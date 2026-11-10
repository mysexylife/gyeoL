-- gyeoL 로테이션 소개팅 · Supabase 스키마 (v4)
--   · 회차별 운영, 연락처 로그인, 구글시트 명단
--   · 최종 선택은 언제든 제출(번호/이름 입력), 매칭 결과 공개는 진행자가 회차별로 한 번에 연다
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요. (여러 번 실행해도 안전합니다)
-- 실행 전에 아래 '01000000000' 을 진행자 마스터키(숫자 8자리 이상, 예: 휴대폰 번호 형태)로 바꾸세요.
--
-- ※ v1(profiles / Supabase Auth) 을 실행했다면 먼저 아래 한 줄의 주석을 풀어 정리하세요.
-- drop table if exists public.picks, public.notes, public.surveys, public.sessions, public.participants, public.profiles cascade;

-- 이전 버전의 함수 정리 (인자가 달라졌거나 없어진 것들)
drop function if exists public.login(text);
drop function if exists public.get_phase();
drop function if exists public.get_phase(uuid);
drop function if exists public.get_cards(uuid);
drop function if exists public.save_note(uuid, uuid, text, int);
drop function if exists public.submit_picks(uuid, uuid[], jsonb);
drop function if exists public.admin_dashboard(text);
drop function if exists public.admin_set_phase(text, text);
drop function if exists public.admin_set_phase(text, text, text);
drop function if exists public.admin_reset(text);
drop function if exists public.admin_import(text, jsonb, boolean);

-- ───────────────────────── 테이블 ─────────────────────────

create table if not exists public.app_settings (
  id        int primary key default 1 check (id = 1),
  admin_pin text not null,                -- 진행자 마스터키 (숫자). 진행자 모두가 같은 키로 들어간다
  max_picks int  not null default 3
);
insert into public.app_settings (id, admin_pin) values (1, '01000000000')
on conflict (id) do nothing;

-- 회차: 매칭 결과를 열었는지(results_open)를 회차마다 따로 가진다.
create table if not exists public.rounds (
  id           text primary key,                        -- 날짜 YYYY-MM-DD (화면에는 11/8 (일) 로 표시)
  label        text not null,                           -- 예: 11/8 (일)
  results_open boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.rounds add column if not exists results_open boolean not null default false;
alter table public.rounds drop column if exists phase;   -- v3 까지 쓰던 진행 단계

-- 참가자 = (회차, 사람). 두 회차를 신청한 사람은 회차마다 한 줄씩 가진다.
create table if not exists public.participants (
  id         uuid primary key default gen_random_uuid(),
  round_id   text not null references public.rounds(id) on delete cascade,
  phone      text not null,                             -- 숫자만 (01012345678)
  gender     text not null check (gender in ('M','F')),
  number     int  not null,
  name       text not null,
  age_label  text,                                      -- 예: 03년생
  school     text,                                      -- 예: 고려대-건축학과
  mbti       text,
  hobby      text,
  created_at timestamptz not null default now(),
  constraint participants_round_phone_key unique (round_id, phone),
  -- 번호 맞교환이 한 번에 되도록, 검사는 트랜잭션 끝에서 한다
  constraint participants_round_gender_number_key unique (round_id, gender, number) deferrable initially deferred
);
create index if not exists participants_phone_idx on public.participants (phone);

-- 회차 id 를 'YYYY-MM-DD' 로 통일한다. (v4 까지는 '11/8' 처럼 연도 없이 저장했다)
-- 이미 만들어진 회차는 만든 해를 붙여 옮기고, 참가자도 함께 옮긴다. 여러 번 실행해도 안전하다.
do $$
declare r record; nid text;
begin
  for r in select id, created_at from public.rounds where id ~ '^\d{1,2}/\d{1,2}$' loop
    nid := to_char(make_date(extract(year from r.created_at)::int, split_part(r.id, '/', 1)::int, split_part(r.id, '/', 2)::int), 'YYYY-MM-DD');
    insert into public.rounds (id, label, results_open, created_at)
      select nid, label, results_open, created_at from public.rounds where id = r.id
      on conflict (id) do nothing;
    update public.participants set round_id = nid where round_id = r.id;
    delete from public.rounds where id = r.id;
  end loop;
end $$;


-- 신청자 대기 명단: 구글폼/시트로 들어온 사람. 진행자가 사진·성비를 보고 회차에 배정하면 그때 참가자가 된다.
-- 사진은 링크(구글 드라이브)만 저장하고, 진행자 함수에서만 내려준다.
create table if not exists public.applicants (
  id             uuid primary key default gen_random_uuid(),
  phone          text not null unique,                  -- 숫자만. 같은 사람이 다시 신청하면 정보만 갱신
  gender         text not null check (gender in ('M','F')),
  name           text not null,
  age_label      text,
  school         text,
  mbti           text,
  hobby          text,
  pref_date      text,                                  -- 신청한 날짜 YYYY-MM-DD (선호일, 배정과는 별개)
  photo_url      text,
  assigned_round text,                                  -- 배정된 회차. null 이면 대기 중
  created_at     timestamptz not null default now()
);
alter table public.applicants enable row level security;

-- 로그인 상태(브라우저에 저장되는 임의 토큰)
create table if not exists public.sessions (
  token          uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at     timestamptz not null default now()
);

-- 메모장: 상대 참가자와 연결하지 않는 단순 기억용 메모. slot = 이성 번호(1~9)
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'notes' and column_name = 'target_id') then
    drop table public.notes;                              -- v3 의 옛 형식
  end if;
