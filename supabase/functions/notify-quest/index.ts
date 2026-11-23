// YKS Macera Defteri — Supabase Edge Function (Supabase'de adı: smooth-task)
// Uygulama bu fonksiyonu şu işler için çağırır:
//   { type: "ping" }                          → kurulum kontrolü
//   { type: "claim_code" }                    → giriş yapmış kullanıcıya benzersiz 6 haneli giriş kodu ver
//   { type: "login", name, code }             → isim soyisim + giriş kodu ile giriş
//   { type: "new",  quest_id }                → yoldaş görev astı → gezgine bildirim
//   { type: "done", quest_id }                → gezgin bitirdi    → görevi verene bildirim
// Gerekli gizli değişkenler (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ör. mailto:sen@ornek.com)
import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = () => createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonKey = (req: Request) => Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";

// ---------- web push (ilk istekte kurulur; hata olursa çökmez, nedenini söyler) ----------
// deno-lint-ignore no-explicit-any
let webpush: any = null;
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
  // Apple (iPhone) geçersiz/örnek adresli "subject"i reddediyor (403 BadJwtToken).
  // Boşluksuz, gerçek görünen bir mailto ya da sitenin https adresi kullan.
  subj = subj.replace(/\s+/g, "");
  if (subj && !/^(mailto:|https:)/.test(subj)) subj = "mailto:" + subj;
  if (!/^mailto:[^@]+@[^@]+\.[a-z]{2,}$/i.test(subj) && !/^https:\/\/\S+$/.test(subj)) subj = "";
  if (!subj || /KENDI-EPOSTAN|ornek\.com|example\.(com|org)|localhost/i.test(subj)) subj = "https://yigit1708.github.io/yks-macera/";
  try { webpush.setVapidDetails(subj, pub, priv); vapidReady = true; vapidError = null; }
  catch (e) { vapidError = "VAPID anahtarları geçersiz: " + (e as Error).message; }
}

// ---------- giriş kodu → hesap şifresi ----------
// Şifre giriş kodundan sunucuda türetilir; kod tek başına Supabase'e doğrudan giriş için yetmez.
const CODE_RE = /^[0-9]{6}$/;
const emailFor = (id: string) => `yks-${id}@example.com`;
async function passwordFor(userId: string, code: string) {
  const pepper = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "") + "|yks-login";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId + ":" + code)));
  return "Yk!" + btoa(String.fromCharCode(...sig)).replace(/[+/=]/g, "");
}
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "bilinmiyor";

async function callerOf(req: Request) {
  const c = createClient(URL_, anonKey(req), { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: { user } } = await c.auth.getUser();
  return user;
}

// Giriş yapmış kullanıcıya benzersiz giriş kodu ver ve hesabını bu koda bağla
async function claimCode(req: Request) {
  const user = await callerOf(req);
  if (!user) return json({ error: "not_authenticated" }, 401);
  const db = admin();
  const { data: code, error: ce } = await db.rpc("assign_login_code", { p_user: user.id });
  if (ce || !code) { console.error("assign_login_code", ce); return json({ error: "claim_failed", detail: ce?.message }, 500); }
  const { error } = await db.auth.admin.updateUserById(user.id, {
    email: emailFor(user.id), password: await passwordFor(user.id, code), email_confirm: true,
  });
  if (error) { console.error("claim_code", error); return json({ error: "claim_failed", detail: error.message }, 500); }
  // Şifre değişince Supabase eski oturumları kapatıyor; uygulamaya hemen yeni oturum ver.
  const anon = createClient(URL_, anonKey(req), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s } = await anon.auth.signInWithPassword({ email: emailFor(user.id), password: await passwordFor(user.id, code) });
  return json({ code, access_token: s?.session?.access_token, refresh_token: s?.session?.refresh_token });
}

const MAX_FAILS = 10, LOCK_MS = 15 * 60 * 1000;
async function login(req: Request, name: string, code: string) {
  if (!CODE_RE.test(String(code ?? "")) || !String(name ?? "").trim()) return json({ error: "bad_request" }, 400);
  const db = admin();
  const ip = ipOf(req);
  const { data: guard } = await db.from("login_guard").select("*").eq("ip", ip).maybeSingle();
  if (guard?.locked_until && Date.parse(guard.locked_until) > Date.now())
    return json({ error: "locked", until: guard.locked_until }, 429);

  const fail = async () => {
    const fails = (guard?.fails ?? 0) + 1;
    const locked = fails >= MAX_FAILS;
    await db.from("login_guard").upsert({ ip, fails: locked ? 0 : fails, locked_until: locked ? new Date(Date.now() + LOCK_MS).toISOString() : null });
    return json({ error: locked ? "locked" : "no_match" }, locked ? 429 : 401);
  };

  const { data: uid, error: fe } = await db.rpc("find_by_login", { p_code: code, p_name: name });
  if (fe) { console.error("find_by_login", fe); return json({ error: "server_error" }, 500); }
  if (!uid) return await fail();

  const anon = createClient(URL_, anonKey(req), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: emailFor(uid), password: await passwordFor(uid, code) });
  if (error || !data.session) { console.error("login", error?.message); return await fail(); }
  await db.from("login_guard").delete().eq("ip", ip);
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}

