/* 공통: 설문 문항, 오류 문구, 백엔드(Supabase / 체험 모드) */
(function () {
  const cfg = window.APP_CONFIG || {};
  const isDemo = new URLSearchParams(location.search).has("demo") || !cfg.supabaseUrl || !cfg.supabaseAnonKey;

  const MAX_PICKS = 3;
  const MEMO_SLOTS = 9;   // 메모장 칸 수 (이성 번호 1~9)

  // 참가 후기 설문 (준비해 주신 PDF 문항). type: scale | multi | matrix | choice | text
  // 문항을 바꿔도 DB 수정은 필요 없습니다. (answers 는 JSON 으로 저장)
  const YES_NO = ["네, 괜찮아요", "아니오"];
  const SURVEY = [
    { id: "q1", type: "scale", required: true, label: "오늘 결, 전반적으로 만족하셨나요?", low: "아쉬웠어요", high: "정말 좋았어요" },
    { id: "q2", type: "multi", label: "오늘 가장 좋았던 점은? (복수 선택)", options: ["3:3 그룹 대화", "1:1 로테이션", "질문 카드", "장소·분위기", "음료·다과", "운영진 진행"] },
    { id: "q3", type: "matrix", label: "대화 시간은 어땠나요?", options: ["짧았어요", "적당했어요", "길었어요"],
      rows: [{ id: "group", label: "3:3 그룹 (8분)" }, { id: "one", label: "1:1 로테이션 (5분)" }] },
    { id: "q4", type: "scale", label: "질문 카드가 대화에 도움이 됐나요?", low: "별로였어요", high: "큰 도움" },
    { id: "q5", type: "choice", label: "참가비는 어땠나요?", options: ["저렴해요", "적당해요", "조금 비싸요", "비싸요"] },
    { id: "q6", type: "multi", label: "다음 회차는 언제가 좋을까요? (복수 선택)", options: ["평일 저녁", "금요일 저녁", "주말 낮", "주말 저녁"] },
    { id: "q7", type: "text", label: "만족스러웠던 점은?", placeholder: "자유롭게 적어 주세요" },
    { id: "q8", type: "text", label: "아쉬웠던 점은?", placeholder: "자유롭게 적어 주세요" },
    { id: "q9", type: "choice", label: "7번에 적어주신 내용을 익명 후기로 홍보에 사용해도 될까요?", options: YES_NO },
  ];

  const ERRORS = {
    bad_phone: "휴대폰 번호를 정확히 입력해 주세요.",
    not_authenticated: "다시 입장해 주세요.",
    not_registered: "명단에 없는 번호예요. 신청서에 적은 연락처가 맞는지 확인해 주세요.",
    too_many: "최대 " + MAX_PICKS + "명까지 적을 수 있어요.",
    invalid_target: "선택할 수 없는 상대가 포함되어 있어요.",
    result_published: "매칭 결과가 이미 공개되어 선택을 바꿀 수 없어요.",
    not_ready: "아직 매칭 결과가 공개되지 않았어요.",
    invalid_slot: "메모 칸 번호가 올바르지 않아요.",
    bad_pin: "마스터키가 맞지 않아요.",
    round_required: "날짜를 골라 주세요.",
    invalid_round: "날짜 형식이 올바르지 않아요.",
    number_taken: "같은 성별에 이미 쓰고 있는 번호예요.",
    invalid_number: "번호는 1 이상의 숫자여야 해요.",
    participants_round_gender_number_key: "같은 성별에 번호가 겹쳐요. 시트에서 연락처를 바꾼 사람이 있다면, 아래 표에서 이전 행을 삭제하거나 '기존 참가자 삭제' 옵션을 켜고 다시 가져와 주세요.",
    "Failed to fetch": "네트워크 연결을 확인해 주세요.",
  };
  // 서버 오류는 "코드 :: 자세한 내용" 형태로 온다
  function friendly(err) {
    const msg = (err && err.message) || String(err);
    const [head, detail] = msg.split(" :: ");
    if (head.includes("not_found")) return "'" + detail + "'에 해당하는 번호나 이름을 찾지 못했어요. 이름은 성+이름으로 정확히 적어 주세요.";
    if (head.includes("ambiguous_name")) return "'" + detail + "' 이름이 여러 명이에요. 번호로 적어 주세요.";
    if (head.includes("duplicate_pick")) return "'" + detail + "'은(는) 이미 적었어요.";
    for (const k in ERRORS) if (head.includes(k)) return ERRORS[k];
    return "문제가 생겼어요: " + head;
  }

  /* ───────────── 회차(날짜) ─────────────
   * 회차는 'YYYY-MM-DD'(예: 2026-11-08) 한 가지 형식으로 저장하고, 화면에도 같은 형식으로 보여준다.
   * 연도를 id 에 넣는 이유: 해마다 같은 날짜(예: 11/8)가 겹쳐도 지난 회차의 데이터가 섞이지 않게 하려는 것. */
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
  const p2 = (n) => String(n).padStart(2, "0");
  const todayISO = (now) => { now = now || new Date(); return now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate()); };
  const roundLabel = (id) => String(id || "");   // 화면에도 저장된 그대로 '2026-11-08' 형식으로 보여준다
  // 시트의 '11/8' 같은 날짜를 회차 id 로 바꾼다. 올해 기준이고, 5개월 넘게 지난 날짜면 내년으로 본다.
  function toRoundId(token, now) {
    now = now || new Date();
    const [m, d] = String(token).split("/").map(Number);
    let y = now.getFullYear();
    if ((now - new Date(y, m - 1, d)) / 86400000 > 150) y += 1;
    return y + "-" + p2(m) + "-" + p2(d);
  }
  // 날짜 드롭다운 목록: 오늘 기준 -90일 ~ +180일, 그리고 이미 있는 회차
  function dateChoices(existingIds) {
    const set = new Set(existingIds || []), now = new Date();
    for (let i = -90; i <= 180; i++) set.add(todayISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)));
    return Array.from(set).sort();
  }
  const roundTag = (id) => { const t = todayISO(); return id === t ? "오늘" : id > t ? "예정" : "지난"; };

  /* ───────────── 공용 도우미 ───────────── */
  const digits = (s) => String(s || "").replace(/\D/g, "");
  // 01012345678 형태로 통일 (+82, 앞자리 0 누락 대응). schema.sql 의 _norm_phone 과 같은 규칙
  function normPhone(s) {
    const d = digits(s);
    if (/^82/.test(d) && d.length >= 11) return "0" + d.slice(2);
    if (d.length === 10 && d[0] === "1") return "0" + d;
    return d;
  }
  function fmtPhone(s) {
    const d = digits(s);
    if (d.length === 11) return d.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
    if (d.length === 10) return d.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    return d;
  }
  // "고려대-건축학과" → ["고려대", "건축학과"],  "서경대 메이크업과" → ["서경대", "메이크업과"]
  function splitSchool(s) {
    s = String(s || "").trim();
    if (!s) return ["", ""];
    let i = s.indexOf("-");
    if (i < 0) i = s.search(/\s/);
    return i < 0 ? [s, ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  const splitHobby = (h) => String(h || "").split(/[,，、/·;|\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 6);

  /* ───────────── Supabase ───────────── */
  function liveApi() {
    // 외부 라이브러리 없이 Supabase REST(PostgREST)를 직접 호출한다. apikey 헤더만 보내면 새·옛 키 형식 모두 동작한다.
    const base = String(cfg.supabaseUrl).replace(/\/+$/, "") + "/rest/v1/rpc/";
    const KEY = "rn_token";
    const getTok = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
    const setTok = (t) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* 저장소 사용 불가 */ } };
    const rpc = async (name, args) => {
      if (args && args.p_pin !== undefined) args = Object.assign({}, args, { p_pin: digits(args.p_pin) });
      const res = await fetch(base + name, {
        method: "POST",
        headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify(args || {}),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      if (!res.ok) {
        const msg = (data && data.message) || text || res.statusText || "요청 실패";
        throw new Error(msg + (data && data.details ? " :: " + data.details : ""));
      }
      return data;
    };
    const authed = (name, args) => rpc(name, Object.assign({ p_token: getTok() }, args));
    return {
      mode: "live",
      // 반환: { me } 또는 { choices: [{round_id, label}] } (두 회차 이상에 있는 번호)
      async login(phone, roundId) {
        const r = await rpc("login", { p_phone: phone, p_round: roundId || null });
        if (r.choices) return { choices: r.choices };
        setTok(r.token);
        return { me: r.me };
      },
      async getMe() {
        if (!getTok()) return null;
        try { return await authed("get_me"); }
        catch (e) { if (String(e.message).includes("not_authenticated")) { setTok(null); return null; } throw e; }
      },
      // 입력한 번호가 진행자 마스터키인지 (참가자 로그인 화면에서 진행자가 같은 칸에 입력한다)
      isMaster: async (key) => !!(await rpc("check_master", { p_key: key })),
      async logout() { const t = getTok(); setTok(null); if (t) { try { await rpc("logout", { p_token: t }); } catch (e) { /* 무시 */ } } },
      getStatus: () => authed("get_status"),
      async getNotes() { return (await authed("get_notes")) || {}; },
      saveNote: (slot, memo, mark) => authed("save_note", { p_slot: slot, p_memo: memo, p_mark: mark }),
      getMyPicks: () => authed("get_my_picks"),
      submitPicks: (inputs, survey) => authed("submit_picks", { p_inputs: inputs, p_survey: survey }),
      getResult: () => authed("get_result"),
      admin: {
        rounds: (pin) => rpc("admin_rounds", { p_pin: pin }),
        dashboard: (pin, round) => rpc("admin_dashboard", { p_pin: pin, p_round: round }),
        setResults: (pin, round, open) => rpc("admin_set_results", { p_pin: pin, p_round: round, p_open: !!open }),
        setNumber: (pin, id, n) => rpc("admin_set_number", { p_pin: pin, p_id: id, p_number: n }),
        setPicks: (pin, participantId, targetIds) => rpc("admin_set_picks", { p_pin: pin, p_participant: participantId, p_targets: targetIds }),
        remove: (pin, id) => rpc("admin_remove", { p_pin: pin, p_id: id }),
        reset: (pin, round) => rpc("admin_reset", { p_pin: pin, p_round: round }),
        import: (pin, round, label, rows, prune) => rpc("admin_import", { p_pin: pin, p_round: round, p_label: label, p_rows: rows, p_prune: !!prune }),
      },
    };
  }

  /* ───────────── 체험 모드 (localStorage, 가짜 명단 · 회차 2개) ───────────── */
  function demoApi() {
    const KEY = "rotation-note-demo-v3";
    const ADMIN_PIN = "01012345678";   // 체험 모드 마스터키
    const NAMES = {
      F: ["김지은", "이수아", "박하린", "최민서", "정서윤", "강예린", "조다은", "윤채원", "장유나"],
      M: ["김도윤", "이시우", "박준호", "최민재", "정지훈", "강현우", "조태민", "윤서진", "장건우"],
    };
    const SCHOOLS = ["고려대-건축학과", "연세대-경제학부", "한양대-전기공학과", "중앙대-국제물류학과", "서강대-경영학과", "성신여대-AI융합학부", "이화여대-간호학과", "홍익대-시각디자인과", "건국대-수의학과"];
    const AGES = ["01년생", "02년생", "03년생", "00년생", "04년생", "03년생", "02년생", "01년생", "04년생"];
    const MBTIS = ["ENFP", "ISTJ", "INFJ", "ESTP", "INTP", "ENFJ", "ISFP", "ENTJ", "ISFJ"];
    const HOBBIES = ["러닝, 전시회", "요리, 와인", "등산, 사진", "보드게임, 영화", "필라테스, 독서", "캠핑, 커피", "클라이밍, 여행", "베이킹, 드라마", "골프, 재즈"];
    // 11/8 회차: 남 9 · 여 9.  11/6 회차: 남 3 · 여 3 (남 1번은 11/8 의 남 1번과 같은 번호라, 로그인할 때 회차를 고르게 된다)
    const seedRound = (round, nm, nf, phoneBase) => {
      const out = [];
      [["M", nm], ["F", nf]].forEach(([g, n]) => NAMES[g].slice(0, n).forEach((name, i) => {
        const k = (i + (g === "M" ? 3 : 0)) % 9;
        out.push({ id: "s-" + round + "-" + g + (i + 1), round, sample: true, loggedIn: false, phone: phoneBase + (g === "M" ? "1" : "2") + "00" + (i + 1),
          gender: g, number: i + 1, name: name + (round === "11/6" ? "" : ""), age_label: AGES[k], school: SCHOOLS[k], mbti: MBTIS[(k + 4) % 9], hobby: HOBBIES[k] });
      }));
      return out;
    };
    const fresh = () => {
      const Y = new Date().getFullYear(), R8 = Y + "-11-08", R6 = Y + "-11-06";
      return {
      rounds: { [R8]: { label: roundLabel(R8), results_open: false }, [R6]: { label: roundLabel(R6), results_open: false } },
      people: seedRound(R8, 9, 9, "0100000").concat(seedRound(R6, 3, 3, "0100000").map((p, i) => (i === 0 ? p : Object.assign(p, { phone: "0109999" + p.phone.slice(7), name: p.name + "B" })))),
      session: null, notes: {}, picks: {}, surveys: {}, seq: 1,
      };
    };
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { return fresh(); } };
    const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
    const op = async (fn) => { await new Promise((r) => setTimeout(r, 50)); const s = load(); const r = fn(s); save(s); return r; };
    const fail = (m, detail) => { throw new Error(detail ? m + " :: " + detail : m); };
    const rng = (seed) => { let x = seed * 9301 + 49297; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); };
    const me = (s) => s.people.find((x) => x.id === s.session) || fail("not_authenticated");
    const card = (p) => ({ id: p.id, number: p.number, gender: p.gender, name: p.name, age_label: p.age_label, school: p.school, mbti: p.mbti, hobby: p.hobby });
    const mine = (s, u) => Object.assign(card(u), { phone: u.phone, round_id: u.round, round_label: s.rounds[u.round].label });
    // 한 사람의 선택을 화면용으로 (찾은 상대는 번호·이름, 못 찾은 입력은 글자 그대로)
    const pickView = (s, pid) => (s.picks[pid] || []).map((e, i) => {
      const t = e.target ? s.people.find((x) => x.id === e.target) : null;
      return { rank: i + 1, input: e.input, resolved: !!t, number: t ? t.number : null, name: t ? t.name : null };
    });
    const checkAdmin = (pin) => { if (digits(pin) !== ADMIN_PIN) fail("bad_pin"); };

    // 로그인하지 않은 명단 참가자는 체험용으로 자동 선택·설문을 만든다 (같은 회차 안에서만)
    function ensureSamples(s, round) {
      const here = s.people.filter((x) => x.round === round);
      const real = here.filter((x) => x.loggedIn || !x.sample);   // 가짜 샘플이 아닌 사람 = 실제 참가자
      here.filter((u) => u.sample && !u.loggedIn && !s.picks[u.id]).forEach((u) => {
        const r = rng(u.number * 7 + (u.gender === "M" ? 1 : 2));
        const pick = (arr) => arr[Math.floor(r() * arr.length)];
        const chosen = [];
        if (u.number % 3 === 1) real.filter((x) => x.gender !== u.gender).slice(0, 1).forEach((x) => chosen.push(x.id));
        const pool = here.filter((x) => x.sample && !x.loggedIn && x.gender !== u.gender).map((x) => x.id);
        while (chosen.length < MAX_PICKS && pool.length) chosen.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
        s.picks[u.id] = chosen.map((id) => ({ target: id, input: "" }));
        const a = {};
        SURVEY.forEach((q) => {
          if (q.type === "scale") a[q.id] = 3 + Math.floor(r() * 3);
          else if (q.type === "choice") a[q.id] = pick(q.options);
          else if (q.type === "multi") a[q.id] = q.options.filter(() => r() > 0.55).slice(0, 3);
          else if (q.type === "matrix") { a[q.id] = {}; q.rows.forEach((row) => (a[q.id][row.id] = pick(q.options))); }
          else a[q.id] = r() > 0.5 ? (q.id === "q7" ? "질문 카드 덕분에 대화가 편했어요" : "대기 시간이 조금 길었어요") : "";
        });
        s.surveys[u.id] = a;
      });
    }

    return {
      mode: "demo",
      login: (phone, roundId) => op((s) => {
        const hits = s.people.filter((x) => x.phone === normPhone(phone));
        if (!hits.length) fail("not_registered");
        if (!roundId && hits.length > 1) return { choices: hits.map((h) => ({ round_id: h.round, label: s.rounds[h.round].label })).sort((a, b) => a.round_id.localeCompare(b.round_id)) };
        const u = hits.find((h) => !roundId || h.round === roundId) || fail("not_registered");
        u.loggedIn = true; s.session = u.id;
        return { me: mine(s, u) };
      }),
      getMe: () => op((s) => { const u = s.people.find((x) => x.id === s.session); return u ? mine(s, u) : null; }),
      isMaster: async (key) => digits(key) === ADMIN_PIN,
      logout: () => op((s) => { s.session = null; }),
      getStatus: () => op((s) => ({ results_open: !!s.rounds[me(s).round].results_open })),
      getNotes: () => op((s) => s.notes[me(s).id] || {}),
      saveNote: (slot, memo, mark) => op((s) => {
        const u = me(s);
        if (!(slot >= 1 && slot <= 30)) fail("invalid_slot");
        (s.notes[u.id] = s.notes[u.id] || {})[slot] = { memo, mark };
      }),
      getMyPicks: () => op((s) => {
        const u = me(s);
        return { picks: pickView(s, u.id), submitted: !!s.surveys[u.id], answers: s.surveys[u.id] || {} };
      }),
      // 번호·이름이 정확히 맞으면 연결하고, 아니면 적은 글자 그대로 저장한다 (진행자가 나중에 맞춘다)
      submitPicks: (inputs, survey) => op((s) => {
        const u = me(s);
        if (s.rounds[u.round].results_open) fail("result_published");
        const pool = s.people.filter((x) => x.round === u.round && x.gender !== u.gender);
        const typed = (inputs || []).map((x) => String(x || "").trim().slice(0, 40)).filter(Boolean);
        if (typed.length > MAX_PICKS) fail("too_many");
        const norm = (v) => String(v).replace(/\s+/g, "").toLowerCase();
        const seen = new Set(), entries = [];
        typed.forEach((x) => {
          let t = null;
          if (/^\d{1,3}\s*번?$/.test(x)) t = pool.find((p) => p.number === parseInt(x, 10)) || null;
          else { const hits = pool.filter((p) => norm(p.name) === norm(x.replace(/\s*님$/, ""))); if (hits.length === 1) t = hits[0]; }
          if (t) { if (seen.has(t.id)) return; seen.add(t.id); }
          entries.push({ target: t ? t.id : null, input: x });
        });
        s.picks[u.id] = entries;
        s.surveys[u.id] = survey || {};
        return { picks: pickView(s, u.id) };
      }),
      getResult: () => op((s) => {
        const u = me(s);
        if (!s.rounds[u.round].results_open) fail("not_ready");
        ensureSamples(s, u.round);
        return (s.picks[u.id] || []).map((e, i) => {
          const t = e.target ? s.people.find((x) => x.id === e.target) : null;
          const mutual = !!t && (s.picks[t.id] || []).some((p) => p.target === u.id);
          return { rank: i + 1, resolved: !!t, input: e.input, number: t ? t.number : null, name: t ? t.name : null, age_label: t ? t.age_label : null, school: t ? t.school : null, mutual, phone: mutual ? t.phone : null };
        });
      }),
      admin: {
        rounds: (pin) => op((s) => {
          checkAdmin(pin);
          return Object.keys(s.rounds).sort().map((id) => ({ id, label: s.rounds[id].label, results_open: !!s.rounds[id].results_open, count: s.people.filter((p) => p.round === id).length }));
        }),
        dashboard: (pin, round) => op((s) => {
          checkAdmin(pin);
          const r = s.rounds[round];
          if (r) ensureSamples(s, round);   // 체험 모드: 로그인하지 않은 가짜 참가자는 선택·설문을 자동으로 낸다
          const here = s.people.filter((p) => p.round === round);
          const matches = [];
          here.filter((p) => p.gender === "M").forEach((m) => (s.picks[m.id] || []).forEach((e) => {
            const tid = e.target;
            if (tid && (s.picks[tid] || []).some((p) => p.target === m.id)) { const f = s.people.find((x) => x.id === tid); matches.push({ m_number: m.number, m_name: m.name, f_number: f.number, f_name: f.name }); }
          }));
          const picks = [];
          here.forEach((p) => (s.picks[p.id] || []).forEach((e, i) => {
            const t = e.target ? s.people.find((x) => x.id === e.target) : null;
            picks.push({ participant_id: p.id, rank: i + 1, target_id: e.target || null, input: e.input, target_number: t ? t.number : null, target_name: t ? t.name : null });
          }));
          return {
            round: r ? { id: round, label: r.label, results_open: !!r.results_open } : null,
            results_open: r ? !!r.results_open : false,
            participants: here.map((p) => ({ id: p.id, number: p.number, gender: p.gender, name: p.name, phone: p.phone, age_label: p.age_label, school: p.school, mbti: p.mbti, hobby: p.hobby, submitted: !!s.surveys[p.id] }))
              .sort((a, b) => (a.gender === b.gender ? a.number - b.number : a.gender === "M" ? -1 : 1)),
            matches, picks,
            surveys: here.filter((p) => s.surveys[p.id]).map((p) => ({ gender: p.gender, answers: s.surveys[p.id] })),
          };
        }),
        setResults: (pin, round, open) => op((s) => { checkAdmin(pin); if (s.rounds[round]) s.rounds[round].results_open = !!open; }),
        setNumber: (pin, id, n) => op((s) => {
          checkAdmin(pin);
          const p = s.people.find((x) => x.id === id);
          if (!p || !(n >= 1)) fail("invalid_number");
          if (s.people.some((x) => x.id !== id && x.round === p.round && x.gender === p.gender && x.number === n)) fail("number_taken");
          p.number = n;
        }),
        setPicks: (pin, pid, targets) => op((s) => {
          checkAdmin(pin);
          const me2 = s.people.find((x) => x.id === pid);
          if (!me2) fail("not_registered");
          if (targets.length > MAX_PICKS) fail("too_many");
          if (new Set(targets).size !== targets.length || targets.some((id) => { const t = s.people.find((x) => x.id === id); return !t || t.round !== me2.round || t.gender === me2.gender; })) fail("invalid_target");
          s.picks[pid] = targets.map((id) => ({ target: id, input: "" }));
        }),
        remove: (pin, id) => op((s) => {
          checkAdmin(pin);
          s.people = s.people.filter((u) => u.id !== id); delete s.picks[id]; delete s.surveys[id]; delete s.notes[id];
          if (s.session === id) s.session = null;
        }),
        reset: (pin, round) => op((s) => {
          checkAdmin(pin);
          const gone = s.people.filter((p) => p.round === round).map((p) => p.id);
          s.people = s.people.filter((p) => p.round !== round);
          gone.forEach((id) => { delete s.picks[id]; delete s.surveys[id]; delete s.notes[id]; });
          if (gone.includes(s.session)) s.session = null;
          if (s.rounds[round]) s.rounds[round].results_open = false;
        }),
        import: (pin, round, label, rows, prune) => op((s) => {
          checkAdmin(pin);
          if (!String(round || "").trim()) fail("round_required");
          round = String(round).trim();
          if (!ISO_RE.test(round)) fail("invalid_round");
          if (!s.rounds[round]) s.rounds[round] = { label: label || round, results_open: false };
          else s.rounds[round].label = label || s.rounds[round].label;
          let ins = 0, upd = 0, skipped = 0, pruned = 0;
          const seen = new Set();
          for (const pass of [1, 2]) {
            rows.forEach((r) => {
              const ph = normPhone(r.phone), g = r.gender, nm = String(r.name || "").trim();
              const num = r.number === undefined || r.number === null || r.number === "" ? null : parseInt(r.number, 10);
              if (!ph || !nm || !["M", "F"].includes(g)) { if (pass === 1) skipped++; return; }
              if ((num !== null) !== (pass === 1)) return;
              seen.add(ph);
              const fields = { gender: g, name: nm, age_label: r.age_label || null, school: r.school || null, mbti: (r.mbti || "").toUpperCase() || null, hobby: r.hobby || null };
              const ex = s.people.find((x) => x.round === round && x.phone === ph);
              if (ex) { Object.assign(ex, fields); if (num !== null) ex.number = num; upd++; }
              else {
                const taken = new Set(s.people.filter((x) => x.round === round && x.gender === g).map((x) => x.number));
                let n = num;
                if (n === null) { n = 1; while (taken.has(n)) n++; }   // 비어 있는 가장 작은 번호, 없으면 맨 뒤
                s.people.push(Object.assign({ id: "p" + s.seq++, round, phone: ph, number: n, sample: false, loggedIn: false }, fields)); ins++;
              }
            });
          }
          if (prune) {
            const gone = s.people.filter((x) => x.round === round && !seen.has(x.phone)).map((x) => x.id);
            pruned = gone.length; s.people = s.people.filter((x) => !gone.includes(x.id));
            gone.forEach((id) => { delete s.picks[id]; delete s.surveys[id]; delete s.notes[id]; });
          }
          const keys = s.people.filter((x) => x.round === round).map((x) => x.gender + ":" + x.number);
          if (new Set(keys).size !== keys.length) fail("participants_round_gender_number_key");
          return { inserted: ins, updated: upd, skipped, pruned };
        }),
      },
    };
  }

  window.api = isDemo ? demoApi() : liveApi();
  window.RN = { SURVEY, MAX_PICKS, MEMO_SLOTS, roundLabel, roundTag, toRoundId, dateChoices, todayISO, friendly, digits, normPhone, fmtPhone, splitSchool, splitHobby };
})();