end $$;
create table if not exists public.notes (
  participant_id uuid not null references public.participants(id) on delete cascade,
  slot           int  not null check (slot between 1 and 30),
  memo           text not null default '',
  mark           int  not null default 0 check (mark between 0 and 3),
  updated_at     timestamptz not null default now(),
  primary key (participant_id, slot)
);

create table if not exists public.picks (
  participant_id uuid not null references public.participants(id) on delete cascade,
  rank           int  not null,
  target_id      uuid references public.participants(id) on delete cascade,  -- 명단에서 못 찾은 입력은 null (진행자가 맞춰 준다)
  input_text     text,                                                       -- 참가자가 적은 그대로
  primary key (participant_id, rank)
);
-- v4 까지의 picks (PK = participant_id, target_id) 를 새 구조로 바꾼다
alter table public.picks add column if not exists input_text text;
alter table public.picks alter column target_id drop not null;
do $$ begin
  if not exists (select 1 from information_schema.key_column_usage k
                 where k.table_schema = 'public' and k.table_name = 'picks'
                   and k.constraint_name = 'picks_pkey' and k.column_name = 'rank') then
    alter table public.picks drop constraint if exists picks_pkey;
    alter table public.picks add primary key (participant_id, rank);
  end if;
end $$;
create unique index if not exists picks_participant_target_idx
  on public.picks (participant_id, target_id) where target_id is not null;

create table if not exists public.surveys (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  answers        jsonb not null default '{}'::jsonb,
  submitted_at   timestamptz not null default now()
);

-- ───────────────────────── 접근 권한 ─────────────────────────
-- 모든 테이블은 RLS 를 켜고 정책을 하나도 만들지 않는다 = 브라우저(anon 키)는 테이블을 직접 읽거나 쓸 수 없다.
-- 모든 접근은 아래 함수(security definer)를 통해서만 이루어진다.

alter table public.app_settings enable row level security;
alter table public.rounds       enable row level security;
alter table public.participants enable row level security;
alter table public.sessions     enable row level security;
alter table public.notes        enable row level security;
alter table public.picks        enable row level security;
alter table public.surveys      enable row level security;

-- ───────────────────────── 내부 도우미 ─────────────────────────

-- 전화번호를 숫자만 남기고 01012345678 형태로 맞춘다. (+82, 앞자리 0 누락 대응)
create or replace function public._norm_phone(t text)
returns text language sql immutable as $$
  select case
    when d ~ '^82' and length(d) >= 11 then '0' || substr(d, 3)
    when length(d) = 10 and d ~ '^1' then '0' || d
    else d end
  from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) s
$$;

-- 연락처는 숫자만 저장한다. 하이픈·공백이 섞여 저장된 옛 데이터를 정리한다. (같은 회차에 정리 결과가 겹치면 건너뜀)
do $$
declare r record; np text;
begin
  for r in select id, round_id, phone from public.participants where phone !~ '^\d+$' loop
    np := public._norm_phone(r.phone);
    if np <> '' and not exists (select 1 from public.participants where round_id = r.round_id and phone = np and id <> r.id) then
      update public.participants set phone = np where id = r.id;
    end if;
  end loop;
