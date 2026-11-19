/* 진행자 화면: 단계 전환, 참가 현황, 매칭, 설문 집계, CSV */
(() => {
  const api = window.api;
  const { applPrefs, SURVEY, MAX_PICKS, friendly, splitSchool, fmtPhone, normPhone, roundLabel, roundTag, roundDate, mkRound, isRoundId, toRoundId, todayISO, digits } = window.RN;
  const Roster = window.Roster;   // 나이·MBTI 정리에만 쓴다 (명단 가져오기는 쓰지 않음)
  const $app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const S = { pin: "", data: null, paid: [], thr: [], applicants: [], appl: { date: "", time: "", gender: "", showAssigned: false, sel: {}, target: "", newdate: "", newtime: "" }, error: "", confirm: "", busy: false, round: "", rounds: [], tab: "picks", open: {}, openPick: {}, pickEdit: {}, onlyBad: false, onlyAbsent: false, sms: { test: "", last: null, kind: "reserve", venue: "", map: "", when: "", counts: null, tpl: {}, list: [], sel: {}, wasSent: {}, dbOk: true, f: { status: "unsent", q: "", date: "", time: "", src: "" } },
    add: { open: false, editing: false, round: "", newdate: "", newtime: "", name: "", gender: "", phone: "", number: "", age: "", school: "", mbti: "", hobby: "" },
  };
  S.lastAssign = null;
  try { S.lastAssign = JSON.parse(sessionStorage.getItem("rn_admin_lastassign") || "null"); } catch (e) { S.lastAssign = null; }
  try { S.pin = sessionStorage.getItem("rn_admin_pin") || ""; S.round = sessionStorage.getItem("rn_admin_round") || ""; S.tab = sessionStorage.getItem("rn_admin_tab") || "applicants"; } catch (e) { /* 저장소 사용 불가 */ }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // 회차 목록과, 선택한 회차의 현황을 불러온다. 진행자 화면은 항상 한 회차만 보여준다.
  async function load() {
    S.rounds = (await api.admin.rounds(S.pin)).sort((a, b) => (a.id < b.id ? 1 : -1));   // 최근 날짜가 앞
    if (!S.rounds.some((r) => r.id === S.round)) {
      const withData = S.rounds.filter((r) => r.count > 0).map((r) => r.id).sort();
      const ids = withData.length ? withData : S.rounds.map((r) => r.id).sort(), t = todayISO();
      S.round = ids.find((i) => roundDate(i) === t) || ids.find((i) => roundDate(i) > t) || ids[ids.length - 1] || "";
    }
    S.applicants = await api.admin.applicants(S.pin);
    S.paid = S.round ? await api.admin.paid(S.pin, S.round) : [];
    S.thr = S.round ? await api.admin.threads(S.pin, S.round) : [];
    try { S.sms.counts = await api.admin.smsCounts(S.pin, S.round); } catch (e) { S.sms.counts = null; }   // SQL 을 아직 안 돌렸으면 숫자만 못 보여준다
    await loadSms();
    S.data = S.round ? await api.admin.dashboard(S.pin, S.round) : { round: null, results_open: false, participants: [], matches: [], surveys: [] };
    try { sessionStorage.setItem("rn_admin_round", S.round); sessionStorage.setItem("rn_admin_tab", S.tab); } catch (e) { /* 무시 */ }
  }

  /* ───────── 설문 집계 ───────── */
  function summarize(q, answers) {
    const vals = answers.map((a) => a[q.id]).filter((v) => v !== undefined && v !== "" && v !== null);
    if (q.type === "text") return { type: "text", items: vals.map(String) };
    if (q.type === "choice") return { type: "choice", n: vals.length, rows: q.options.map((o) => [o, vals.filter((v) => v === o).length]) };
    if (q.type === "multi") {
      const arr = vals.filter(Array.isArray);
      return { type: "multi", n: arr.length, rows: q.options.map((o) => [o, arr.filter((v) => v.includes(o)).length]) };
    }
    if (q.type === "matrix") {
      return { type: "matrix", groups: q.rows.map((r) => { const v = vals.map((x) => x && x[r.id]).filter(Boolean); return { label: r.label, n: v.length, rows: q.options.map((o) => [o, v.filter((x) => x === o).length]) }; }) };
    }
    const nums = vals.map(Number).filter((v) => !isNaN(v));
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    return { type: "scale", n: nums.length, avg, rows: [1, 2, 3, 4, 5].map((k) => [String(k), nums.filter((v) => v === k).length]) };
  }
  function bars(rows, n) {
    return rows.map(([l, c]) => `<div class="bar"><span>${esc(l)}</span><div><i style="width:${n ? Math.round((c / n) * 100) : 0}%"></i></div><span>${c}</span></div>`).join("");
  }
  function surveyCards(surveys) {
    const answers = surveys.map((s) => s.answers || {});
    if (!answers.length) return `<div class="empty"><b>아직 제출된 설문이 없어요</b><p>최종 선택 단계에서 참가자가 제출하면 여기에 집계돼요.</p></div>`;
    return `<div class="two">${SURVEY.map((q, qi) => {
      const r = summarize(q, answers);
      let body;
      if (r.type === "text") body = r.items.length ? `<ul class="texts">${r.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="sub">응답 없음</p>`;
      else if (r.type === "choice") body = bars(r.rows, r.n);
      else if (r.type === "multi") body = `<p class="sub" style="font-size:12.5px">${r.n}명 응답 · 복수 선택</p>${bars(r.rows, r.n)}`;
      else if (r.type === "matrix") body = r.groups.map((g) => `<div class="qstat"><h3 style="font-weight:500">${esc(g.label)} <span class="sub">${g.n}명</span></h3>${bars(g.rows, g.n)}</div>`).join("");
      else body = `<div class="big">${r.avg == null ? "-" : r.avg.toFixed(2)}<em>/ 5 · ${r.n}명</em></div>${bars(r.rows, r.n)}`;
      return `<section class="panel qstat"><h3><span class="qno">${String(qi + 1).padStart(2, "0")}</span>${esc(q.label)}</h3>${body}</section>`;
    }).join("")}</div>${promoList(answers)}`;
  }
  // 홍보 사용에 동의한 후기만 모아 보여준다 (7번 후기 + 9번 동의)
  function promoList(answers) {
    const ok = SURVEY.find((q) => q.id === "q9").options[0];
    const items = answers.filter((a) => a.q9 === ok && a.q7).map((a) => a.q7);
    return `<section class="panel qstat"><h3>홍보 사용에 동의한 후기 <span class="sub">${items.length}건</span></h3>
      ${items.length ? `<ul class="texts">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="sub">동의한 후기가 아직 없어요.</p>`}</section>`;
  }

  /* ───────── CSV ───────── */
  function csvCell(v) { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  // 스크립트처럼 글자만 있는 파일 내려받기(브라우저가 .txt 를 덧붙이지 않도록 일반 바이너리 형식으로 보낸다)
  function downloadText(name, text) {
    const blob = new Blob([text], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function downloadCSV(name, rows) {
    const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ───────── 뷰 ───────── */
  function loginView() {
    return `<header class="top"><div class="brand">gyeoL <small>진행자</small></div><span class="pill">${api.mode === "demo" ? "체험 모드" : "관리"}</span></header>
      <main class="wrap"><form id="f-pin" class="panel"><h2>진행자 마스터키</h2>
        <div class="field"><label for="pin">마스터키 (진행자 공통)</label><input id="pin" type="tel" inputmode="tel" autocomplete="off" required placeholder="${api.mode === "demo" ? "체험 모드: 010-1234-5678" : "010-0000-0000"}"></div>
        ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
        <button class="btn" type="submit">들어가기</button></form></main>`;
  }

  /* ───────── 날짜 드롭다운 (수동 등록·시트 가져오기 공통) ───────── */
  // 등록 폼의 날짜 선택값: 이미 참가자가 있는 날짜, 또는 '__new'(새 날짜 추가)
  const knownRounds = () => S.rounds.filter((r) => r.count > 0 || r.id === S.round);
  const addRoundValue = () => (S.add.editing ? S.round : S.add.round || (knownRounds().some((r) => r.id === S.round) ? S.round : "__new"));
  function addDateFields() {
    const a = S.add, cur = addRoundValue(), t = todayISO();
    const opts = knownRounds().map((r) => `<option value="${esc(r.id)}" ${r.id === cur ? "selected" : ""}>${esc(roundLabel(r.id))}${roundDate(r.id) === t ? " · 오늘" : ""} · ${r.count}명</option>`).join("");
    const sel = `<select id="add-round" ${a.editing ? "disabled" : ""}>${opts}<option value="__new" ${cur === "__new" ? "selected" : ""}>＋ 새 날짜 추가…</option></select>`;
    const nd = cur === "__new" && !a.editing ? `<label class="mp" for="add-newdate"><span>새 날짜 * <small>달력에서 고르면 YYYY-MM-DD로 저장돼요</small></span><input type="date" id="add-newdate" value="${esc(a.newdate || t)}" required></label><label class="mp" for="add-newtime"><span>시간 타임 <small>선택 · 예: 19:00 (같은 날 여러 타임이면 입력)</small></span><input type="text" id="add-newtime" inputmode="numeric" placeholder="19:00" maxlength="5" value="${esc(a.newtime || "")}"></label>` : "";
    return `<label class="mp" for="add-round"><span>날짜 *</span>${sel}</label>${nd}`;
  }

  /* ───────── 참가자 입장 링크 + QR ───────── */
  function entryUrl() {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/admin\.html$/, "");
    u.search = api.mode === "demo" ? "?demo" : "";
    u.hash = "";
    return u.toString();
  }
  function entryPanel() {
    return `<section class="panel"><h2>참가자 입장 링크</h2>
      <div class="qrbox"><div class="qr" id="qr" aria-label="입장 QR 코드"></div>
        <div class="qrinfo"><p class="url" id="entry-url">${esc(entryUrl())}</p>
          <div class="qrbtns"><button class="btn sm ghost" data-act="copy-url">링크 복사</button><button class="btn sm" data-act="qr-save">QR 이미지 저장 (인쇄용)</button></div>
          <p class="note">QR을 화면에 띄우거나 인쇄해 두세요. 참가자는 신청서에 적은 휴대폰 번호만 입력하면 들어와요.</p></div></div></section>`;
  }
  function drawQR() {
    const el = document.getElementById("qr");
    if (!el) return;
    el.innerHTML = "";
    if (typeof QRCode === "undefined") { el.textContent = "QR"; return; }
    try { new QRCode(el, { text: entryUrl(), width: 148, height: 148, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { el.textContent = "QR"; }
  }

  /* ───────── 명단 가져오기 (구글 시트 → 참가자) ───────── */
  const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : "열" + (i + 1));
  const shortHead = (h) => { h = String(h || "").replace(/\s+/g, " ").trim(); return h.length > 26 ? h.slice(0, 26) + "…" : h || "(제목 없음)"; };
  const maskPhone = (p) => "***-****-" + String(p).slice(-4);

  // 시트에 날짜 열이 없을 때: 참가자가 있는 날짜 중에서 고르거나 새 날짜를 만든다
  const timeField = (id, v) => `<label class="mp" for="${id}"><span>시간 타임 <small>선택 · 예: 19:00</small></span><input type="text" id="${id}" inputmode="numeric" placeholder="19:00" maxlength="5" value="${esc(v || "")}"></label>`;

  /* ───────── 회차 선택 + 참가자 목록(컴팩트) ───────── */
  // 날짜(회차)를 드롭다운으로 고른다. 지난 회차도 모두 목록에 남는다. 최근 날짜가 위.
  function roundBar() {
    if (!S.rounds.length) return "";
    const cur = S.rounds.find((r) => r.id === S.round);
    const tag = (r) => { const t = roundTag(r.id); return t === "지난" ? "" : " · " + t; };
    const shown = S.rounds.filter((r) => r.count > 0 || r.id === S.round);   // 참가자 데이터가 있는 날짜만
    return `<div class="roundsel"><label for="round-select">날짜</label>
      <select id="round-select" aria-label="날짜별 회차 선택">${shown.map((r) => `<option value="${esc(r.id)}" ${r.id === S.round ? "selected" : ""}>${esc(roundLabel(r.id))}${tag(r)} · ${r.count}명 · ${r.results_open ? "결과 공개" : "진행 중"}</option>`).join("")}</select>
      ${cur ? `<span class="rtag t-${roundTag(cur.id)}">${roundTag(cur.id)}</span>` : ""}</div>`;
  }
  // 한 줄: 번호 · 이름 · 성별 · 연락처 + 펼치기 버튼.  자세한 정보는 펼쳤을 때만 보인다.
  function participantList(ppl) {
    if (!ppl.length) return `<div class="empty"><b>이 회차에는 아직 명단이 없어요</b><p>위의 '명단 가져오기'에서 구글 시트를 불러오세요.</p></div>`;
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    return `<div class="plist" role="list">
      <div class="phead chk"><span>도착</span><span class="pn">번호</span><span>이름</span><span>성별</span><span>연락처</span><span></span></div>
      ${ppl.map((p) => {
        const open = !!S.open[p.id];
        const rows = [["나이", p.age_label], ["대학·학과", splitSchool(p.school).filter(Boolean).join(" · ")], ["MBTI", p.mbti], ["취미", p.hobby]]
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "-")}</dd></div>`).join("");
        return `<div class="prow ${open ? "open" : ""} ${p.arrived ? "here" : ""}" role="listitem">
          <div class="pmain chk"><label class="apck"><input type="checkbox" data-arrive="${p.id}" ${p.arrived ? "checked" : ""} aria-label="${esc(p.name)} 도착 확인"></label><span class="pn">${p.number}</span><span class="pnm">${esc(p.name)}</span><span class="pg g-${p.gender}">${p.gender === "M" ? "남" : "여"}</span><span class="pph">${esc(fmtPhone(p.phone))}</span>
            <button class="ptog" data-act="toggle" data-id="${p.id}" aria-expanded="${open}" aria-label="${esc(p.name)} 자세히 ${open ? "접기" : "보기"}">${chev}</button></div>
          ${open ? `<dl class="pdet">${rows}<div><dt>설문</dt><dd><span class="tag ${p.submitted ? "y" : "n"}">${p.submitted ? "제출" : "대기"}</span></dd></div>
            <div class="pact"><label>번호 <input class="numin" type="number" min="1" inputmode="numeric" data-id="${p.id}" data-old="${p.number}" value="${p.number}" aria-label="${esc(p.name)} 번호"></label>
              <span class="pbtns">${p.has_pin ? `<button class="link" data-act="reset-pin" data-phone="${esc(p.phone)}" data-name="${esc(p.name)}">${S.confirm === "rp" + p.phone ? "정말 초기화" : "비밀번호 초기화"}</button>` : `<span class="sub" style="font-size:12px">비밀번호 미설정</span>`}<button class="link" data-act="edit-person" data-id="${p.id}">정보 수정</button>${S.applicants.some((a) => a.phone === p.phone && a.assigned_round === S.round) ? `<button class="link" data-act="remove" data-id="${p.id}" data-name="${esc(p.name)}" title="신청자 대기 명단으로 되돌려요">${S.confirm === "rm" + p.id ? "한 번 더 눌러 취소" : "배정 취소"}</button>` : ""}<button class="link" data-act="remove-full" data-id="${p.id}" data-name="${esc(p.name)}" title="신청 기록까지 모두 삭제해요">${S.confirm === "rf" + p.id ? "한 번 더 눌러 삭제" : "삭제"}</button></span></div></dl>` : ""}
        </div>`;
      }).join("")}</div>`;
  }

  /* ───────── 참가자 직접 추가·수정 ───────── */
  const emptyAdd = () => ({ open: true, editing: false, round: "", newdate: "", newtime: "", name: "", gender: "", phone: "", number: "", age: "", school: "", mbti: "", hobby: "" });
  function addPanel() {
    const a = S.add, hasRound = !!(S.data && S.data.round);
    const f = (id, label, input) => `<label class="mp" for="add-${id}"><span>${label}</span>${input}</label>`;
    const txt = (id, ph, extra) => `<input type="text" id="add-${id}" value="${esc(a[id])}" placeholder="${esc(ph || "")}" autocomplete="off" ${extra || ""}>`;
    return `<section class="panel" id="add-details"><h2>${a.editing ? "참가자 정보 수정" : "참가자 직접 추가"} </h2>
      <p class="note">${a.editing ? "연락처는 그 사람을 구분하는 값이라 바꿀 수 없어요. 연락처를 바꾸려면 이전 사람을 삭제하고 새로 추가하세요." : "추가한 사람은 선택한 날짜의 참가자가 되어 바로 입장할 수 있어요. 연락처는 <b>하이픈 없이 숫자만</b> 저장돼요. 같은 연락처로 다시 추가하면 정보가 수정돼요. <b>번호는 비워 두면 알아서 정해져요.</b> 같은 성별에서 비어 있는 가장 작은 번호가 붙고, 빈 번호가 없으면 맨 뒤 번호가 붙어요."}</p>
      <form id="f-add" class="addgrid" autocomplete="off">
        ${addDateFields()}
        ${f("name", "이름 *", txt("name", "성+이름 (예: 김지은)", "required"))}
        <div class="mp"><span>성별 *</span><div class="seg"><label><input type="radio" name="add-gender" value="M" ${a.gender === "M" ? "checked" : ""}><span>남성</span></label><label><input type="radio" name="add-gender" value="F" ${a.gender === "F" ? "checked" : ""}><span>여성</span></label></div></div>
        ${f("phone", "연락처 * ('-' 없이 숫자만)", `<input type="tel" inputmode="numeric" id="add-phone" value="${esc(a.phone)}" placeholder="01012345678" autocomplete="off" required ${a.editing ? "readonly" : ""}>`)}
        ${f("number", "번호", `<input type="number" min="1" inputmode="numeric" id="add-number" value="${esc(a.number)}" placeholder="비우면 자동 배정">`)}
        ${f("age", "나이", txt("age", "예: 03년생"))}
        ${f("school", "대학교-학과", txt("school", "예: 고려대-건축학과"))}
        ${f("mbti", "MBTI", txt("mbti", "예: INTP", 'maxlength="4"'))}
        ${f("hobby", "취미", txt("hobby", "예: 러닝, 전시회"))}
        <div class="addact"><button class="btn" type="submit" ${S.busy ? "disabled" : ""}>${a.editing ? "수정 저장" : "참가자 추가"}</button>${a.editing ? `<button class="btn ghost" type="button" data-act="add-cancel">취소</button>` : ""}</div>
      </form></section>`;
  }

  /* ───────── 최종 선택 현황 + 수동 조정 ───────── */
  const shortText = (t) => { t = String(t || "?").trim(); return t.length > 6 ? t.slice(0, 6) + "…" : t; };
  function pickLabel(x) { return x.target_id ? `${x.target_number}번 ${x.target_name}` : `"${x.input}" (미확인)`; }
  function picksPanel(d) {
    const ppl = d.participants, picks = d.picks || [];
    const of = (id) => picks.filter((x) => x.participant_id === id).sort((a, b) => a.rank - b.rank);
    const mutual = (pid, tid) => !!tid && picks.some((x) => x.participant_id === tid && x.target_id === pid);
    const bad = picks.filter((x) => !x.target_id).length;
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    const rows = ppl.filter((p) => !S.onlyBad || of(p.id).some((x) => !x.target_id)).map((p) => {
      const mine = of(p.id), open = !!S.openPick[p.id];
      const sum = mine.length ? mine.map((x) => (x.target_id ? `<span class="pk ${mutual(p.id, x.target_id) ? "mu" : ""}">${x.target_number}</span>` : `<span class="pk bad" title="${esc(x.input || "")}">${esc(shortText(x.input))}</span>`)).join("") : `<span class="sub">-</span>`;
      const cur = S.pickEdit[p.id] || Array.from({ length: MAX_PICKS }, (_, i) => (mine[i] && mine[i].target_id) || "");
      const opp = ppl.filter((q) => q.gender !== p.gender).sort((a, b) => a.number - b.number);
      const detail = open ? `<div class="pdet pickedit">
          ${mine.length ? `<ul class="typed"><li class="typed-h">참가자가 적은 내용</li>${mine.map((x) => `<li><b>${x.rank}순위</b> “${esc(x.input == null ? "(진행자 입력)" : x.input)}” → ${x.target_id ? `${x.target_number}번 ${esc(x.target_name)}` : `<span class="badtxt">명단에서 못 찾음 · 아래에서 맞춰 주세요</span>`}</li>`).join("")}</ul>` : `<p class="sub" style="font-size:12.5px;margin:0">아직 적은 내용이 없어요. 아래에서 직접 정할 수도 있어요.</p>`}
          ${Array.from({ length: MAX_PICKS }, (_, i) => `<label class="pks"><span>${i + 1}순위</span><select data-pick-for="${p.id}" data-slot="${i}"><option value="">(비움)</option>${opp.map((q) => `<option value="${q.id}" ${cur[i] === q.id ? "selected" : ""}>${q.number}번 ${esc(q.name)}</option>`).join("")}</select></label>`).join("")}
          <div class="pact"><span class="sub" style="font-size:12px">${p.submitted ? "설문 제출함" : "설문 미제출 (선택만 조정해도 돼요)"}</span><button class="btn sm" type="button" data-act="pick-save" data-id="${p.id}">저장</button></div></div>` : "";
      return `<div class="prow ${open ? "open" : ""}" role="listitem"><div class="pmain pickmain"><span class="pn">${p.number}</span><span class="pnm">${esc(p.name)}</span><span class="pg g-${p.gender}">${p.gender === "M" ? "남" : "여"}</span><span class="psum">${sum}</span>
        <button class="ptog" data-act="pick-toggle" data-id="${p.id}" aria-expanded="${open}" aria-label="${esc(p.name)} 선택 조정 ${open ? "접기" : "열기"}">${chev}</button></div>${detail}</div>`;
    }).join("");
    return `<section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>최종 선택 현황</h2><span>제출 ${ppl.filter((p) => p.submitted).length} / ${ppl.length}명 · <b class="${bad ? "badtxt" : ""}">확인 필요 ${bad}건</b></span></div>
        <div><label class="ck"><input type="checkbox" id="only-bad" ${S.onlyBad ? "checked" : ""}> 확인 필요만</label> <button class="btn sm ghost" data-act="csv-picks">선택 CSV</button></div></div>
      <p class="note"><span class="pk mu">붉은 숫자</span> 서로 선택 · <span class="pk bad">노란 글자</span> 명단에서 못 찾은 입력(적은 그대로). 줄을 펼치면 <b>직접 맞추거나 바꿀 수</b> 있어요.</p>
      ${rows ? `<div class="plist" role="list"><div class="phead pickhead"><span class="pn">번호</span><span>이름</span><span>성별</span><span>1·2·3순위</span><span></span></div>${rows}</div>` : `<div class="empty"><b>${S.onlyBad ? "확인이 필요한 선택이 없어요" : "아직 참가자가 없어요"}</b></div>`}</section>`;
  }

  /* ───────── 하단 탭 4개: 최종 선택 현황 · 참가자 현황 · 참가자 추가 · 설문 결과 ───────── */
  const ico = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const TABS = [
    ["applicants", "신청자", ico('<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>')],
    ["people", "참가자", ico('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8s5 1.8 5.5 4.8"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16 14.4c2.6-.2 4.2 1.4 4.5 4.1"/>')],
    ["sms", "안내 문자", ico('<path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4.2 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M8 10h8M8 13h5"/>')],
    ["picks", "최종 선택", ico('<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M9.3 11.6l2 2 3.6-3.8"/>')],
    ["survey", "설문 결과", ico('<path d="M4.5 20V10M10 20V4.5M15.5 20v-7M21 20H3"/>')],
  ];

  // [운명의 실] 보내기 스위치(켜면 참가자 화면에 팝업) + 보낸 실 목록. 보낸 사람은 진행자만 볼 수 있다
  function threadPanel(rnd) {
    const open = !!rnd.threads_open, list = S.thr, knots = list.filter((t) => t.knot).length / 2;
    return `<section class="panel"><h2>운명의 실 <span class="sub">3:3 끝난 뒤 · 1:1 전에 켜기</span></h2>
      <div class="resultbar"><span class="tag ${open ? "y" : "n"}">${open ? "보내기 열림" : "닫힘"}</span><span class="sub" style="font-size:13px">보낸 실 ${list.length}개 · 매듭 ${Math.floor(knots)}쌍</span>
        <button class="btn ${open ? "ghost" : ""}" style="width:auto" data-act="threads-toggle" ${S.busy ? "disabled" : ""}>${open ? (S.confirm === "th-off" ? "한 번 더 눌러 닫기" : "보내기 닫기") : S.confirm === "th-on" ? "한 번 더 눌러 열기" : "실 보내기 열기"}</button></div>
      <p class="note">열면 참가자 화면에 <b>팝업</b>이 떠요(6초 안에). 닫아도 이미 보낸 실은 그대로 남아요.</p>
      ${list.length ? `<div class="rows">${list.map((t) => `<div class="row paidrow ${t.knot ? "" : ""}"><span class="rm"><b>${t.from_gender === "M" ? "남" : "여"} ${t.from_number}번 ${esc(t.from_name)} → ${t.to_number}번 ${esc(t.to_name)}</b>${t.knot ? ` <span class="tag y">매듭</span>` : ""}<blockquote class="msg">${esc(t.message)}</blockquote></span><span class="pbtns"><button class="link" data-act="thread-del" data-id="${t.id}">${S.confirm === "td" + t.id ? "정말 삭제" : "삭제"}</button></span></div>`).join("")}</div>` : ""}</section>`;
  }

  /* ───────── 안내 문자(예약 확인 · 전날 확정 · 결과 안내): 맥북 메시지 앱으로 보내는 스크립트 ───────── */
  const SMS_KINDS = [["reserve", "신청 완료"], ["join", "참가 확정"], ["confirm", "장소 안내"], ["result", "결과 안내"], ["cancel", "행사 취소"]];
  // 보내는 순서(진행 단계)와 때. 기본 필터는 모두 "아직 안 보낸 사람"이라, 늦게 등록한 사람은 나중에 같은 화면에서 미발송만 골라 보내면 된다
  const SMS_STEP = { reserve: "신청 직후 · 신규 신청자에게", join: "행사 2일 전 · 그 회차 참가자에게", confirm: "행사 1일 전 · 그 회차 참가자에게", result: "결과 공개 후 · 그 회차 참가자에게", cancel: "행사를 열 수 없을 때 · 그 회차 참가자와 신청자에게" };
  const SMS_DEFAULT = {
    reserve: ["안녕하세요, 로테이션 소개팅 [결] 운영진입니다 :)", "{이름}님, 신청과 입금이 확인되어 신청이 완료되었어요 💌", "", "신청하신 날짜: {희망날짜}", "", "성비를 고려해 참가 확정 여부는 행사 2일 전까지 문자로 안내드릴게요.", "조금만 기다려주세요 🙂"].join("\n"),
    join: ["안녕하세요, 로테이션 소개팅 [결] 운영진입니다 :)", "{이름}님, 로테이션 소개팅 참가가 확정되었어요 🎉", "", "📅 일시 : {일시}", "📍 장소 : 신촌·홍대 근처 카페", "", "정확한 장소와 지도 링크는 행사 하루 전에 문자로 다시 안내드릴게요.", "", "설레는 만남 준비해두고 기다릴게요 💗"].join("\n"),
    confirm: ["안녕하세요, 로테이션 소개팅 [결] 운영진입니다 🧶", "내일 행사 장소와 시간 안내드립니다!", "", "📅 일시 : {일시}", "📍 장소 : {장소}", "🗺️ 지도 : {지도}", "", "⏰ 원활한 진행을 위해 {도착시간}까지 꼭 도착해주세요!", "", "🎓 입장할 때 학생증을 확인해요. 실물이나 모바일 학생증 등 학교를 확인할 수 있는 물품을 꼭 챙겨주세요!", "☕ 간단한 음료와 다과가 준비되어 있어요.", "", "혹시 늦거나 못 오시게 되면 미리 연락 부탁드려요.", "내일 뵐게요 💘"].join("\n"),
    result: ["안녕하세요, 로테이션 소개팅 [결] 운영진입니다 :)", "오늘 함께해 주셔서 정말 감사합니다 🙏", "", "최종 선택 결과가 공개되었어요!", "아래 링크에서 로그인 후 '최종선택' 탭에서 확인해 주세요 💘", "{링크}", "", "서로 선택한 분이 있다면 그곳에서 연락처를 확인하실 수 있어요.", "인스타그램을 팔로우하면 다음 회차 소식과 콘텐츠를 가장 먼저 받아보실 수 있어요 ㅎㅎ", "→ @gyeol.meet_official"].join("\n"),
    cancel: ["안녕하세요, 로테이션 소개팅 [결] 운영진입니다.", "{이름}님, [결]에 신청해 주셔서 진심으로 감사드려요 🙏", "", "아쉽게도 {일시} 회차는 성비 문제로 부득이하게 참여가 어려워졌어요.", "기대하고 계셨을 텐데 정말 죄송합니다.", "", "혹시 다음 회차로 옮겨서 참여하실 수 있을까요?", "다음 회차 일정에 맞춰 우선으로 자리를 마련해 드릴게요 💌", "", "▶ 다음 회차로 이동을 원하시면 \"이동\"", "▶ 환불을 원하시면 \"환불\"과 함께 환불받으실 계좌", "", "이 번호로 답장 주시면 바로 처리해 드릴게요.", "환불을 선택하셔도 참가비는 전액 돌려드려요.", "", "소식은 인스타그램 @gyeol.meet_official 에서도 확인하실 수 있어요."].join("\n"),
  };
  const smsStoreKey = "rn_sms_tpl_v1";
  let smsTimer = null;   // 입력 후 잠깐 기다렸다 저장(타자마다 서버를 부르지 않게)
  function smsTpl(kind) {
    const t = S.sms.tpl[kind];
    return typeof t === "string" && t.trim() ? t : SMS_DEFAULT[kind];
  }
  function smsQueueSave() { clearTimeout(smsTimer); smsTimer = setTimeout(smsFlushSave, 700); }
  async function smsFlushSave() {
    clearTimeout(smsTimer); smsTimer = null;
    const kind = S.sms.kind, round = S.round, tpl = S.sms.tpl[kind] || "";
    try {
      await api.admin.smsSaveTpl(S.pin, kind, tpl);
      if (round) await api.admin.smsSaveRound(S.pin, round, S.sms.when, S.sms.venue, S.sms.map, {});
    } catch (e) { if (S.sms.dbOk) toast("문안을 서버에 저장하지 못했어요(SQL 최신본을 실행했는지 확인). 이 화면에서만 유지돼요."); S.sms.dbOk = false; }
  }
  function smsSaveTpl(kind, text) { S.sms.tpl[kind] = text; smsQueueSave(); }
  // 서버의 문안·장소와 발송 대상 목록을 불러온다. 선택 상태(체크)는 15초 새로고침에도 유지한다.
  async function loadSms() {
    const typing = smsTimer !== null;   // 저장 대기 중이면 서버 값으로 덮지 않는다
    try {
      const c = await api.admin.smsGet(S.pin, S.round);
      S.sms.dbOk = true;
      if (!typing) { S.sms.tpl = c.tpl || {}; S.sms.when = c.when || ""; S.sms.venue = c.venue || ""; S.sms.map = c.map || ""; }
    } catch (e) { S.sms.dbOk = false; }
    let list = [];
    try { list = S.round || S.sms.kind === "reserve" ? await api.admin.smsPending(S.pin, S.round, S.sms.kind) : []; } catch (e) { list = []; }   // 결과 미공개 등은 빈 목록
    const kind = S.sms.kind;
    list.forEach((x) => {
      const k = kind + ":" + x.id;
      if (!(k in S.sms.wasSent)) S.sms.sel[k] = !x.sent;                  // 처음 보는 사람: 아직 안 보냈으면 선택
      else if (x.sent && !S.sms.wasSent[k]) S.sms.sel[k] = false;         // 방금 발송 완료가 된 사람은 선택 해제
      else if (!x.sent && S.sms.wasSent[k]) S.sms.sel[k] = true;          // 발송 표시를 되돌린 사람은 다시 선택
      S.sms.wasSent[k] = !!x.sent;
    });
    S.sms.list = list;
  }
  // 필터(발송 상태·검색·날짜·대상 구분)에 걸려 화면에 보이는 사람들
  function smsVisible() {
    const f = S.sms.f, q = f.q.trim().toLowerCase(), qd = f.q.replace(/\D/g, "");
    return S.sms.list.filter((x) => (!f.status || (f.status === "sent" ? x.sent : !x.sent))
      && (!q || String(x.name || "").toLowerCase().includes(q) || (qd.length >= 3 && String(x.phone || "").includes(qd)))
      && (S.sms.kind !== "reserve" || !f.date || (f.date === "__none" ? !applPrefs(x).length : applPrefs(x).some((d) => roundDate(d) === f.date && (!f.time || (d.slice(11) || "__none") === f.time))))
      && (S.sms.kind !== "cancel" || !f.src || x.src === f.src));
  }
  // 체크된 사람 중 이미 '발송됨'인 사람(발송 표시를 잘못 눌렀을 때 되돌리는 대상)
  const smsSentSel = () => smsVisible().filter((x) => x.sent && S.sms.sel[S.sms.kind + ":" + x.id]);
  // 보낼 사람 = 화면에 보이는 사람 중 체크된 사람 (필터로 가려진 사람은 보내지 않는다)
  const smsSelIds = () => smsVisible().filter((x) => S.sms.sel[S.sms.kind + ":" + x.id]).map((x) => x.id);
  // {이름} {희망날짜} {일시} {장소} {링크} 를 채운다. 값이 비어 있는 자리표시가 든 줄은 통째로 뺀다(예: 희망 날짜를 안 고른 사람)
  function renderTpl(tpl, vars) {
    return String(tpl).split("\n").filter((line) => {
      const ms = line.match(/\{[^}]+\}/g) || [];
      return ms.every((m) => String(vars[m.slice(1, -1)] || "").trim() !== "");
    }).map((line) => line.replace(/\{([^}]+)\}/g, (m, k) => String(vars[k] || ""))).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  const WDAY = ["일", "월", "화", "수", "목", "금", "토"];
  function fmtMD(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? parseInt(m[2], 10) + "/" + parseInt(m[3], 10) + "(" + WDAY[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ")" : "";
  }
  function fmtWhen(roundId) {
    const m = String(roundId || "").match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/);
    return m ? parseInt(m[2], 10) + "월 " + parseInt(m[3], 10) + "일(" + WDAY[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] + ")" + (m[4] ? " " + m[4] : "") : "";
  }
  // '11월 14일(토) 18:00 - 20:00' 의 첫 시각에서 10분을 더한 도착 마감 시각(18:10). 시각이 없으면 빈 값
  function arriveTime(text) {
    const m = String(text || "").match(/(\d{1,2}):(\d{2})/);
    if (!m) return "";
    const min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + 10;
    return min >= 24 * 60 ? "" : String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  }
  function smsVars(kind, person) {
    const v = { 이름: person ? person.name : "홍길동", 링크: entryUrl() };
    if (kind === "reserve") v.희망날짜 = person ? applPrefs(person).map((d) => fmtMD(d) + (d.slice(11) ? " " + d.slice(11) : "")).join(", ") : fmtMD(todayISO());
    if (kind === "join") v.일시 = S.sms.when.trim() || fmtWhen(S.round);
    if (kind === "confirm") {
      v.일시 = S.sms.when.trim() || fmtWhen(S.round); v.장소 = S.sms.venue.trim(); v.지도 = S.sms.map.trim();
      v.도착시간 = arriveTime(v.일시);   // 시작 시각 10분 후. 일시에 시간이 없으면 비어서 그 줄이 빠진다
    }
    if (kind === "cancel") v.일시 = S.sms.when.trim() || fmtWhen(S.round);
    return v;
  }
  // 문자를 보내기 전에 꼭 채워야 하는 칸이 비었는지. 비어 있으면 안내 문구를, 아니면 ""
  function smsMissing(kind) {
    if (kind === "confirm" && (!S.sms.venue.trim() || !S.sms.map.trim())) return "장소와 지도 링크를 입력해 주세요";
    return "";
  }
  const smsRest = (kind, d) => {
    const c = S.sms.counts && S.sms.counts[kind];
    if (c) return { sent: c.sent, total: c.total, rest: Math.max(0, c.total - c.sent) };
    if (kind === "result") { const sent = d.sms_sent || 0, total = d.participants.length; return { sent, total, rest: Math.max(0, total - sent) }; }
    return { sent: 0, total: 0, rest: 0, unknown: true };
  };
  // 발송 버튼의 상태(눌러도 되는지, 글자): 장소를 입력하는 중에도 바로 갱신할 수 있게 따로 계산한다
  function smsSendState(d) {
    const open = !!d.results_open, kind = S.sms.kind, st = smsRest(kind, d), miss = smsMissing(kind);
    const n = smsSelIds().length, noRound = kind !== "reserve" && !S.round;
    const canSend = !S.busy && n > 0 && !(kind === "result" && !open) && !miss && !noRound;
    const label = noRound ? "날짜(회차)를 먼저 만들어 주세요" : kind === "result" && !open ? "먼저 결과를 공개해 주세요" : miss ? miss : !n ? "보낼 사람을 선택해 주세요" : `발송 스크립트 받기 (선택 ${n}명)`;
    return { canSend, label, st, open, n };
  }
  function updateSmsButtons() {
    if (!S.data) return;
    const { canSend, label } = smsSendState(S.data);
    const send = document.querySelector('[data-act="mac-send"]'), mark = document.querySelector('[data-act="mac-mark"]');
    if (send) { send.disabled = !canSend; send.textContent = label; }
    const pv = document.getElementById("sms-preview"); if (pv) pv.textContent = renderTpl(smsTpl(S.sms.kind), smsVars(S.sms.kind, null));
    if (mark) mark.disabled = !canSend;
  }
  const smsPrefLabel = (d) => fmtMD(d) + (d.slice(11) ? " " + d.slice(11) : "");
  // 목록: 맨 위에 '보이는 사람 전체 선택' 체크박스, 아래에 사람별 체크박스
  function smsRowsHtml() {
    const kind = S.sms.kind, vis = smsVisible();
    if (!S.sms.list.length) return `<p class="sub">${kind === "result" && !(S.data && S.data.results_open) ? "결과를 공개하면 목록이 나와요." : "보낼 수 있는 사람이 없어요."}</p>`;
    if (!vis.length) return `<p class="sub">조건에 맞는 사람이 없어요.</p>`;
    const nSel = smsSelIds().length;
    return `<label class="row apck-row smsall"><input type="checkbox" data-sms-all ${nSel === vis.length ? "checked" : ""} aria-label="보이는 사람 전체 선택"><span class="rm"><b>전체 선택</b> <span class="sub">${nSel}명 선택 / ${vis.length}명</span></span></label>
      <div class="rows smslist">${vis.map((x) => `<label class="row apck-row"><input type="checkbox" data-sms-sel="${x.id}" ${S.sms.sel[kind + ":" + x.id] ? "checked" : ""} aria-label="${esc(x.name)} 선택"><span class="rm"><b>${x.number ? x.number + "번 " : ""}${esc(x.name)}</b> <span class="sub">${esc(fmtPhone(x.phone))}${kind === "cancel" ? (x.src === "applicant" ? " · 신청자" : " · 참가자") : ""}${kind === "reserve" && applPrefs(x).length ? " · " + esc(applPrefs(x).map(smsPrefLabel).join(", ")) : ""}</span></span>${x.sent ? `<span class="tag y">발송됨</span>` : ""}</label>`).join("")}</div>`;
  }
  // 체크·검색을 바꿀 때: 화면 전체를 다시 그리지 않고 목록과 버튼만 갱신한다(입력 칸의 포커스 유지)
  function updateSmsList() {
    const box = document.getElementById("sms-listbox");
    if (box) box.innerHTML = smsRowsHtml();
    updateSmsButtons();
  }
  // 필터는 최소한으로: 발송 상태(기본 미발송) + 검색. 신청 완료는 신청 날짜, 행사 취소는 참가자/신청자 구분을 더한다
  function smsFilterBar(kind) {
    const f = S.sms.f, opt = (v, label, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
    let more = "";
    if (kind === "reserve") {
      const dates = Array.from(new Set(S.sms.list.flatMap((x) => applPrefs(x).map(roundDate)).filter(Boolean))).sort();
      const times = f.date && f.date !== "__none" ? Array.from(new Set(S.sms.list.flatMap((x) => applPrefs(x).filter((d) => roundDate(d) === f.date).map((d) => d.slice(11) || "__none")))).sort() : [];
      more = `<label class="mp"><span>신청 날짜</span><select id="sms-f-date">${opt("", "전체", f.date)}${dates.map((d) => opt(d, roundLabel(d), f.date)).join("")}${opt("__none", "날짜 없음", f.date)}</select></label>`
        + (times.length > 1 || (times.length === 1 && times[0] !== "__none") ? `<label class="mp"><span>시간</span><select id="sms-f-time">${opt("", "전체", f.time)}${times.map((t) => opt(t, t === "__none" ? "시간 없음" : t, f.time)).join("")}</select></label>` : "");
    } else if (kind === "cancel") {
      more = `<label class="mp"><span>대상</span><select id="sms-f-src">${opt("", "전체", f.src)}${opt("participant", "참가자", f.src)}${opt("applicant", "신청자", f.src)}</select></label>`;
    }
    return `<div class="filters"><label class="mp"><span>발송 상태</span><select id="sms-f-status">${opt("unsent", "미발송", f.status)}${opt("", "전체", f.status)}${opt("sent", "발송됨", f.status)}</select></label>${more}
      <label class="mp"><span>검색</span><input id="sms-f-q" type="text" autocomplete="off" placeholder="이름 또는 번호" value="${esc(f.q)}"></label></div>`;
  }
  function smsPanel(d) {
    const kind = S.sms.kind, tpl = smsTpl(kind);
    const { canSend, label } = smsSendState(d);
    const seg = SMS_KINDS.map(([k, lb]) => { const c = smsRest(k, d); return `<button type="button" data-act="sms-kind" data-v="${k}" class="${kind === k ? "on" : ""}">${lb}${c.unknown ? "" : ` <small>${c.sent}/${c.total}</small>`}</button>`; }).join("");
    const roundSel = kind !== "reserve" ? `<label class="mp" for="sms-round"><span>회차</span><select id="sms-round">${S.rounds.length ? S.rounds.map((r) => `<option value="${esc(r.id)}" ${r.id === S.round ? "selected" : ""}>${esc(roundLabel(r.id))} · 참가자 ${r.count}명</option>`).join("") : `<option value="">회차가 없어요</option>`}</select></label>` : "";
    const when = kind === "join" || kind === "cancel" ? `<label class="mp" for="sms-when"><span>일시 <small>비우면 회차 날짜</small></span><input id="sms-when" type="text" placeholder="${esc(fmtWhen(S.round) || "11월 8일(일) 18:00 - 20:00")}" value="${esc(S.sms.when)}"></label>` : "";
    const place = kind === "confirm" ? `<label class="mp" for="sms-when"><span>일시 <small>예: 11월 8일(일) 18:00 - 20:00 · 시작 10분 후가 도착 마감</small></span><input id="sms-when" type="text" placeholder="${esc(fmtWhen(S.round) || "11월 8일(일) 18:00 - 20:00")}" value="${esc(S.sms.when)}"></label>
      <label class="mp" for="sms-venue"><span>장소 *</span><input id="sms-venue" type="text" placeholder="예: 홍대 ○○ 공간" value="${esc(S.sms.venue)}"></label>
      <label class="mp" for="sms-map"><span>지도 링크 *</span><input id="sms-map" type="url" placeholder="https://naver.me/…" value="${esc(S.sms.map)}"></label>` : "";
    return `<section class="panel smsflow"><h2>안내 문자</h2>
      <div class="seg smsseg" role="group" aria-label="문자 종류">${seg}</div>
      <p class="sub" style="font-size:13px">${SMS_STEP[kind]}</p>
      <div class="filters">${roundSel}${when}${place}</div>
      ${smsFilterBar(kind)}
      <div id="sms-listbox">${smsRowsHtml()}</div>
      ${smsSentSel().length ? `<button class="link" data-act="mac-unmark" style="justify-self:start">${S.confirm === "unmark" ? "한 번 더 눌러 표시 해제" : `선택한 사람 중 발송됨 ${smsSentSel().length}명을 미발송으로 되돌리기`}</button>` : ""}
      <details class="smsprev"><summary>문안 보기 · 수정</summary>
        <label class="mp" for="sms-tpl"><span>문안 <small>{이름} {희망날짜} {일시} {장소} {지도} {도착시간} {링크} · 값이 없는 줄은 빠져요</small></span><textarea id="sms-tpl" rows="10">${esc(tpl)}</textarea></label>
        <p class="sub" style="font-size:12.5px;margin:8px 0 4px">미리 보기 (예시)</p><pre id="sms-preview">${esc(renderTpl(tpl, smsVars(kind, null)))}</pre>
        <button class="link" data-act="sms-tpl-reset" style="justify-self:start">기본 문구로 되돌리기</button></details>
      <button class="btn" data-act="mac-send" ${canSend ? "" : "disabled"}>${label}</button>
      <p class="note">받은 파일을 맥북의 <b>스크립트 편집기</b>로 열어 ▶ 실행하세요. 끝나면 아래 버튼으로 기록하고, 파일은 삭제하세요.</p>
      <button class="btn ghost" data-act="mac-mark" ${canSend ? "" : "disabled"}>${S.confirm === "mark" ? "한 번 더 눌러 표시" : "발송 완료로 표시"}</button>
      <details class="smsprev"><summary>테스트로 1건 먼저 보내기</summary>
        <div class="filters"><label class="mp" for="sms-test"><span>받을 번호 <small>다른 사람 번호</small></span><input id="sms-test" type="tel" inputmode="numeric" placeholder="01012345678" value="${esc(S.sms.test)}"></label>
          <button class="btn sm ghost" data-act="mac-test" ${S.busy ? "disabled" : ""}>테스트 스크립트 받기</button></div></details>
    </section>`;
  }
  // [문자] 탭: 예약 확인은 날짜(회차)와 무관하게, 나머지는 위에서 고른 날짜(회차)의 참가자에게
  const tabSms = (d) => smsPanel(d || { results_open: false, participants: [] });

  // [유료 신청] 입금을 확인하고 승인하면 참가자 화면에 득표수/연락처가 열린다
  function paidPanel() {
    const list = S.paid, wait = list.filter((q) => q.status === "pending");
    if (!list.length) return `<section class="panel"><h2>유료 신청 <span class="sub">득표수 확인 · 연락처 전달</span></h2><p class="sub" style="font-size:13px">결과를 공개한 뒤 참가자가 신청하면 여기에 입금자명과 금액이 나와요. 입금을 확인하고 승인해 주세요.</p></section>`;
    const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
    const tagFor = (q) => `<span class="tag ${q.status === "approved" ? "y" : q.status === "rejected" ? "" : "n"}">${q.status === "approved" ? "승인" : q.status === "rejected" ? "거절" : "대기"}</span>`;
    return `<section class="panel"><h2>유료 신청 <span class="sub">${wait.length ? `대기 <b class="badtxt">${wait.length}건</b>` : "대기 없음"} · 입금 확인 후 승인</span></h2>
      <div class="rows">${list.map((q) => `<div class="row paidrow ${q.status === "pending" ? "warn" : ""}">
        <span class="rm"><b>${q.from_gender === "M" ? "남" : "여"} ${q.from_number}번 ${esc(q.from_name)}</b>
          <small>${q.kind === "votes" ? "득표수 확인" : `연락처 전달 → ${q.to_number}번 ${esc(q.to_name || "")}`} · ${won(q.amount)} · 입금자 <b>${esc(q.depositor)}</b></small>${q.message ? `<blockquote class="msg">${esc(q.message)}</blockquote>` : ""}</span>
        <span class="pbtns">${tagFor(q)}
          ${q.status !== "approved" ? `<button class="btn sm" data-act="paid-set" data-id="${q.id}" data-v="approved">승인</button>` : `<button class="link" data-act="paid-set" data-id="${q.id}" data-v="pending">승인 취소</button>`}
          ${q.status === "pending" ? `<button class="link" data-act="paid-set" data-id="${q.id}" data-v="rejected">거절</button>` : ""}</span></div>`).join("")}</div></section>`;
  }

  // [최종 선택 현황] 결과 공개 스위치 + 선택 현황·조정 + 매칭 쌍
  function tabPicks(d, rnd) {
    const ppl = d.participants, submitted = ppl.filter((p) => p.submitted).length, bad = (d.picks || []).filter((x) => !x.target_id).length;
    return `${threadPanel(rnd)}<section class="panel"><div class="toolbar"><h2>${esc(roundLabel(rnd.id))} 매칭 결과</h2><button class="btn sm ghost" data-act="refresh">새로고침</button></div>
        <p class="note">공개하면 참가자 화면에 <b>매칭 결과와 연락처</b>가 열리고, 이후엔 선택을 바꿀 수 없어요. 공개 전에 <b>확인 필요 0건</b>인지 확인하세요.</p>
        <div class="resultbar"><span class="tag ${d.results_open ? "y" : "n"}">${d.results_open ? "결과 공개 중" : "아직 비공개"}</span><span class="sub" style="font-size:13px">제출 ${submitted} / ${ppl.length}명 · 매칭 ${d.matches.length}쌍${bad ? ` · <b class="badtxt">확인 필요 ${bad}건</b>` : ""}</span>
          <button class="btn ${d.results_open ? "ghost" : ""}" style="width:auto" data-act="results" ${S.busy ? "disabled" : ""}>${d.results_open ? (S.confirm === "res-off" ? "한 번 더 눌러 공개 취소" : "공개 취소 (다시 제출 받기)") : S.confirm === "res-on" ? "한 번 더 눌러 공개" : "매칭 결과 공개하기"}</button></div></section>
      ${paidPanel()}
      ${picksPanel(d)}
      <section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>매칭된 쌍</h2><span>${d.matches.length}쌍</span></div><button class="btn sm ghost" data-act="csv-match">매칭 CSV</button></div>
        ${d.matches.length ? `<div class="tbl-wrap"><table><thead><tr><th>남</th><th>여</th></tr></thead><tbody>${d.matches.map((m) => `<tr><td>${m.m_number}번 ${esc(m.m_name)}</td><td>${m.f_number}번 ${esc(m.f_name)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>매칭된 쌍이 아직 없어요</b><p>참가자가 최종 선택을 제출하면 서로 선택한 쌍이 여기에 보여요.</p></div>`}
        <p class="note">매칭된 상대의 연락처는 참가자 본인 화면에서 결과 공개 후에만 전달돼요.</p></section>`;
  }

  // [참가자 현황] 통계 + 목록(컴팩트) + CSV + 날짜 초기화
  function tabPeople(d, rnd) {
    const ppl = d.participants, men = ppl.filter((p) => p.gender === "M"), women = ppl.filter((p) => p.gender === "F");
    const submitted = ppl.filter((p) => p.submitted).length, arrived = ppl.filter((p) => p.arrived).length;
    const am = men.filter((p) => p.arrived).length, af = women.filter((p) => p.arrived).length;
    const shown = S.onlyAbsent ? ppl.filter((p) => !p.arrived) : ppl;
    return `<section class="stats s3">
        <div class="stat"><small>남성 총원</small><b>${men.length}<em>명</em></b></div>
        <div class="stat"><small>여성 총원</small><b>${women.length}<em>명</em></b></div>
        <div class="stat"><small>선택·설문 제출</small><b>${submitted}<em>/ ${ppl.length}명</em></b></div>
      </section>
      <section class="stats s3"><div class="stat"><small>도착 확인</small><b>${arrived}<em>/ ${ppl.length}명</em></b></div>
        <div class="stat"><small>남성 도착</small><b>${am}<em>/ ${men.length}명</em></b></div>
        <div class="stat"><small>여성 도착</small><b>${af}<em>/ ${women.length}명</em></b></div></section>
      <section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>참가자</h2><span>연락처는 진행자만 볼 수 있어요</span></div><button class="btn sm ghost" data-act="csv-people">참가자 CSV</button></div>
        <label class="ck"><input type="checkbox" id="only-absent" ${S.onlyAbsent ? "checked" : ""}> 아직 도착하지 않은 사람만 보기 (${ppl.length - arrived}명)</label>
        ${participantList(shown)}</section>
      <section class="panel"><h2>${esc(roundLabel(rnd.id))} 데이터 초기화</h2><p class="sub" style="font-size:13px">이 날짜의 모든 참가자, 메모, 선택, 설문을 <b>지우고</b> 결과 공개도 닫습니다. 다른 날짜는 그대로예요. 지난 회차 기록은 지우지 않는 한 계속 저장돼 있으니, 정말 필요할 때만 쓰세요. 되돌릴 수 없어요. 먼저 CSV를 내려받으세요.</p>
        <button class="btn danger sm" style="justify-self:start" data-act="reset">${S.confirm === "reset" ? "정말 모두 삭제합니다" : "이 날짜 데이터 초기화"}</button></section>`;
  }

  // [설문 결과]
  function tabSurvey(d, rnd) {
    return `<section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>${esc(roundLabel(rnd.id))} 설문 결과</h2><span>${d.surveys.length}명 응답</span></div>
        <div><button class="btn sm ghost" data-act="csv-survey">설문 CSV</button></div></div>
        ${surveyCards(d.surveys)}</section>`;
  }


  /* ───────── [신청자] 대기 명단 → 날짜 배정 ───────── */
  const applKnownRounds = () => S.rounds.filter((r) => r.count > 0 || r.id === S.round);
  function applTarget() {
    const a = S.appl, known = applKnownRounds();
    return a.target && (a.target === "__new" || known.some((r) => r.id === a.target)) ? a.target : (known.some((r) => r.id === S.round) ? S.round : "__new");
  }
  // 신청자가 고른 희망 날짜·시간 중 그 날짜에 해당하는 것들
  const prefsOn = (x, date) => applPrefs(x).filter((p) => roundDate(p) === date);
  function applFiltered() {
    const a = S.appl;
    return S.applicants.filter((x) => (a.showAssigned || !x.assigned_round)
      && (!a.gender || x.gender === a.gender)
      && (!a.date || (a.date === "__none" ? !applPrefs(x).length : prefsOn(x, a.date).length > 0))
      && (!a.time || !a.date || a.date === "__none" || prefsOn(x, a.date).some((p) => (p.slice(11) || "__none") === a.time)));
  }
  function tabApplicants() {
    const a = S.appl, all = S.applicants, wait = all.filter((x) => !x.assigned_round);
    const list = applFiltered(), prefDates = Array.from(new Set(all.flatMap((x) => applPrefs(x).map(roundDate)).filter(Boolean))).sort();
    const onDate = a.date && a.date !== "__none" ? all.filter((x) => prefsOn(x, a.date).length) : [];
    const prefTimes = Array.from(new Set(onDate.flatMap((x) => prefsOn(x, a.date).map((p) => p.slice(11))).filter(Boolean))).sort();
    const hasNoTime = onDate.some((x) => prefsOn(x, a.date).some((p) => !p.slice(11)));
    const cntWait = (f) => { const w = wait.filter(f); return " · 대기 " + w.length + "명(남 " + w.filter((x) => x.gender === "M").length + " 여 " + w.filter((x) => x.gender === "F").length + ")"; };
    const sel = list.filter((x) => a.sel[x.id] && !x.assigned_round), selAsg = list.filter((x) => a.sel[x.id] && x.assigned_round), tg = applTarget();
    const cnt = (g) => wait.filter((x) => x.gender === g).length;
    const tr = S.rounds.find((r) => r.id === tg), baseM = tr ? tr.male || 0 : 0, baseF = tr ? tr.female || 0 : 0;
    const addM = sel.filter((x) => x.gender === "M").length, addF = sel.filter((x) => x.gender === "F").length;
    const tOpts = applKnownRounds().map((r) => `<option value="${esc(r.id)}" ${tg === r.id ? "selected" : ""}>${esc(roundLabel(r.id))} · 남 ${r.male || 0} · 여 ${r.female || 0}</option>`).join("");
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    const rowsHtml = list.map((x) => {
      const open = !!S.open["ap" + x.id], done = !!x.assigned_round;
      const det = [["나이", x.age_label], ["대학·학과", splitSchool(x.school).filter(Boolean).join(" · ")], ["MBTI", x.mbti], ["취미", x.hobby], ["신청 날짜", applPrefs(x).length ? applPrefs(x).map(roundLabel).join(", ") : "-"]]
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "-")}</dd></div>`).join("");
      return `<div class="prow ${open ? "open" : ""} ${done ? "done" : ""}" role="listitem">
        <div class="pmain apmain">
          <label class="apck"><input type="checkbox" data-appl-sel="${x.id}" ${a.sel[x.id] ? "checked" : ""} aria-label="${esc(x.name)} 선택"></label>
          <span class="pnm">${esc(x.name)}</span><span class="pg g-${x.gender}">${x.gender === "M" ? "남" : "여"}</span>
          <span class="pph">${done ? `<span class="tag y">${esc(roundLabel(x.assigned_round))} 배정</span>` : esc(x.age_label || "")}</span>
          <button class="ptog" data-act="toggle" data-id="ap${x.id}" aria-expanded="${open}" aria-label="${esc(x.name)} 자세히 ${open ? "접기" : "보기"}">${chev}</button></div>
        ${open ? `<dl class="pdet">${det}<div><dt>연락처</dt><dd>${esc(fmtPhone(x.phone))}</dd></div>
          <div class="pact"><span>${x.photo_url ? `<a class="link" href="${esc(x.photo_url)}" target="_blank" rel="noopener noreferrer">사진 보기 ↗</a>` : `<span class="sub">사진 링크 없음</span>`}</span>
            <span class="pbtns">${done ? `<button class="link" data-act="appl-unassign" data-id="${x.id}" data-name="${esc(x.name)}" title="대기 명단으로 되돌려요">${S.confirm === "un" + x.id ? "한 번 더 눌러 취소" : "배정 취소"}</button>` : ""}<button class="link" data-act="appl-remove" data-id="${x.id}" data-name="${esc(x.name)}" title="신청 기록까지 모두 삭제해요">${S.confirm === "ar" + x.id ? "한 번 더 눌러 삭제" : "삭제"}</button></span></div></dl>` : ""}
      </div>`;
    }).join("");
    const lastBar = S.lastAssign ? `<div class="undobar ok"><span>방금 <b>${esc(roundLabel(S.lastAssign.rid))}</b>에 <b>${S.lastAssign.n}명</b>을 배정했어요.</span><span class="pbtns"><button class="btn sm" data-act="appl-undo-last" ${S.busy ? "disabled" : ""}>${S.confirm === "undo" ? "한 번 더 눌러 되돌리기" : "되돌리기"}</button><button class="link" data-act="appl-undo-dismiss">닫기</button></span></div>` : "";
    return `${lastBar}<section class="stats s3">
        <div class="stat"><small>대기 남성</small><b>${cnt("M")}<em>명</em></b></div>
        <div class="stat"><small>대기 여성</small><b>${cnt("F")}<em>명</em></b></div>
        <div class="stat"><small>배정 완료</small><b>${all.length - wait.length}<em>/ ${all.length}명</em></b></div>
      </section>
      <section class="panel"><h2>날짜에 배정 <span class="sub">사진과 성비를 보고 정해요</span></h2>
        <div class="filters">
          <label class="mp"><span>신청한 날짜</span><select id="ap-date"><option value="" ${!a.date ? "selected" : ""}>전체</option>${prefDates.map((d) => `<option value="${d}" ${a.date === d ? "selected" : ""}>${esc(roundLabel(d))}${esc(cntWait((x) => prefsOn(x, d).length > 0))}</option>`).join("")}<option value="__none" ${a.date === "__none" ? "selected" : ""}>날짜 없음</option></select></label>
          ${prefTimes.length ? `<label class="mp"><span>신청한 시간</span><select id="ap-time"><option value="" ${!a.time ? "selected" : ""}>전체 시간</option>${prefTimes.map((t) => `<option value="${t}" ${a.time === t ? "selected" : ""}>${esc(t)}${esc(cntWait((x) => prefsOn(x, a.date).some((p) => p.slice(11) === t)))}</option>`).join("")}${hasNoTime ? `<option value="__none" ${a.time === "__none" ? "selected" : ""}>시간 없음</option>` : ""}</select></label>` : ""}
          <label class="mp"><span>성별</span><select id="ap-gender"><option value="" ${!a.gender ? "selected" : ""}>전체</option><option value="M" ${a.gender === "M" ? "selected" : ""}>남</option><option value="F" ${a.gender === "F" ? "selected" : ""}>여</option></select></label>
          <label class="ck"><input type="checkbox" id="ap-showdone" ${a.showAssigned ? "checked" : ""}> 배정된 사람도 보기</label>
        </div>
        <div class="filters">
          <label class="mp"><span>배정할 날짜</span><select id="ap-target">${tOpts}<option value="__new" ${tg === "__new" ? "selected" : ""}>＋ 새 날짜…</option></select></label>
          ${tg === "__new" ? `<label class="mp"><span>새 날짜</span><input type="date" id="ap-newdate" value="${esc(a.newdate || todayISO())}"></label>${timeField("ap-newtime", a.newtime)}` : ""}
        </div>
        <p class="sum"><b>${sel.length}명</b> 선택 <span class="sub">(남 ${addM} · 여 ${addF})</span>${sel.length ? ` → 배정 후 <b>남 ${baseM + addM} · 여 ${baseF + addF}</b>` : ""}</p>
        <div class="toolbar"><span class="toolbar-l"><button class="btn sm ghost" data-act="appl-all">보이는 사람 모두 선택</button> <button class="btn sm ghost" data-act="appl-none">선택 해제</button></span>
          <button class="btn" style="width:auto" data-act="appl-assign" ${sel.length && !S.busy ? "" : "disabled"}>${sel.length}명 배정하기</button></div>
        ${sel.length + selAsg.length ? `<button class="link" data-act="appl-remove-sel" style="justify-self:start" ${S.busy ? "disabled" : ""}>${S.confirm === "rmsel" ? "한 번 더 눌러 삭제" : `선택한 ${sel.length + selAsg.length}명 삭제`}</button>` : ""}
        ${selAsg.length ? `<div class="undobar"><span><b>배정된 ${selAsg.length}명</b> 선택 <small>(메모·선택·설문도 지워져요)</small></span>
          <span class="pbtns"><button class="btn sm ghost" data-act="appl-move" ${S.busy ? "disabled" : ""}>${S.confirm === "mv" ? "한 번 더 눌러 이동" : "위 날짜로 이동"}</button>
          <button class="btn sm ghost" data-act="appl-unassign-sel" ${S.busy ? "disabled" : ""}>${S.confirm === "unsel" ? "한 번 더 눌러 취소" : "배정 취소"}</button></span></div>` : ""}
      </section>
      <section style="display:grid;gap:10px"><div class="sec-title"><h2>신청자</h2><span>${list.length}명 · 사진·연락처는 진행자만 볼 수 있어요</span></div>
        ${list.length ? `<div class="plist" role="list">${rowsHtml}</div>` : `<div class="empty"><b>대기 중인 신청자가 없어요</b><p>구글폼을 연동하면 제출 즉시 여기에 나타나요. 연동 전 응답은 '참가자 추가' 탭의 명단 가져오기에서 <b>신청자 명단</b>으로 넣어 주세요.</p></div>`}</section>`;
  }

  function dashView() {
    const d = S.data, rnd = d.round;
    const head = `<header class="top"><div class="brand">gyeoL <small>진행자</small></div><div class="top-r"><button class="link" data-act="logout">나가기</button></div></header>
      ${api.mode === "demo" ? `<div class="demo-bar">체험 모드 · 참가자 화면과 같은 브라우저 데이터를 사용해요. <a href="index.html?demo">참가자 화면</a></div>` : ""}`;
    // 날짜(회차)가 하나도 없으면 '참가자 추가' 탭만 쓸 수 있다
    const noRoundTabs = ["applicants", "sms"];   // 날짜(회차)가 없어도 쓸 수 있는 탭
    const tab = TABS.some((t) => t[0] === S.tab) && (rnd || noRoundTabs.includes(S.tab)) ? S.tab : "people", badCount = (d.picks || []).filter((x) => !x.target_id).length;
    const nav = `<nav class="tabs" aria-label="진행자 메뉴">${TABS.map(([id, label, icon]) => `<button data-act="tab" data-v="${id}" class="${tab === id ? "on" : ""}" ${tab === id ? 'aria-current="page"' : ""} ${!rnd && id !== "people" && !noRoundTabs.includes(id) ? "disabled" : ""}><span class="ico">${icon}</span>${label}${id === "picks" && badCount + S.paid.filter((q) => q.status === "pending").length ? `<em class="bdg" aria-label="확인 필요 ${badCount + S.paid.filter((q) => q.status === "pending").length}건">${badCount + S.paid.filter((q) => q.status === "pending").length}</em>` : ""}</button>`).join("")}</nav>`;
    let body;
    if (tab === "applicants") body = tabApplicants();
    else if (tab === "sms") body = tabSms(rnd ? d : null);
    else if (!rnd) body = `<div class="empty"><b>아직 날짜(회차)가 없어요</b><p>신청자 탭에서 날짜에 배정하거나, 아래에서 참가자를 직접 추가하면 그 날짜 회차가 만들어져요.</p></div>${addPanel()}${entryPanel()}`;
    else if (tab === "picks") body = tabPicks(d, rnd);
    else if (tab === "survey") body = tabSurvey(d, rnd);
    else body = `${tabPeople(d, rnd)}${addPanel()}${entryPanel()}`;   // 참가자 탭: 현황 + 직접 추가 + 입장 링크
    return `${head}${roundBar()}<main class="wrap wide admin-main">${body}</main>${nav}`;
  }

  function render() {
    const y = window.scrollY;
    $app.innerHTML = S.data ? dashView() : loginView();
    window.scrollTo(0, y);
    if (S.data) drawQR();
  }

  /* ───────── 동작 ───────── */
  let confirmTimer;
  function askConfirm(key) { S.confirm = key; clearTimeout(confirmTimer); confirmTimer = setTimeout(() => { S.confirm = ""; render(); }, 4000); render(); }
  async function run(fn) {
    S.busy = true;
    try { await fn(); await load(); } catch (e) { toast(friendly(e)); }
    S.busy = false; S.confirm = ""; render();
  }

  const actions = {
    refresh: () => run(async () => {}),
    tab: (t) => { S.tab = t.dataset.v; S.confirm = ""; try { sessionStorage.setItem("rn_admin_tab", S.tab); } catch (e) { /* 무시 */ } render(); window.scrollTo(0, 0); },
    "csv-people": () => {
      const rows = [["번호", "성별", "이름", "연락처", "나이", "대학·학과", "MBTI", "취미", "도착", "설문 제출"]];
      S.data.participants.forEach((p) => rows.push([p.number, p.gender === "M" ? "남" : "여", p.name, fmtPhone(p.phone), p.age_label || "", p.school || "", p.mbti || "", p.hobby || "", p.arrived ? "도착" : "", p.submitted ? "제출" : ""]));
      downloadCSV("participants-" + S.round + ".csv", rows);
    },
    "pick-toggle": (t) => { S.openPick[t.dataset.id] = !S.openPick[t.dataset.id]; delete S.pickEdit[t.dataset.id]; render(); },
    "pick-save": (t) => {
      const id = t.dataset.id;
      const sel = Array.from(document.querySelectorAll(`select[data-pick-for="${id}"]`)).map((x) => x.value).filter(Boolean);
      if (new Set(sel).size !== sel.length) return toast("같은 사람을 두 번 골랐어요.");
      run(async () => { await api.admin.setPicks(S.pin, id, sel); delete S.pickEdit[id]; toast("선택을 저장했어요."); });
    },
    "csv-picks": () => {
      const ppl = S.data.participants, picks = S.data.picks || [];
      const rows = [["번호", "성별", "이름", ...Array.from({ length: MAX_PICKS }, (_, i) => (i + 1) + "순위")]];
      ppl.forEach((p) => {
        const mine = picks.filter((x) => x.participant_id === p.id).sort((a, b) => a.rank - b.rank);
        rows.push([p.number, p.gender === "M" ? "남" : "여", p.name, ...Array.from({ length: MAX_PICKS }, (_, i) => (mine[i] ? pickLabel(mine[i]) : ""))]);
      });
      downloadCSV("picks-" + S.round + ".csv", rows);
    },
    "edit-person": (t) => {
      const p = S.data.participants.find((x) => x.id === t.dataset.id);
      if (!p) return;
      S.tab = "people"; S.add = { open: true, editing: true, round: "", name: p.name || "", gender: p.gender, phone: p.phone, number: String(p.number), age: p.age_label || "", school: p.school || "", mbti: p.mbti || "", hobby: p.hobby || "" };
      render(); document.getElementById("add-details")?.scrollIntoView({ block: "center" });
    },
    "add-cancel": () => { S.add = emptyAdd(); S.add.open = false; render(); },
    round: (t) => { S.round = t.dataset.v; S.confirm = ""; run(async () => {}); },
    toggle: (t) => { S.open[t.dataset.id] = !S.open[t.dataset.id]; render(); },
    logout: () => { try { sessionStorage.removeItem("rn_admin_pin"); } catch (e) { /* noop */ } S.pin = ""; S.data = null; render(); },
    results: () => {
      const open = !S.data.results_open, key = open ? "res-on" : "res-off";
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.setResults(S.pin, S.round, open); toast(open ? "매칭 결과를 공개했어요." : "공개를 취소했어요."); });
    },
    "reset-pin": (t) => {
      const key = "rp" + t.dataset.phone;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.resetPin(S.pin, t.dataset.phone); toast(t.dataset.name + " 님의 비밀번호를 초기화했어요. 다음 입장 때 다시 정해요."); });
    },
    "remove-full": (t) => {
      const key = "rf" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.removeFull(S.pin, t.dataset.id); toast(t.dataset.name + " 님을 삭제했어요."); });
    },
    remove: (t) => {
      const key = "rm" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.remove(S.pin, t.dataset.id); toast(t.dataset.name + " 님의 배정을 취소했어요. 신청자 명단으로 돌아갔어요."); });
    },
    reset: () => {
      if (S.confirm !== "reset") return askConfirm("reset");
      run(async () => { await api.admin.reset(S.pin, S.round); toast("초기화했어요."); });
    },
    "csv-survey": () => {
      const cols = [];
      SURVEY.forEach((q, qi) => {
        const no = String(qi + 1).padStart(2, "0") + " " + q.label;
        if (q.type === "matrix") q.rows.forEach((r) => cols.push([no + " - " + r.label, (a) => (a[q.id] || {})[r.id] ?? ""]));
        else if (q.type === "multi") cols.push([no, (a) => (Array.isArray(a[q.id]) ? a[q.id].join(" / ") : "")]);
        else cols.push([no, (a) => a[q.id] ?? ""]);
      });
      const rows = [["성별", ...cols.map((c) => c[0])]];
      S.data.surveys.forEach((s) => rows.push([s.gender === "M" ? "남" : "여", ...cols.map((c) => c[1](s.answers || {}))]));
      downloadCSV("survey-" + S.round + ".csv", rows);
    },
    // 인쇄용 큰 QR 이미지(PNG, 흰 여백 포함)를 만들어 저장한다
    "qr-save": () => {
      if (typeof QRCode === "undefined") return toast("QR을 만들지 못했어요. 링크 복사를 이용해 주세요.");
      const box = document.createElement("div");
      new QRCode(box, { text: entryUrl(), width: 720, height: 720, correctLevel: QRCode.CorrectLevel.M });
      const src = box.querySelector("canvas"), pad = 72, size = 720 + pad * 2;
      const c = document.createElement("canvas"); c.width = c.height = size;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.drawImage(src, pad, pad);
      c.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "gyeol-qr.png"; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        toast("QR 이미지를 저장했어요.");
      }, "image/png");
    },
    "copy-url": async () => {
      try { await navigator.clipboard.writeText(entryUrl()); toast("링크를 복사했어요."); }
      catch (e) { toast("링크를 길게 눌러 복사해 주세요."); }
    },
    "appl-all": () => { applFiltered().forEach((x) => { S.appl.sel[x.id] = true; }); render(); },
    "appl-none": () => { S.appl.sel = {}; render(); },
    "appl-assign": () => {
      const ids = applFiltered().filter((x) => S.appl.sel[x.id] && !x.assigned_round).map((x) => x.id);
      const tg = applTarget(), rid = tg === "__new" ? mkRound(S.appl.newdate || todayISO(), S.appl.newtime) : tg;
      if (!ids.length) return;
      if (!rid) return toast("날짜 또는 시간 형식을 확인해 주세요. 시간은 19:00 처럼 적어요.");
      run(async () => {
        const r = await api.admin.assign(S.pin, ids, rid, roundLabel(rid));
        S.appl.sel = {}; S.appl.target = rid; S.round = rid;
        if (r.assigned) { S.lastAssign = { ids, rid, n: r.assigned }; try { sessionStorage.setItem("rn_admin_lastassign", JSON.stringify(S.lastAssign)); } catch (e) { /* 무시 */ } }
        toast(roundLabel(rid) + "에 " + r.assigned + "명을 배정했어요.");
      });
    },
    "appl-unassign": (t) => {
      const key = "un" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.unassign(S.pin, t.dataset.id); toast(t.dataset.name + " 배정을 취소했어요."); });
    },
    "appl-unassign-sel": () => {
      const ids = applFiltered().filter((x) => S.appl.sel[x.id] && x.assigned_round).map((x) => x.id);
      if (!ids.length) return;
      if (S.confirm !== "unsel") return askConfirm("unsel");
      run(async () => { const n = await api.admin.unassignMany(S.pin, ids); S.appl.sel = {}; toast(n + "명의 배정을 취소했어요. 다시 대기 명단으로 돌아왔어요."); });
    },
    "appl-move": () => {
      const ids = applFiltered().filter((x) => S.appl.sel[x.id] && x.assigned_round).map((x) => x.id);
      const tg = applTarget(), rid = tg === "__new" ? mkRound(S.appl.newdate || todayISO(), S.appl.newtime) : tg;
      if (!ids.length) return;
      if (!rid) return toast("날짜 또는 시간 형식을 확인해 주세요. 시간은 19:00 처럼 적어요.");
      if (S.confirm !== "mv") return askConfirm("mv");
      run(async () => {
        const r = await api.admin.reassign(S.pin, ids, rid, roundLabel(rid));
        S.appl.sel = {}; S.appl.target = rid; S.round = rid;
        S.lastAssign = { ids, rid, n: r.assigned }; try { sessionStorage.setItem("rn_admin_lastassign", JSON.stringify(S.lastAssign)); } catch (e) { /* 무시 */ }
        toast(roundLabel(rid) + "(으)로 " + r.assigned + "명을 옮겼어요.");
      });
    },
    "appl-undo-last": () => {
      if (!S.lastAssign) return;
      if (S.confirm !== "undo") return askConfirm("undo");
      run(async () => { const n = await api.admin.unassignMany(S.pin, S.lastAssign.ids); S.lastAssign = null; try { sessionStorage.removeItem("rn_admin_lastassign"); } catch (e) { /* 무시 */ } toast(n + "명의 배정을 되돌렸어요."); });
    },
    "appl-undo-dismiss": () => { S.lastAssign = null; try { sessionStorage.removeItem("rn_admin_lastassign"); } catch (e) { /* 무시 */ } render(); },
    "appl-remove-sel": () => {
      const ids = applFiltered().filter((x) => S.appl.sel[x.id]).map((x) => x.id);
      if (!ids.length) return;
      if (S.confirm !== "rmsel") return askConfirm("rmsel");
      run(async () => { const n = await api.admin.applicantRemoveMany(S.pin, ids); S.appl.sel = {}; toast(n + "명의 신청자를 삭제했어요."); });
    },
    "appl-remove": (t) => {
      const key = "ar" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.applicantRemove(S.pin, t.dataset.id); toast(t.dataset.name + " 신청자를 삭제했어요."); });
    },
    "threads-toggle": () => {
      const open = !S.data.round.threads_open, key = open ? "th-on" : "th-off";
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.setThreads(S.pin, S.round, open); toast(open ? "실 보내기를 열었어요. 참가자 화면에 팝업이 떠요." : "실 보내기를 닫았어요."); });
    },
    "thread-del": (t) => {
      const key = "td" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.threadDelete(S.pin, t.dataset.id); toast("실을 삭제했어요. 보낸 사람은 다시 보낼 수 있어요."); });
    },
    "sms-kind": (t) => { smsFlushSave(); S.sms.kind = t.dataset.v; S.sms.last = null; S.confirm = ""; S.sms.list = []; S.sms.f = { status: "unsent", q: "", date: "", time: "", src: "" }; render(); run(async () => {}); },
    "sms-tpl-reset": () => { S.sms.tpl[S.sms.kind] = ""; smsFlushSave(); toast("기본 문구로 되돌렸어요."); render(); },
    "mac-test": () => {
      const to = digits(S.sms.test), kind = S.sms.kind;
      if (!/^01\d{8,9}$/.test(to)) return toast("테스트 문자를 받을 휴대폰 번호를 정확히 입력해 주세요.");
      if (smsMissing(kind)) return toast(smsMissing(kind) + ".");
      downloadText("gyeol-sms-test.applescript", window.MacSms.buildItems([{ phone: to, text: renderTpl(smsTpl(kind), smsVars(kind, null)) }], 5));
      toast("테스트 스크립트를 받았어요. 맥북의 스크립트 편집기로 열어 실행해 주세요.");
    },
    "mac-send": () => {
      const kind = S.sms.kind;
      if (smsMissing(kind)) return toast(smsMissing(kind) + ".");
      run(async () => {
        await smsFlushSave();   // 방금 고친 문안도 먼저 저장
        const ids = new Set(smsSelIds());
        const list = S.sms.list.filter((x) => ids.has(x.id));
        if (!list.length) return toast("보낼 사람을 선택해 주세요.");
        const tpl = smsTpl(kind);
        const items = list.map((x) => ({ phone: x.phone, text: renderTpl(tpl, smsVars(kind, x)) }));
        downloadText("gyeol-sms-" + kind + "-" + (kind === "reserve" ? todayISO().replace(/\D/g, "") : String(S.round).replace(/\D/g, "")) + ".applescript", window.MacSms.buildItems(items, 5));
        toast(list.length + "명 발송 스크립트를 받았어요. 맥북으로 옮겨 실행해 주세요.");
      });
    },
    "mac-unmark": () => {
      const ids = smsSentSel().map((x) => x.id);
      if (!ids.length) return;
      if (S.confirm !== "unmark") return askConfirm("unmark");
      run(async () => { const n = await api.admin.smsUnmark(S.pin, S.round, S.sms.kind, ids); toast(n + "명을 미발송으로 되돌렸어요."); });
    },
    "mac-mark": () => {
      if (S.confirm !== "mark") return askConfirm("mark");
      const kind = S.sms.kind;
      run(async () => { const ids = smsSelIds(); if (!ids.length) return toast("표시할 사람을 선택해 주세요."); const n = await api.admin.smsMark(S.pin, S.round, kind, ids); toast(n + "명을 발송 완료로 표시했어요."); });
    },
    "paid-set": (t) => run(async () => { await api.admin.paidSet(S.pin, t.dataset.id, t.dataset.v); toast(t.dataset.v === "approved" ? "승인했어요. 참가자 화면에 바로 열려요." : t.dataset.v === "rejected" ? "거절했어요." : "대기로 되돌렸어요."); }),
    "csv-match": () => {
      const rows = [["남 번호", "남 이름", "여 번호", "여 이름"]];
      S.data.matches.forEach((m) => rows.push([m.m_number, m.m_name, m.f_number, m.f_name]));
      downloadCSV("matches-" + S.round + ".csv", rows);
    },
  };

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && actions[t.dataset.act]) actions[t.dataset.act](t);
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "round-select" || t.id === "sms-round") { S.round = t.value; S.confirm = ""; S.openPick = {}; S.open = {}; S.pickEdit = {}; run(async () => {}); return; }
    if (t.id === "add-round") { S.add.round = t.value; render(); return; }
    if (t.id === "ap-date") { S.appl.date = t.value; S.appl.time = ""; render(); return; }
    if (t.id === "ap-time") { S.appl.time = t.value; render(); return; }
    if (t.id === "ap-gender") { S.appl.gender = t.value; render(); return; }
    if (t.id === "ap-showdone") { S.appl.showAssigned = t.checked; render(); return; }
    if (t.id === "ap-target") { S.appl.target = t.value; render(); return; }
    if (t.dataset && t.dataset.smsSel) { S.sms.sel[S.sms.kind + ":" + t.dataset.smsSel] = !!t.checked; updateSmsList(); return; }
    if (t.dataset && t.dataset.smsAll !== undefined) { const on = !!t.checked; smsVisible().forEach((x) => { S.sms.sel[S.sms.kind + ":" + x.id] = on; }); updateSmsList(); return; }
    { const m = /^sms-f-(status|date|time|src)$/.exec(t.id || ""); if (m) { S.sms.f[m[1]] = t.value; if (m[1] === "date") S.sms.f.time = ""; render(); return; } }
    if (t.dataset && t.dataset.applSel) { if (t.checked) S.appl.sel[t.dataset.applSel] = true; else delete S.appl.sel[t.dataset.applSel]; render(); return; }
    if (t.dataset && t.dataset.arrive) {   // 도착 체크: 화면은 바로 바꾸고 서버에 저장한다
      const p = S.data.participants.find((x) => x.id === t.dataset.arrive); if (!p) return;
      p.arrived = t.checked; render();
      api.admin.setArrived(S.pin, p.id, t.checked).catch((e) => { p.arrived = !t.checked; render(); toast(friendly(e)); });
      return;
    }
    if (t.id === "only-absent") { S.onlyAbsent = t.checked; render(); return; }
    if (t.id === "only-bad") { S.onlyBad = t.checked; render(); }
    else if (t.dataset && t.dataset.pickFor) {
      const id = t.dataset.pickFor;
      const cur = S.pickEdit[id] || Array.from({ length: MAX_PICKS }, (_, i) => { const sel = document.querySelector(`select[data-pick-for="${id}"][data-slot="${i}"]`); return sel ? sel.value : ""; });
      cur[Number(t.dataset.slot)] = t.value; S.pickEdit[id] = cur;
    }
    else if (t.name === "add-gender") { S.add.gender = t.value; }
    else if (t.classList && t.classList.contains("numin")) {
      const n = parseInt(t.value, 10);
      if (!(n >= 1) || String(n) === t.dataset.old) { t.value = t.dataset.old; return; }
      run(async () => { await api.admin.setNumber(S.pin, t.dataset.id, n); toast("번호를 " + n + "번으로 바꿨어요."); });
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "sms-test") S.sms.test = e.target.value.replace(/\D/g, "").slice(0, 11);
    if (e.target.id === "sms-venue") { S.sms.venue = e.target.value; smsQueueSave(); updateSmsButtons(); }
    if (e.target.id === "sms-when") { S.sms.when = e.target.value; smsQueueSave(); updateSmsButtons(); }
    if (e.target.id === "sms-f-q") { S.sms.f.q = e.target.value; updateSmsList(); }
    if (e.target.id === "sms-map") { S.sms.map = e.target.value; smsQueueSave(); updateSmsButtons(); }
    if (e.target.id === "sms-tpl") { smsSaveTpl(S.sms.kind, e.target.value); updateSmsButtons(); }
    if (e.target.id === "ap-newdate") S.appl.newdate = e.target.value;
    if (e.target.id === "ap-newtime") S.appl.newtime = e.target.value;
    if (e.target.id && e.target.id.startsWith("add-") && e.target.id !== "add-details") {
      const k = e.target.id.slice(4);
      if (k === "phone") { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 11); }   // '-' 를 입력하거나 붙여넣어도 숫자만 남긴다
      S.add[k] = e.target.value;
    }
    if (e.target.id === "pin") {   // 마스터키도 010-1234-5678 형태로 정리
      const d = e.target.value.replace(/\D/g, "").slice(0, 11);
      e.target.value = d.length <= 3 ? d : d.length <= 7 ? d.slice(0, 3) + "-" + d.slice(3) : d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
    }
  });
  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "f-add") {
      const a = S.add, phone = normPhone(a.phone), name = a.name.trim();
      const cur = addRoundValue(), rid = a.editing ? S.round : cur === "__new" ? mkRound(a.newdate || todayISO(), a.newtime) : cur;
      if (!rid || !isRoundId(rid)) return toast("날짜 또는 시간 형식을 확인해 주세요. 시간은 19:00 처럼 적어요.");
      if (!name) return toast("이름을 적어 주세요.");
      if (!a.gender) return toast("성별을 골라 주세요.");
      if (!/^01\d{8,9}$/.test(phone)) return toast("연락처를 정확히 입력해 주세요.");
      const row = { phone, gender: a.gender, name, number: a.number ? parseInt(a.number, 10) : null, age_label: Roster.normAge(a.age), school: a.school.trim(), mbti: Roster.normMbti(a.mbti), hobby: a.hobby.trim() };
      const label = roundLabel(rid);
      run(async () => {
        const r = await api.admin.import(S.pin, rid, label, [row], false);
        S.round = rid;
        await load();   // 배정된 번호를 알려주기 위해
        const me = S.data.participants.find((x) => x.phone === phone);
        const tag = me ? ` (${me.gender === "M" ? "남성" : "여성"} ${me.number}번)` : "";
        toast(name + (r.inserted ? "님을 추가했어요" : "님 정보를 수정했어요") + tag);
        S.add = emptyAdd();
      });
      return;
    }
    if (e.target.id !== "f-pin") return;
    S.pin = (document.getElementById("pin").value || "").replace(/\D/g, "");
    try {
      await load(); S.error = "";
      try { sessionStorage.setItem("rn_admin_pin", S.pin); } catch (err) { /* noop */ }
    } catch (err) { S.error = friendly(err); S.data = null; }
    render();
  });

  (async function boot() {
    render();
    if (S.pin) { try { await load(); } catch (e) { S.data = null; } render(); }
    setInterval(async () => { const ae = document.activeElement; const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName); if (S.data && !S.busy && !S.confirm && !typing) { try { await load(); render(); } catch (e) { /* 다음 주기에 재시도 */ } } }, 15000);
  })();
})();
