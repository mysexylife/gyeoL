/**
 * gyeoL 구글폼 → 앱 실시간 연동 (Google Apps Script)
 *
 * 구글폼의 응답 시트에서 [확장 프로그램 → Apps Script] 를 열어 이 코드를 붙여넣고,
 * 아래 SECRET 을 정한 뒤, 왼쪽 시계 아이콘(트리거)에서 `onFormSubmit` 을
 * "스프레드시트에서 · 양식 제출 시" 로 추가하세요. 자세한 순서는 README 의 '구글폼 연동' 참고.
 *
 * 폼이 제출될 때마다 신청자 한 명이 앱의 '신청자' 명단에 들어갑니다.
 * 이미 쌓여 있는 응답은 `syncAll` 을 한 번 실행하면 한꺼번에 들어갑니다(같은 연락처는 정보만 갱신되어 여러 번 실행해도 안전).
 * 이상형·입금·추가요청·동의 항목은 읽지도 보내지도 않습니다. 사진은 드라이브 링크만 보냅니다.
 */
const SUPABASE_URL = "https://pjferikmuhqxnzoukokc.supabase.co";
const ANON_KEY = "sb_publishable_JXLE1DGg8Rla4Zk0b4_H0w_Lf7cg0Kn";   // 공개 키(config.js 와 같은 값)
const SECRET = "여기에-20자-이상-무작위-문자열";   // Supabase 의 app_settings.form_secret 와 똑같이

// 폼 제출 때 실행되는 함수 (트리거에 연결)
function onFormSubmit(e) {
  const row = buildRow(e.namedValues);
  if (!row.phone || !row.name || !row.gender) {
    console.warn("필수 항목(연락처·이름·성별)이 비어 있어 건너뜁니다.", JSON.stringify({ name: row.name }));
    return;
  }
  console.log("전송 완료", send(row));
}

// 트리거를 화면에서 못 만들 때: 이 함수를 한 번 실행하면 '양식 제출 시' 트리거가 자동으로 만들어진다.
// (응답 시트의 [확장 프로그램 → Apps Script] 로 연 프로젝트에서만 동작한다)
function installTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("응답 시트에서 [확장 프로그램 → Apps Script] 로 연 프로젝트가 아닙니다. 시트에서 다시 열어 주세요.");
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "onFormSubmit").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onFormSubmit").forSpreadsheet(ss).onFormSubmit().create();
  console.log("트리거를 만들었습니다: onFormSubmit (스프레드시트 · 양식 제출 시)");
}

// 응답 시트에 이미 있는 모든 행을 앱으로 보낸다. 처음 한 번 직접 실행하세요(상단 함수 선택 → syncAll → 실행).
// 시간 기반 트리거(예: 5분마다)로 걸어 두면 시트를 직접 고친 내용도 따라갑니다.
function syncAll() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];   // 첫 번째 탭 = 폼 응답
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return console.log("보낼 응답이 없습니다.");
  const headers = values[0], rows = [];
  for (let i = 1; i < values.length; i++) {
    const nv = {};
    headers.forEach((h, c) => {
      const v = String(values[i][c] == null ? "" : values[i][c]);
      if (!nv[h] || !nv[h][0]) nv[h] = [v];   // 같은 제목의 열이 둘이면 값이 있는 쪽을 쓴다
    });
    const row = buildRow(nv);
    if (row.phone && row.name && row.gender) rows.push(row);
  }
  let total = { inserted: 0, updated: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i += 100) {
    const r = JSON.parse(send(rows.slice(i, i + 100)));
    total.inserted += r.inserted; total.updated += r.updated; total.skipped += r.skipped;
  }
  console.log("전체 " + rows.length + "건 전송 · 추가 " + total.inserted + " · 갱신 " + total.updated + " · 건너뜀 " + total.skipped);
}

function send(payloadRow) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/rpc/form_submit", {
    method: "post", contentType: "application/json", headers: { apikey: ANON_KEY },
    payload: JSON.stringify({ p_secret: SECRET, p_row: payloadRow }), muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("앱 전송 실패 " + res.getResponseCode() + " " + res.getContentText());
  return res.getContentText();
}

// 시트의 머리글(질문 제목)을 보고 항목을 찾아 앱이 받는 형식으로 정리한다
const SKIP = /동의|수집|개인정보|이상형|입금|요청|학생증|유입/;   // 사진 외의 민감한 열은 절대 읽지 않는다
const RULES = {
  phone:  { re: /전화|연락처|휴대|핸드폰|phone/i, not: /친구/ },
  name:   { re: /이름|성함|성명/, not: /친구/ },
  gender: { re: /성별/ },
  age:    { re: /나이|출생|생년|년생/ },
  school: { re: /대학|학과|학교/, not: /재학/ },
  mbti:   { re: /mbti/i },
  hobby:  { re: /취미/ },
  date:   { re: /날짜|회차/ },
  photo:  { re: /사진/, not: /동의|수집|개인정보/ },   // 값이 링크(http…)인 것만 쓴다
};

function pick(nv, field) {
  const rule = RULES[field];
  const keys = Object.keys(nv).filter((k) => rule.re.test(k) && !(rule.not && rule.not.test(k)) && (field === "photo" || !SKIP.test(k)));
  // 제목이 짧은 열(예: '이름')을 먼저 쓴다 — 긴 안내문 열보다 정확하다
  keys.sort((a, b) => a.length - b.length);
  for (const k of keys) {
    const v = String(nv[k] && nv[k][0] != null ? nv[k][0] : "").trim();
    if (v && (field !== "photo" || /^https?:\/\//i.test(v))) return v;
  }
  return "";
}

function buildRow(nv) {
  const g = pick(nv, "gender").toLowerCase();
  const gender = /^(남|m$|male|man)/.test(g) ? "M" : /^(여|f$|female|woman)/.test(g) ? "F" : "";
  const photo = pick(nv, "photo");
  return {
    phone: pick(nv, "phone").replace(/\D/g, ""),
    name: pick(nv, "name"),
    gender: gender,
    age_label: normAge(pick(nv, "age")),
    school: pick(nv, "school").replace(/\s+/g, " "),
    mbti: normMbti(pick(nv, "mbti")),
    hobby: pick(nv, "hobby").replace(/\s*\n\s*/g, ", "),
    pref_date: prefDate(pick(nv, "date")),
    photo_url: /^https?:\/\//i.test(photo) ? photo : "",
  };
}

// "03년생" / "03" / "2003" → "03년생",  "23세" → "23세"
function normAge(v) {
  v = String(v || "").trim();
  const m = v.match(/\d{2,4}/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (/세|살/.test(v)) return n + "세";
  if (m[0].length === 4) return String(n % 100).padStart(2, "0") + "년생";
  if (/년/.test(v) || n <= 10 || n >= 90) return String(n).padStart(2, "0") + "년생";
  return n + "세";
}
const normMbti = (v) => (/^[EI][NS][TF][JP]$/i.test(String(v || "").trim()) ? String(v).trim().toUpperCase() : "");

// "11/8 (일) - 19:00-21:00" → "2026-11-08". 날짜를 하나만 골랐을 때만 쓴다. 5개월 넘게 지난 날짜면 내년으로 본다.
function prefDate(v) {
  const t = String(v || "").match(/\d{1,2}\/\d{1,2}/g) || [];
  if (t.length !== 1) return "";
  const [mo, d] = t[0].split("/").map(Number);
  const now = new Date();
  let y = now.getFullYear();
  if ((now - new Date(y, mo - 1, d)) / 86400000 > 150) y += 1;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