end $$;

create or replace function public._me(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select participant_id into pid from public.sessions where token = p_token;
  if pid is null then raise exception 'not_authenticated'; end if;
  return pid;
end $$;

create or replace function public._card_json(p public.participants, with_phone boolean default false)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'number', p.number, 'gender', p.gender, 'name', p.name,
    'age_label', p.age_label, 'school', p.school, 'mbti', p.mbti, 'hobby', p.hobby)
    || case when with_phone then jsonb_build_object(
         'phone', p.phone, 'round_id', p.round_id,
         'round_label', (select label from public.rounds where id = p.round_id))
       else '{}'::jsonb end
$$;

-- ───────────────────────── 참가자용 함수 ─────────────────────────

-- 연락처로 입장. 명단(구글시트)에 있는 번호만 들어올 수 있다.
-- 두 회차 이상에 있는 번호면 {choices:[{round_id,label}]} 를 돌려주고, 회차를 골라 다시 호출한다.
create or replace function public.login(p_phone text, p_round text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := public._norm_phone(p_phone); n int; pr public.participants; tok uuid;
begin
  select count(*) into n from public.participants where phone = ph;
  if n = 0 then raise exception 'not_registered'; end if;
  if p_round is null and n > 1 then
    return jsonb_build_object('choices', (
      select jsonb_agg(jsonb_build_object('round_id', r.id, 'label', r.label) order by r.id)
      from public.participants p join public.rounds r on r.id = p.round_id where p.phone = ph));
  end if;
  select * into pr from public.participants
   where phone = ph and (p_round is null or round_id = p_round) order by created_at limit 1;
  if not found then raise exception 'not_registered'; end if;
  delete from public.sessions where created_at < now() - interval '14 days';
  insert into public.sessions (participant_id) values (pr.id) returning token into tok;
  return jsonb_build_object('token', tok, 'me', public._card_json(pr, true));
end $$;

create or replace function public.logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.sessions where token = p_token
$$;

create or replace function public.get_me(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr public.participants;
begin
  select * into pr from public.participants where id = public._me(p_token);
  return public._card_json(pr, true);
end $$;

-- 내 회차에서 매칭 결과가 열렸는지
create or replace function public.get_status(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ro boolean;
begin
  select r.results_open into ro from public.participants p join public.rounds r on r.id = p.round_id
   where p.id = public._me(p_token);
  return jsonb_build_object('results_open', coalesce(ro, false));
end $$;

create or replace function public.get_notes(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid := public._me(p_token);
begin
  return coalesce((
    select jsonb_object_agg(slot::text, jsonb_build_object('memo', memo, 'mark', mark))
    from public.notes where participant_id = pid), '{}'::jsonb);
end $$;

create or replace function public.save_note(p_token uuid, p_slot int, p_memo text, p_mark int)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid := public._me(p_token);
begin
  if p_slot is null or p_slot < 1 or p_slot > 30 then raise exception 'invalid_slot'; end if;
  insert into public.notes (participant_id, slot, memo, mark)
  values (pid, p_slot, left(coalesce(p_memo, ''), 2000), least(3, greatest(0, coalesce(p_mark, 0))))
  on conflict (participant_id, slot)
  do update set memo = excluded.memo, mark = excluded.mark, updated_at = now();
end $$;

-- 최종 선택 + 설문 제출. 결과가 열리기 전에는 언제든 다시 제출(덮어쓰기)할 수 있다.
-- p_inputs: 이성 번호(예: '3') 또는 이름(예: '지은') 최대 3개. 같은 회차의 이성 참가자로 찾아 저장한다.
-- 반환: {picks:[{number,name}]}  (참가자가 오타를 확인할 수 있게)
-- 최종 선택 + 설문 제출. 결과가 공개되기 전에는 언제든 다시 제출(덮어쓰기)할 수 있다.
-- p_inputs: 이성 번호(예: '3') 또는 성+이름(예: '김지은') 최대 3개.
--   같은 회차의 이성 참가자로 정확히 찾으면 연결하고, 못 찾으면 적은 글자 그대로 저장한다 (진행자가 나중에 맞춘다).
create or replace function public.submit_picks(p_token uuid, p_inputs text[], p_survey jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.participants; mx int; ro boolean;
  x text; t uuid; k int; rk int := 0;
  seen uuid[] := '{}';
  typed text[] := '{}';
begin
  select * into me from public.participants where id = public._me(p_token);
  select results_open into ro from public.rounds where id = me.round_id;
  if ro then raise exception 'result_published'; end if;
  select max_picks into mx from public.app_settings where id = 1;

  foreach x in array coalesce(p_inputs, '{}') loop
    x := left(btrim(coalesce(x, '')), 40);
    if x <> '' then typed := typed || x; end if;
  end loop;
  if coalesce(cardinality(typed), 0) > mx then raise exception 'too_many'; end if;

  delete from public.picks where participant_id = me.id;
  foreach x in array typed loop
    t := null;
    if x ~ '^\d{1,3}\s*번?$' then
      select id into t from public.participants
       where round_id = me.round_id and gender <> me.gender and number = regexp_replace(x, '\D', '', 'g')::int;
    else
      select count(*) into k from public.participants
       where round_id = me.round_id and gender <> me.gender
         and lower(replace(name, ' ', '')) = lower(replace(regexp_replace(x, '\s*님$', ''), ' ', ''));
      if k = 1 then
        select id into t from public.participants
         where round_id = me.round_id and gender <> me.gender
           and lower(replace(name, ' ', '')) = lower(replace(regexp_replace(x, '\s*님$', ''), ' ', ''));
      end if;
    end if;
    if t is not null then
      if t = any(seen) then continue; end if;      -- 같은 사람을 두 번 적었으면 한 번만
      seen := seen || t;
    end if;
    rk := rk + 1;
    insert into public.picks (participant_id, rank, target_id, input_text) values (me.id, rk, t, x);
  end loop;

  insert into public.surveys (participant_id, answers)
  values (me.id, coalesce(p_survey, '{}'::jsonb))
  on conflict (participant_id) do update set answers = excluded.answers, submitted_at = now();

  return jsonb_build_object('picks', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rank', pk.rank, 'input', pk.input_text, 'resolved', pk.target_id is not null,
      'number', p.number, 'name', p.name) order by pk.rank), '[]'::jsonb)
    from public.picks pk left join public.participants p on p.id = pk.target_id
    where pk.participant_id = me.id));
end $$;

create or replace function public.get_my_picks(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid := public._me(p_token);
begin
  return jsonb_build_object(
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', pk.rank, 'input', pk.input_text, 'resolved', pk.target_id is not null,
        'number', p.number, 'name', p.name) order by pk.rank)
      from public.picks pk left join public.participants p on p.id = pk.target_id
      where pk.participant_id = pid), '[]'::jsonb),
    'submitted', exists (select 1 from public.surveys where participant_id = pid),
    'answers', coalesce((select answers from public.surveys where participant_id = pid), '{}'::jsonb)
  );
