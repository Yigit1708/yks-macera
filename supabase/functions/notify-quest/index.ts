// YKS Macera Defteri — bildirim gönderen Supabase Edge Function
// Uygulama bunu iki durumda çağırır:
//   { type: "new",  quest_id }  → yoldaş görev astı  → gezginin telefonuna bildirim
//   { type: "done", quest_id }  → gezgin bitirdi     → görevi verenin telefonuna bildirim
// Gerekli gizli değişkenler (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ör. mailto:sen@ornek.com)
// deno-lint-ignore no-explicit-any
let webpush: any = null;
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Anahtarları ilk istekte kur; hata olursa fonksiyon çökmesin, nedenini söylesin.
let vapidError: string | null = null, vapidReady = false;
async function setupVapid() {
  if (vapidReady) return;
  if (!webpush) {
    try { webpush = (await import("npm:web-push@3.6.7")).default; }
    catch (e) { vapidError = "web-push yüklenemedi: " + (e as Error).message; return; }
  }
  const pub = (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim();
  const priv = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim();
  let subj = (Deno.env.get("VAPID_SUBJECT") ?? "").trim();
  if (!pub) { vapidError = "VAPID_PUBLIC_KEY secret eksik"; return; }
  if (!priv) { vapidError = "VAPID_PRIVATE_KEY secret eksik"; return; }
  if (!subj || subj.includes("KENDI-EPOSTAN")) subj = "mailto:yks-macera@example.com";
  if (!/^(mailto:|https:)/.test(subj)) subj = "mailto:" + subj;
  try { webpush.setVapidDetails(subj, pub, priv); vapidReady = true; vapidError = null; }
  catch (e) { vapidError = "VAPID anahtarları geçersiz: " + (e as Error).message; }
}

const FRESH_MS = 10 * 60 * 1000; // sadece son 10 dakikadaki olaylar için bildirim

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  await setupVapid();
  try {
    const peek = await req.clone().json().catch(() => ({}));
    if (peek?.type === "ping") return json({ ok: !vapidError, vapid: vapidError ?? "hazır" });
    if (vapidError) return json({ error: vapidError }, 500);
    // Çağıranı doğrula
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const { type, quest_id } = await req.json();
    if (!["new", "done"].includes(type) || typeof quest_id !== "string") return json({ error: "bad_request" }, 400);

    const admin = createClient(URL_, SERVICE);
    const { data: q } = await admin.from("quests").select("*").eq("id", quest_id).maybeSingle();
    if (!q) return json({ error: "not_found" }, 404);
    const { data: room } = await admin.from("rooms").select("hero_id, hero_name").eq("code", q.room_code).single();

    let recipient: string, title: string, body: string, flag: "notified_new" | "notified_done";
    if (type === "new") {
      if (q.from_id !== user.id || Date.now() - Date.parse(q.created_at) > FRESH_MS) return json({ skipped: true });
      const { data: giver } = await admin.from("profiles").select("name").eq("id", q.from_id).single();
      recipient = room!.hero_id;
      title = "⚔️ Yeni görev!";
      body = `${giver?.name ?? "Bir yoldaş"} sana görev verdi: ${q.title} (+${q.xp} XP)`;
      flag = "notified_new";
    } else {
      if (room!.hero_id !== user.id || !q.done || Date.now() - Date.parse(q.done_at) > FRESH_MS) return json({ skipped: true });
      recipient = q.from_id;
      title = "✦ Görev tamamlandı!";
      body = `${room!.hero_name} verdiğin görevi bitirdi: ${q.title} (+${q.xp} XP)`;
      flag = "notified_done";
    }

    // Aynı olay için tek bildirim: bayrağı ilk çeviren gönderir
    const { data: claimed } = await admin.from("quests").update({ [flag]: true }).eq("id", q.id).eq(flag, false).select("id");
    if (!claimed?.length) return json({ skipped: true, reason: "already_sent" });

    const { data: subs } = await admin.from("push_subs").select("*").eq("user_id", recipient);
    const payload = JSON.stringify({ title, body, url: "./", tag: `quest-${q.id}-${type}` });
    let sent = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subs").delete().eq("endpoint", s.endpoint); // süresi geçmiş abonelik
        else console.error("push hata", code, (e as Error).message);
      }
    }));
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
