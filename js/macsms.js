/* 맥북 메시지 앱으로 문자를 보내는 애플스크립트(.applescript) 만들기
 *
 * 진행자 화면에서 받은 스크립트를 맥북의 '스크립트 편집기'로 열어 ▶ 실행하면,
 * 아이폰의 '문자 메시지 전달'을 통해 한 명씩 일반 문자(SMS)가 나간다.
 * 한글이 깨지지 않도록 스크립트 파일 안의 글자는 모두 유니코드 번호(character id)로 적어, 파일이 영문·숫자뿐이다.
 */
(function (root) {
  "use strict";

  // 문자열 → AppleScript 식: (character id {44032, 45208, ...}). 파일에 한글이 직접 들어가지 않는다.
  function asText(str) {
    const cps = Array.from(String(str)).map((c) => c.codePointAt(0));
    if (!cps.length) return '""';
    const parts = [];
    for (let i = 0; i < cps.length; i += 24) parts.push(cps.slice(i, i + 24).join(", "));
    return parts.map((p) => "(character id {" + p + "})").join(" & ");
  }

  // 01012345678 → +821012345678
  function e164(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    return /^01\d{8,9}$/.test(d) ? "+82" + d.slice(1) : "";
  }

  // items: [{ phone: "01012345678", text: "그 사람에게 보낼 문안" }, ...]  (사람마다 문안이 달라도 된다)
  // delaySec: 한 명 보내고 쉬는 초(통신사 제한을 피하려고 간격을 둔다)
  function buildItems(items, delaySec) {
    const seen = new Set();
    const list = [];
    (items || []).forEach((it) => {
      const ph = e164(it && it.phone);
      if (!ph || seen.has(ph)) return;
      seen.add(ph); list.push({ ph, text: String((it && it.text) || "") });
    });
    const delay = Math.max(2, Math.min(30, Number(delaySec) || 5));
    const q = (s) => '"' + s + '"';
    const lines = [
      "-- gyeoL SMS sender (Messages app on Mac, via iPhone Text Message Forwarding)",
      "-- How to use: open this file in Script Editor, then press the Run button.",
      "-- This file contains phone numbers. Delete it after use.",
      "",
      "set phones to {" + list.map((x) => q(x.ph)).join(", ") + "}",
      // 문안 목록은 한 줄씩 'set end of' 로 쌓는다. 쉼표 뒤에서 줄을 바꾼 긴 목록 한 개로 쓰면 스크립트 편집기가 '표현식을 예상했지만 라인의 끝을 발견했습니다' 오류를 낸다.
      "set texts to {}",
      ...list.map((x) => "set end of texts to " + asText(x.text)),
      "set delaySec to " + delay,
      "set okCount to 0",
      "set failList to {}",
      "",
      'tell application "Messages"',
      "\trepeat with i from 1 to (count of phones)",
      "\t\tset phoneText to item i of phones",
      "\t\tset msgText to item i of texts",
      "\t\tset sentOk to false",
      "\t\ttry",
      "\t\t\tset svc to 1st account whose service type = SMS",
      "\t\t\tset theBuddy to participant phoneText of svc",
      "\t\t\tsend msgText to theBuddy",
      "\t\t\tset sentOk to true",
      "\t\ton error",
      "\t\t\ttry",
      "\t\t\t\tset svc2 to 1st service whose service type = SMS",
      "\t\t\t\tset buddy2 to buddy phoneText of svc2",
      "\t\t\t\tsend msgText to buddy2",
      "\t\t\t\tset sentOk to true",
      "\t\t\tend try",
      "\t\tend try",
      "\t\tif sentOk then",
      "\t\t\tset okCount to okCount + 1",
      "\t\telse",
      "\t\t\tset end of failList to phoneText",
      "\t\tend if",
      "\t\tdelay delaySec",
      "\tend repeat",
      "end tell",
      "",
      "set AppleScript's text item delimiters to \", \"",
      "set failText to failList as text",
      "set AppleScript's text item delimiters to \"\"",
      "set summary to " + asText("발송 요청 ") + " & okCount & " + asText("건 완료") + " & linefeed & " + asText("실패 ") + " & (count of failList) & " + asText("건 ") + " & failText",
      "display dialog summary buttons {\"OK\"} default button 1",
      "",
    ];
    return lines.join("\n");
  }

  // 같은 문안을 여러 번호에 보낼 때(예전 방식과 호환)
  function build(text, phones, delaySec) {
    return buildItems((phones || []).map((phone) => ({ phone, text })), delaySec);
  }

  const api = { build, buildItems, asText, e164 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MacSms = api;
})(typeof window !== "undefined" ? window : globalThis);
