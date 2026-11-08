/* 진행자 화면: 단계 전환, 참가 현황, 매칭, 설문 집계, CSV */
(() => {
  const api = window.api;
  const { SURVEY, MAX_PICKS, friendly, splitSchool, fmtPhone, normPhone, roundLabel, roundTag, toRoundId, dateChoices, todayISO } = window.RN;
  const Roster = window.Roster;   // 나이·MBTI 정리에만 쓴다 (명단 가져오기는 쓰지 않음)
  const $app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const S = { pin: "", data: null, error: "", confirm: "", busy: false, round: "", rounds: [], tab: "picks", open: {}, openPick: {}, pickEdit: {}, onlyBad: false,
    add: { open: false, editing: false, round: "", name: "", gender: "", phone: "", number: "", age: "", school: "", mbti: "", hobby: "" } };
  try { S.pin = sessionStorage.getItem("rn_admin_pin") || ""; S.round = sessionStorage.getItem("rn_admin_round") || ""; S.tab = sessionStorage.getItem("rn_admin_tab") || "picks"; } catch (e) { /* 저장소 사용 불가 */ }

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
      const ids = S.rounds.map((r) => r.id).sort(), t = todayISO();
      S.round = ids.includes(t) ? t : ids.find((i) => i > t) || ids[ids.length - 1] || "";
    }
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
  function dateSelect(id, value, extra) {
    const counts = Object.fromEntries(S.rounds.map((r) => [r.id, r.count])), t = todayISO();
    const opts = dateChoices(S.rounds.map((r) => r.id)).map((d) => `<option value="${d}" ${d === value ? "selected" : ""}>${esc(roundLabel(d))}${d === t ? " · 오늘" : ""}${counts[d] != null ? " · " + counts[d] + "명" : ""}</option>`).join("");
    return `<select id="${id}" ${extra || ""}>${opts}</select>`;
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

  /* ───────── 회차 선택 + 참가자 목록(컴팩트) ───────── */
  // 날짜(회차)를 드롭다운으로 고른다. 지난 회차도 모두 목록에 남는다. 최근 날짜가 위.
  function roundBar() {
    if (!S.rounds.length) return "";
    const cur = S.rounds.find((r) => r.id === S.round);
    const tag = (r) => { const t = roundTag(r.id); return t === "지난" ? "" : " · " + t; };
    return `<div class="roundsel"><label for="round-select">날짜</label>
      <select id="round-select" aria-label="날짜별 회차 선택">${S.rounds.map((r) => `<option value="${esc(r.id)}" ${r.id === S.round ? "selected" : ""}>${esc(roundLabel(r.id))}${tag(r)} · ${r.count}명 · ${r.results_open ? "결과 공개" : "진행 중"}</option>`).join("")}</select>
      ${cur ? `<span class="rtag t-${roundTag(cur.id)}">${roundTag(cur.id)}</span>` : ""}</div>`;
  }
  // 한 줄: 번호 · 이름 · 성별 · 연락처 + 펼치기 버튼.  자세한 정보는 펼쳤을 때만 보인다.
  function participantList(ppl) {
    if (!ppl.length) return `<div class="empty"><b>이 회차에는 아직 명단이 없어요</b><p>위의 '명단 가져오기'에서 구글 시트를 불러오세요.</p></div>`;
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    return `<div class="plist" role="list">
      <div class="phead"><span class="pn">번호</span><span>이름</span><span>성별</span><span>연락처</span><span></span></div>
      ${ppl.map((p) => {
        const open = !!S.open[p.id];
        const rows = [["나이", p.age_label], ["대학·학과", splitSchool(p.school).filter(Boolean).join(" · ")], ["MBTI", p.mbti], ["취미", p.hobby]]
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "-")}</dd></div>`).join("");
        return `<div class="prow ${open ? "open" : ""}" role="listitem">
          <div class="pmain"><span class="pn">${p.number}</span><span class="pnm">${esc(p.name)}</span><span class="pg g-${p.gender}">${p.gender === "M" ? "남" : "여"}</span><span class="pph">${esc(fmtPhone(p.phone))}</span>
            <button class="ptog" data-act="toggle" data-id="${p.id}" aria-expanded="${open}" aria-label="${esc(p.name)} 자세히 ${open ? "접기" : "보기"}">${chev}</button></div>
          ${open ? `<dl class="pdet">${rows}<div><dt>설문</dt><dd><span class="tag ${p.submitted ? "y" : "n"}">${p.submitted ? "제출" : "대기"}</span></dd></div>
            <div class="pact"><label>번호 <input class="numin" type="number" min="1" inputmode="numeric" data-id="${p.id}" data-old="${p.number}" value="${p.number}" aria-label="${esc(p.name)} 번호"></label>
              <span class="pbtns"><button class="link" data-act="edit-person" data-id="${p.id}">정보 수정</button><button class="link" data-act="remove" data-id="${p.id}" data-name="${esc(p.name)}">${S.confirm === "rm" + p.id ? "정말 삭제" : "삭제"}</button></span></div></dl>` : ""}
        </div>`;
      }).join("")}</div>`;
  }

  /* ───────── 참가자 직접 추가·수정 ───────── */
  const emptyAdd = () => ({ open: true, editing: false, round: "", name: "", gender: "", phone: "", number: "", age: "", school: "", mbti: "", hobby: "" });
  function addPanel() {
    const a = S.add, hasRound = !!(S.data && S.data.round);
    const f = (id, label, input) => `<label class="mp" for="add-${id}"><span>${label}</span>${input}</label>`;
    const txt = (id, ph, extra) => `<input type="text" id="add-${id}" value="${esc(a[id])}" placeholder="${esc(ph || "")}" autocomplete="off" ${extra || ""}>`;
    return `<section class="panel" id="add-details"><h2>${a.editing ? "참가자 정보 수정" : "참가자 직접 추가"} </h2>
      <p class="note">${a.editing ? "연락처는 그 사람을 구분하는 값이라 바꿀 수 없어요. 연락처를 바꾸려면 이전 사람을 삭제하고 새로 추가하세요." : "추가한 사람은 선택한 날짜의 참가자가 되어 바로 입장할 수 있어요. 연락처는 <b>하이픈 없이 숫자만</b> 저장돼요. 같은 연락처로 다시 추가하면 정보가 수정돼요. 번호를 비우면 같은 성별의 다음 번호가 붙어요."}</p>
      <form id="f-add" class="addgrid" autocomplete="off">
        ${f("round", "날짜 *", dateSelect("add-round", a.editing ? S.round : (a.round || S.round || todayISO()), a.editing ? "disabled" : ""))}
        ${f("name", "이름 *", txt("name", "성+이름 (예: 김지은)", "required"))}
        <div class="mp"><span>성별 *</span><div class="seg"><label><input type="radio" name="add-gender" value="M" ${a.gender === "M" ? "checked" : ""}><span>남성</span></label><label><input type="radio" name="add-gender" value="F" ${a.gender === "F" ? "checked" : ""}><span>여성</span></label></div></div>
        ${f("phone", "연락처 * ('-' 없이 숫자만)", `<input type="tel" inputmode="numeric" id="add-phone" value="${esc(a.phone)}" placeholder="01012345678" autocomplete="off" required ${a.editing ? "readonly" : ""}>`)}
        ${f("number", "번호", `<input type="number" min="1" inputmode="numeric" id="add-number" value="${esc(a.number)}" placeholder="비우면 자동">`)}
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
      <p class="note">참가자가 적은 최종 선택이에요. 참가자가 <b>자유롭게 적은 내용은 그대로 저장</b>돼서 여기에 전달돼요. 숫자는 명단에서 찾은 상대의 번호이고, <span class="pk mu">붉은 숫자</span>는 서로 선택한 경우, <span class="pk bad">노란 글자</span>는 명단에서 정확히 찾지 못해 적은 그대로 보여주는 거예요. 줄을 펼치면 <b>직접 맞추거나 바꿀 수 있어요</b> (제출하지 않은 사람도 가능). 결과를 공개하기 전에 <b>확인 필요</b>를 정리하세요.</p>
      ${rows ? `<div class="plist" role="list"><div class="phead pickhead"><span class="pn">번호</span><span>이름</span><span>성별</span><span>1·2·3순위</span><span></span></div>${rows}</div>` : `<div class="empty"><b>${S.onlyBad ? "확인이 필요한 선택이 없어요" : "아직 참가자가 없어요"}</b></div>`}</section>`;
  }

  /* ───────── 하단 탭 4개: 최종 선택 현황 · 참가자 현황 · 참가자 추가 · 설문 결과 ───────── */
  const ico = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const TABS = [
    ["picks", "최종 선택", ico('<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M9.3 11.6l2 2 3.6-3.8"/>')],
    ["people", "참가자", ico('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8s5 1.8 5.5 4.8"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16 14.4c2.6-.2 4.2 1.4 4.5 4.1"/>')],
    ["add", "참가자 추가", ico('<circle cx="10" cy="8.5" r="3.2"/><path d="M4 19c.5-3.3 2.8-5 6-5s5.5 1.7 6 5"/><path d="M19 8v6M16 11h6"/>')],
    ["survey", "설문 결과", ico('<path d="M4.5 20V10M10 20V4.5M15.5 20v-7M21 20H3"/>')],
  ];

  // [최종 선택 현황] 결과 공개 스위치 + 선택 현황·조정 + 매칭 쌍
  function tabPicks(d, rnd) {
    const ppl = d.participants, submitted = ppl.filter((p) => p.submitted).length, bad = (d.picks || []).filter((x) => !x.target_id).length;
    return `<section class="panel"><div class="toolbar"><h2>${esc(roundLabel(rnd.id))} 매칭 결과</h2><button class="btn sm ghost" data-act="refresh">새로고침</button></div>
        <p class="note">참가자는 <b>언제든</b> 최종 선택과 설문을 제출·수정할 수 있어요. 아래 버튼을 누르면 이 날짜의 <b>매칭 결과(서로 선택한 경우 연락처 포함)가 참가자 화면에 공개</b>되고, 그 뒤에는 선택을 더 바꿀 수 없어요. 공개 전에 '제출' 인원과 <b>확인 필요</b>를 확인하세요. 날짜마다 따로 공개해요.</p>
        <div class="resultbar"><span class="tag ${d.results_open ? "y" : "n"}">${d.results_open ? "결과 공개 중" : "아직 비공개"}</span><span class="sub" style="font-size:13px">제출 ${submitted} / ${ppl.length}명 · 매칭 ${d.matches.length}쌍${bad ? ` · <b class="badtxt">확인 필요 ${bad}건</b>` : ""}</span>
          <button class="btn ${d.results_open ? "ghost" : ""}" style="width:auto" data-act="results" ${S.busy ? "disabled" : ""}>${d.results_open ? (S.confirm === "res-off" ? "한 번 더 눌러 공개 취소" : "공개 취소 (다시 제출 받기)") : S.confirm === "res-on" ? "한 번 더 눌러 공개" : "매칭 결과 공개하기"}</button></div></section>
      ${picksPanel(d)}
      <section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>매칭된 쌍</h2><span>${d.matches.length}쌍</span></div><button class="btn sm ghost" data-act="csv-match">매칭 CSV</button></div>
        ${d.matches.length ? `<div class="tbl-wrap"><table><thead><tr><th>남</th><th>여</th></tr></thead><tbody>${d.matches.map((m) => `<tr><td>${m.m_number}번 ${esc(m.m_name)}</td><td>${m.f_number}번 ${esc(m.f_name)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>매칭된 쌍이 아직 없어요</b><p>참가자가 최종 선택을 제출하면 서로 선택한 쌍이 여기에 보여요.</p></div>`}
        <p class="note">매칭된 상대의 연락처는 참가자 본인 화면에서 결과 공개 후에만 전달돼요.</p></section>`;
  }

  // [참가자 현황] 통계 + 목록(컴팩트) + CSV + 날짜 초기화
  function tabPeople(d, rnd) {
    const ppl = d.participants, men = ppl.filter((p) => p.gender === "M"), women = ppl.filter((p) => p.gender === "F");
    const submitted = ppl.filter((p) => p.submitted).length;
    return `<section class="stats">
        <div class="stat"><small>명단</small><b>${ppl.length}<em>명 (남 ${men.length} · 여 ${women.length})</em></b></div>
        <div class="stat"><small>최종 선택·설문 제출</small><b>${submitted}<em>/ ${ppl.length}명</em></b></div>
        <div class="stat"><small>성비 확인</small><b>${men.length === women.length ? "균형" : "차이 " + Math.abs(men.length - women.length)}<em></em></b></div>
      </section>
      <section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>참가자</h2><span>연락처는 진행자만 볼 수 있어요</span></div><button class="btn sm ghost" data-act="csv-people">참가자 CSV</button></div>
        ${participantList(ppl)}</section>
      <section class="panel"><h2>${esc(roundLabel(rnd.id))} 데이터 초기화</h2><p class="sub" style="font-size:13px">이 날짜의 모든 참가자, 메모, 선택, 설문을 <b>지우고</b> 결과 공개도 닫습니다. 다른 날짜는 그대로예요. 지난 회차 기록은 지우지 않는 한 계속 저장돼 있으니, 정말 필요할 때만 쓰세요. 되돌릴 수 없어요. 먼저 CSV를 내려받으세요.</p>
        <button class="btn danger sm" style="justify-self:start" data-act="reset">${S.confirm === "reset" ? "정말 모두 삭제합니다" : "이 날짜 데이터 초기화"}</button></section>`;
  }

  // [설문 결과]
  function tabSurvey(d, rnd) {
    return `<section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>${esc(roundLabel(rnd.id))} 설문 결과</h2><span>${d.surveys.length}명 응답</span></div>
        <div><button class="btn sm ghost" data-act="csv-survey">설문 CSV</button></div></div>
        ${surveyCards(d.surveys)}</section>`;
  }

  function dashView() {
    const d = S.data, rnd = d.round;
    const head = `<header class="top"><div class="brand">gyeoL <small>진행자</small></div><div class="top-r">${rnd ? `<span class="pill">${esc(roundLabel(rnd.id))} · ${d.results_open ? "결과 공개" : "진행 중"}</span>` : ""}<button class="link" data-act="logout">나가기</button></div></header>
      ${api.mode === "demo" ? `<div class="demo-bar">체험 모드 · 참가자 화면과 같은 브라우저 데이터를 사용해요. <a href="index.html?demo">참가자 화면</a></div>` : ""}`;
    // 날짜(회차)가 하나도 없으면 '참가자 추가' 탭만 쓸 수 있다
    const tab = rnd ? S.tab : "add", badCount = (d.picks || []).filter((x) => !x.target_id).length;
    const nav = `<nav class="tabs" aria-label="진행자 메뉴">${TABS.map(([id, label, icon]) => `<button data-act="tab" data-v="${id}" class="${tab === id ? "on" : ""}" ${tab === id ? 'aria-current="page"' : ""} ${!rnd && id !== "add" ? "disabled" : ""}><span class="ico">${icon}</span>${label}${id === "picks" && badCount ? `<em class="bdg" aria-label="확인 필요 ${badCount}건">${badCount}</em>` : ""}</button>`).join("")}</nav>`;
    let body;
    if (!rnd) body = `<div class="empty"><b>아직 날짜(회차)가 없어요</b><p>날짜를 골라 참가자를 추가하거나 구글 시트를 가져오면 그 날짜 회차가 만들어져요.</p></div>${addPanel()}${entryPanel()}`;
    else if (tab === "picks") body = tabPicks(d, rnd);
    else if (tab === "people") body = tabPeople(d, rnd);
    else if (tab === "survey") body = tabSurvey(d, rnd);
    else body = `${addPanel()}${entryPanel()}`;
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
      const rows = [["번호", "성별", "이름", "연락처", "나이", "대학·학과", "MBTI", "취미", "설문 제출"]];
      S.data.participants.forEach((p) => rows.push([p.number, p.gender === "M" ? "남" : "여", p.name, fmtPhone(p.phone), p.age_label || "", p.school || "", p.mbti || "", p.hobby || "", p.submitted ? "제출" : ""]));
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
      S.tab = "add"; S.add = { open: true, editing: true, round: "", name: p.name || "", gender: p.gender, phone: p.phone, number: String(p.number), age: p.age_label || "", school: p.school || "", mbti: p.mbti || "", hobby: p.hobby || "" };
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
    remove: (t) => {
      const key = "rm" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.remove(S.pin, t.dataset.id); toast(t.dataset.name + " 참가자를 삭제했어요."); });
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
    if (t.id === "round-select") { S.round = t.value; S.confirm = ""; S.openPick = {}; S.open = {}; S.pickEdit = {}; run(async () => {}); return; }
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
      const rid = a.editing ? S.round : (a.round || S.round || todayISO());
      if (!rid) return toast("날짜를 골라 주세요.");
      if (!name) return toast("이름을 적어 주세요.");
      if (!a.gender) return toast("성별을 골라 주세요.");
      if (!/^01\d{8,9}$/.test(phone)) return toast("연락처를 정확히 입력해 주세요.");
      const row = { phone, gender: a.gender, name, number: a.number ? parseInt(a.number, 10) : null, age_label: Roster.normAge(a.age), school: a.school.trim(), mbti: Roster.normMbti(a.mbti), hobby: a.hobby.trim() };
      const label = roundLabel(rid);
      run(async () => {
        const r = await api.admin.import(S.pin, rid, label, [row], false);
        S.round = rid;
        toast(name + (r.inserted ? "님을 추가했어요." : "님 정보를 수정했어요."));
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
