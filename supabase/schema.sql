-- gyeoL 로테이션 소개팅 · Supabase 스키마 (v3: 회차별 운영 + 연락처 로그인 + 구글시트 명단)
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요. (여러 번 실행해도 안전합니다)
-- 실행 전에 아래 'CHANGE-ME-1234' 진행자 비밀번호를 바꾸세요.
--
-- ※ 이전 버전(v1 profiles / v2 participants 단일 회차)을 이미 실행했다면, 먼저 아래 두 줄의 주석을 풀어 정리하세요.
-- drop table if exists public.picks, public.notes, public.surveys, public.sessions, public.participants, public.profiles cascade;
-- alter table public.app_settings drop column if exists phase;

-- 이전 버전의 함수 정리 (인자가 달라진 것들)
drop function if exists public.login(text);
drop function if exists public.get_phase();
drop function if exists public.admin_dashboard(text);
drop function if exists public.admin_set_phase(text, text);
drop function if exists public.admin_reset(text);
drop function if exists public.admin_import(text, jsonb, boolean);

-- ───────────────────────── 테이블 ─────────────────────────

create table if not exists public.app_settings (
  id        int primary key default 1 check (id = 1),
  admin_pin text not null,
  max_picks int  not null default 3
);
insert into public.app_settings (id, admin_pin) values (1, 'CHANGE-ME-1234')
on conflict (id) do nothing;

-- 회차: 진행 단계(phase)는 회차마다 따로 가진다.
create table if not exists public.rounds (
  id         text primary key,                          -- 예: 11/8
  label      text not null,                             -- 예: 11/8 (일)
  phase      text not null default 'registration'
             check (phase in ('registration','rotation','selection','result')),
  created_at timestamptz not null default now()
);

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

-- 로그인 상태(브라우저에 저장되는 임의 토큰)
create table if not exists public.sessions (
  token          uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at     timestamptz not null default now()
);

create table if not exists public.notes (
  participant_id uuid not null references public.participants(id) on delete cascade,
  target_id      uuid not null references public.participants(id) on delete cascade,
  memo           text not null default '',
  mark           int  not null default 0 check (mark between 0 and 3),
  updated_at     timestamptz not null default now(),
  primary key (participant_id, target_id)
);

create table if not exists public.picks (
  participant_id uuid not null references public.participants(id) on delete cascade,
  target_id      uuid not null references public.participants(id) on delete cascade,
  rank           int  not null,
  primary key (participant_id, target_id)
);

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

