/* 구글시트(응답) → 참가자 명단 변환. 브라우저(진행자 화면)와 Node 테스트에서 같이 쓴다.
 *
 * 카드에 필요한 열(이름, 나이, 대학·학과, MBTI, 취미)과 로그인·매칭에 필요한 열(연락처, 성별, 현장 번호)만 읽는다.
 * 이상형·사진·입금·추가요청 같은 열은 읽지도, 서버로 보내지도 않는다.
 */
(function (root) {
  "use strict";

  /* ───────── CSV / TSV 파서 (따옴표, 셀 안 줄바꿈, BOM 지원) ───────── */
  function parseTable(text) {
    text = String(text || "").replace(/^﻿/, "");
    // 첫 줄(따옴표 밖)에서 구분자를 고른다: 구글시트에서 복사하면 탭, CSV 파일이면 쉼표
    let tabs = 0, commas = 0, q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      else if (!q && c === "\n") break;
      else if (!q && c === "\t") tabs++;
      else if (!q && c === ",") commas++;
    }
    const delim = tabs > commas ? "\t" : ",";
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += c;
      } else if (c === '"' && cell === "") inQ = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  }

  /* ───────── 열 자동 인식 ───────── */
  const GLOBAL_NOT = /동의|수집|개인정보|이상형|사진|입금|요청|학생증|유입/;
  const RULES = {
    phone:  { re: /전화|연락처|휴대|핸드폰|phone/i, not: /친구/ },
    name:   { re: /이름|성함|성명|^name$/i, not: /친구/ },
    gender: { re: /성별|gender/i },
    number: { re: /현장\s*번호|참가\s*번호|^번호$/, not: /전화|연락/ },
    age:    { re: /나이|출생|생년|년생/ },
    school: { re: /대학|학과|학교|school/i, not: /재학/ },
    mbti:   { re: /mbti/i },
    hobby:  { re: /취미|hobby/i },
    date:   { re: /날짜|회차/ },
  };
  const FIELD_LABEL = {
    phone: "연락처 *", name: "이름 *", gender: "성별 *", number: "현장 번호", age: "나이",
    school: "대학·학과", mbti: "MBTI", hobby: "취미", date: "날짜(회차)",
  };

  // headers: 첫 줄, data: 나머지 줄.  반환: { phone: 열번호 또는 -1, ... }
  function detect(headers, data) {
    const hasData = (i) => data.some((r) => String(r[i] === undefined ? "" : r[i]).trim() !== "");
    const map = {};
    Object.keys(RULES).forEach((f) => {
      const rule = RULES[f];
      map[f] = headers.findIndex((h, i) => {
        h = String(h || "");
        return rule.re.test(h) && !(rule.not && rule.not.test(h)) && !GLOBAL_NOT.test(h) && hasData(i);
      });
    });
    return map;
  }

  /* ───────── 값 정리 ───────── */
  const cellOf = (row, i) => (i >= 0 && row[i] !== undefined ? String(row[i]).trim() : "");

  function normGender(v) {
    v = String(v || "").trim().toLowerCase();
    if (/^(남|m$|male|man)/.test(v)) return "M";
    if (/^(여|f$|female|woman)/.test(v)) return "F";
    return "";
  }

  // "03년생" / "03" / "2003" → "03년생",  "23세" → "23세",  "23"(11~89) → "23세"
  function normAge(v) {
    v = String(v || "").trim();
    if (!v) return "";
    const m = v.match(/\d{2,4}/);
    if (!m) return "";
    const n = parseInt(m[0], 10);
    if (/세|살/.test(v)) return n + "세";
    if (m[0].length === 4) return String(n % 100).padStart(2, "0") + "년생";
    if (/년/.test(v) || n <= 10 || n >= 90) return String(n).padStart(2, "0") + "년생";
    return n + "세";
  }

  const normMbti = (v) => (/^[EI][NS][TF][JP]$/i.test(String(v || "").trim()) ? String(v).trim().toUpperCase() : "");
  const dateTokens = (v) => String(v || "").match(/\d{1,2}\/\d{1,2}/g) || [];

  // 시트에서 이름 뒤에 현장 번호를 붙여 둔 경우(예: "홍길동3", 번호 3)에 숫자를 뗀다
  function cleanName(name, num) {
    name = String(name || "").trim();
    if (num != null) {
      const s = String(num);
      if (name.length > s.length && name.endsWith(s)) name = name.slice(0, -s.length).trim();
    }
    return name;
  }

  function dateOptions(data, map) {
    if (map.date < 0) return [];
    const set = new Set();
    data.forEach((r) => dateTokens(cellOf(r, map.date)).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => {
      const [am, ad] = a.split("/").map(Number), [bm, bd] = b.split("/").map(Number);
      return am - bm || ad - bd;
    });
  }

  // 날짜 열의 값에서 보이는 그대로의 라벨(예: "11/6 (금)")을 찾아 준다
  function dateLabel(data, map, token) {
    for (const r of data) {
      const m = cellOf(r, map.date).match(new RegExp(token.replace("/", "\\/") + "\\s*\\([^)]*\\)"));
      if (m) return m[0];
    }
    return token;
  }

  /* ───────── 명단 만들기 ─────────
   * opts: { date: "11/8" 또는 "", numberedOnly: boolean }
   * 반환: { rows, skipped, dupPhones, dupNumbers, invalidMbti, counts }
   */
  function build(data, map, opts) {
    opts = opts || {};
    const out = [], skipped = [];
    let invalidMbti = 0;
    data.forEach((r, idx) => {
      const line = idx + 2; // 시트의 행 번호(머리글이 1행)
      if (opts.date && map.date >= 0 && !dateTokens(cellOf(r, map.date)).includes(opts.date)) return;
      const numRaw = cellOf(r, map.number);
      const num = /^\d+$/.test(numRaw) ? parseInt(numRaw, 10) : null;
      if (opts.numberedOnly && num == null) return;
      const phone = digitsNorm(cellOf(r, map.phone));
      const gender = normGender(cellOf(r, map.gender));
      const name = cleanName(cellOf(r, map.name), num);
      if (!/^01\d{8,9}$/.test(phone)) return skipped.push({ line, name, reason: "연락처 형식이 달라요" });
      if (!gender) return skipped.push({ line, name, reason: "성별을 알 수 없어요" });
      if (!name) return skipped.push({ line, name, reason: "이름이 비어 있어요" });
      const mbtiRaw = cellOf(r, map.mbti), mbti = normMbti(mbtiRaw);
      if (mbtiRaw && !mbti) invalidMbti++;
      out.push({
        line, phone, gender, name, number: num,
        age_label: normAge(cellOf(r, map.age)),
        school: cellOf(r, map.school).replace(/\s+/g, " "),
        mbti,
        hobby: cellOf(r, map.hobby).replace(/\s*\n\s*/g, ", "),
      });
    });

    // 같은 연락처가 두 번 나오면 나중 행을 쓴다
    const byPhone = new Map(), dupPhones = [];
    out.forEach((p) => { if (byPhone.has(p.phone)) dupPhones.push(p.name); byPhone.set(p.phone, p); });
    const rows = Array.from(byPhone.values());

    // 같은 성별에 같은 번호가 둘이면 가져올 수 없다
    const seen = new Map(), dupNumbers = [];
    rows.forEach((p) => {
      if (p.number == null) return;
      const k = p.gender + p.number;
      if (seen.has(k)) dupNumbers.push((p.gender === "M" ? "남 " : "여 ") + p.number + "번: " + seen.get(k).name + ", " + p.name);
      else seen.set(k, p);
    });

    return {
      rows, skipped, dupPhones, dupNumbers, invalidMbti,
      counts: { M: rows.filter((p) => p.gender === "M").length, F: rows.filter((p) => p.gender === "F").length },
    };
  }

  function digitsNorm(s) {
    let d = String(s || "").replace(/\D/g, "");
    if (/^82/.test(d) && d.length >= 11) d = "0" + d.slice(2);
    else if (d.length === 10 && d[0] === "1") d = "0" + d;
    return d;
  }

  const api = { parseTable, detect, build, dateOptions, dateLabel, normAge, normGender, normMbti, cleanName, FIELD_LABEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Roster = api;
})(typeof window !== "undefined" ? window : globalThis);
