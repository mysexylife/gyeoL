/* 진행자 화면: 단계 전환, 참가 현황, 매칭, 설문 집계, CSV */
(() => {
  const api = window.api;
  const { SURVEY, MAX_PICKS, friendly, splitSchool, fmtPhone, normPhone } = window.RN;
  const Roster = window.Roster;
  const $app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const S = { pin: "", data: null, error: "", confirm: "", busy: false, round: "", rounds: [], open: {}, openPick: {}, pickEdit: {}, onlyBad: false,
    add: { open: false, editing: false, round: "", name: "", gender: "", phone: "", number: "", age: "", school: "", mbti: "", hobby: "" },
    imp: { open: true, text: "", fileName: "", table: null, map: {}, date: "", numberedOnly: false, prune: false, done: null, error: "" } };
  try { S.pin = sessionStorage.getItem("rn_admin_pin") || ""; S.round = sessionStorage.getItem("rn_admin_round") || ""; } catch (e) { /* 저장소 사용 불가 */ }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // 회차 목록과, 선택한 회차의 현황을 불러온다. 진행자 화면은 항상 한 회차만 보여준다.
  async function load() {
    S.rounds = await api.admin.rounds(S.pin);
    if (!S.rounds.some((r) => r.id === S.round)) S.round = S.rounds.length ? S.rounds[0].id : "";
    S.data = S.round ? await api.admin.dashboard(S.pin, S.round) : { round: null, results_open: false, participants: [], matches: [], surveys: [] };
    try { sessionStorage.setItem("rn_admin_round", S.round); } catch (e) { /* 무시 */ }
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
          <button class="btn sm ghost" data-act="copy-url">링크 복사</button>
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

  function importPanel(d) {
    const im = S.imp, t = im.table;
    let body = "";
    if (t) {
      const data = t.slice(1);
      const dates = Roster.dateOptions(data, im.map);
      if (dates.length && !dates.includes(im.date)) im.date = dates[0];
      const b = Roster.build(data, im.map, { date: im.date, numberedOnly: im.numberedOnly });
      im.built = b;
      const sel = (f) => `<label class="mp"><span>${Roster.FIELD_LABEL[f]}</span><select data-field="${f}" id="map-${f}"><option value="-1" ${im.map[f] < 0 ? "selected" : ""}>(사용 안 함)</option>${t[0].map((h, i) => `<option value="${i}" ${im.map[f] === i ? "selected" : ""}>${colName(i)}열 · ${esc(shortHead(h))}</option>`).join("")}</select></label>`;
      const missing = ["phone", "name", "gender"].filter((f) => im.map[f] < 0).map((f) => Roster.FIELD_LABEL[f].replace(" *", ""));
      const errs = [];
      if (missing.length) errs.push("필수 열을 골라 주세요: " + missing.join(", "));
      if (b.dupNumbers.length) errs.push("같은 성별에 번호가 겹쳐요. 날짜(회차)를 고르거나 시트의 번호를 확인해 주세요. → " + b.dupNumbers.join(" / "));
      const warns = [];
      if (b.skipped.length) warns.push(`건너뛰는 행 ${b.skipped.length}개: ` + b.skipped.slice(0, 5).map((x) => `${x.line}행${x.name ? " " + x.name : ""}(${x.reason})`).join(", ") + (b.skipped.length > 5 ? " …" : ""));
      if (b.dupPhones.length) warns.push("연락처가 같은 행이 있어 나중 행을 써요: " + b.dupPhones.join(", "));
      if (b.invalidMbti) warns.push(`MBTI 형식이 아닌 값 ${b.invalidMbti}개는 비워 둬요.`);
      const noNum = b.rows.filter((p) => p.number == null).length;
      if (b.rows.length && noNum) warns.push(`현장 번호가 없는 ${noNum}명은 같은 성별의 다음 번호를 자동으로 붙여요.`);
      const canRun = b.rows.length > 0 && !errs.length && !S.busy;
      body = `<div class="mapgrid">${["phone", "name", "gender", "number", "age", "school", "mbti", "hobby", "date"].map(sel).join("")}</div>
        <div class="filters">
          ${dates.length
            ? `<label class="mp"><span>가져올 회차</span><select id="imp-date">${dates.map((x) => `<option value="${x}" ${im.date === x ? "selected" : ""}>${esc(Roster.dateLabel(data, im.map, x))}</option>`).join("")}</select></label>`
            : `<label class="mp"><span>회차 이름</span><input type="text" id="imp-round" value="${esc(im.roundName || S.round || "")}" placeholder="예: 11/8"></label>`}
          <label class="ck"><input type="checkbox" id="imp-numbered" ${im.numberedOnly ? "checked" : ""}> 현장 번호가 있는 사람만</label>
          <label class="ck"><input type="checkbox" id="imp-prune" ${im.prune ? "checked" : ""}> 이 회차에서 이번 명단에 없는 기존 참가자는 삭제</label>
        </div>
        <p class="sum"><b>${b.rows.length}명</b> 가져와요 <span class="sub">(남 ${b.counts.M} · 여 ${b.counts.F})</span></p>
        ${errs.map((x) => `<p class="err">${esc(x)}</p>`).join("")}${warns.map((x) => `<p class="note">${esc(x)}</p>`).join("")}
        ${b.rows.length ? `<div class="tbl-wrap"><table><thead><tr><th class="num">번호</th><th>성별</th><th>이름</th><th>나이</th><th>대학·학과</th><th>MBTI</th><th>취미</th><th>연락처</th></tr></thead><tbody>${b.rows.slice(0, 8).map((p) => `<tr><td class="num">${p.number ?? "자동"}</td><td>${p.gender === "M" ? "남" : "여"}</td><td>${esc(p.name)}</td><td>${esc(p.age_label)}</td><td>${esc(p.school)}</td><td>${esc(p.mbti)}</td><td>${esc(p.hobby)}</td><td>${maskPhone(p.phone)}</td></tr>`).join("")}</tbody></table></div>${b.rows.length > 8 ? `<p class="sub" style="font-size:12.5px">… 외 ${b.rows.length - 8}명</p>` : ""}` : ""}
        <div class="toolbar"><span class="sub" style="font-size:12.5px">${im.fileName ? esc(im.fileName) : "붙여넣은 내용"} · 이상형·사진·입금·추가요청 열은 읽지 않고 서버로 보내지 않아요.</span>
          <button class="btn" style="width:auto" data-act="imp-run" ${canRun ? "" : "disabled"}>${S.confirm === "imp" ? "삭제가 포함돼요. 한 번 더 눌러 실행" : `${b.rows.length}명 가져오기`}</button></div>`;
    }
    return `<details class="panel" id="imp-details" ${im.open ? "open" : ""}><summary><h2>명단 가져오기 <span class="sub">구글 시트 응답 → 참가자 카드</span></h2></summary>
      <p class="note">회차마다 한 번씩 가져오세요(예: 11/6, 11/8). 시트가 바뀌면 같은 방법으로 다시 가져오면 돼요. 같은 회차 안에서 연락처가 같은 사람은 정보만 갱신하고, 메모·선택은 그대로 유지돼요.</p>
      <ol class="how"><li>구글 시트에서 <b>파일 → 다운로드 → 쉼표로 구분된 값(.csv)</b>을 받아 올리거나,</li><li>시트 전체를 선택(<b>Ctrl/⌘+A</b>)해 복사한 뒤 아래에 붙여넣으세요.</li></ol>
      <div class="impin"><input type="file" id="imp-file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-label="CSV 파일 선택">
        <textarea id="imp-text" placeholder="또는 여기에 붙여넣기" rows="3">${esc(im.text)}</textarea>
        <button class="btn sm ghost" data-act="imp-parse">붙여넣은 내용 불러오기</button></div>
      ${im.error ? `<p class="err">${esc(im.error)}</p>` : ""}
      ${im.done ? `<div class="done">가져왔어요 · 추가 ${im.done.inserted}명, 갱신 ${im.done.updated}명${im.done.skipped ? `, 건너뜀 ${im.done.skipped}명` : ""}${im.done.pruned ? `, 삭제 ${im.done.pruned}명` : ""}</div>` : ""}
      ${body}</details>`;
  }
  function loadImport(text, fileName) {
    const im = S.imp;
    im.error = ""; im.done = null; im.fileName = fileName || ""; im.confirm = false;
    const table = Roster.parseTable(text);
    if (table.length < 2) { im.table = null; im.error = "읽을 수 있는 행이 없어요. 머리글이 있는 시트 전체를 올려 주세요."; return; }
    im.table = table; im.map = Roster.detect(table[0], table.slice(1)); im.date = ""; im.roundName = ""; im.numberedOnly = false;
    const need = ["phone", "name", "gender"].filter((f) => im.map[f] < 0);
    if (need.length) im.error = "일부 열을 자동으로 찾지 못했어요. 아래에서 직접 골라 주세요.";
  }

  /* ───────── 회차 선택 + 참가자 목록(컴팩트) ───────── */
  function roundBar() {
    if (!S.rounds.length) return "";
    return `<nav class="roundbar" aria-label="회차">${S.rounds.map((r) => `<button class="rchip ${r.id === S.round ? "on" : ""}" data-act="round" data-v="${esc(r.id)}" aria-pressed="${r.id === S.round}"><b>${esc(r.label)}</b><small>${r.count}명 · ${r.results_open ? "결과 공개" : "진행 중"}</small></button>`).join("")}</nav>`;
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
    return `<details class="panel" id="add-details" ${a.open ? "open" : ""}><summary><h2>참가자 추가·수정 <span class="sub">시트에 없는 사람을 직접 넣기</span></h2></summary>
      <p class="note">${a.editing ? "연락처는 그 사람을 구분하는 값이라 바꿀 수 없어요. 연락처를 바꾸려면 이전 사람을 삭제하고 새로 추가하세요." : "추가한 사람은 바로 입장할 수 있어요. 같은 연락처로 다시 추가하면 그 사람의 정보가 수정돼요. 번호를 비우면 같은 성별의 다음 번호가 붙어요."}</p>
      <form id="f-add" class="addgrid" autocomplete="off">
        ${hasRound ? "" : f("round", "회차 *", txt("round", "예: 11/8", "required"))}
        ${f("name", "이름 *", txt("name", "성+이름 (예: 김지은)", "required"))}
        <div class="mp"><span>성별 *</span><div class="seg"><label><input type="radio" name="add-gender" value="M" ${a.gender === "M" ? "checked" : ""}><span>남성</span></label><label><input type="radio" name="add-gender" value="F" ${a.gender === "F" ? "checked" : ""}><span>여성</span></label></div></div>
        ${f("phone", "연락처 *", `<input type="tel" inputmode="tel" id="add-phone" value="${esc(a.phone)}" placeholder="010-1234-5678" required ${a.editing ? "readonly" : ""}>`)}
        ${f("number", "번호", `<input type="number" min="1" inputmode="numeric" id="add-number" value="${esc(a.number)}" placeholder="비우면 자동">`)}
        ${f("age", "나이", txt("age", "예: 03년생"))}
        ${f("school", "대학교-학과", txt("school", "예: 고려대-건축학과"))}
        ${f("mbti", "MBTI", txt("mbti", "예: INTP", 'maxlength="4"'))}
        ${f("hobby", "취미", txt("hobby", "예: 러닝, 전시회"))}
        <div class="addact"><button class="btn" type="submit" ${S.busy ? "disabled" : ""}>${a.editing ? "수정 저장" : "참가자 추가"}</button>${a.editing ? `<button class="btn ghost" type="button" data-act="add-cancel">취소</button>` : ""}</div>
      </form></details>`;
  }

  /* ───────── 최종 선택 현황 + 수동 조정 ───────── */
  function pickLabel(x) { return x.target_id ? `${x.target_number}번 ${x.target_name}` : `"${x.input}" (미확인)`; }
  function picksPanel(d) {
    const ppl = d.participants, picks = d.picks || [];
    const of = (id) => picks.filter((x) => x.participant_id === id).sort((a, b) => a.rank - b.rank);
    const mutual = (pid, tid) => !!tid && picks.some((x) => x.participant_id === tid && x.target_id === pid);
    const bad = picks.filter((x) => !x.target_id).length;
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    const rows = ppl.filter((p) => !S.onlyBad || of(p.id).some((x) => !x.target_id)).map((p) => {
      const mine = of(p.id), open = !!S.openPick[p.id];
      const sum = mine.length ? mine.map((x) => (x.target_id ? `<span class="pk ${mutual(p.id, x.target_id) ? "mu" : ""}">${x.target_number}</span>` : `<span class="pk bad">?</span>`)).join("") : `<span class="sub">-</span>`;
      const cur = S.pickEdit[p.id] || Array.from({ length: MAX_PICKS }, (_, i) => (mine[i] && mine[i].target_id) || "");
      const opp = ppl.filter((q) => q.gender !== p.gender).sort((a, b) => a.number - b.number);
      const typed = mine.filter((x) => !x.target_id).map((x) => `"${x.input}"`);
      const detail = open ? `<div class="pdet pickedit">
          ${typed.length ? `<p class="warnnote">참가자가 적은 내용 중 못 찾은 것: <b>${esc(typed.join(", "))}</b></p>` : ""}
          ${Array.from({ length: MAX_PICKS }, (_, i) => `<label class="pks"><span>${i + 1}순위</span><select data-pick-for="${p.id}" data-slot="${i}"><option value="">(비움)</option>${opp.map((q) => `<option value="${q.id}" ${cur[i] === q.id ? "selected" : ""}>${q.number}번 ${esc(q.name)}</option>`).join("")}</select></label>`).join("")}
          <div class="pact"><span class="sub" style="font-size:12px">${p.submitted ? "설문 제출함" : "설문 미제출 (선택만 조정해도 돼요)"}</span><button class="btn sm" type="button" data-act="pick-save" data-id="${p.id}">저장</button></div></div>` : "";
      return `<div class="prow ${open ? "open" : ""}" role="listitem"><div class="pmain pickmain"><span class="pn">${p.number}</span><span class="pnm">${esc(p.name)}</span><span class="pg g-${p.gender}">${p.gender === "M" ? "남" : "여"}</span><span class="psum">${sum}</span>
        <button class="ptog" data-act="pick-toggle" data-id="${p.id}" aria-expanded="${open}" aria-label="${esc(p.name)} 선택 조정 ${open ? "접기" : "열기"}">${chev}</button></div>${detail}</div>`;
    }).join("");
    return `<section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>최종 선택 현황</h2><span>제출 ${ppl.filter((p) => p.submitted).length} / ${ppl.length}명 · <b class="${bad ? "badtxt" : ""}">확인 필요 ${bad}건</b></span></div>
        <div><label class="ck"><input type="checkbox" id="only-bad" ${S.onlyBad ? "checked" : ""}> 확인 필요만</label> <button class="btn sm ghost" data-act="csv-picks">선택 CSV</button></div></div>
      <p class="note">참가자가 적은 최종 선택이에요. 숫자는 고른 상대의 번호이고, <span class="pk mu">붉은 숫자</span>는 서로 선택한 경우, <span class="pk bad">?</span>는 명단에서 정확히 찾지 못한 입력이에요. 줄을 펼치면 <b>직접 맞추거나 바꿀 수 있어요</b> (제출하지 않은 사람도 가능). 결과를 공개하기 전에 <b>확인 필요</b>를 정리하세요.</p>
      ${rows ? `<div class="plist" role="list"><div class="phead pickhead"><span class="pn">번호</span><span>이름</span><span>성별</span><span>1·2·3순위</span><span></span></div>${rows}</div>` : `<div class="empty"><b>${S.onlyBad ? "확인이 필요한 선택이 없어요" : "아직 참가자가 없어요"}</b></div>`}</section>`;
  }

  function dashView() {
    const d = S.data, ppl = d.participants;
    const men = ppl.filter((p) => p.gender === "M"), women = ppl.filter((p) => p.gender === "F");
    const submitted = ppl.filter((p) => p.submitted).length;
    const rnd = S.data.round;
    const pill = rnd ? `${esc(rnd.label)} · ${d.results_open ? "결과 공개" : "진행 중"}` : "회차 없음";
    const head = `<header class="top"><div class="brand">gyeoL <small>진행자</small></div><div class="top-r"><span class="pill">${pill}</span><button class="link" data-act="logout">나가기</button></div></header>
      ${api.mode === "demo" ? `<div class="demo-bar">체험 모드 · 참가자 화면과 같은 브라우저 데이터를 사용해요. <a href="index.html?demo">참가자 화면</a></div>` : ""}`;
    if (!rnd) {
      return `${head}<main class="wrap wide">
        <div class="empty"><b>아직 회차가 없어요</b><p>아래 '명단 가져오기'에서 구글 시트를 불러오면 회차가 만들어져요.</p></div>
        ${addPanel()}${importPanel(d)}${entryPanel()}</main>`;
    }
    return `${head}${roundBar()}
      <main class="wrap wide">
        <section class="panel"><div class="toolbar"><h2>${esc(rnd.label)} 매칭 결과</h2><button class="btn sm ghost" data-act="refresh">새로고침</button></div>
          <p class="note">참가자는 <b>언제든</b> 최종 선택과 설문을 제출·수정할 수 있어요. 아래 버튼을 누르면 이 회차의 <b>매칭 결과(서로 선택한 경우 연락처 포함)가 참가자 화면에 공개</b>되고, 그 뒤에는 선택을 더 바꿀 수 없어요. 공개 전에 '제출' 인원을 확인하세요. 회차마다 따로 공개해요.</p>
          <div class="resultbar"><span class="tag ${d.results_open ? "y" : "n"}">${d.results_open ? "결과 공개 중" : "아직 비공개"}</span><span class="sub" style="font-size:13px">제출 ${submitted} / ${ppl.length}명 · 매칭 ${d.matches.length}쌍${(d.picks || []).some((x) => !x.target_id) ? ` · <b class="badtxt">확인 필요 ${(d.picks || []).filter((x) => !x.target_id).length}건</b>` : ""}</span>
            <button class="btn ${d.results_open ? "ghost" : ""}" style="width:auto" data-act="results" ${S.busy ? "disabled" : ""}>${d.results_open ? (S.confirm === "res-off" ? "한 번 더 눌러 공개 취소" : "공개 취소 (다시 제출 받기)") : S.confirm === "res-on" ? "한 번 더 눌러 공개" : "매칭 결과 공개하기"}</button></div></section>
        <section class="stats">
          <div class="stat"><small>명단</small><b>${ppl.length}<em>명 (남 ${men.length} · 여 ${women.length})</em></b></div>
          <div class="stat"><small>최종 선택·설문 제출</small><b>${submitted}<em>/ ${ppl.length}명</em></b></div>
          <div class="stat"><small>서로 선택(매칭)</small><b>${d.matches.length}<em>쌍</em></b></div>
          <div class="stat"><small>확인 필요한 선택</small><b class="${(d.picks || []).some((x) => !x.target_id) ? "badtxt" : ""}">${(d.picks || []).filter((x) => !x.target_id).length}<em>건</em></b></div>
          <div class="stat"><small>성비 확인</small><b>${men.length === women.length ? "균형" : "차이 " + Math.abs(men.length - women.length)}<em></em></b></div>
        </section>
        <div class="two">
          <section style="display:grid;gap:10px"><div class="sec-title"><h2>참가자</h2><span>${ppl.length}명 · 연락처는 진행자만 볼 수 있어요</span></div>
            ${participantList(ppl)}
          </section>
          <section style="display:grid;gap:10px"><div class="sec-title"><h2>매칭 결과</h2><span>${d.matches.length}쌍</span></div>
            ${d.matches.length ? `<div class="tbl-wrap"><table><thead><tr><th>남</th><th>여</th></tr></thead><tbody>${d.matches.map((m) => `<tr><td>${m.m_number}번 ${esc(m.m_name)}</td><td>${m.f_number}번 ${esc(m.f_name)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>매칭된 쌍이 아직 없어요</b><p>참가자가 최종 선택을 제출하면 서로 선택한 쌍이 여기에 보여요.</p></div>`}
            <p class="note">매칭된 상대의 연락처는 참가자 본인 화면에서 결과 발표 후에만 전달돼요.</p>
          </section>
        </div>
        ${picksPanel(d)}
        ${addPanel()}
        <section style="display:grid;gap:10px"><div class="toolbar"><div class="sec-title"><h2>설문 결과</h2><span>${d.surveys.length}명 응답</span></div>
          <div><button class="btn sm ghost" data-act="csv-survey">설문 CSV</button><button class="btn sm ghost" data-act="csv-match">매칭 CSV</button></div></div>
          ${surveyCards(d.surveys)}</section>
        ${importPanel(d)}
        ${entryPanel()}
        <section class="panel"><h2>${esc(rnd.label)} 초기화</h2><p class="sub" style="font-size:13px">이 회차의 모든 참가자, 메모, 선택, 설문을 지우고 결과 공개도 닫습니다. 다른 회차는 그대로예요. 되돌릴 수 없으니 먼저 CSV를 내려받으세요.</p>
          <button class="btn danger sm" style="justify-self:start" data-act="reset">${S.confirm === "reset" ? "정말 모두 삭제합니다" : "이 회차 초기화"}</button></section>
      </main>`;
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
      downloadCSV("picks-" + S.round.replace(/[\\/]/g, "-") + ".csv", rows);
    },
    "edit-person": (t) => {
      const p = S.data.participants.find((x) => x.id === t.dataset.id);
      if (!p) return;
      S.add = { open: true, editing: true, round: "", name: p.name || "", gender: p.gender, phone: fmtPhone(p.phone), number: String(p.number), age: p.age_label || "", school: p.school || "", mbti: p.mbti || "", hobby: p.hobby || "" };
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
      downloadCSV("survey-" + S.round.replace(/[\\/]/g, "-") + ".csv", rows);
    },
    "copy-url": async () => {
      try { await navigator.clipboard.writeText(entryUrl()); toast("링크를 복사했어요."); }
      catch (e) { toast("링크를 길게 눌러 복사해 주세요."); }
    },
    "imp-parse": () => { S.imp.text = document.getElementById("imp-text").value; loadImport(S.imp.text, ""); render(); },
    "imp-run": () => {
      const im = S.imp, b = im.built;
      if (!b || !b.rows.length) return;
      if (im.prune && S.confirm !== "imp") return askConfirm("imp");
      run(async () => {
        const rows = b.rows.map((p) => ({ phone: p.phone, gender: p.gender, name: p.name, age_label: p.age_label, school: p.school, mbti: p.mbti, hobby: p.hobby, number: p.number }));
        const data = im.table.slice(1);
        const rid = (im.date || String(im.roundName || S.round || "").trim()).trim();
        const label = im.date ? Roster.dateLabel(data, im.map, im.date) : rid;
        im.done = await api.admin.import(S.pin, rid, label, rows, im.prune);
        S.round = rid;
        toast(label + " 명단을 가져왔어요.");
      });
    },
    "csv-match": () => {
      const rows = [["남 번호", "남 이름", "여 번호", "여 이름"]];
      S.data.matches.forEach((m) => rows.push([m.m_number, m.m_name, m.f_number, m.f_name]));
      downloadCSV("matches-" + S.round.replace(/[\\/]/g, "-") + ".csv", rows);
    },
  };

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (t && actions[t.dataset.act]) actions[t.dataset.act](t);
  });
  document.addEventListener("change", (e) => {
    const t = e.target, im = S.imp;
    if (t.id === "imp-file" && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then((txt) => { im.text = ""; loadImport(txt, f.name); render(); }).catch(() => { im.error = "파일을 읽지 못했어요."; render(); });
    } else if (t.dataset && t.dataset.field) { im.map[t.dataset.field] = Number(t.value); render(); }
    else if (t.id === "imp-date") { im.date = t.value; render(); }
    else if (t.id === "imp-round") { im.roundName = t.value; }
    else if (t.id === "imp-numbered") { im.numberedOnly = t.checked; render(); }
    else if (t.id === "imp-prune") { im.prune = t.checked; S.confirm = ""; render(); }
    else if (t.id === "only-bad") { S.onlyBad = t.checked; render(); }
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
    if (e.target.id === "imp-text") S.imp.text = e.target.value;
    if (e.target.id && e.target.id.startsWith("add-") && e.target.id !== "add-details") {
      const k = e.target.id.slice(4);
      if (k === "phone") { const d = e.target.value.replace(/\D/g, "").slice(0, 11); e.target.value = d.length <= 3 ? d : d.length <= 7 ? d.slice(0, 3) + "-" + d.slice(3) : d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7); }
      S.add[k] = e.target.value;
    }
    if (e.target.id === "pin") {   // 마스터키도 010-1234-5678 형태로 정리
      const d = e.target.value.replace(/\D/g, "").slice(0, 11);
      e.target.value = d.length <= 3 ? d : d.length <= 7 ? d.slice(0, 3) + "-" + d.slice(3) : d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
    }
  });
  document.addEventListener("toggle", (e) => { if (e.target.id === "imp-details") S.imp.open = e.target.open; if (e.target.id === "add-details") S.add.open = e.target.open; }, true);
  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "f-add") {
      const a = S.add, phone = normPhone(a.phone), name = a.name.trim();
      const rid = S.data.round ? S.round : String(a.round || "").trim();
      if (!rid) return toast("회차 이름을 적어 주세요.");
      if (!name) return toast("이름을 적어 주세요.");
      if (!a.gender) return toast("성별을 골라 주세요.");
      if (!/^01\d{8,9}$/.test(phone)) return toast("연락처를 정확히 입력해 주세요.");
      const row = { phone, gender: a.gender, name, number: a.number ? parseInt(a.number, 10) : null, age_label: Roster.normAge(a.age), school: a.school.trim(), mbti: Roster.normMbti(a.mbti), hobby: a.hobby.trim() };
      const label = S.data.round ? S.data.round.label : rid;
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
    if (S.pin) { try { await load(); } catch (e) { S.data = null; } if (S.data && S.data.participants.length) S.imp.open = false; render(); }
    setInterval(async () => { const ae = document.activeElement; const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName); if (S.data && !S.busy && !S.confirm && !typing) { try { await load(); render(); } catch (e) { /* 다음 주기에 재시도 */ } } }, 15000);
  })();
})();