end $$;

-- 진행자가 결과를 연 뒤에만 동작. 서로 선택한 경우에만 상대 연락처가 포함된다.
create or replace function public.get_result(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.participants; ro boolean;
begin
  select * into me from public.participants where id = public._me(p_token);
  select results_open into ro from public.rounds where id = me.round_id;
  if not coalesce(ro, false) then raise exception 'not_ready'; end if;
  return (
    select coalesce(jsonb_agg(s.x order by (s.x->>'rank')::int), '[]'::jsonb) from (
      select jsonb_build_object(
        'rank', pk.rank, 'resolved', pk.target_id is not null, 'input', pk.input_text,
        'number', t.number, 'name', t.name, 'age_label', t.age_label, 'school', t.school,
        'mutual', m.mutual,
        'phone', case when m.mutual then t.phone end) as x
      from public.picks pk
      left join public.participants t on t.id = pk.target_id
      cross join lateral (
        select exists (select 1 from public.picks b
                       where b.participant_id = pk.target_id and b.target_id = pk.participant_id) as mutual
      ) m
      where pk.participant_id = me.id
    ) s
  );
end $$;

-- ───────────────────────── 진행자용 함수 (비밀번호 필요) ─────────────────────────

-- 마스터키 확인. 하이픈·공백은 무시하고 숫자만 비교한다. (010-1234-5678 = 01012345678)
create or replace function public.check_master(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_settings
    where id = 1
      and length(regexp_replace(coalesce(p_key, ''), '\D', '', 'g')) >= 8
      and regexp_replace(coalesce(p_key, ''), '\D', '', 'g') = regexp_replace(admin_pin, '\D', '', 'g'))
$$;

create or replace function public._check_admin(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.check_master(p_pin) then raise exception 'bad_pin'; end if;
end $$;


-- 회차 목록 (결과 공개 여부와 인원 포함)
create or replace function public.admin_rounds(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'label', r.label, 'results_open', r.results_open,
      'count', (select count(*) from public.participants p where p.round_id = r.id),
      'male',  (select count(*) from public.participants p where p.round_id = r.id and p.gender = 'M'),
      'female',(select count(*) from public.participants p where p.round_id = r.id and p.gender = 'F')) order by r.id)
    from public.rounds r), '[]'::jsonb);
