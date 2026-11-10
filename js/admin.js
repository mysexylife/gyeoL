/* 진행자 화면: 단계 전환, 참가 현황, 매칭, 설문 집계, CSV */
(() => {
  const api = window.api;
  const { SURVEY, MAX_PICKS, friendly, splitSchool, fmtPhone, normPhone, roundLabel, roundTag, roundDate, mkRound, isRoundId, toRoundId, todayISO } = window.RN;
  const Roster = window.Roster;   // 나이·MBTI 정리에만 쓴다 (명단 가져오기는 쓰지 않음)
  const $app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const S = { pin: "", data: null, applicants: [], appl: { date: "", gender: "", showAssigned: false, sel: {}, target: "", newdate: "", newtime: "" }, error: "", confirm: "", busy: false, round: "", rounds: [], tab: "picks", open: {}, openPick: {}, pickEdit: {}, onlyBad: false,
    add: { open: false, editing: false, round: "", newdate: "", newtime: "", name: "", gender: "", phone: "", number: "", age: "", school: "", mbti: "", hobby: "" },
    imp: { dest: "applicants", text: "", fileName: "", table: null, map: {}, date: "", round: "", newdate: "", newtime: "", numberedOnly: false, onlyDate: true, prune: false, done: null, error: "" } };
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
      const withData = S.rounds.filter((r) => r.count > 0).map((r) => r.id).sort();
      const ids = withData.length ? withData : S.rounds.map((r) => r.id).sort(), t = todayISO();
      S.round = ids.find((i) => roundDate(i) === t) || ids.find((i) => roundDate(i) > t) || ids[ids.length - 1] || "";
    }
    S.applicants = await api.admin.applicants(S.pin);
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

  function importPanel(d) {
    const im = S.imp, t = im.table;
    let body = "";
    if (t) {
      const data = t.slice(1);
      const dates = Roster.dateOptions(data, im.map);
      const toApp = im.dest === "applicants";
      if (toApp) { if (im.date && !dates.includes(im.date)) im.date = ""; }
      else if (dates.length && !dates.includes(im.date)) im.date = dates[0];
      const b = Roster.build(data, im.map, { date: im.date, numberedOnly: !toApp && im.numberedOnly, onlyThisDate: im.onlyDate && !!im.date, applicant: toApp });
      im.built = b;
      const sel = (f) => `<label class="mp"><span>${Roster.FIELD_LABEL[f]}</span><select data-field="${f}" id="map-${f}"><option value="-1" ${im.map[f] < 0 ? "selected" : ""}>(사용 안 함)</option>${t[0].map((h, i) => `<option value="${i}" ${im.map[f] === i ? "selected" : ""}>${colName(i)}열 · ${esc(shortHead(h))}</option>`).join("")}</select></label>`;
      const missing = ["phone", "name", "gender"].filter((f) => im.map[f] < 0).map((f) => Roster.FIELD_LABEL[f].replace(" *", ""));
      const errs = [];
      if (missing.length) errs.push("필수 열을 골라 주세요: " + missing.join(", "));
      if (!toApp && b.dupNumbers.length) errs.push("같은 성별에 번호가 겹쳐요. 날짜(회차)를 고르거나 시트의 번호를 확인해 주세요. → " + b.dupNumbers.join(" / "));
      const warns = [];
      if (b.skipped.length) warns.push(`건너뛰는 행 ${b.skipped.length}개: ` + b.skipped.slice(0, 5).map((x) => `${x.line}행${x.name ? " " + x.name : ""}(${x.reason})`).join(", ") + (b.skipped.length > 5 ? " …" : ""));
      if (b.dupPhones.length) warns.push("연락처가 같은 행이 있어 나중 행을 써요: " + b.dupPhones.join(", "));
      if (b.invalidMbti) warns.push(`MBTI 형식이 아닌 값 ${b.invalidMbti}개는 비워 둬요.`);
      const noNum = b.rows.filter((p) => p.number == null).length;
      if (!toApp && b.rows.length && noNum) warns.push(`현장 번호가 없는 ${noNum}명은 같은 성별의 다음 번호를 자동으로 붙여요.`);
      const canRun = b.rows.length > 0 && !errs.length && !S.busy;
      body = `<div class="mapgrid">${["phone", "name", "gender", ...(toApp ? [] : ["number"]), "age", "school", "mbti", "hobby", "date", ...(toApp ? ["photo"] : [])].map(sel).join("")}</div>
        <div class="filters">
          ${dates.length
            ? `<label class="mp"><span>가져올 날짜 (시트)</span><select id="imp-date">${toApp ? `<option value="" ${im.date === "" ? "selected" : ""}>전체 날짜</option>` : ""}${dates.map((x) => `<option value="${x}" ${im.date === x ? "selected" : ""}>${esc(roundLabel(toRoundId(x)))}</option>`).join("")}</select></label>${toApp ? "" : timeField("imp-newtime", im.newtime)}`
            : (toApp ? "" : `${importDateFields()}`)}
          <label class="ck"><input type="checkbox" id="imp-onlydate" ${im.onlyDate ? "checked" : ""}> 이 날짜만 고른 사람만 (다른 날짜도 고른 사람 제외)</label>
          ${toApp ? "" : `<label class="ck"><input type="checkbox" id="imp-numbered" ${im.numberedOnly ? "checked" : ""}> 현장 번호가 있는 사람만</label>
          <label class="ck"><input type="checkbox" id="imp-prune" ${im.prune ? "checked" : ""}> 이 회차에서 이번 명단에 없는 기존 참가자는 삭제</label>`}
        </div>
        <p class="sum"><b>${b.rows.length}명</b> 가져와요 <span class="sub">(남 ${b.counts.M} · 여 ${b.counts.F})</span></p>
        ${errs.map((x) => `<p class="err">${esc(x)}</p>`).join("")}${warns.map((x) => `<p class="note">${esc(x)}</p>`).join("")}
        ${b.rows.length ? `<div class="tbl-wrap"><table><thead><tr><th class="num">번호</th><th>성별</th><th>이름</th><th>나이</th><th>대학·학과</th><th>MBTI</th><th>취미</th><th>연락처</th></tr></thead><tbody>${b.rows.slice(0, 8).map((p) => `<tr><td class="num">${p.number ?? "자동"}</td><td>${p.gender === "M" ? "남" : "여"}</td><td>${esc(p.name)}</td><td>${esc(p.age_label)}</td><td>${esc(p.school)}</td><td>${esc(p.mbti)}</td><td>${esc(p.hobby)}</td><td>${maskPhone(p.phone)}</td></tr>`).join("")}</tbody></table></div>${b.rows.length > 8 ? `<p class="sub" style="font-size:12.5px">… 외 ${b.rows.length - 8}명</p>` : ""}` : ""}
        <div class="toolbar"><span class="sub" style="font-size:12.5px">${im.fileName ? esc(im.fileName) : "붙여넣은 내용"} · ${toApp ? "사진은 링크만 저장하고 진행자만 볼 수 있어요. " : ""}이상형·입금·추가요청 열은 읽지 않고 서버로 보내지 않아요.</span>
          <button class="btn" style="width:auto" data-act="imp-run" ${canRun ? "" : "disabled"}>${S.confirm === "imp" ? "삭제가 포함돼요. 한 번 더 눌러 실행" : toApp ? `${b.rows.length}명 신청자 명단에 넣기` : `${b.rows.length}명 가져오기`}</button></div>`;
    }
    return `<section class="panel" id="imp-details"><h2>명단 가져오기 <span class="sub">구글 시트 응답 → 참가자</span></h2>
      <div class="seg" role="radiogroup" aria-label="가져올 곳"><label><input type="radio" name="imp-dest" value="applicants" ${im.dest === "applicants" ? "checked" : ""}><span>신청자 명단 (나중에 배정)</span></label><label><input type="radio" name="imp-dest" value="round" ${im.dest === "round" ? "checked" : ""}><span>날짜에 바로 등록</span></label></div>
      <p class="note">${im.dest === "applicants" ? "시트의 응답은 먼저 <b>신청자 명단</b>에 들어가요. 사진과 남녀 인원을 보고 <b>신청자</b> 탭에서 날짜에 배정하면 그때 참가자가 되고 번호가 붙어요. 같은 연락처를 다시 가져오면 정보만 갱신돼요." : "날짜마다 한 번씩 가져오세요(예: 2026-11-06, 2026-11-08). 가져온 사람은 그 날짜의 참가자가 되어, 직접 등록한 사람과 같은 날짜에 합쳐져요. 시트가 바뀌면 같은 방법으로 다시 가져오면 돼요. 같은 날짜에서 연락처가 같은 사람은 정보만 갱신하고, 메모·선택은 그대로 유지돼요. <b>시트를 먼저 가져오고 나머지를 직접 등록하면</b> 번호가 겹치지 않아요."}</p>
      <ol class="how"><li>구글 시트에서 <b>파일 → 다운로드 → 쉼표로 구분된 값(.csv)</b>을 받아 올리거나,</li><li>시트 전체를 선택(<b>Ctrl/⌘+A</b>)해 복사한 뒤 아래에 붙여넣으세요.</li></ol>
      <div class="impin"><input type="file" id="imp-file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-label="CSV 파일 선택">
        <textarea id="imp-text" placeholder="또는 여기에 붙여넣기" rows="3">${esc(im.text)}</textarea>
        <button class="btn sm ghost" data-act="imp-parse">붙여넣은 내용 불러오기</button></div>
      ${im.error ? `<p class="err">${esc(im.error)}</p>` : ""}
      ${im.done ? `<div class="done">가져왔어요 · 추가 ${im.done.inserted}명, 갱신 ${im.done.updated}명${im.done.skipped ? `, 건너뜀 ${im.done.skipped}명` : ""}${im.done.pruned ? `, 삭제 ${im.done.pruned}명` : ""}</div>` : ""}
      ${body}</section>`;
  }
  function loadImport(text, fileName) {
    const im = S.imp;
    im.error = ""; im.done = null; im.fileName = fileName || ""; im.confirm = false;
    const table = Roster.parseTable(text);
    if (table.length < 2) { im.table = null; im.error = "읽을 수 있는 행이 없어요. 머리글이 있는 시트 전체를 올려 주세요."; return; }
    im.table = table; im.map = Roster.detect(table[0], table.slice(1)); im.date = ""; im.round = ""; im.newdate = ""; im.numberedOnly = false; im.onlyDate = true;
    const need = ["phone", "name", "gender"].filter((f) => im.map[f] < 0);
    if (need.length) im.error = "일부 열을 자동으로 찾지 못했어요. 아래에서 직접 골라 주세요.";
  }

  // 시트에 날짜 열이 없을 때: 참가자가 있는 날짜 중에서 고르거나 새 날짜를 만든다
  const impRoundValue = () => S.imp.round || (knownRounds().some((r) => r.id === S.round) ? S.round : "__new");
  const timeField = (id, v) => `<label class="mp" for="${id}"><span>시간 타임 <small>선택 · 예: 19:00</small></span><input type="text" id="${id}" inputmode="numeric" placeholder="19:00" maxlength="5" value="${esc(v || "")}"></label>`;
  function importDateFields() {
    const im = S.imp, cur = impRoundValue(), t = todayISO();
    const opts = knownRounds().map((r) => `<option value="${esc(r.id)}" ${r.id === cur ? "selected" : ""}>${esc(roundLabel(r.id))}${roundDate(r.id) === t ? " · 오늘" : ""} · ${r.count}명</option>`).join("");
    return `<label class="mp" for="imp-round"><span>저장할 날짜</span><select id="imp-round">${opts}<option value="__new" ${cur === "__new" ? "selected" : ""}>＋ 새 날짜 추가…</option></select></label>`
      + (cur === "__new" ? `<label class="mp" for="imp-newdate"><span>새 날짜</span><input type="date" id="imp-newdate" value="${esc(im.newdate || t)}"></label>${timeField("imp-newtime", im.newtime)}` : "");
  }

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
    ["picks", "최종 선택", ico('<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M9.3 11.6l2 2 3.6-3.8"/>')],
    ["people", "참가자", ico('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8s5 1.8 5.5 4.8"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16 14.4c2.6-.2 4.2 1.4 4.5 4.1"/>')],
    ["applicants", "신청자", ico('<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/>')],
    ["add", "참가자 추가", ico('<circle cx="10" cy="8.5" r="3.2"/><path d="M4 19c.5-3.3 2.8-5 6-5s5.5 1.7 6 5"/><path d="M19 8v6M16 11h6"/>')],
    ["survey", "설문 결과", ico('<path d="M4.5 20V10M10 20V4.5M15.5 20v-7M21 20H3"/>')],
  ];

  // [최종 선택 현황] 결과 공개 스위치 + 선택 현황·조정 + 매칭 쌍
  function tabPicks(d, rnd) {
    const ppl = d.participants, submitted = ppl.filter((p) => p.submitted).length, bad = (d.picks || []).filter((x) => !x.target_id).length;
    return `<section class="panel"><div class="toolbar"><h2>${esc(roundLabel(rnd.id))} 매칭 결과</h2><button class="btn sm ghost" data-act="refresh">새로고침</button></div>
        <p class="note">공개하면 참가자 화면에 <b>매칭 결과와 연락처</b>가 열리고, 이후엔 선택을 바꿀 수 없어요. 공개 전에 <b>확인 필요 0건</b>인지 확인하세요.</p>
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
    return `<section class="stats s3">
        <div class="stat"><small>남성 총원</small><b>${men.length}<em>명</em></b></div>
        <div class="stat"><small>여성 총원</small><b>${women.length}<em>명</em></b></div>
        <div class="stat"><small>선택·설문 제출</small><b>${submitted}<em>/ ${ppl.length}명</em></b></div>
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


  /* ───────── [신청자] 대기 명단 → 날짜 배정 ───────── */
  const applKnownRounds = () => S.rounds.filter((r) => r.count > 0 || r.id === S.round);
  function applTarget() {
    const a = S.appl, known = applKnownRounds();
    return a.target && (a.target === "__new" || known.some((r) => r.id === a.target)) ? a.target : (known.some((r) => r.id === S.round) ? S.round : "__new");
  }
  function applFiltered() {
    const a = S.appl;
    return S.applicants.filter((x) => (a.showAssigned || !x.assigned_round)
      && (!a.gender || x.gender === a.gender)
      && (!a.date || (a.date === "__none" ? !x.pref_date : x.pref_date === a.date)));
  }
  function tabApplicants() {
    const a = S.appl, all = S.applicants, wait = all.filter((x) => !x.assigned_round);
    const list = applFiltered(), prefDates = Array.from(new Set(all.map((x) => x.pref_date).filter(Boolean))).sort();
    const sel = list.filter((x) => a.sel[x.id] && !x.assigned_round), tg = applTarget();
    const cnt = (g) => wait.filter((x) => x.gender === g).length;
    const tr = S.rounds.find((r) => r.id === tg), baseM = tr ? tr.male || 0 : 0, baseF = tr ? tr.female || 0 : 0;
    const addM = sel.filter((x) => x.gender === "M").length, addF = sel.filter((x) => x.gender === "F").length;
    const tOpts = applKnownRounds().map((r) => `<option value="${esc(r.id)}" ${tg === r.id ? "selected" : ""}>${esc(roundLabel(r.id))} · 남 ${r.male || 0} · 여 ${r.female || 0}</option>`).join("");
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
    const rowsHtml = list.map((x) => {
      const open = !!S.open["ap" + x.id], done = !!x.assigned_round;
      const det = [["나이", x.age_label], ["대학·학과", splitSchool(x.school).filter(Boolean).join(" · ")], ["MBTI", x.mbti], ["취미", x.hobby], ["신청 날짜", x.pref_date ? roundLabel(x.pref_date) : "-"]]
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "-")}</dd></div>`).join("");
      return `<div class="prow ${open ? "open" : ""} ${done ? "done" : ""}" role="listitem">
        <div class="pmain apmain">
          ${done ? `<span class="apck"></span>` : `<label class="apck"><input type="checkbox" data-appl-sel="${x.id}" ${a.sel[x.id] ? "checked" : ""} aria-label="${esc(x.name)} 선택"></label>`}
          <span class="pnm">${esc(x.name)}</span><span class="pg g-${x.gender}">${x.gender === "M" ? "남" : "여"}</span>
          <span class="pph">${done ? `<span class="tag y">${esc(roundLabel(x.assigned_round))} 배정</span>` : esc(x.age_label || "")}</span>
          <button class="ptog" data-act="toggle" data-id="ap${x.id}" aria-expanded="${open}" aria-label="${esc(x.name)} 자세히 ${open ? "접기" : "보기"}">${chev}</button></div>
        ${open ? `<dl class="pdet">${det}<div><dt>연락처</dt><dd>${esc(fmtPhone(x.phone))}</dd></div>
          <div class="pact"><span>${x.photo_url ? `<a class="link" href="${esc(x.photo_url)}" target="_blank" rel="noopener noreferrer">사진 보기 ↗</a>` : `<span class="sub">사진 링크 없음</span>`}</span>
            <span class="pbtns">${done ? `<button class="link" data-act="appl-unassign" data-id="${x.id}" data-name="${esc(x.name)}">${S.confirm === "un" + x.id ? "정말 배정 취소(참가자 삭제)" : "배정 취소"}</button>` : ""}<button class="link" data-act="appl-remove" data-id="${x.id}" data-name="${esc(x.name)}">${S.confirm === "ar" + x.id ? "정말 삭제" : "삭제"}</button></span></div></dl>` : ""}
      </div>`;
    }).join("");
    return `<section class="stats s3">
        <div class="stat"><small>대기 남성</small><b>${cnt("M")}<em>명</em></b></div>
        <div class="stat"><small>대기 여성</small><b>${cnt("F")}<em>명</em></b></div>
        <div class="stat"><small>배정 완료</small><b>${all.length - wait.length}<em>/ ${all.length}명</em></b></div>
      </section>
      <section class="panel"><h2>날짜에 배정 <span class="sub">사진과 성비를 보고 정해요</span></h2>
        <div class="filters">
          <label class="mp"><span>신청한 날짜</span><select id="ap-date"><option value="" ${!a.date ? "selected" : ""}>전체</option>${prefDates.map((d) => `<option value="${d}" ${a.date === d ? "selected" : ""}>${esc(roundLabel(d))}</option>`).join("")}<option value="__none" ${a.date === "__none" ? "selected" : ""}>날짜 없음</option></select></label>
          <label class="mp"><span>성별</span><select id="ap-gender"><option value="" ${!a.gender ? "selected" : ""}>전체</option><option value="M" ${a.gender === "M" ? "selected" : ""}>남</option><option value="F" ${a.gender === "F" ? "selected" : ""}>여</option></select></label>
          <label class="ck"><input type="checkbox" id="ap-showdone" ${a.showAssigned ? "checked" : ""}> 배정된 사람도 보기</label>
        </div>
        <div class="filters">
          <label class="mp"><span>배정할 날짜</span><select id="ap-target">${tOpts}<option value="__new" ${tg === "__new" ? "selected" : ""}>＋ 새 날짜…</option></select></label>
          ${tg === "__new" ? `<label class="mp"><span>새 날짜</span><input type="date" id="ap-newdate" value="${esc(a.newdate || todayISO())}"></label>${timeField("ap-newtime", a.newtime)}` : ""}
        </div>
        <p class="sum"><b>${sel.length}명</b> 선택 <span class="sub">(남 ${addM} · 여 ${addF})</span>${sel.length ? ` → 배정 후 <b>남 ${baseM + addM} · 여 ${baseF + addF}</b>` : ""}</p>
        <div class="toolbar"><span class="toolbar-l"><button class="btn sm ghost" data-act="appl-all">보이는 대기자 모두 선택</button> <button class="btn sm ghost" data-act="appl-none">선택 해제</button></span>
          <button class="btn" style="width:auto" data-act="appl-assign" ${sel.length && !S.busy ? "" : "disabled"}>${sel.length}명 배정하기</button></div>
      </section>
      <section style="display:grid;gap:10px"><div class="sec-title"><h2>신청자</h2><span>${list.length}명 · 사진·연락처는 진행자만 볼 수 있어요</span></div>
        ${list.length ? `<div class="plist" role="list">${rowsHtml}</div>` : `<div class="empty"><b>대기 중인 신청자가 없어요</b><p>'참가자 추가' 탭의 명단 가져오기에서 시트를 <b>신청자 명단</b>으로 넣어 주세요.</p></div>`}</section>`;
  }

  function dashView() {
    const d = S.data, rnd = d.round;
    const head = `<header class="top"><div class="brand">gyeoL <small>진행자</small></div><div class="top-r"><button class="link" data-act="logout">나가기</button></div></header>
      ${api.mode === "demo" ? `<div class="demo-bar">체험 모드 · 참가자 화면과 같은 브라우저 데이터를 사용해요. <a href="index.html?demo">참가자 화면</a></div>` : ""}`;
    // 날짜(회차)가 하나도 없으면 '참가자 추가' 탭만 쓸 수 있다
    const tab = rnd || S.tab === "applicants" ? S.tab : "add", badCount = (d.picks || []).filter((x) => !x.target_id).length;
    const nav = `<nav class="tabs" aria-label="진행자 메뉴">${TABS.map(([id, label, icon]) => `<button data-act="tab" data-v="${id}" class="${tab === id ? "on" : ""}" ${tab === id ? 'aria-current="page"' : ""} ${!rnd && id !== "add" && id !== "applicants" ? "disabled" : ""}><span class="ico">${icon}</span>${label}${id === "picks" && badCount ? `<em class="bdg" aria-label="확인 필요 ${badCount}건">${badCount}</em>` : ""}</button>`).join("")}</nav>`;
    let body;
    if (tab === "applicants") body = tabApplicants();
    else if (!rnd) body = `<div class="empty"><b>아직 날짜(회차)가 없어요</b><p>날짜를 골라 참가자를 추가하거나 구글 시트를 가져오면 그 날짜 회차가 만들어져요.</p></div>${importPanel(d)}${addPanel()}${entryPanel()}`;
    else if (tab === "picks") body = tabPicks(d, rnd);
    else if (tab === "people") body = tabPeople(d, rnd);
    else if (tab === "survey") body = tabSurvey(d, rnd);
    else body = `${importPanel(d)}${addPanel()}${entryPanel()}`;
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
    "imp-parse": () => { S.imp.text = document.getElementById("imp-text").value; loadImport(S.imp.text, ""); render(); },
    "imp-run": () => {
      const im = S.imp, b = im.built;
      if (!b || !b.rows.length) return;
      if (im.dest === "applicants") {
        return run(async () => {
          const rows = b.rows.map((p) => ({ phone: p.phone, gender: p.gender, name: p.name, age_label: p.age_label, school: p.school, mbti: p.mbti, hobby: p.hobby, pref_date: p.pref_date, photo_url: p.photo_url }));
          im.done = await api.admin.applicantImport(S.pin, rows);
          S.tab = "applicants";
          toast("신청자 명단에 넣었어요. 이제 날짜에 배정해 주세요.");
        });
      }
      if (im.prune && S.confirm !== "imp") return askConfirm("imp");
      run(async () => {
        const rows = b.rows.map((p) => ({ phone: p.phone, gender: p.gender, name: p.name, age_label: p.age_label, school: p.school, mbti: p.mbti, hobby: p.hobby, number: p.number }));
        const data = im.table.slice(1);
        const cur = impRoundValue(), rid = im.date ? mkRound(toRoundId(im.date), im.newtime) : cur === "__new" ? mkRound(im.newdate || todayISO(), im.newtime) : cur;
        if (!rid) throw new Error("invalid_time");
        const label = roundLabel(rid);
        im.done = await api.admin.import(S.pin, rid, label, rows, im.prune);
        S.round = rid;
        toast(label + " 명단을 가져왔어요.");
      });
    },
    "appl-all": () => { applFiltered().filter((x) => !x.assigned_round).forEach((x) => { S.appl.sel[x.id] = true; }); render(); },
    "appl-none": () => { S.appl.sel = {}; render(); },
    "appl-assign": () => {
      const ids = applFiltered().filter((x) => S.appl.sel[x.id] && !x.assigned_round).map((x) => x.id);
      const tg = applTarget(), rid = tg === "__new" ? mkRound(S.appl.newdate || todayISO(), S.appl.newtime) : tg;
      if (!ids.length) return;
      if (!rid) return toast("날짜 또는 시간 형식을 확인해 주세요. 시간은 19:00 처럼 적어요.");
      run(async () => {
        const r = await api.admin.assign(S.pin, ids, rid, roundLabel(rid));
        S.appl.sel = {}; S.appl.target = rid; S.round = rid;
        toast(roundLabel(rid) + "에 " + r.assigned + "명을 배정했어요.");
      });
    },
    "appl-unassign": (t) => {
      const key = "un" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.unassign(S.pin, t.dataset.id); toast(t.dataset.name + " 배정을 취소했어요."); });
    },
    "appl-remove": (t) => {
      const key = "ar" + t.dataset.id;
      if (S.confirm !== key) return askConfirm(key);
      run(async () => { await api.admin.applicantRemove(S.pin, t.dataset.id); toast(t.dataset.name + " 신청자를 삭제했어요."); });
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
    if (t.id === "add-round") { S.add.round = t.value; render(); return; }
    if (t.id === "ap-date") { S.appl.date = t.value; render(); return; }
    if (t.id === "ap-gender") { S.appl.gender = t.value; render(); return; }
    if (t.id === "ap-showdone") { S.appl.showAssigned = t.checked; render(); return; }
    if (t.id === "ap-target") { S.appl.target = t.value; render(); return; }
    if (t.dataset && t.dataset.applSel) { if (t.checked) S.appl.sel[t.dataset.applSel] = true; else delete S.appl.sel[t.dataset.applSel]; render(); return; }
    const im = S.imp;
    if (t.id === "imp-file" && t.files && t.files[0]) {
      const f = t.files[0];
      f.text().then((txt) => { im.text = ""; loadImport(txt, f.name); render(); }).catch(() => { im.error = "파일을 읽지 못했어요."; render(); });
      return;
    }
    if (t.dataset && t.dataset.field) { im.map[t.dataset.field] = Number(t.value); render(); return; }
    if (t.name === "imp-dest") { im.dest = t.value; im.date = ""; render(); return; }
    if (t.id === "imp-date") { im.date = t.value; render(); return; }
    if (t.id === "imp-round") { im.round = t.value; render(); return; }
    if (t.id === "imp-onlydate") { im.onlyDate = t.checked; render(); return; }
    if (t.id === "imp-numbered") { im.numberedOnly = t.checked; render(); return; }
    if (t.id === "imp-prune") { im.prune = t.checked; S.confirm = ""; render(); return; }
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
    if (e.target.id === "imp-text") S.imp.text = e.target.value;
    if (e.target.id === "imp-newdate") S.imp.newdate = e.target.value;
    if (e.target.id === "ap-newdate") S.appl.newdate = e.target.value;
    if (e.target.id === "ap-newtime") S.appl.newtime = e.target.value;
    if (e.target.id === "imp-newtime") S.imp.newtime = e.target.value;
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
