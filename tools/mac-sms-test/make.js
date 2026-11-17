// 테스트 스크립트(sms-test.applescript) 생성기. 실행: node tools/mac-sms-test/make.js
// 한글이 깨지지 않도록 모든 글자를 유니코드 번호(character id)로 적어, 결과 파일은 영문·숫자만 들어간다.
const fs = require("fs");
const path = require("path");
const { asText } = require("../../js/macsms.js");

const T = {
  ask: "테스트 문자를 받을 휴대폰 번호를 입력하세요. (예: 01012345678)\n\n주의: 문자를 보내는 아이폰 자기 자신의 번호가 아니라, 문자를 받아 볼 수 있는 다른 사람의 번호(또는 보조 번호)로 보내세요.",
  bad: "휴대폰 번호 형식이 맞지 않아요. 01012345678 처럼 숫자만 입력해 주세요.",
  msg: "[결] 문자 테스트예요 🧶\n이 문자가 보이면 맥북에서 아이폰을 통해 문자 보내기가 되는 거예요.\n이모지도 보이나요? 😊💘",
  okHead: "발송을 요청했어요.\n받는 휴대폰에 문자가 왔는지 확인해 주세요.\n(전달 방식: ",
  okTail: ")",
  fail: "문자를 보내지 못했어요.\n오류 내용을 그대로 복사해서 알려주세요:\n\n",
};

const src = `-- gyeoL Mac SMS test (Messages app on Mac, via iPhone Text Message Forwarding)
-- How to use: open this file in Script Editor, then press the Run button (triangle).
-- Nothing is stored or uploaded. It sends ONE test text to the number you type.

set promptText to ${asText(T.ask)}
set badText to ${asText(T.bad)}
set msgText to ${asText(T.msg)}
set okHead to ${asText(T.okHead)}
set okTail to ${asText(T.okTail)}
set failHead to ${asText(T.fail)}

set dlg to display dialog promptText default answer "" buttons {"Cancel", "OK"} default button "OK"
set raw to text returned of dlg
set digitsOnly to ""
repeat with ch in characters of raw
	if "0123456789" contains (contents of ch) then set digitsOnly to digitsOnly & (contents of ch)
end repeat
if (length of digitsOnly) < 10 then
	display dialog badText buttons {"OK"} default button 1
	return
end if
if (text 1 thru 2 of digitsOnly) is not "01" then
	display dialog badText buttons {"OK"} default button 1
	return
end if
set phoneText to "+82" & (text 2 thru -1 of digitsOnly)

set methodUsed to ""
set errText to ""
tell application "Messages"
	try
		set svc to 1st account whose service type = SMS
		set theBuddy to participant phoneText of svc
		send msgText to theBuddy
		set methodUsed to "account/participant"
	on error e1
		set errText to e1
		try
			set svc2 to 1st service whose service type = SMS
			set buddy2 to buddy phoneText of svc2
			send msgText to buddy2
			set methodUsed to "service/buddy"
		on error e2
			set errText to errText & " | " & e2
		end try
	end try
end tell

if methodUsed is not "" then
	display dialog okHead & methodUsed & okTail buttons {"OK"} default button 1
else
	display dialog failHead & errText buttons {"OK"} default button 1
end if
`;
fs.writeFileSync(path.join(__dirname, "sms-test.applescript"), src);
console.log("sms-test.applescript 생성", src.length, "bytes");