end $$;

-- 한 회차의 참가자(연락처 포함), 매칭, 설문
create or replace function public.admin_dashboard(p_pin text, p_round text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  return jsonb_build_object(
    'round', (select jsonb_build_object('id', id, 'label', label, 'results_open', results_open) from public.rounds where id = p_round),
    'results_open', coalesce((select results_open from public.rounds where id = p_round), false),
    'participants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'number', p.number, 'gender', p.gender, 'name', p.name, 'phone', p.phone,
        'age_label', p.age_label, 'school', p.school, 'mbti', p.mbti, 'hobby', p.hobby,
        'submitted', exists (select 1 from public.surveys s where s.participant_id = p.id)
      ) order by p.gender desc, p.number), '[]'::jsonb) from public.participants p where p.round_id = p_round),
    -- 참가자별 최종 선택: target_id 가 없으면 명단에서 못 찾은 입력(진행자가 맞춰야 함)
    'picks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'participant_id', pk.participant_id, 'rank', pk.rank, 'target_id', pk.target_id, 'input', pk.input_text,
        'target_number', t.number, 'target_name', t.name) order by pk.participant_id, pk.rank), '[]'::jsonb)
      from public.picks pk
      join public.participants me on me.id = pk.participant_id and me.round_id = p_round
      left join public.participants t on t.id = pk.target_id),
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'm_number', m.number, 'm_name', m.name, 'f_number', f.number, 'f_name', f.name
      ) order by m.number), '[]'::jsonb)
      from public.picks x
      join public.picks y on y.participant_id = x.target_id and y.target_id = x.participant_id
      join public.participants m on m.id = x.participant_id and m.gender = 'M' and m.round_id = p_round
      join public.participants f on f.id = x.target_id),
    'surveys', (
      select coalesce(jsonb_agg(jsonb_build_object('gender', p.gender, 'answers', s.answers)
        order by s.submitted_at), '[]'::jsonb)
      from public.surveys s join public.participants p on p.id = s.participant_id where p.round_id = p_round)
  );
end $$;

