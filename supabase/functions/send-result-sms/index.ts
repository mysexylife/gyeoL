// gyeoL · 결과 안내 문자 발송 (Supabase Edge Function)
//
// 진행자 화면의 [결과 안내 문자 보내기] 버튼이 부른다. 그 회차 참가자 전원에게
// "최종 선택 결과가 나왔어요 + 로그인 링크" 문자를 보낸다. 결과 내용·연락처는 문자에 담지 않는다.
// 문자 서비스: 솔라피(SOLAPI) API. 다른 서비스를 쓰려면 sendBatch() 만 바꾸면 된다.
//
// 필요한 환경변수(Supabase → Edge Functions → Secrets):
//   SOLAPI_API_KEY, SOLAPI_API_SECRET   솔라피 API 키/시크릿
//   SOLAPI_SENDER                       사전등록·인증된 발신번호 (숫자만, 예: 01012345678)
//   APP_URL                             참가자 입장 주소 (예: https://gyeol.rotationdating.workers.dev)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 준다.
//
// 배포 때 "Verify JWT" 는 끈다(이 앱의 공개 키는 JWT 가 아니라서). 대신 진행자 마스터키를 함수 안에서 확인한다.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const SUBJECT = "[결] 최종 선택 결과 안내";
export function buildText(appUrl: string): string {
  return [
    "안녕하세요, 로테이션 소개팅 [결] 운영진입니다 :)",
    "오늘 참여해 주셔서 감사합니다!",
    "",
    "최종 선택 결과가 나왔어요.",
    "아래 링크에서 로그인 후 최종선택 탭에서 확인해 주세요.",
    appUrl,
    "",
    "인스타그램을 팔로우하면 다음 회차 소식과 콘텐츠를 확인하실 수 있어요ㅎㅎ",
    "→ @gyeol.meet_official",
  ].join("\n");
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

// 솔라피 인증 헤더: HMAC-SHA256(date + salt) 를 API 시크릿으로 서명한다
export async function authHeader(apiKey: string, apiSecret: string, now = new Date(), salt = crypto.randomUUID().replace(/-/g, "")): Promise<string> {
  const date = now.toISOString();
  const key = await crypto.subtle.importKey("raw", enc.encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, enc.encode(date + salt)));
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// 한 묶음(최대 100명)을 보내고, 번호별 결과 { sent: [번호], failed: [{to, error}] } 를 돌려준다
export async function sendBatch(
  env: { key: string; secret: string; sender: string },
  tos: string[],
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ sent: string[]; failed: { to: string; error: string }[] }> {
  const res = await fetchFn("https://api.solapi.com/messages/v4/send-many", {
    method: "POST",
    headers: { Authorization: await authHeader(env.key, env.secret), "Content-Type": "application/json" },
    body: JSON.stringify({ messages: tos.map((to) => ({ to, from: env.sender, text, subject: SUBJECT, type: "LMS" })) }),
  });
  const raw = await res.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* 아래에서 오류로 처리 */ }
  if (!res.ok) {
    const msg = (data && (data.errorMessage || data.message)) || raw || res.statusText;
    return { sent: [], failed: tos.map((to) => ({ to, error: String(msg).slice(0, 200) })) };
  }
  const failedList: any[] = (data && (data.failedMessageList || data.failedMessages)) || [];
  const failed = failedList.map((f) => ({ to: String(f.to || ""), error: String(f.statusMessage || f.reason || f.errorMessage || "발송 실패").slice(0, 200) }));
  const failedSet = new Set(failed.map((f) => f.to));
  return { sent: tos.filter((t) => !failedSet.has(t)), failed };
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const { pin, round, test_to } = await req.json();
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 진행자 확인(마스터키). 틀리면 아무것도 보내지 않는다.
    const { data: okPin } = await sb.rpc("check_master", { p_key: String(pin || "") });
    if (!okPin) return json({ error: "bad_pin" }, 401);

    const env = {
      key: Deno.env.get("SOLAPI_API_KEY") || "",
      secret: Deno.env.get("SOLAPI_API_SECRET") || "",
      sender: (Deno.env.get("SOLAPI_SENDER") || "").replace(/\D/g, ""),
    };
    const appUrl = Deno.env.get("APP_URL") || "";
    if (!env.key || !env.secret || !env.sender || !appUrl) return json({ error: "not_configured" }, 500);
    const text = buildText(appUrl);

    // 테스트: 입력한 번호 한 곳에만 보낸다(참가자 기록에 남기지 않는다)
    if (test_to) {
      const to = String(test_to).replace(/\D/g, "");
      if (!/^01\d{8,9}$/.test(to)) return json({ error: "bad_number" }, 400);
      const r = await sendBatch(env, [to], text);
      return json({ test: true, sent: r.sent.length, failed: r.failed });
    }

    // 실제 발송: 결과가 공개된 회차의 참가자 중 아직 문자를 받지 않은 사람에게만
    if (!round) return json({ error: "round_required" }, 400);
    const { data: rnd } = await sb.from("rounds").select("results_open").eq("id", round).maybeSingle();
    if (!rnd || !rnd.results_open) return json({ error: "results_not_open" }, 409);
    const { data: ppl } = await sb.from("participants").select("id, phone").eq("round_id", round);
    const { data: done } = await sb.from("sms_log").select("participant_id").eq("round_id", round).eq("kind", "result").eq("status", "sent");
    const doneIds = new Set((done || []).map((d: any) => d.participant_id));
    const todo = (ppl || []).filter((p: any) => !doneIds.has(p.id) && /^01\d{8,9}$/.test(p.phone));
    let sent = 0;
    const failed: { to: string; error: string }[] = [];
    for (const group of chunk(todo, 100)) {
      const r = await sendBatch(env, group.map((p: any) => p.phone), text);
      const okSet = new Set(r.sent);
      const errBy = new Map(r.failed.map((f) => [f.to, f.error]));
      const rows = group.map((p: any) => okSet.has(p.phone)
        ? { round_id: round, participant_id: p.id, phone: p.phone, kind: "result", status: "sent" }
        : { round_id: round, participant_id: p.id, phone: p.phone, kind: "result", status: "failed", error: errBy.get(p.phone) || "발송 실패" });
      await sb.from("sms_log").insert(rows);
      sent += r.sent.length;
      failed.push(...r.failed);
    }
    return json({ total: (ppl || []).length, already: doneIds.size, sent, failed });
  } catch (e) {
    return json({ error: "server_error", message: String((e as Error).message || e).slice(0, 200) }, 500);
  }
}

// @ts-ignore: Deno 런타임에서만 존재한다
if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(handler);
