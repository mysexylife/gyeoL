/* 참가자 화면: 내 프로필 · 대화 카드 · 메모장 · 최종 선택 */
(() => {
  const api = window.api;
  const { SURVEY, MAX_PICKS, MEMO_SLOTS, roundLabel, friendly, digits, fmtPhone, splitSchool, splitHobby } = window.RN;
  const $app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TOPICS = window.TOPICS;
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ICON = {
    mine: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.8" r="2"/><path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4"/><path d="M14.5 10h3.5M14.5 13h2.5"/>'),
    talk: svg('<path d="M5.5 5h13A2 2 0 0 1 20.5 7v8a2 2 0 0 1-2 2H11l-4.5 3.5V17h-1A2 2 0 0 1 3.5 15V7a2 2 0 0 1 2-2z"/><path d="M10.1 9.4a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.3"/><circle cx="11.9" cy="14.2" r=".5" fill="currentColor"/>'),
    memo: svg('<rect x="5.5" y="3.5" width="14" height="17" rx="2"/><path d="M9.5 8.5h6M9.5 12h6M9.5 15.5h3.5"/><path d="M5.5 7.5h-2M5.5 12h-2M5.5 16.5h-2"/>'),
    pick: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M9.3 11.6l2 2 3.6-3.8"/>'),
    done: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" fill-opacity=".18"/><path d="M9.3 11.6l2 2 3.6-3.8"/>'),
  };
  const META = window.DECK_META;
  const DECKS = { light: META.light.name, deep: META.deep.name };
  const pad2 = (n) => String(n + 1).padStart(2, "0");
  const newDeck = (k) => ({ left: TOPICS[k].map((_, i) => i), current: null, history: [] });
  const MARK_LABEL = ["", "관심 있음", "많이 끌림", "최고"];

  const S = {
    ready: false, me: null, choices: null, tab: "mine",
    notes: {}, mine: { picks: [], submitted: false, answers: {} }, resultsOpen: false, result: null, paid: null, payForm: null,
    draftInputs: ["", "", ""], draftAnswers: {}, editSel: false,
    busy: false, error: "", draft: null,
    talk: { deck: "light", lock: false, dealing: false, d: { light: null, deep: null } },
  };

  /* ───────── 유틸 ───────── */
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
  const noteOf = (slot) => S.notes[String(slot)] || { memo: "", mark: 0 };
  const genderLabel = (g) => (g === "M" ? "남성" : "여성");
  // 각 탭의 쓰임새 설명
  const howto = (title, text) => `<aside class="howto"><b>${esc(title)}</b><p>${text}</p></aside>`;

  /* ───────── 데이터 로드 ───────── */
  async function loadData() {
    S.notes = await api.getNotes();
    S.mine = await api.getMyPicks();
    S.draftInputs = [0, 1, 2].map((i) => { const p = S.mine.picks[i]; return p ? (p.resolved ? String(p.number) : p.input || "") : ""; });
    S.draftAnswers = JSON.parse(JSON.stringify(S.mine.answers || {}));
    S.resultsOpen = !!(await api.getStatus()).results_open;
    S.result = S.resultsOpen ? await api.getResult() : null;
    S.paid = S.resultsOpen ? await api.getPaid() : null;
  }
  async function refreshAll() {
    S.me = await api.getMe();
    if (S.me) { await loadData(); S.tab = S.resultsOpen ? "pick" : "mine"; }
  }
  // 진행자가 매칭 결과를 열면 자동으로 보여준다
  async function poll() {
    if (!S.me) return;
    try {
      const open = !!(await api.getStatus()).results_open;
      if (open && S.resultsOpen) {   // 공개된 뒤 진행자가 선택을 조정하면 결과도 바로 바뀐다
        const r = await api.getResult(), pd = await api.getPaid();
        const changed = JSON.stringify(r) !== JSON.stringify(S.result) || JSON.stringify(pd) !== JSON.stringify(S.paid);
        S.result = r; S.paid = pd;
        if (changed && !S.payForm) render();   // 입금자명을 적는 중에는 화면을 다시 그리지 않는다
        return;
      }
      if (open === S.resultsOpen) return;
      S.resultsOpen = open;
      S.result = open ? await api.getResult() : null;
      S.paid = open ? await api.getPaid() : null;
      if (open) { S.tab = "pick"; toast("매칭 결과가 공개됐어요."); }
      render();
    } catch (e) { /* 일시적인 네트워크 오류는 무시 */ }
  }

  /* ───────── 뷰: 입장 ───────── */
  // 두 회차 이상에 신청한 번호는 어느 회차에 참석하는지 고른다
  function choiceForm() {
    return `<section class="panel"><h2>오늘 참석하는 회차를 골라 주세요</h2>
      <div class="rounds">${S.choices.list.map((c) => `<button class="btn" type="button" data-act="pickround" data-v="${esc(c.round_id)}" ${S.busy ? "disabled" : ""}>${esc(roundLabel(c.round_id))}</button>`).join("")}</div>
      ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
      <button class="link" type="button" data-act="backlogin" style="justify-self:start">← 번호 다시 입력</button></section>`;
  }
  function authView() {
    return `<main class="wrap auth-wrap">
      <section class="hero"><img src="assets/hero.jpg" alt="붉은 실이 두 사람의 그림자 사이를 잇고 있는 모습"></section>
      <section class="hero-copy"><p class="eyebrow">ROTATION DATING</p>
        <h1 class="logo-xl">gyeoL</h1>
        <p class="tagline">결이 맞는 사람을 만나는 곳</p>
        <ul class="promo"><li><b>말주변 없어도 괜찮아요.</b> 질문 카드가 준비되어 있어 대화가 술술 풀려요.</li>
          <li>MBTI·연애 스타일 같은 가벼운 질문부터</li>
          <li>인생 우선순위, 갈등 해결 방식 같은 깊은 대화까지</li></ul></section>
      ${S.choices ? choiceForm() : `<form id="f-login" class="panel" autocomplete="on">
        <h2>내 번호로 입장</h2>
        <div class="field"><label for="l-phone">신청할 때 적은 휴대폰 번호</label>
          <input id="l-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678" value="${esc((S.draft || {}).phone || "")}" required></div>
        <p class="note">번호만 입력하면 들어와요. 내 연락처는 <b>서로 최종 선택이 일치했을 때만</b> 상대에게 전달돼요.</p>
        ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
        <button class="btn" type="submit" ${S.busy ? "disabled" : ""}>${S.busy ? "확인 중…" : "입장하기"}</button>
        ${api.mode === "demo" ? `<p class="note">체험용 번호: <b>010-0000-1001</b> (남 1번 · 두 회차에 모두 있어 회차 선택이 나와요) · <b>010-0000-2001</b> (여 1번)</p>` : ""}
      </form>`}
    </main>`;
  }

  /* ───────── 뷰: 내 프로필 카드 ───────── */
  const cell = (label, val, wide) => `<div class="cell ${wide ? "wide" : ""}"><dt>${label}</dt><dd>${val ? esc(val) : '<span class="nil">—</span>'}</dd></div>`;
  function mineView() {
    const m = S.me, [univ, dept] = splitSchool(m.school), hob = splitHobby(m.hobby), g = genderLabel(m.gender);
    return `${howto("내 프로필 카드", "상대에게 나를 소개하는 카드예요. 이 정보를 보고 편하게 이야기를 시작해 보세요. 내용이 다르면 운영진에게 알려 주세요.")}
      <article class="idcard" aria-label="${g} ${m.number}번 ${esc(m.name)}">
        <div class="id-thread"></div>
        <div class="id-top"><span class="id-brand">gyeoL</span><span class="id-round">${esc(roundLabel(m.round_id))}</span></div>
        <div class="id-no" aria-hidden="true"><span class="id-g">${g}</span><span class="id-n">${m.number}</span><span class="id-u">번</span></div>
        <h3 class="id-name">${esc(m.name)}</h3>
        <dl class="id-grid">
          ${cell("나이", m.age_label)}${cell("MBTI", m.mbti)}
          ${cell("대학교", univ, true)}${cell("학과", dept, true)}
          <div class="cell wide"><dt>HOBBY</dt><dd>${hob.length ? `<span class="chips">${hob.map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</span>` : '<span class="nil">—</span>'}</dd></div>
        </dl>
        <div class="id-foot">ROTATION DATING</div>
        <span class="id-mark" aria-hidden="true">gyeoL</span>
      </article>
      <p class="note">내 연락처(${esc(fmtPhone(m.phone))})는 <b>서로 최종 선택이 일치했을 때만</b> 상대에게 전달돼요.</p>`;
  }

  /* ───────── 뷰: 메모장 (이성 번호 1~9, 상대 정보와 연결하지 않는 기억용) ───────── */
  function memoView() {
    const filled = Array.from({ length: MEMO_SLOTS }, (_, i) => noteOf(i + 1)).filter((n) => n.memo || n.mark).length;
    return `${howto("메모장", "만난 이성의 번호(1~9)별로 기억하고 싶은 것을 적어 두는 나만의 메모장이에요. 상대의 정보와 연결되지 않고, 나만 볼 수 있어요. ♥는 끌림 정도를 표시하는 용도로 자유롭게 쓰세요.")}
      <div class="sec-title"><h2>메모장</h2><span id="memocount">${filled} / ${MEMO_SLOTS}번 기록</span></div>
      <div class="memos">${Array.from({ length: MEMO_SLOTS }, (_, i) => {
        const n = i + 1, v = noteOf(n);
        return `<div class="mrow"><div class="mnum" aria-hidden="true"><b>${n}</b><small>번</small></div>
          <div class="mbody"><textarea rows="2" data-bind="memo" data-slot="${n}" aria-label="${n}번 메모" placeholder="${n}번에 대해 기억할 것">${esc(v.memo)}</textarea>
            <div class="hearts sm" role="group" aria-label="${n}번 끌림">${[1, 2, 3].map((k) => `<button type="button" class="${v.mark >= k ? "on" : ""}" data-act="mark" data-slot="${n}" data-v="${k}" aria-label="끌림 ${k}">♥</button>`).join("")}<span class="lbl">${MARK_LABEL[v.mark]}</span></div></div></div>`;
      }).join("")}</div>`;
  }

  function surveyHTML() {
    return SURVEY.map((q, qi) => {
      const val = S.draftAnswers[q.id];
      const label = `<span class="qno">${String(qi + 1).padStart(2, "0")}</span>${esc(q.label)}${q.required ? "<i>*</i>" : ""}`;
      if (q.type === "text") {
        return `<div class="q"><label class="lbl" for="${q.id}">${label}</label><textarea id="${q.id}" data-bind="ans" data-q="${q.id}" placeholder="${esc(q.placeholder || "")}">${esc(val || "")}</textarea></div>`;
      }
      if (q.type === "matrix") {
        return `<div class="q" data-qid="${q.id}"><span class="lbl">${label}</span>${q.rows.map((r) => `<div class="mx-row"><span>${esc(r.label)}</span><div class="opts">${q.options.map((o) => `<button type="button" class="opt ${val && val[r.id] === o ? "on" : ""}" data-act="ansx" data-q="${q.id}" data-r="${r.id}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>`).join("")}</div>`;
      }
      if (q.type === "multi") {
        return `<div class="q" data-qid="${q.id}"><span class="lbl">${label}</span><div class="opts" role="group">${q.options.map((o) => `<button type="button" class="opt chk ${Array.isArray(val) && val.includes(o) ? "on" : ""}" data-act="ansm" data-q="${q.id}" data-v="${esc(o)}" aria-pressed="${Array.isArray(val) && val.includes(o)}">${esc(o)}</button>`).join("")}</div></div>`;
      }
      const opts = q.type === "scale" ? [1, 2, 3, 4, 5] : q.options;
      return `<div class="q" data-qid="${q.id}"><span class="lbl">${label}</span>
        <div class="opts ${q.type}" role="group">${opts.map((o) => `<button type="button" class="opt ${val === o ? "on" : ""}" data-act="ans" data-q="${q.id}" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>
        ${q.low ? `<div class="ends"><span>${esc(q.low)}</span><span>${esc(q.high)}</span></div>` : ""}</div>`;
    }).join("");
  }

  /* ───────── 뷰: 최종 선택 ───────── */
  function pickView() {
    const guide = howto("최종 선택", `오늘 마음에 든 이성을 최대 ${MAX_PICKS}명까지 <b>번호 또는 이름만</b> 적어 제출하는 곳이에요. 이름은 <b>성+이름</b>으로 적어 주세요. 서로 선택하면 매칭돼요. 정확히 맞지 않게 적어도 제출돼요. 진행자가 확인해서 맞춰 드려요. 제출은 언제든 할 수 있고 고쳐서 다시 낼 수 있어요. 매칭 결과는 진행자가 공개하면 이 탭에서 확인해요.`);
    if (S.resultsOpen) return guide + resultView();
    if (S.mine.submitted && !S.editSel) {
      const ps = S.mine.picks;
      return `${guide}<div class="done">제출 완료! 응답이 집계됐어요.</div>
        <p class="note"><b>매칭 결과는 오늘 중으로 이 사이트(gyeoL)에서 전달드릴 예정이에요.</b> 진행자가 결과를 공개하면 이 탭에서 확인할 수 있어요. 서로 선택한 분이 있다면 그때 연락처가 함께 열려요.</p>
        <div class="panel"><h2>내가 적은 사람</h2>${ps.length ? `<div class="rows">${ps.map((p) => p.resolved
          ? `<div class="row on"><span class="rk">${p.rank}</span><span class="rn">${p.number}</span><span class="rm"><b>${esc(p.name)}</b></span><span></span></div>`
          : `<div class="row warn"><span class="rk">${p.rank}</span><span class="rn">?</span><span class="rm"><b>${esc(p.input)}</b><small>정확히 맞는 사람을 못 찾았어요. 진행자가 확인해 드려요.</small></span><span></span></div>`).join("")}</div>` : `<p class="sub">적은 사람이 없어요.</p>`}</div>
        <button class="btn ghost" data-act="editsel">선택·설문 수정하기</button><p class="note">결과가 공개되기 전까지는 언제든 고쳐서 다시 제출할 수 있어요.</p>`;
    }
    return `${guide}
      <div class="sec-title"><h2>최종 선택</h2><span>최대 ${MAX_PICKS}명</span></div>
      <section class="panel">
        <p class="sub" style="font-size:13px"><b>번호 또는 이름만</b> 적어 주세요. 이름은 <b>성+이름</b>으로 적어요 (예: 3 / 김지은). 순서가 <b>1순위, 2순위, 3순위</b>예요. 다 채우지 않아도 괜찮고, 순서는 상대에게 알려지지 않아요. 정확히 맞지 않아도 제출되고, 진행자가 확인해서 맞춰 드려요.</p>
        ${[0, 1, 2].map((i) => `<div class="pkfield"><label for="pk${i}">${i + 1}순위</label><input id="pk${i}" type="text" data-bind="pick" data-i="${i}" placeholder="번호 또는 성+이름 (예: 3, 김지은)" value="${esc(S.draftInputs[i])}" autocomplete="off" enterkeyhint="next"></div>`).join("")}
      </section>
      <section class="panel"><h2>참가 후기 설문</h2><p class="sub" style="font-size:13px">익명으로 집계돼요. 최종 선택과 함께 제출됩니다.</p>${surveyHTML()}</section>
      ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
      <button class="btn" data-act="submit" ${S.busy ? "disabled" : ""}>${S.busy ? "제출 중…" : S.mine.submitted ? "수정 내용 제출" : "선택하고 제출하기"}</button>`;
  }

  function resultView() {
    const res = S.result || [];
    const hits = res.filter((r) => r.mutual).length;
    return `<div class="sec-title"><h2>매칭 결과</h2><span>서로 선택 ${hits}명</span></div>
      ${res.length === 0 ? `<div class="empty"><b>선택한 사람이 없어요</b><p>다음 모임에서 또 만나요.</p></div>` : ""}
      ${res.map((r) => !r.resolved ? `<article class="res"><div class="who"><b>?</b><span>${esc(r.input)}</span><span class="badge">확인 필요</span></div><p class="gentle">적어 주신 내용과 맞는 참가자를 찾지 못했어요. 운영진에게 알려 주세요.</p></article>` : r.mutual ? `<article class="res hit">
          <div class="who"><b>${r.number}번</b><span>${esc(r.name)}</span><span class="badge">서로 선택</span></div>
          <p>${esc([r.age_label, splitSchool(r.school).filter(Boolean).join(" ")].filter(Boolean).join(" · "))}</p>
          <div class="phone">${esc(fmtPhone(r.phone))}</div>
          <div class="acts"><button class="btn sm ghost" data-act="copy" data-v="${esc(r.phone)}">번호 복사</button><a class="btn sm ghost" style="text-decoration:none" href="tel:${esc(r.phone)}">전화 걸기</a></div>
        </article>` : `<article class="res">
          <div class="who"><b>${r.number}번</b><span>${esc(r.name)}</span><span class="badge">연결 안 됨</span></div>
          <p class="gentle">이번에는 서로의 선택이 맞지 않았어요. 만나 주셔서 고마워요.</p></article>`).join("")}
      ${hits === 0 && res.length ? `<p class="note">연결되지 않아도 괜찮아요. 오늘 만난 시간은 그대로 남아요.</p>` : ""}
      ${receivedView()}${paidView()}`;
  }


  /* ───────── 유료 서비스: 득표수 확인 · 연락처 전달 ───────── */
  const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
  function receivedView() {
    const rec = (S.paid && S.paid.received) || [];
    if (!rec.length) return "";
    return `<div class="sec-title"><h2>나에게 연락처를 전달한 분</h2><span>${rec.length}명</span></div>
      ${rec.map((r) => `<article class="res hit"><div class="who"><b>${r.number}번</b><span>${esc(r.name)}</span><span class="badge">연락처 전달</span></div>
        <p>${esc([r.age_label, splitSchool(r.school).filter(Boolean).join(" ")].filter(Boolean).join(" · "))}</p>
        <div class="phone">${esc(fmtPhone(r.phone))}</div>
        ${r.message ? `<blockquote class="msg">${esc(r.message)}</blockquote>` : ""}
        <p class="gentle">연락은 하지 않으셔도 괜찮아요. 연락할지는 자유롭게 정해요.</p>
        <div class="acts"><button class="btn sm ghost" data-act="copy" data-v="${esc(r.phone)}">번호 복사</button><a class="btn sm ghost" style="text-decoration:none" href="tel:${esc(r.phone)}">전화 걸기</a></div></article>`).join("")}`;
  }
  function paidState(q, openAttrs, label, price) {
    if (q && q.status === "pending") return `<span class="tag n">입금 확인 대기</span>`;
    if (q && q.status === "approved") return null;
    return `<button class="btn sm" ${openAttrs}>${q && q.status === "rejected" ? "다시 신청" : label} · ${won(price)}</button>`;
  }
  function paidView() {
    const P = S.paid;
    if (!P) return "";
    const live = (kind, tid) => P.items.filter((q) => q.kind === kind && (kind === "votes" || q.target_id === tid)).pop();
    const vq = live("votes");
    const voteBody = vq && vq.status === "approved"
      ? `<p class="votes"><b>${P.votes === null || P.votes === undefined ? 0 : P.votes}명</b>이 나를 선택했어요.</p><p class="sub" style="font-size:12.5px">누가 골랐는지, 몇 순위인지는 알려지지 않아요. 진행자가 아직 연결하지 못한 선택은 포함되지 않을 수 있어요.</p>`
      : `<p class="sub" style="font-size:13px">나를 선택한 사람이 몇 명인지 알려 드려요. 신원과 순위는 알려지지 않아요.</p>${vq && vq.status === "rejected" ? `<p class="err">확인되지 않았어요. 입금자명이나 입금 여부를 진행자에게 문의해 주세요.</p>` : ""}${paidState(vq, `data-act="pay-open" data-kind="votes"`, "득표수 확인", P.prices.votes) || ""}`;
    const targets = (S.result || []).filter((r) => r.resolved && !r.mutual && r.target_id);
    const contactRows = targets.map((r) => {
      const q = live("contact", r.target_id);
      const right = q && q.status === "approved" ? `<span class="tag y">전달 완료</span>` : paidState(q, `data-act="pay-open" data-kind="contact" data-target="${esc(r.target_id)}"`, "연락처 전달", P.prices.contact);
      return `<div class="row cr"><span class="rn">${r.number}</span><span class="rm"><b>${esc(r.name)}</b>${q && q.status === "rejected" ? `<small>확인되지 않았어요. 진행자에게 문의해 주세요.</small>` : ""}</span><span>${right}</span></div>`;
    }).join("");
    const f = S.payForm;
    const form = f ? `<section class="panel payform"><h2>${f.kind === "votes" ? "득표수 확인" : "연락처 전달"} 신청 · ${won(f.kind === "votes" ? P.prices.votes : P.prices.contact)}</h2>
        <p class="sub" style="font-size:13px">${f.kind === "contact" ? `<b>${esc(f.name || "")}</b> 님에게 내 이름과 연락처가 전달돼요. ` : ""}아래 계좌로 입금한 뒤 <b>입금자명</b>을 적어 신청하면, 진행자가 확인하고 열어 드려요.</p>
        <p class="payinfo">${P.pay_info ? esc(P.pay_info) : "입금 계좌는 진행자에게 문의해 주세요."}</p>
        ${f.kind === "contact" ? `<div class="pkfield"><label for="paymsg">메시지 <small>선택 · 최대 100자</small></label><textarea id="paymsg" data-bind="paymsg" rows="3" maxlength="100" placeholder="짧게 인사를 남겨 보세요 (예: 오늘 대화 즐거웠어요!)">${esc(f.message || "")}</textarea><small class="sub" id="paymsgcount">${(f.message || "").length} / 100 · 진행자가 확인하고, 부적절한 내용은 전달되지 않아요.</small></div>` : ""}
        <div class="pkfield"><label for="depositor">입금자명</label><input id="depositor" type="text" data-bind="depositor" maxlength="20" placeholder="입금하신 분 이름" value="${esc(f.depositor)}" autocomplete="off"></div>
        ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
        <div class="toolbar"><button class="btn ghost sm" data-act="pay-cancel">취소</button><button class="btn sm" data-act="pay-submit" ${S.busy ? "disabled" : ""}>신청하기</button></div></section>` : "";
    return `<div class="sec-title"><h2>추가 서비스</h2><span>유료 · 계좌이체</span></div>
      <section class="panel"><h2>득표수 확인</h2>${voteBody}</section>
      ${targets.length ? `<section class="panel"><h2>연락처 전달</h2><p class="sub" style="font-size:13px">서로 선택하지 못한 분에게도 내 이름과 연락처를 전달할 수 있어요. 받은 분은 연락할지 자유롭게 정해요. 1명당 ${won(P.prices.contact)}.</p><div class="rows">${contactRows}</div></section>` : ""}
      ${form}
      <p class="note">입금 확인은 진행자가 직접 해요. 승인되면 이 화면에 바로 나타나요.</p>`;
  }

  /* ───────── 뷰: 대화 카드 (덱) ───────── */
  // 카드 앞면(뒤집기 전): 이중 테두리, 마름모 격자, 햇살 메달리온, 붉은 실 하트, 로고
  function backSVG(label) {
    const rays = Array.from({ length: 28 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 28, long = i % 2 === 0, r1 = 38, r2 = long ? 76 : 62;
      return `M${(150 + r1 * Math.cos(a)).toFixed(1)} ${(172 + r1 * Math.sin(a)).toFixed(1)}L${(150 + r2 * Math.cos(a)).toFixed(1)} ${(172 + r2 * Math.sin(a)).toFixed(1)}`;
    }).join("");
    const corner = (t) => `<g transform="${t}"><path d="M26 66C26 44 44 26 66 26" class="s1"/><path d="M26 51C26 38 38 26 51 26" class="s2"/><circle cx="35" cy="35" r="2.4" class="f1"/></g>`;
    const corners = [corner(""), corner("translate(300 0) scale(-1 1)"), corner("translate(0 400) scale(1 -1)"), corner("translate(300 400) scale(-1 -1)")].join("");
    return `<svg class="back" viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <pattern id="lat" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M11 0V22M0 11H22" class="p1"/><circle cx="11" cy="11" r="1.7" class="pf"/></pattern>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
      </defs>
      <rect width="300" height="400" class="g"/>
      <rect x="8" y="8" width="284" height="384" rx="12" class="s1"/><rect x="15" y="15" width="270" height="370" rx="8" class="s2"/>
      <rect x="24" y="24" width="252" height="352" fill="url(#lat)"/>
      ${corners}
      <ellipse cx="150" cy="196" rx="92" ry="128" class="g s1"/><ellipse cx="150" cy="196" rx="84" ry="120" class="s2"/>
      <path d="${rays}" class="s2"/>
      <circle cx="150" cy="172" r="34" class="g s2"/><circle cx="150" cy="172" r="29" class="s2"/>
      <path d="M150 190C134 178 129 166 138 160C144 156 150 160 150 165C150 160 156 156 162 160C171 166 166 178 150 190Z" class="thread"/>
      <path d="M150 190C146 198 140 197 141 192C142 188 149 189 151 195C153 201 160 203 166 198" class="thread"/>
      <text x="150" y="280" text-anchor="middle" class="t-logo">gyeoL</text>
      <text x="150" y="297" text-anchor="middle" class="t-sub">ROTATION DATING</text>
      <path d="M150 59l7 9.5-7 9.5-7-9.5z" class="g s1"/><path d="M150 314l7 9.5-7 9.5-7-9.5z" class="g s1"/>
      <rect x="92" y="341" width="116" height="28" rx="14" class="g s1"/><text x="150" y="360" text-anchor="middle" class="t-label">${esc(label)}</text>
      <rect width="300" height="400" fill="url(#sheen)"/></svg>`;
  }

  const deckState = () => (S.talk.d[S.talk.deck] = S.talk.d[S.talk.deck] || newDeck(S.talk.deck));
  function hintText(st) {
    if (st.current === null) return "맨 위 카드를 눌러 펼쳐 보세요";
    return st.left.length ? "한 번 더 누르면 다음 카드로 넘어가요" : "마지막 카드예요. 한 번 더 누르면 카드가 다시 채워져요";
  }
  function talkView() {
    const d = S.talk.deck, st = deckState();
    if (st.current === null && !st.left.length) st.left = TOPICS[d].map((_, i) => i);   // 남은 카드가 없으면 다시 채운다
    const under = Math.min(4, st.current !== null ? st.left.length : st.left.length - 1);
    const layers = Array.from({ length: Math.max(0, under) }, (_, i) => `<span class="layer l${under - i}"></span>`).join("");
    const top = `<button class="flip top ${st.current !== null ? "on" : ""} ${S.talk.dealing ? "deal" : ""}" data-act="draw" aria-label="${DECKS[d]} 카드 덱의 맨 위 카드">
        <span class="fi"><span class="ff">${backSVG(DECKS[d])}</span>
        <span class="fb"><span class="fb-top"><small>${META[d].tag}</small><em class="no">${st.current !== null ? pad2(st.current) : ""}</em></span><p>${st.current !== null ? esc(TOPICS[d][st.current]) : ""}</p><span class="fb-foot"><i class="wave"></i><b class="gl">gyeo<u>L</u></b></span></span></span></button>`;
    return `${howto("대화 카드", "대화가 막힐 때 꺼내는 질문 카드예요. 덱의 맨 위 카드를 누르면 펼쳐져 질문이 나오고, 한 번 더 누르면 다음 카드로 넘어가요. 카드를 모두 쓰면 자동으로 다시 채워져요.")}
      <div class="sec-title"><h2>대화 카드</h2><span id="talkleft">남은 카드 ${st.left.length}장</span></div>
      <div class="seg" role="tablist">${Object.keys(DECKS).map((k) => `<button type="button" data-act="deck" data-v="${k}" class="${d === k ? "on" : ""}"><i class="dot dot-${k}"></i>${DECKS[k]}</button>`).join("")}</div>
      <div class="stackwrap deck-${d}"><div class="stack">${layers}${top}</div><p class="hint" id="talkhint">${hintText(st)}</p></div>
      <button class="btn ghost" data-act="reshuffle">덱 다시 섞기</button>
      ${st.history.length ? `<section class="hist"><h3>지나간 질문 <span>${st.history.length}</span></h3><ol>${st.history.slice(0, 8).map((i) => `<li><em>${pad2(i)}</em>${esc(TOPICS[d][i])}</li>`).join("")}</ol></section>` : ""}`;
  }

  /* ───────── 렌더 ───────── */
  function header() {
    const logo = S.me ? `<button class="brand" type="button" data-act="home" aria-label="홈 (내 프로필)">gyeoL</button>` : `<div class="brand">gyeoL</div>`;
    return `<header class="top">${logo}<div class="top-r">${S.me ? `<button class="link" data-act="logout">나가기</button>` : ""}</div></header>
      ${api.mode === "demo" ? `<div class="demo-bar">체험 모드 · 이 브라우저에만 저장돼요. 가짜 참가자가 함께 있어요. <a href="admin.html?demo">진행자 화면 (마스터키 010-1234-5678)</a></div>` : ""}`;
  }

  function render() {
    const y = window.scrollY;
    if (!S.ready) { $app.innerHTML = `${header()}<main class="wrap"><div class="empty">불러오는 중…</div></main>`; return; }
    if (!S.me) { $app.innerHTML = header() + authView(); return; }
    const body = S.tab === "mine" ? mineView() : S.tab === "talk" ? talkView() : S.tab === "memo" ? memoView() : pickView();
    const tab = (id, label, icon) => `<button data-act="tab" data-v="${id}" class="${S.tab === id ? "on" : ""}" ${S.tab === id ? 'aria-current="page"' : ""}><span class="ico">${icon}</span>${label}</button>`;
    $app.innerHTML = `${header()}<main class="wrap">${body}</main>
      <nav class="tabs" aria-label="메뉴">
        ${tab("mine", "내 프로필", ICON.mine)}${tab("talk", "대화 카드", ICON.talk)}${tab("memo", "메모장", ICON.memo)}${tab("pick", S.resultsOpen ? "매칭 결과" : "최종 선택", S.resultsOpen ? ICON.done : ICON.pick)}
      </nav>`;
    window.scrollTo(0, y);
  }

  /* ───────── 동작 ───────── */
  const saveTimers = {};
  function queueSave(slot) {
    clearTimeout(saveTimers[slot]);
    saveTimers[slot] = setTimeout(() => flushSave(slot), 600);
  }
  async function flushSave(slot) {
    clearTimeout(saveTimers[slot]); delete saveTimers[slot];
    const n = noteOf(slot);
    try { await api.saveNote(Number(slot), n.memo, n.mark); } catch (e) { toast("메모 저장에 실패했어요. 다시 시도해 주세요."); }
  }
  function flushAll() { return Promise.all(Object.keys(saveTimers).map(flushSave)); }

  async function guarded(fn) {
    if (S.busy) return;
    S.busy = true; S.error = "";
    document.querySelectorAll("button[type=submit],[data-act=submit]").forEach((b) => (b.disabled = true));
    try { await fn(); S.draft = null; } catch (e) { S.error = friendly(e); }
    S.busy = false; render();
  }

  const actions = {
    tab: (t) => { flushAll(); S.draft = null; S.tab = t.dataset.v; S.error = ""; render(); window.scrollTo(0, 0); },
    home: () => { flushAll(); S.tab = "mine"; S.error = ""; render(); window.scrollTo(0, 0); },
    mark: (t) => {
      const slot = t.dataset.slot, v = Number(t.dataset.v), n = noteOf(slot);
      const next = n.mark === v ? 0 : v;
      S.notes[slot] = { memo: n.memo, mark: next };
      const grp = t.parentElement;
      grp.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", i < next));
      const lbl = grp.querySelector(".lbl"); if (lbl) lbl.textContent = MARK_LABEL[next];
      flushSave(slot);
    },
    deck: (t) => { S.talk.deck = t.dataset.v; render(); },
    draw: (t) => {
      if (S.talk.lock) return;
      const d = S.talk.deck, st = deckState();
      if (st.current === null) {
        if (!st.left.length) return;
        const idx = st.left.splice(Math.floor(Math.random() * st.left.length), 1)[0];
        st.current = idx;
        t.querySelector(".fb p").textContent = TOPICS[d][idx];
        t.querySelector(".fb .no").textContent = pad2(idx);
        t.classList.add("on");
        const l = document.getElementById("talkleft"); if (l) l.textContent = "남은 카드 " + st.left.length + "장";
        const h = document.getElementById("talkhint"); if (h) h.textContent = hintText(st);
      } else {
        S.talk.lock = true; t.classList.add("out");
        setTimeout(() => {
          st.history.unshift(st.current); st.current = null;
          if (!st.left.length) {   // 모든 카드를 펼쳤으면 다시 채운다 (방금 본 카드는 다음 바퀴로)
            st.left = TOPICS[d].map((_, i) => i).filter((i) => i !== st.history[0]);
            if (!st.left.length) st.left = TOPICS[d].map((_, i) => i);
            toast("카드를 한 바퀴 다 써서 다시 채웠어요.");
          }
          S.talk.lock = false; S.talk.dealing = true; render(); S.talk.dealing = false;
        }, 340);
      }
    },
    reshuffle: () => { S.talk.d[S.talk.deck] = newDeck(S.talk.deck); render(); },
    pickround: (t) => {
      const phone = S.choices.phone, round = t.dataset.v;
      guarded(async () => { await finishLogin(await api.login(phone, round)); });
    },
    backlogin: () => { S.choices = null; S.error = ""; render(); },
    logout: async () => { await flushAll(); await api.logout(); Object.assign(S, { me: null, choices: null, tab: "mine", notes: {}, result: null, paid: null, payForm: null, resultsOpen: false, editSel: false }); render(); },
    ans: (t) => {
      const q = SURVEY.find((x) => x.id === t.dataset.q);
      const raw = t.dataset.v, v = q.type === "scale" ? Number(raw) : raw;
      S.draftAnswers[q.id] = v;
      t.parentElement.querySelectorAll(".opt").forEach((b) => b.classList.toggle("on", b === t));
    },
    ansm: (t) => {
      const id = t.dataset.q, v = t.dataset.v;
      const cur = (S.draftAnswers[id] = Array.isArray(S.draftAnswers[id]) ? S.draftAnswers[id] : []);
      const i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1); else cur.push(v);
      t.classList.toggle("on", i < 0); t.setAttribute("aria-pressed", String(i < 0));
    },
    ansx: (t) => {
      const id = t.dataset.q, cur = (S.draftAnswers[id] = S.draftAnswers[id] && typeof S.draftAnswers[id] === "object" ? S.draftAnswers[id] : {});
      cur[t.dataset.r] = t.dataset.v;
      t.parentElement.querySelectorAll(".opt").forEach((b) => b.classList.toggle("on", b === t));
    },
    editsel: () => { S.editSel = true; render(); },
    submit: () => {
      const filled = (q, v) => (q.type === "multi" ? Array.isArray(v) && v.length > 0 : q.type === "matrix" ? !!v && q.rows.every((r) => v[r.id]) : !(v === undefined || v === ""));
      const missing = SURVEY.find((q) => q.required && !filled(q, S.draftAnswers[q.id]));
      if (missing) { toast("설문 " + String(SURVEY.indexOf(missing) + 1).padStart(2, "0") + "번에 답해 주세요."); document.querySelector(`[data-qid="${missing.id}"]`)?.scrollIntoView({ block: "center" }); return; }
      const inputs = S.draftInputs.map((x) => String(x).trim());
      const typed = inputs.filter(Boolean);
      if (new Set(typed.map((x) => x.replace(/\s+/g, "").toLowerCase())).size !== typed.length) { toast("같은 사람을 두 번 적었어요."); return; }
      guarded(async () => {
        const res = await api.submitPicks(inputs, S.draftAnswers);
        S.mine = await api.getMyPicks(); S.editSel = false; window.scrollTo(0, 0);
        const bad = res.picks.filter((p) => !p.resolved).length;
        toast(bad ? "제출했어요. 정확히 맞지 않은 " + bad + "건은 진행자가 확인해요." : "제출했어요.");
      });
    },
    "pay-open": (t) => {
      const k = t.dataset.kind, r = (S.result || []).find((x) => x.target_id === t.dataset.target);
      S.payForm = { kind: k, target: t.dataset.target || null, name: r ? r.name : "", depositor: "", message: "" }; S.error = ""; render();
      document.getElementById("depositor")?.focus();
    },
    "pay-cancel": () => { S.payForm = null; S.error = ""; render(); },
    "pay-submit": () => {
      const f = S.payForm;
      if (!f || !f.depositor.trim()) { S.error = "입금자명을 적어 주세요."; render(); return; }
      guarded(async () => {
        await api.requestPaid(f.kind, f.target, f.depositor.trim(), f.kind === "contact" ? (f.message || "").trim() : "");
        S.paid = await api.getPaid(); S.payForm = null;
        toast("신청했어요. 진행자가 입금을 확인하면 열려요.");
      });
    },
    copy: async (t) => {
      try { await navigator.clipboard.writeText(t.dataset.v); toast("번호를 복사했어요."); }
      catch (e) { toast("길게 눌러 번호를 복사해 주세요."); }
    },
  };

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && actions[t.dataset.act]) actions[t.dataset.act](t, e);
  });
  // 휴대폰 번호는 입력하는 동안 010-1234-5678 형태로 자동 정리한다
  function formatPhoneTyping(raw) {
    let d = digits(raw);
    if (/^\s*\+?82/.test(raw) && d.startsWith("82")) d = "0" + d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
  }
  document.addEventListener("input", (e) => {
    if (e.target.id === "l-phone") {
      const v = formatPhoneTyping(e.target.value);
      if (v !== e.target.value) e.target.value = v;
      S.draft = { phone: v };
      return;
    }
    const b = e.target.dataset && e.target.dataset.bind;
    if (b === "memo") {
      const slot = e.target.dataset.slot, n = noteOf(slot);
      S.notes[slot] = { memo: e.target.value, mark: n.mark };
      queueSave(slot);
      const filled = Array.from({ length: MEMO_SLOTS }, (_, i) => noteOf(i + 1)).filter((x) => x.memo || x.mark).length;
      const c = document.getElementById("memocount"); if (c) c.textContent = filled + " / " + MEMO_SLOTS + "번 기록";
    }
    if (b === "ans") S.draftAnswers[e.target.dataset.q] = e.target.value;
    if (b === "depositor" && S.payForm) S.payForm.depositor = e.target.value;
    if (b === "paymsg" && S.payForm) {
      S.payForm.message = e.target.value;
      const c = document.getElementById("paymsgcount"); if (c) c.textContent = e.target.value.length + " / 100 · 진행자가 확인하고, 부적절한 내용은 전달되지 않아요.";
    }
    if (b === "pick") S.draftInputs[Number(e.target.dataset.i)] = e.target.value;
  });
  // 메모 칸에서 손을 떼는 순간(다른 칸·탭 누르기) 바로 저장해서, 앱을 바로 닫아도 남도록 한다
  document.addEventListener("focusout", (e) => { const t = e.target; if (t.dataset && t.dataset.bind === "memo" && saveTimers[t.dataset.slot]) flushSave(t.dataset.slot); });
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); else poll(); });

  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id !== "f-login") return;
    const raw = String(new FormData(f).get("phone") || "");
    S.draft = { phone: raw };
    guarded(async () => {
      const d = digits(raw);
      if (d.length < 10 || d.length > 13) throw new Error("bad_phone");
      let r;
      try { r = await api.login(raw); }
      catch (e) {
        // 명단에 없는 번호가 진행자 마스터키라면 진행자 화면으로 보낸다
        if (String(e.message).includes("not_registered") && (await api.isMaster(raw))) {
          try { sessionStorage.setItem("rn_admin_pin", d); } catch (err) { /* 저장소 사용 불가: 진행자 화면에서 다시 입력 */ }
          location.href = "admin.html" + location.search;
          return;
        }
        throw e;
      }
      if (r.choices) { S.choices = { phone: raw, list: r.choices }; return; }
      await finishLogin(r);
    });
  });

  async function finishLogin(r) {
    S.choices = null;
    S.me = r.me;
    await loadData();
    S.tab = S.resultsOpen ? "pick" : "mine";
  }

  (async function boot() {
    render();
    try { await refreshAll(); } catch (e) { S.error = friendly(e); }
    S.ready = true; render();
    setInterval(poll, 6000);
  })();
})();