// ---------- bildirimler ----------
const FRESH_MS = 10 * 60 * 1000; // sadece son 10 dakikadaki olaylar için bildirim
async function notify(req: Request, type: string, quest_id: string) {
  await setupVapid();
  if (vapidError) return json({ error: vapidError }, 500);
  const user = await callerOf(req);
  if (!user) return json({ error: "not_authenticated" }, 401);
  if (typeof quest_id !== "string") return json({ error: "bad_request" }, 400);

  const db = admin();
  const { data: q } = await db.from("quests").select("*").eq("id", quest_id).maybeSingle();
  if (!q) return json({ error: "not_found" }, 404);
  const { data: room } = await db.from("rooms").select("hero_id, hero_name").eq("code", q.room_code).single();

  let recipient: string, title: string, body: string, flag: "notified_new" | "notified_done";
  if (type === "new") {
    if (q.from_id !== user.id || Date.now() - Date.parse(q.created_at) > FRESH_MS) return json({ skipped: true });
    const { data: giver } = await db.from("profiles").select("name").eq("id", q.from_id).single();
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
  const { data: claimed } = await db.from("quests").update({ [flag]: true }).eq("id", q.id).eq(flag, false).select("id");
  if (!claimed?.length) return json({ skipped: true, reason: "already_sent" });

  return json(await pushTo(db, recipient, { title, body, url: "./", tag: `quest-${q.id}-${type}` }));
}

// Bir kişinin bütün telefonlarına bildirim gönder
// deno-lint-ignore no-explicit-any
async function pushTo(db: any, recipient: string, msg: Record<string, unknown>) {
  const { data: subs } = await db.from("push_subs").select("*").eq("user_id", recipient);
  const payload = JSON.stringify(msg);
  let sent = 0;
  const failed: { service: string; status?: number; reason: string }[] = [];
  // deno-lint-ignore no-explicit-any
  await Promise.all((subs ?? []).map(async (s: any) => {
    const service = s.endpoint.includes("apple.com") ? "apple" : s.endpoint.includes("google") ? "google" : new URL(s.endpoint).host;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: "high" });
      sent++;
    } catch (e) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      if (err.statusCode === 404 || err.statusCode === 410) { await db.from("push_subs").delete().eq("endpoint", s.endpoint); return; } // süresi geçmiş abonelik
      const reason = String(err.body || err.message || "").slice(0, 160);
      console.error("push hata", service, err.statusCode, reason);
      failed.push({ service, status: err.statusCode, reason });
    }
  }));
  return { sent, devices: subs?.length ?? 0, failed };
}

// Yoldaş, bitmemiş bir görev için gezgine "hadi yap" hatırlatması gönderir
const REMIND_GAP_MS = 5 * 60 * 1000;
const lastRemind = new Map<string, number>(); // aynı kişi aynı görev için 5 dakikada bir
async function remind(req: Request, quest_id: string) {
  await setupVapid();
  if (vapidError) return json({ error: vapidError }, 500);
  const user = await callerOf(req);
  if (!user) return json({ error: "not_authenticated" }, 401);
  if (typeof quest_id !== "string") return json({ error: "bad_request" }, 400);

  const db = admin();
  const { data: q } = await db.from("quests").select("*").eq("id", quest_id).maybeSingle();
  if (!q) return json({ error: "not_found" }, 404);
  if (q.done) return json({ error: "already_done" }, 409);
  const { data: room } = await db.from("rooms").select("hero_id, hero_name").eq("code", q.room_code).single();
  if (room!.hero_id === user.id) return json({ error: "hero_cannot_remind" }, 403);
  const { data: mem } = await db.from("members").select("user_id").eq("room_code", q.room_code).eq("user_id", user.id).maybeSingle();
  if (!mem) return json({ error: "not_member" }, 403);

  const key = user.id + ":" + q.id;
  const last = lastRemind.get(key) ?? 0;
  if (Date.now() - last < REMIND_GAP_MS) return json({ error: "too_soon", wait_s: Math.ceil((REMIND_GAP_MS - (Date.now() - last)) / 1000) }, 429);
  lastRemind.set(key, Date.now());

  const { data: me } = await db.from("profiles").select("name").eq("id", user.id).single();
  return json(await pushTo(db, room!.hero_id, {
    title: "🔔 Hatırlatma!",
    body: `${me?.name ?? "Bir yoldaş"} dürtüyor: "${q.title}" görevi seni bekliyor (+${q.xp} XP) ⚔️`,
    url: "./",
    tag: `remind-${q.id}`,
  }));
}

// ---------- giriş noktası ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    switch (b?.type) {
      case "ping": {
        await setupVapid();
        let dbs = "hazır";
        try { const { error } = await admin().from("login_guard").select("ip", { count: "exact", head: true }); if (error) dbs = error.message; }
        catch (e) { dbs = (e as Error).message; }
        return json({ ok: !vapidError && dbs === "hazır", vapid: vapidError ?? "hazır", db: dbs });
      }
      case "claim_code": return await claimCode(req);
      case "login":      return await login(req, b.name, b.code);
      case "new":
      case "done":    return await notify(req, b.type, b.quest_id);
      case "remind":  return await remind(req, b.quest_id);
      default:        return json({ error: "bad_request" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