-- 매칭 결과 공개 / 공개 취소 (회차별)
create or replace function public.admin_set_results(p_pin text, p_round text, p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  update public.rounds set results_open = coalesce(p_open, false) where id = p_round;
end $$;

-- 한 참가자의 최종 선택을 진행자가 직접 정한다. (제출하지 않은 사람도 가능, 결과 공개 후에도 가능)
-- p_targets: 선택한 상대의 participant id 를 1순위부터 순서대로 (최대 max_picks 개). 빈 배열이면 선택을 비운다.
create or replace function public.admin_set_picks(p_pin text, p_participant uuid, p_targets uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare me public.participants; mx int; cnt int := coalesce(cardinality(p_targets), 0);
begin
  perform public._check_admin(p_pin);
  select * into me from public.participants where id = p_participant;
  if not found then raise exception 'not_registered'; end if;
  select max_picks into mx from public.app_settings where id = 1;
  if cnt > mx then raise exception 'too_many'; end if;
  if cnt > 0 then
    if (select count(distinct x) from unnest(p_targets) x) <> cnt then raise exception 'invalid_target'; end if;
    if exists (select 1 from unnest(p_targets) x
               where not exists (select 1 from public.participants q
                                 where q.id = x and q.round_id = me.round_id and q.gender <> me.gender)) then
      raise exception 'invalid_target';
    end if;
  end if;
  delete from public.picks where participant_id = me.id;
  if cnt > 0 then
    insert into public.picks (participant_id, rank, target_id, input_text)
    select me.id, u.ord::int, u.id, null from unnest(p_targets) with ordinality as u(id, ord);
  end if;
end $$;

create or replace function public.admin_set_number(p_pin text, p_id uuid, p_number int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  if p_number is null or p_number < 1 then raise exception 'invalid_number'; end if;
  set constraints public.participants_round_gender_number_key immediate;
  begin
    update public.participants set number = p_number where id = p_id;
  exception when unique_violation then
    raise exception 'number_taken';
  end;
end $$;

create or replace function public.admin_remove(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  update public.applicants a set assigned_round = null
    from public.participants x where x.id = p_id and a.phone = x.phone and a.assigned_round = x.round_id;
  delete from public.participants where id = p_id;   -- 메모·선택·설문·로그인은 연쇄 삭제
end $$;

-- 한 회차를 비우고 결과를 다시 닫는다.
create or replace function public.admin_reset(p_pin text, p_round text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  delete from public.participants where round_id = p_round;
  update public.applicants set assigned_round = null where assigned_round = p_round;
  update public.rounds set results_open = false where id = p_round;
end $$;

-- 명단 가져오기. 한 회차 안에서 연락처가 같으면 갱신, 없으면 추가한다. (시트가 바뀌면 다시 가져오면 된다)
-- 회차(p_round)가 없으면 새로 만든다.
-- p_rows: [{phone, gender('M'|'F'), name, age_label, school, mbti, hobby, number?}]
--   number 가 있으면 그 번호를 쓰고, 없으면 같은 성별에서 비어 있는 가장 작은 번호(빈 번호가 없으면 맨 뒤 번호)를 붙인다.
-- p_prune: true 면 이번 명단에 없는 사람(이 회차 안)을 삭제한다.
create or replace function public.admin_import(p_pin text, p_round text, p_label text, p_rows jsonb, p_prune boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; ph text; g text; nm text; num int; pass int;
  ins int := 0; upd int := 0; skipped int := 0; pruned int := 0;
  seen text[] := '{}';
begin
  perform public._check_admin(p_pin);
  if nullif(trim(p_round), '') is null then raise exception 'round_required'; end if;
  if trim(p_round) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_round'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_rows'; end if;

  insert into public.rounds (id, label) values (trim(p_round), coalesce(nullif(trim(p_label), ''), trim(p_round)))
  on conflict (id) do update set label = excluded.label;

  for pass in 1..2 loop                     -- 1: 번호가 지정된 행, 2: 번호가 없는 행
    for r in select * from jsonb_array_elements(p_rows) loop
      ph  := public._norm_phone(r->>'phone');
      g   := r->>'gender';
      nm  := nullif(trim(r->>'name'), '');
      num := nullif(r->>'number', '')::int;
      if ph = '' or nm is null or g is null or g not in ('M','F') then
        if pass = 1 then skipped := skipped + 1; end if;
        continue;
      end if;
      if (num is not null) <> (pass = 1) then continue; end if;
      seen := seen || ph;

      if exists (select 1 from public.participants where round_id = trim(p_round) and phone = ph) then
        update public.participants set
          gender = g, name = nm,
          age_label = nullif(trim(r->>'age_label'), ''), school = nullif(trim(r->>'school'), ''),
          mbti = nullif(upper(trim(r->>'mbti')), ''), hobby = nullif(trim(r->>'hobby'), ''),
          number = coalesce(num, number)
        where round_id = trim(p_round) and phone = ph;
        upd := upd + 1;
      else
        insert into public.participants (round_id, phone, gender, number, name, age_label, school, mbti, hobby)
        values (trim(p_round), ph, g,
          -- 번호를 비우면: 같은 날짜·같은 성별에서 비어 있는 가장 작은 번호, 빈 번호가 없으면 맨 뒤 번호
          coalesce(num, (
            select min(gs) from generate_series(1, coalesce((
              select max(p2.number) from public.participants p2
               where p2.round_id = trim(p_round) and p2.gender = g), 0) + 1) gs
             where not exists (
              select 1 from public.participants p3
               where p3.round_id = trim(p_round) and p3.gender = g and p3.number = gs))),
          nm, nullif(trim(r->>'age_label'), ''), nullif(trim(r->>'school'), ''),
          nullif(upper(trim(r->>'mbti')), ''), nullif(trim(r->>'hobby'), ''));
        ins := ins + 1;
      end if;
    end loop;
  end loop;

  if p_prune then
    delete from public.participants where round_id = trim(p_round) and not (phone = any(seen));
    get diagnostics pruned = row_count;
  end if;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skipped, 'pruned', pruned);
end $$;


-- ───────────────────────── 신청자 대기 명단 (진행자) ─────────────────────────

-- 전체 신청자 (연락처·사진 링크 포함). 배정된 사람도 함께 돌려준다.
create or replace function public.admin_applicants(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'phone', a.phone, 'gender', a.gender, 'name', a.name, 'age_label', a.age_label,
      'school', a.school, 'mbti', a.mbti, 'hobby', a.hobby, 'pref_date', a.pref_date,
      'photo_url', a.photo_url, 'assigned_round', a.assigned_round, 'created_at', a.created_at)
      order by a.created_at, a.name)
    from public.applicants a), '[]'::jsonb);
end $$;

-- 신청자 추가·갱신. 연락처가 같으면 정보만 갱신하고 배정 상태는 그대로 둔다.
-- p_rows: [{phone, gender, name, age_label, school, mbti, hobby, pref_date, photo_url}]
create or replace function public.admin_applicant_import(p_pin text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; ph text; g text; nm text; pd text; pu text; ins int := 0; upd int := 0; skipped int := 0;
begin
  perform public._check_admin(p_pin);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    ph := public._norm_phone(r->>'phone'); g := r->>'gender'; nm := nullif(trim(r->>'name'), '');
    pd := nullif(trim(r->>'pref_date'), ''); pu := nullif(trim(r->>'photo_url'), '');
    if ph = '' or nm is null or g is null or g not in ('M','F') then skipped := skipped + 1; continue; end if;
    if pd is not null and pd !~ '^\d{4}-\d{2}-\d{2}$' then pd := null; end if;
    if pu is not null and pu !~* '^https?://' then pu := null; end if;
    if exists (select 1 from public.applicants where phone = ph) then
      update public.applicants set
        gender = g, name = nm, age_label = nullif(trim(r->>'age_label'), ''), school = nullif(trim(r->>'school'), ''),
        mbti = nullif(upper(trim(r->>'mbti')), ''), hobby = nullif(trim(r->>'hobby'), ''),
        pref_date = coalesce(pd, pref_date), photo_url = coalesce(pu, photo_url)
      where phone = ph;
      upd := upd + 1;
    else
      insert into public.applicants (phone, gender, name, age_label, school, mbti, hobby, pref_date, photo_url)
      values (ph, g, nm, nullif(trim(r->>'age_label'), ''), nullif(trim(r->>'school'), ''),
              nullif(upper(trim(r->>'mbti')), ''), nullif(trim(r->>'hobby'), ''), pd, pu);
      ins := ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skipped);
end $$;

-- 신청자를 회차에 배정한다. 참가자가 만들어지고 번호는 성별별로 비어 있는 가장 작은 번호가 붙는다.
create or replace function public.admin_assign(p_pin text, p_ids uuid[], p_round text, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rows jsonb; n int;
begin
  perform public._check_admin(p_pin);
  if trim(coalesce(p_round, '')) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_round'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'phone', a.phone, 'gender', a.gender, 'name', a.name, 'age_label', a.age_label,
      'school', a.school, 'mbti', a.mbti, 'hobby', a.hobby) order by a.created_at), '[]'::jsonb)
    into rows from public.applicants a
   where a.id = any(p_ids) and a.assigned_round is null;
  n := jsonb_array_length(rows);
  if n = 0 then return jsonb_build_object('assigned', 0); end if;
  perform public.admin_import(p_pin, trim(p_round), p_label, rows, false);
  update public.applicants set assigned_round = trim(p_round) where id = any(p_ids) and assigned_round is null;
  return jsonb_build_object('assigned', n);
end $$;

-- 배정을 되돌린다: 그 회차의 참가자(메모·선택·설문 포함)를 지우고 대기 상태로 돌린다.
create or replace function public.admin_unassign(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.applicants;
begin
  perform public._check_admin(p_pin);
  select * into a from public.applicants where id = p_id;
  if a.id is null or a.assigned_round is null then return; end if;
  delete from public.participants where round_id = a.assigned_round and phone = a.phone;
  update public.applicants set assigned_round = null where id = p_id;
end $$;

create or replace function public.admin_applicant_remove(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  delete from public.applicants where id = p_id;
end $$;
