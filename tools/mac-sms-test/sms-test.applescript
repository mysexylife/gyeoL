-- gyeoL Mac SMS test (Messages app on Mac, via iPhone Text Message Forwarding)
-- How to use: open this file in Script Editor, then press the Run button (triangle).
-- Nothing is stored or uploaded. It sends ONE test text to the number you type.

set promptText to (character id {53580, 49828, 53944, 32, 47928, 51088, 47484, 32, 48155, 51012, 32, 55092, 45824, 54256, 32, 48264, 54840, 47484, 32, 51077, 47141, 54616, 49464, 50836}) & (character id {46, 32, 40, 50696, 58, 32, 48, 49, 48, 49, 50, 51, 52, 53, 54, 55, 56, 41, 10, 10, 51452, 51032, 58, 32}) & (character id {47928, 51088, 47484, 32, 48372, 45236, 45716, 32, 50500, 51060, 54256, 32, 51088, 44592, 32, 51088, 49888, 51032, 32, 48264, 54840, 44032, 32, 50500}) & (character id {45768, 46972, 44, 32, 47928, 51088, 47484, 32, 48155, 50500, 32, 48380, 32, 49688, 32, 51080, 45716, 32, 45796, 47480, 32, 49324, 46988, 51032}) & (character id {32, 48264, 54840, 40, 46608, 45716, 32, 48372, 51312, 32, 48264, 54840, 41, 47196, 32, 48372, 45236, 49464, 50836, 46})
set badText to (character id {55092, 45824, 54256, 32, 48264, 54840, 32, 54805, 49885, 51060, 32, 47582, 51648, 32, 50506, 50500, 50836, 46, 32, 48, 49, 48, 49, 50}) & (character id {51, 52, 53, 54, 55, 56, 32, 52376, 47100, 32, 49707, 51088, 47564, 32, 51077, 47141, 54644, 32, 51452, 49464, 50836, 46})
set msgText to (character id {91, 44208, 93, 32, 47928, 51088, 32, 53580, 49828, 53944, 50696, 50836, 32, 129526, 10, 51060, 32, 47928, 51088, 44032, 32, 48372, 51060, 47732}) & (character id {32, 47589, 48513, 50640, 49436, 32, 50500, 51060, 54256, 51012, 32, 53685, 54644, 32, 47928, 51088, 32, 48372, 45236, 44592, 44032, 32, 46104, 45716}) & (character id {32, 44144, 50696, 50836, 46, 10, 51060, 47784, 51648, 46020, 32, 48372, 51060, 45208, 50836, 63, 32, 128522, 128152})
set okHead to (character id {48156, 49569, 51012, 32, 50836, 52397, 54664, 50612, 50836, 46, 10, 48155, 45716, 32, 55092, 45824, 54256, 50640, 32, 47928, 51088, 44032, 32, 50772}) & (character id {45716, 51648, 32, 54869, 51064, 54644, 32, 51452, 49464, 50836, 46, 10, 40, 51204, 45804, 32, 48169, 49885, 58, 32})
set okTail to (character id {41})
set failHead to (character id {47928, 51088, 47484, 32, 48372, 45236, 51648, 32, 47803, 54664, 50612, 50836, 46, 10, 50724, 47448, 32, 45236, 50857, 51012, 32, 44536, 45824, 47196}) & (character id {32, 48373, 49324, 54644, 49436, 32, 50508, 47140, 51452, 49464, 50836, 58, 10, 10})

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