-- 내가 속한 회차의 진행 단계
create or replace function public.get_phase(p_token uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare ph text;
begin
  select r.phase into ph from public.participants p join public.rounds r on r.id = p.round_id
   where p.id = public._me(p_token);
  return ph;
end $$;

-- 로테이션이 시작된 뒤에만, 같은 회차의 이성 참가자 카드(연락처 제외)를 돌려준다.
create or replace function public.get_cards(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.participants; ph text;
begin
  select * into me from public.participants where id = public._me(p_token);
  select phase into ph from public.rounds where id = me.round_id;
  if ph = 'registration' then return '[]'::jsonb; end if;
  return (
    select coalesce(jsonb_agg(public._card_json(p) order by p.number), '[]'::jsonb)
    from public.participants p where p.round_id = me.round_id and p.gender <> me.gender
  );
end $$;

create or replace function public.get_notes(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid := public._me(p_token);
begin
  return coalesce((
    select jsonb_object_agg(target_id::text, jsonb_build_object('memo', memo, 'mark', mark))
    from public.notes where participant_id = pid), '{}'::jsonb);
end $$;

create or replace function public.save_note(p_token uuid, p_target uuid, p_memo text, p_mark int)
returns void language plpgsql security definer set search_path = public as $$
declare me public.participants; ph text;
begin
  select * into me from public.participants where id = public._me(p_token);
  select phase into ph from public.rounds where id = me.round_id;
  if ph = 'registration' then raise exception 'cards_closed'; end if;
  if not exists (select 1 from public.participants
                 where id = p_target and round_id = me.round_id and gender <> me.gender) then
    raise exception 'invalid_target';
  end if;
  insert into public.notes (participant_id, target_id, memo, mark)
  values (me.id, p_target, left(coalesce(p_memo, ''), 2000), least(3, greatest(0, coalesce(p_mark, 0))))
  on conflict (participant_id, target_id)
  do update set memo = excluded.memo, mark = excluded.mark, updated_at = now();
end $$;

-- 최종 선택 + 설문을 한 번에 저장한다. 결과 발표 전까지 다시 제출하면 덮어쓴다.
create or replace function public.submit_picks(p_token uuid, p_targets uuid[], p_survey jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.participants; ph text; mx int;
  cnt int := coalesce(array_length(p_targets, 1), 0);
begin
  select * into me from public.participants where id = public._me(p_token);
  select phase into ph from public.rounds where id = me.round_id;
  select max_picks into mx from public.app_settings where id = 1;
  if ph <> 'selection' then raise exception 'selection_closed'; end if;
  if cnt > mx then raise exception 'too_many'; end if;
  if cnt > 0 then
    if (select count(distinct x) from unnest(p_targets) x) <> cnt then raise exception 'invalid_target'; end if;
    if exists (
      select 1 from unnest(p_targets) x
      where not exists (select 1 from public.participants q
                        where q.id = x and q.round_id = me.round_id and q.gender <> me.gender)
    ) then raise exception 'invalid_target'; end if;
  end if;

  delete from public.picks where participant_id = me.id;
  if cnt > 0 then
    insert into public.picks (participant_id, target_id, rank)
    select me.id, t.x, t.ord::int from unnest(p_targets) with ordinality as t(x, ord);
  end if;

  insert into public.surveys (participant_id, answers)
  values (me.id, coalesce(p_survey, '{}'::jsonb))
  on conflict (participant_id) do update set answers = excluded.answers, submitted_at = now();
end $$;

create or replace function public.get_my_picks(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid := public._me(p_token);
begin
  return jsonb_build_object(
    'picks', (select coalesce(jsonb_agg(target_id order by rank), '[]'::jsonb) from public.picks where participant_id = pid),
    'submitted', exists (select 1 from public.surveys where participant_id = pid),
    'answers', coalesce((select answers from public.surveys where participant_id = pid), '{}'::jsonb)
  );
end $$;

-- 결과 발표 단계에서만 동작. 서로 선택한 경우에만 상대 연락처가 포함된다.
create or replace function public.get_result(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.participants; ph text;
begin
  select * into me from public.participants where id = public._me(p_token);
  select phase into ph from public.rounds where id = me.round_id;
  if ph <> 'result' then raise exception 'not_ready'; end if;
  return (
    select coalesce(jsonb_agg(s.x order by (s.x->>'rank')::int), '[]'::jsonb) from (
      select jsonb_build_object(
        'rank', pk.rank, 'number', t.number, 'name', t.name, 'age_label', t.age_label, 'school', t.school,
        'mutual', m.mutual,
        'phone', case when m.mutual then t.phone end) as x
      from public.picks pk
      join public.participants t on t.id = pk.target_id
      cross join lateral (
        select exists (select 1 from public.picks b where b.participant_id = pk.target_id and b.target_id = pk.participant_id) as mutual
      ) m
      where pk.participant_id = me.id
    ) s
  );
end $$;

-- ───────────────────────── 진행자용 함수 (비밀번호 필요) ─────────────────────────

create or replace function public._check_admin(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_pin is null or not exists (select 1 from public.app_settings where id = 1 and admin_pin = p_pin) then
    raise exception 'bad_pin';
  end if;
end $$;

-- 회차 목록 (진행 단계와 인원 포함)
create or replace function public.admin_rounds(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'label', r.label, 'phase', r.phase,
      'count', (select count(*) from public.participants p where p.round_id = r.id)) order by r.id)
    from public.rounds r), '[]'::jsonb);
end $$;

-- 한 회차의 참가자(연락처 포함), 매칭, 설문
create or replace function public.admin_dashboard(p_pin text, p_round text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  return jsonb_build_object(
    'round', (select jsonb_build_object('id', id, 'label', label, 'phase', phase) from public.rounds where id = p_round),
    'phase', (select phase from public.rounds where id = p_round),
    'participants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'number', p.number, 'gender', p.gender, 'name', p.name, 'phone', p.phone,
        'age_label', p.age_label, 'school', p.school, 'mbti', p.mbti, 'hobby', p.hobby,
        'submitted', exists (select 1 from public.surveys s where s.participant_id = p.id)
      ) order by p.gender desc, p.number), '[]'::jsonb) from public.participants p where p.round_id = p_round),
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

create or replace function public.admin_set_phase(p_pin text, p_round text, p_phase text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  if p_phase not in ('registration','rotation','selection','result') then raise exception 'invalid_phase'; end if;
  update public.rounds set phase = p_phase where id = p_round;
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
  delete from public.participants where id = p_id;   -- 메모·선택·설문·로그인은 연쇄 삭제
end $$;

-- 한 회차를 비우고 '준비' 단계로 되돌린다.
create or replace function public.admin_reset(p_pin text, p_round text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._check_admin(p_pin);
  delete from public.participants where round_id = p_round;
  update public.rounds set phase = 'registration' where id = p_round;
end $$;

-- 명단 가져오기. 한 회차 안에서 연락처가 같으면 갱신, 없으면 추가한다. (시트가 바뀌면 다시 가져오면 된다)
-- 회차(p_round)가 없으면 새로 만든다.
-- p_rows: [{phone, gender('M'|'F'), name, age_label, school, mbti, hobby, number?}]
--   number 가 있으면 그 번호를 쓰고, 없으면 새 참가자에게 같은 성별의 다음 번호를 붙인다.
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
          coalesce(num, (select coalesce(max(number), 0) + 1 from public.participants
                          where round_id = trim(p_round) and gender = g)),
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
