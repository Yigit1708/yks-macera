// YKS Macera Defteri — telefon (PWA) sürümü, Supabase ile
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, NOTIFY_FUNCTION } from "./config.js";

/* ---------- sabitler ---------- */
const ELEMENTS = {
  pyro:{n:"Pyro",c:"#ef7a3a"}, hydro:{n:"Hydro",c:"#4cc2f1"}, anemo:{n:"Anemo",c:"#74d2b4"},
  electro:{n:"Electro",c:"#b48ef5"}, dendro:{n:"Dendro",c:"#a8cc3c"}, cryo:{n:"Cryo",c:"#a6e0ee"},
  geo:{n:"Geo",c:"#f0b232"}, abyss:{n:"Abyss",c:"#e0507f"}, all:{n:"Yedi Element",c:"#ffffff"},
};
const SUBJECTS = [
  {id:"turkce",name:"Türkçe",el:"anemo"}, {id:"mat",name:"Matematik",el:"abyss"}, {id:"geo",name:"Geometri",el:"cryo"},
  {id:"fizik",name:"Fizik",el:"electro"}, {id:"kimya",name:"Kimya",el:"pyro"}, {id:"biyo",name:"Biyoloji",el:"dendro"},
  {id:"tarih",name:"Tarih",el:"pyro"}, {id:"cog",name:"Coğrafya",el:"hydro"}, {id:"felsefe",name:"Felsefe",el:"anemo"},
  {id:"din",name:"Din Kültürü",el:"geo"}, {id:"deneme",name:"Deneme",el:"all"},
];
const CHOOSABLE = ["pyro","hydro","anemo","electro","dendro","cryo","geo","abyss"];
const MASKED = ["pyro","hydro","anemo","electro","dendro","cryo","geo"];
const TIERS = {gunluk:{n:"Günlük",xp:20}, hikaye:{n:"Hikâye",xp:50}, efsane:{n:"Efsanevi",xp:120}};
const MILESTONES = [{xp:0,n:"Başlangıç Köyü"},{xp:600,n:"TYT Ormanı"},{xp:1600,n:"AYT Dağları"},{xp:3200,n:"Deneme Kalesi"},{xp:5500,n:"Üniversite Kapısı"}];
const GOAL = MILESTONES[MILESTONES.length-1].xp;

const $ = (id) => document.getElementById(id);
const icon = (el) => MASKED.includes(el) ? `<i class="elm m-${el}" aria-hidden="true"></i>` : `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#el-${el}"/></svg>`;
const fmtCode = (c) => c ? c.slice(0,3)+" "+c.slice(3) : "------";
const ts = (iso) => iso ? Date.parse(iso) : 0;
const store = { get(k){ try{return localStorage.getItem(k);}catch{return null;} }, set(k,v){ try{localStorage.setItem(k,v);}catch{} } };

/* ---------- durum ---------- */
let sb = null, me = null, myName = null;
let memberships = [];             // [{room_code, role, hero_name}]
const state = { code:null, room:null, quests:[], members:{}, filter:"open", loaded:false };
let channel = null, openPicker = null;
const isHero = () => !!(state.room && me && state.room.hero_id === me);

const subj = (id) => {
  const b = SUBJECTS.find((s) => s.id === id) || SUBJECTS[0];
  const o = state.room?.elements?.[b.id];
  const el = (b.id !== "deneme" && CHOOSABLE.includes(o)) ? o : b.el;
  return { ...b, el, c:ELEMENTS[el].c, eln:ELEMENTS[el].n };
};

/* ---------- pixel yer tutucu ---------- */
const SPRITE=["....HHHH....","...HHHHHH...","..HHSSSSHH..","..HSESSESH..","..HSSSSSSH..","...SSPPSS...","....SSSS....","..GCCCCCCG..",".SCCCYYCCCS.",".S.CCCCCC.S.","...CCCCCC...","...LL..LL...","...LL..LL...","..BBB..BBB.."];
const PAL={H:"#3b2a20",S:"#f2c9a0",E:"#1b1b2e",P:"#e08a8a",C:"#4a6fd1",Y:"#e8c675",G:"#e8c675",L:"#2c3560",B:"#5a3b24"};
function spriteCanvas(){ const c=document.createElement("canvas"); c.width=12; c.height=14; const x=c.getContext("2d");
  SPRITE.forEach((r,y)=>[...r].forEach((ch,i)=>{ if(PAL[ch]){ x.fillStyle=PAL[ch]; x.fillRect(i,y,1,1); } })); return c; }
const avatarUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
function avatarEl(i=0){ const list=state.room?.avatars||[];
  if(list.length){ const img=new Image(); img.alt=""; img.src=avatarUrl(list[i%list.length]); img.onerror=()=>img.replaceWith(spriteCanvas()); return img; }
  return spriteCanvas(); }

/* ---------- yardımcılar ---------- */
function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.append(t); setTimeout(()=>t.remove(),Math.max(3000,msg.length*70)); }
async function copyText(txt){ try{ await navigator.clipboard.writeText(txt); toast("Kod kopyalandı: "+fmtCode(txt)); }catch{ toast("Kopyalanamadı. Kodu elle yaz: "+fmtCode(txt)); } }
function fmtDate(t){ try{ return new Date(t).toLocaleDateString("tr-TR",{day:"numeric",month:"short"}); }catch{ return ""; } }
const initials = (n) => (n||"?").trim().split(/\s+/).map((w)=>w[0]).slice(0,2).join("").toLocaleUpperCase("tr-TR");
const nameOf = (id) => state.members[id]?.name || "Bir yoldaş";
// Sunucu fonksiyonunu çağır: { status, data }
async function callFn(body){
  const { data:{ session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${NOTIFY_FUNCTION}`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", apikey:SUPABASE_ANON_KEY, Authorization:"Bearer "+(session?.access_token||SUPABASE_ANON_KEY) },
    body:JSON.stringify(body),
  });
  let data=null; try{ data=await res.json(); }catch{}
  return { status:res.status, data };
}
const notify = (type, quest_id) => callFn({ type, quest_id }).catch(()=>null);
let myLoginCode = null;
async function claimCode(){
  const { status, data } = await callFn({ type:"claim_code" });
  if(status!==200 || !data?.code) throw new Error("claim_failed: "+(data?.detail||data?.error||status));
  if(data.access_token) await sb.auth.setSession({ access_token:data.access_token, refresh_token:data.refresh_token });
  myLoginCode=data.code; return data.code;
}
// Oturum sunucuda kapanmışsa (ör. eski sürümde kod alınırken) yerelde temizle ve girişe yönlendir
async function sessionExpired(){
  try{ await sb.auth.signOut({ scope:"local" }); }catch{}
  me=null; myName=null; myLoginCode=null;
  if(channel){ sb.removeChannel(channel); channel=null; }
  $("app").hidden=true; $("gate").hidden=false; $("codeScreen").hidden=true; $("welcomeForm").hidden=true;
  $("gateStatus").hidden=false; $("gateStatus").textContent="Oturumunun yenilenmesi gerekiyor. İsim soyisim ve giriş kodunla tekrar gir.";
  $("loginForm").hidden=false; $("loginErr").textContent="";
}

/* ---------- giriş kapısı ---------- */
let role = null;
function pick(r){ role=r; $("pickHero").setAttribute("aria-pressed",r==="hero"); $("pickHelper").setAttribute("aria-pressed",r==="helper");
  $("codeLabel").hidden=r!=="helper"; if(r==="helper") $("codeIn").focus(); $("welcomeErr").textContent=""; }
$("pickHero").onclick=()=>pick("hero"); $("pickHelper").onclick=()=>pick("helper");
document.querySelectorAll(".codein").forEach((i)=>i.addEventListener("input",()=>{ i.value=i.value.replace(/\D/g,"").slice(0,6); }));

async function ensureAccount(name){
  if(!me){
    const { data, error } = await sb.auth.signInAnonymously();
    if(error) throw error;
    me = data.user.id;
  }
  const { error } = await sb.from("profiles").upsert({ id:me, name });
  if(error) throw error;
  myName = name;
}

$("welcomeForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const name=$("nameIn").value.trim().replace(/\s+/g," ");
  if(name.split(" ").length<2){ $("welcomeErr").textContent="İsmini ve soyismini birlikte yaz."; return; }
  if(!role){ $("welcomeErr").textContent="Gezgin mi olacaksın, yoksa arkadaşına mı yardım edeceksin? Birini seç."; return; }
  if(role==="helper" && !/^\d{6}$/.test($("codeIn").value)){ $("welcomeErr").textContent="Geçit kodu 6 haneli bir sayı olmalı."; return; }
  $("welcomeBtn").disabled=true; $("welcomeErr").textContent="";
  try{
    await ensureAccount(name);
    if(role==="hero"){
      const { data:code, error } = await sb.rpc("create_room"); if(error) throw error;
      const login = myLoginCode || await claimCode();
      await loadMemberships(); showCodes(login, code);
    } else {
      const err = await joinRoom($("codeIn").value);
      if(err){ $("welcomeErr").textContent=err; }
      else { const login = myLoginCode || await claimCode(); showCodes(login, null); }
    }
  }catch(err){
    console.error(err);
    const m=err?.message||"";
    $("welcomeErr").textContent = /anonymous/i.test(m) ? "Supabase'de anonim girişler kapalı. KURULUM.md'deki 2. adıma bak."
      : /claim_failed/.test(m) ? "Giriş kodu alınamadı. Biraz sonra tekrar dene."
      : "Kaydedilemedi. İnternet bağlantını kontrol edip tekrar dene.";
  }
  $("welcomeBtn").disabled=false;
});

async function joinRoom(raw){
  const code=String(raw||"").replace(/\D/g,"");
  if(!/^\d{6}$/.test(code)) return "Geçit kodu 6 haneli bir sayı olmalı.";
  const { data, error } = await sb.rpc("join_room", { p_code:code });
  if(error) throw error;
  if(!data) return "Bu kodla bir macera bulunamadı. Kodu arkadaşına tekrar sor.";
  await loadMemberships();
  await enterRoom(code);
  return null;
}
function showCodes(login, room){
  $("welcomeForm").hidden=true; $("loginForm").hidden=true; $("gateStatus").hidden=true;
  $("bigLogin").textContent=fmtCode(login); $("copyLogin").onclick=()=>copyText(login);
  $("roomCodeCard").hidden=!room;
  if(room){ $("bigCode").textContent=fmtCode(room); $("copyBig").onclick=()=>copyText(room); }
  $("codeScreen").hidden=false;
  $("startBtn").onclick=async()=>{ if(room) await enterRoom(room); showApp(); };
}

/* ---------- giriş (isim soyisim + giriş kodu) ---------- */
$("toLogin").onclick=()=>{ $("welcomeForm").hidden=true; $("loginForm").hidden=false; $("loginErr").textContent=""; $("loginName").focus(); };
$("toWelcome").onclick=()=>{ $("loginForm").hidden=true; $("welcomeForm").hidden=false; };
$("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const name=$("loginName").value.trim().replace(/\s+/g," "), code=$("loginCode").value;
  if(name.split(" ").length<2){ $("loginErr").textContent="İsmini ve soyismini birlikte yaz."; return; }
  if(!/^\d{6}$/.test(code)){ $("loginErr").textContent="Giriş kodu 6 haneli bir sayı olmalı."; return; }
  $("loginBtn").disabled=true; $("loginErr").textContent="";
  try{
    const { status, data } = await callFn({ type:"login", name, code });
    if(status===200 && data?.access_token){
      await sb.auth.setSession({ access_token:data.access_token, refresh_token:data.refresh_token });
      $("loginForm").hidden=true; $("gateStatus").hidden=false; $("gateStatus").textContent="Defter açılıyor…";
      await startFromSession();
    } else if(data?.error==="locked"){
      $("loginErr").textContent="Çok fazla yanlış deneme oldu. 15 dakika sonra tekrar dene.";
    } else {
      $("loginErr").textContent="İsim soyisim ya da giriş kodu yanlış. Kaydolurken yazdığın ismi aynen yaz.";
    }
  }catch(err){ console.error(err); $("loginErr").textContent="Bağlanılamadı. İnternet bağlantını kontrol et."; }
  $("loginBtn").disabled=false;
});

/* ---------- giriş kodu hatırlatma, çıkış ---------- */
$("claimBtn").onclick=async()=>{ $("claimBtn").disabled=true; $("codeErr").textContent="";
  try{ const c=await claimCode(); $("myLoginCode").textContent=fmtCode(c); $("codeBannerAsk").hidden=true; $("codeBannerShow").hidden=false; renderTop(); }
  catch{ $("codeErr").textContent="Giriş kodu alınamadı. Biraz sonra tekrar dene."; }
  $("claimBtn").disabled=false; };
$("codeBannerClose").onclick=()=>{ $("codeBanner").hidden=true; };
$("myCodeBtn").onclick=()=>{ if(!myLoginCode) return; $("myLoginCode").textContent=fmtCode(myLoginCode);
  $("codeBannerAsk").hidden=true; $("codeBannerShow").hidden=false; $("codeBanner").hidden=!$("codeBanner").hidden; };
$("logoutBtn").onclick=async()=>{
  if($("logoutBtn").dataset.sure!=="1"){ $("logoutBtn").dataset.sure="1"; $("logoutBtn").textContent="Emin misin? Kodun: "+fmtCode(myLoginCode);
    setTimeout(()=>{ $("logoutBtn").dataset.sure=""; $("logoutBtn").textContent="Çıkış"; },4000); return; }
  try{ const reg=await navigator.serviceWorker?.ready; const sub=await reg?.pushManager?.getSubscription();
    if(sub){ await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } }catch{}
  await sb.auth.signOut(); store.set("yks-current",""); location.reload();
};
function showApp(){ $("gate").hidden=true; $("app").hidden=false; renderTop(); render(); setupInstall(); setupBell(); }

/* ---------- maceralar ---------- */
async function loadMemberships(){
  const { data, error } = await sb.from("members").select("room_code, role, rooms(hero_name)").eq("user_id", me);
  if(error) throw error;
  memberships = (data||[]).map((m)=>({ room_code:m.room_code, role:m.role, hero_name:m.rooms?.hero_name||"Gezgin" }));
}
async function refreshRoom(){ const { data } = await sb.from("rooms").select("*").eq("code", state.code).maybeSingle(); state.room=data; renderTop(); render(); }
async function refreshQuests(){
  const { data, error } = await sb.from("quests").select("*").eq("room_code", state.code);
  if(error){ $("status").hidden=false; $("status").textContent="Görevler okunamadı. İnternet bağlantını kontrol et."; return; }
  state.quests=data||[]; state.loaded=true; render();
}
async function refreshMembers(){
  const { data } = await sb.from("members").select("user_id, role, joined_at, profiles(name)").eq("room_code", state.code);
  const m={}; (data||[]).forEach((r)=>{ m[r.user_id]={ name:r.profiles?.name, role:r.role, joinedAt:ts(r.joined_at) }; });
  state.members=m; render();
}
const refreshAll = () => state.code && Promise.all([refreshRoom(), refreshQuests(), refreshMembers()]);

async function enterRoom(code){
  if(channel){ sb.removeChannel(channel); channel=null; }
  Object.assign(state, { code, room:null, quests:[], members:{}, loaded:false });
  store.set("yks-current", code);
  $("status").hidden=false; $("status").textContent="Görevler yükleniyor…";
  await refreshAll();
  const f = (table, col) => ({ event:"*", schema:"public", table, filter:`${col}=eq.${code}` });
  channel = sb.channel("room-"+code)
    .on("postgres_changes", f("quests","room_code"), refreshQuests)
    .on("postgres_changes", f("members","room_code"), refreshMembers)
    .on("postgres_changes", f("rooms","code"), refreshRoom)
    .subscribe();
}
// Uygulamaya geri dönünce ve dakikada bir tazele (silinen görevler canlı yayında gelmez)
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) refreshAll(); });
setInterval(()=>{ if(!document.hidden) refreshAll(); }, 60000);

$("roomSel").addEventListener("change", async (e)=>{ await enterRoom(e.target.value); renderTop(); });
$("joinToggle").onclick=()=>{ $("joinForm").hidden=!$("joinForm").hidden; if(!$("joinForm").hidden) $("joinCode").focus(); };
$("joinForm").addEventListener("submit", async (e)=>{ e.preventDefault(); $("joinErr").textContent="";
  try{ const err=await joinRoom($("joinCode").value); if(err){ $("joinErr").textContent=err; return; }
    $("joinCode").value=""; $("joinForm").hidden=true; renderTop(); toast("Maceraya katıldın ✦"); }
  catch{ $("joinErr").textContent="Katılamadın. Tekrar dene."; } });
$("ownStart").onclick=async()=>{ $("ownStart").disabled=true;
  try{ const { data:code, error } = await sb.rpc("create_room"); if(error) throw error;
    await loadMemberships(); await enterRoom(code); renderTop(); toast("Kendi maceran başladı. Kodun: "+fmtCode(code)); }
  catch{ toast("Macera başlatılamadı."); }
  $("ownStart").disabled=false; };
$("copyCode").onclick=()=>state.code && copyText(state.code);

/* ---------- çizim ---------- */
function stats(){
  const done=state.quests.filter((q)=>q.done); const xp=done.reduce((a,q)=>a+(q.xp||0),0);
  const per={}; SUBJECTS.forEach((s)=>per[s.id]={xp:0,done:0,open:0});
  state.quests.forEach((q)=>{ const p=per[q.subject]; if(!p) return; if(q.done){ p.xp+=q.xp||0; p.done++; } else p.open++; });
  return { xp, ar:Math.floor(xp/100)+1, per, done };
}
function renderTop(){
  if(!myName) return;
  $("meName").textContent=myName;
  $("meRole").textContent=isHero()?"GEZGİN":"YOLDAŞ"; $("meRole").className="chip"+(isHero()?"":" helper");
  const sel=$("roomSel");
  sel.replaceChildren(...memberships.map((m)=>{ const o=document.createElement("option"); o.value=m.room_code;
    o.textContent=(m.role==="hero"?"Kendi maceram":m.hero_name)+" · "+fmtCode(m.room_code); return o; }));
  sel.value=state.code||""; sel.hidden=memberships.length<2;
  $("ownStart").hidden=memberships.some((m)=>m.role==="hero");
  $("myCodeBtn").hidden=!myLoginCode; $("logoutBtn").hidden=!myLoginCode;
  if(!myLoginCode && $("codeBannerShow").hidden) $("codeBanner").hidden=false;
}
function renderHero(){
  const s=stats(); const r=state.room||{};
  $("heroName").textContent=r.hero_name||"Gezgin";
  $("ar").textContent="AR "+s.ar;
  $("xpfill").style.width=(s.xp%100)+"%";
  $("xptext").textContent=`${s.xp%100} / 100 XP · toplam ${s.xp}`;
  $("roomCode").textContent=fmtCode(state.code); $("noteCode").textContent=fmtCode(state.code);
  $("portrait").replaceChildren(avatarEl(0));
  // Zikzak patika: duraklar eşit aralıkla, sırayla yukarı/aşağı; yazılar hep durağın altında
  const t=$("trail"); t.replaceChildren();
  const n=MILESTONES.length;
  const pts=MILESTONES.map((m,i)=>({ x:8+i*(84/(n-1)), y:i%2===0?40:72 }));
  let k=0; while(k<n-2 && s.xp>=MILESTONES[k+1].xp) k++;
  const span=MILESTONES[k+1].xp-MILESTONES[k].xp;
  const f=Math.max(0,Math.min(1,(s.xp-MILESTONES[k].xp)/span));
  const me_={ x:pts[k].x+(pts[k+1].x-pts[k].x)*f, y:pts[k].y+(pts[k+1].y-pts[k].y)*f };
  const walked=[...pts.slice(0,k+1), me_].map((p)=>`${p.x},${p.y}`).join(" ");
  t.insertAdjacentHTML("beforeend",`<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.map((p)=>`${p.x},${p.y}`).join(" ")}" fill="none" stroke="#3a4777" stroke-width="4" stroke-dasharray="3 4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <polyline points="${walked}" fill="none" stroke="#e8c675" stroke-width="4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`);
  MILESTONES.forEach((m,i)=>{ const d=document.createElement("div"); d.className="milestone"+(s.xp>=m.xp?" reached":"");
    d.style.left=pts[i].x+"%"; d.style.top=pts[i].y+"%"; d.innerHTML="<b></b>";
    const l=document.createElement("span"); l.className="ms-label"; l.textContent=m.n; d.append(l); t.append(d); });
  const w=document.createElement("div"); w.className="walker"; w.style.left=me_.x+"%"; w.style.top=me_.y+"%"; w.title=`${s.xp} / ${GOAL} XP`;
  const inner=document.createElement("div"); inner.append(avatarEl(0)); w.append(inner); t.append(w);
}
function renderQuests(){
  const hero=isHero();
  $("assignPanel").hidden=hero; $("heroNote").hidden=!hero;
  const box=$("quests"); box.replaceChildren();
  if(!state.loaded) return;
  $("status").hidden=true;
  const list=state.quests.filter((q)=>state.filter==="done"?q.done:!q.done)
    .sort((a,b)=> state.filter==="done" ? ts(b.done_at)-ts(a.done_at) : ts(a.created_at)-ts(b.created_at));
  if(!list.length){
    const e=document.createElement("div"); e.className="empty";
    e.textContent = state.filter==="done" ? "Henüz tamamlanan görev yok. İlk sandık bekliyor!"
      : hero ? "Pano boş. Yoldaşların görev astığında burada belirecek." : "Pano boş. Formdan ilk görevi as, macera başlasın.";
    box.append(e); return;
  }
  list.forEach((q)=>{
    const s=subj(q.subject), tier=TIERS[q.tier]||TIERS.gunluk;
    const el=document.createElement("article"); el.className="quest"+(q.done?" done":""); el.style.setProperty("--c",s.c);
    const ico=document.createElement("div"); ico.className="ico"; ico.innerHTML=icon(s.el); ico.title=s.eln;
    const mid=document.createElement("div"); mid.style.minWidth="0";
    const h=document.createElement("h3"); h.textContent=q.title||"Gizemli görev";
    const meta=document.createElement("div"); meta.className="meta";
    [`${tier.n} · +${q.xp} XP`, s.name, (q.done?"✓ "+fmtDate(ts(q.done_at))+" · ":"")+"veren: "+nameOf(q.from_id)]
      .forEach((txt,i)=>{ const sp=document.createElement("span"); if(i===0) sp.className="tier"; sp.textContent=txt; meta.append(sp); });
    mid.append(h,meta);
    const act=document.createElement("div"); act.className="q-actions";
    if(!q.done && hero){ const b=document.createElement("button"); b.className="btn small"; b.type="button"; b.textContent="Tamamla"; b.onclick=()=>complete(q,b); act.append(b); }
    if(q.from_id===me){ const x=document.createElement("button"); x.className="x"; x.type="button"; x.title="Görevi sil"; x.setAttribute("aria-label","Görevi sil"); x.textContent="×"; x.onclick=()=>removeQuest(q,x); act.append(x); }
    el.append(ico,mid,act); box.append(el);
  });
}
function renderMembers(){
  const box=$("members"); box.replaceChildren();
  const list=Object.entries(state.members).sort((a,b)=>((a[1].role==="hero")?-1:0)-((b[1].role==="hero")?-1:0)||a[1].joinedAt-b[1].joinedAt);
  const given={}; state.quests.forEach((q)=>{ given[q.from_id]=(given[q.from_id]||0)+1; });
  list.forEach(([id,m])=>{
    const d=document.createElement("div"); d.className="member"+(m.role==="hero"?" hero":"");
    const av=document.createElement("span"); av.className="av"; av.textContent=initials(m.name);
    const n=document.createElement("span"); n.textContent=(m.name||"Bir yoldaş")+(id===me?" (sen)":"");
    const sm=document.createElement("small"); sm.textContent=m.role==="hero"?"Gezgin":`${given[id]||0} görev verdi`;
    d.append(av,n,sm); box.append(d);
  });
  if(list.length<2){ const e=document.createElement("div"); e.className="muted"; e.style.fontSize="14px"; e.textContent="Henüz yoldaş yok. Geçit kodunu paylaşınca katılanlar burada görünür."; box.append(e); }
}
function renderSkills(){
  const s=stats(); const box=$("skills"); box.replaceChildren();
  const canSwap=isHero();
  SUBJECTS.map((x)=>subj(x.id)).forEach((sb_,idx)=>{
    const p=s.per[sb_.id]; const lv=Math.floor(p.xp/150)+1; const cur=p.xp%150;
    const d=document.createElement("article"); d.className="scard"; d.style.setProperty("--c",sb_.c);
    let seed=(idx+1)*9301; const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
    let sky=`<div class="sc-sky"><div class="sc-mark">${icon(sb_.el)}</div>`;
    for(let i=0;i<7;i++){ const sz=(i<2?14:7)+Math.round(rnd()*6); const col=["#ffffff","#fff1c4",sb_.c][i%3];
      sky+=`<i class="sc-star" style="left:${(30+rnd()*66).toFixed(1)}%;top:${(6+rnd()*80).toFixed(1)}%;--s:${sz}px;--sc:${col};--d:${(2.4+rnd()*2.6).toFixed(2)}s;--dl:${(-rnd()*4).toFixed(2)}s"></i>`; }
    for(let i=0;i<14;i++) sky+=`<i class="sc-dot" style="left:${(26+rnd()*72).toFixed(1)}%;top:${(4+rnd()*90).toFixed(1)}%;opacity:${(.2+rnd()*.5).toFixed(2)}"></i>`;
    sky+=`</div><span class="sc-ornament" aria-hidden="true">✦</span>`;
    d.innerHTML=sky+`<div class="sc-icon">${icon(sb_.el)}</div><div class="sc-head"><span class="sc-el"></span><h3 class="sc-name"></h3></div>
      <div class="sc-foot"><div class="sc-row"><span class="sc-lv">Lv.${lv}</span><span class="sc-xp">${cur} / 150 XP</span></div>
      <div class="sc-bar"><i style="width:${cur/150*100}%"></i></div><div class="sc-count"></div></div>`;
    d.querySelector(".sc-el").textContent=sb_.eln; d.querySelector(".sc-name").textContent=sb_.name;
    d.querySelector(".sc-count").textContent=`${p.done} görev bitti${p.open?` · ${p.open} bekliyor`:""}`;
    if(canSwap && sb_.id!=="deneme"){
      const b=document.createElement("button"); b.type="button"; b.className="sc-swap"; b.textContent="⟳ Element";
      b.setAttribute("aria-expanded",openPicker===sb_.id); b.setAttribute("aria-label",sb_.name+" dersinin elementini değiştir");
      b.onclick=()=>{ openPicker=openPicker===sb_.id?null:sb_.id; renderSkills(); };
      d.append(b);
      if(openPicker===sb_.id){
        const pk=document.createElement("div"); pk.className="sc-pick"; pk.setAttribute("role","group"); pk.setAttribute("aria-label","Element seç");
        CHOOSABLE.forEach((el)=>{ const o=document.createElement("button"); o.type="button"; o.className="sc-opt"+(el===sb_.el?" on":"");
          o.style.setProperty("--c",ELEMENTS[el].c); o.title=ELEMENTS[el].n; o.setAttribute("aria-label",ELEMENTS[el].n); o.setAttribute("aria-pressed",el===sb_.el);
          o.innerHTML=icon(el); o.onclick=()=>setElement(sb_.id,el); pk.append(o); });
        d.append(pk);
      }
    }
    box.append(d);
  });
}
function renderLog(){
  const box=$("log"); box.replaceChildren();
  const recent=stats().done.sort((a,b)=>ts(b.done_at)-ts(a.done_at)).slice(0,6);
  if(!recent.length){ box.textContent="Tamamlanan görevler burada bir günlük gibi birikir."; return; }
  recent.forEach((q)=>{ const d=document.createElement("div"); const b=document.createElement("b"); b.textContent=q.title;
    d.append(fmtDate(ts(q.done_at))+" · ",b,` · +${q.xp} XP (${subj(q.subject).name})`); box.append(d); });
}
function fillSubjects(){ const sel=$("qSubject"), v=sel.value;
  sel.innerHTML=SUBJECTS.map((x)=>{ const s=subj(x.id); return `<option value="${s.id}">${s.name} (${s.eln})</option>`; }).join("");
  if(v) sel.value=v; }
function render(){ if(!state.code) return; fillSubjects(); renderHero(); renderQuests(); renderMembers(); renderSkills(); renderLog(); }

/* ---------- eylemler ---------- */
$("addForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  if(isHero()){ toast("Gezginler kendine görev veremez."); return; }
  const title=$("qTitle").value.trim(); if(!title) return;
  const tier=document.querySelector('input[name="tier"]:checked').value;
  $("addBtn").disabled=true;
  const { data, error } = await sb.from("quests").insert({ room_code:state.code, title, subject:$("qSubject").value, tier, xp:TIERS[tier].xp, from_id:me }).select("id").single();
  if(error){ toast("Görev eklenemedi, tekrar dene."); }
  else { $("qTitle").value=""; toast("Görev panoya asıldı ✦"); refreshQuests();
    notify("new", data.id).then((r)=>{
      if(r?.data?.sent>0) toast(`🔔 ${state.room?.hero_name||"Arkadaşına"} bildirim gitti`);
      else if(r?.data?.failed?.length){ const f=r.data.failed[0]; toast(`⚠️ Bildirim ${f.service==="apple"?"Apple (iPhone)":f.service} tarafından reddedildi: ${f.status||""} ${f.reason||""}`); }
      else if(r?.data?.sent===0) toast(`🔕 ${state.room?.hero_name||"Arkadaşın"} bildirimleri açmamış. Uygulamada 🔔 Bildirimleri aç'a dokunmasını söyle.`);
      else if(r?.status===401){ toast("Oturumun yenilenmeli. İsim soyisim ve giriş kodunla tekrar gir."); setTimeout(sessionExpired,1500); }
      else if(r && r.status!==200) toast("Bildirim gönderilemedi ("+(r.data?.error||r.status)+").");
    }); }
  $("addBtn").disabled=false;
});
async function complete(q,btn){
  if(!isHero()) return;
  btn.disabled=true; const before=stats().ar;
  const { error } = await sb.rpc("complete_quest", { p_id:q.id });
  if(error){ btn.disabled=false; toast("Görev kaydedilemedi, tekrar dene."); return; }
  q.done=true; q.done_at=new Date().toISOString(); const after=stats().ar;
  celebrate(q, after>before?after:0);
  notify("done", q.id).then((r)=>{ if(r?.data?.sent===0) setTimeout(()=>toast("🔕 Görevi veren kişi bildirimleri açmamış, ona haber gitmedi."),2500); });
  render();
}
const pendingDelete=new Set();
async function removeQuest(q,btn){
  if(!pendingDelete.has(q.id)){ pendingDelete.add(q.id); btn.textContent="Sil?"; btn.style.opacity=1; btn.style.fontSize="14px";
    setTimeout(()=>{ pendingDelete.delete(q.id); if(btn.isConnected){ btn.textContent="×"; btn.style.opacity=""; btn.style.fontSize=""; } },3000); return; }
  const { error } = await sb.from("quests").delete().eq("id", q.id);
  if(error) toast("Silinemedi."); else refreshQuests();
}
async function setElement(id, el){
  if(!isHero() || id==="deneme") return;
  openPicker=null;
  const { error } = await sb.rpc("set_element", { p_code:state.code, p_subject:id, p_el:el });
  if(error){ toast("Element değiştirilemedi."); renderSkills(); return; }
  toast(`${subj(id).name} artık ${ELEMENTS[el].n} ✦`); refreshRoom();
}
document.querySelectorAll(".tab").forEach((b)=>b.onclick=()=>{ state.filter=b.dataset.f;
  document.querySelectorAll(".tab").forEach((o)=>o.setAttribute("aria-pressed",o===b?"true":"false")); renderQuests(); });
$("avatarInput").addEventListener("change", async (e)=>{
  const files=[...e.target.files]; if(!files.length || !state.code) return;
  toast("Pixel art yükleniyor…"); let ok=0;
  for(const f of files){
    if(f.size>2*1024*1024){ toast(f.name+" 2 MB'tan büyük."); continue; }
    const ext=(f.type.split("/")[1]||"png").replace("jpeg","jpg");
    const path=`${state.code}/${crypto.randomUUID()}.${ext}`;
    const up=await sb.storage.from("avatars").upload(path, f, { contentType:f.type });
    if(up.error){ toast("Bir resim yüklenemedi."); continue; }
    const { error } = await sb.rpc("add_avatar", { p_code:state.code, p_path:path });
    if(!error) ok++;
  }
  if(ok){ toast("Pixel art eklendi ✦"); refreshRoom(); }
  e.target.value="";
});

/* ---------- kutlama ---------- */
function chime(){ try{ const ac=new (window.AudioContext||window.webkitAudioContext)();
  [659,784,988,1319].forEach((f,i)=>{ const o=ac.createOscillator(), g=ac.createGain(); o.type="square"; o.frequency.value=f; const t=ac.currentTime+i*.11;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.08,t+.02); g.gain.exponentialRampToValueAtTime(.001,t+.5); o.connect(g).connect(ac.destination); o.start(t); o.stop(t+.55); }); }catch{} }
function celebrate(q,newAr){
  chime(); try{ navigator.vibrate?.([60,40,120]); }catch{}
  const pop=document.createElement("div"); pop.className="pop"; pop.setAttribute("role","dialog"); pop.setAttribute("aria-label","Görev tamamlandı");
  const fx=document.createElement("canvas"); fx.className="fx";
  const inner=document.createElement("div"); inner.className="pop-inner";
  const av=document.createElement("div"); av.className="pop-avatar"; av.append(avatarEl(Math.floor(Math.random()*99)));
  const ban=document.createElement("div"); ban.className="banner";
  [..."GÖREV TAMAMLANDI"].forEach((ch,i)=>{ const s=document.createElement("span"); s.textContent=ch===" "?" ":ch; s.style.animationDelay=(0.25+i*0.04)+"s"; ban.append(s); });
  const ttl=document.createElement("div"); ttl.className="pop-title"; ttl.textContent=q.title;
  const rw=document.createElement("div"); rw.className="reward";
  const r1=document.createElement("div"); r1.textContent=`+${q.xp} XP`; const r2=document.createElement("div"); r2.textContent=subj(q.subject).name+" yeteneği ↑"; rw.append(r1,r2);
  inner.append(av,ban,ttl,rw);
  if(newAr){ const l=document.createElement("div"); l.className="levelup"; l.textContent=`MACERA RÜTBESİ ${newAr}!`; inner.append(l); }
  const h=document.createElement("div"); h.className="hint"; h.textContent="Devam etmek için dokun"; inner.append(h);
  pop.append(fx,inner); document.body.append(pop);
  let stop=false;
  function k(e){ if(e.key==="Escape"||e.key==="Enter") close(); }
  function close(){ pop.remove(); stop=true; document.removeEventListener("keydown",k); }
  pop.onclick=close; document.addEventListener("keydown",k);
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const dpr=Math.min(devicePixelRatio||1,2); const W=fx.width=innerWidth*dpr, H=fx.height=innerHeight*dpr; const x=fx.getContext("2d");
  const cols=["#e8c675","#fff3c8",subj(q.subject).c,"#ffffff"];
  const ps=Array.from({length:110},()=>{ const a=Math.random()*Math.PI*2, v=(2+Math.random()*7)*dpr; return {x:W/2,y:H/2.3,vx:Math.cos(a)*v,vy:Math.sin(a)*v-3*dpr,s:Math.ceil((2+Math.random()*4)*dpr),c:cols[Math.random()*4|0],life:1}; });
  (function tick(){ if(stop) return; x.clearRect(0,0,W,H); let alive=0;
    ps.forEach((p)=>{ if(p.life<=0) return; alive++; p.x+=p.vx; p.y+=p.vy; p.vy+=.12*dpr; p.vx*=.985; p.life-=.009;
      x.globalAlpha=Math.max(p.life,0); x.fillStyle=p.c; x.fillRect(Math.round(p.x),Math.round(p.y),p.s,p.s); });
    if(alive) requestAnimationFrame(tick); })();
}

/* ---------- yıldızlı arka plan ---------- */
(function(){ const c=$("stars"), x=c.getContext("2d"); let st=[];
  function size(){ c.width=innerWidth; c.height=innerHeight; st=Array.from({length:90},()=>({x:Math.random()*c.width|0,y:Math.random()*c.height|0,s:Math.random()<.2?2:1,p:Math.random()*6})); }
  size(); addEventListener("resize",size); const still=matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function draw(t){ x.clearRect(0,0,c.width,c.height); st.forEach((s)=>{ x.globalAlpha=.35+.35*Math.sin(s.p+(t||0)/900); x.fillStyle="#cfd8ff"; x.fillRect(s.x,s.y,s.s,s.s); }); if(!still) requestAnimationFrame(draw); })(); })();

/* ---------- telefona kurulum ---------- */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
let deferredPrompt=null;
addEventListener("beforeinstallprompt",(e)=>{ e.preventDefault(); deferredPrompt=e; $("installAlt").hidden=true; });
function setupInstall(){
  if(isStandalone || store.get("yks-install-closed")==="1") return;
  $("installCard").hidden=false; $("installIos").hidden=!isIOS; $("installAndroid").hidden=isIOS;
  $("installClose").onclick=()=>{ $("installCard").hidden=true; store.set("yks-install-closed","1"); };
  $("installBtn").onclick=async()=>{ if(!deferredPrompt){ toast("Chrome menüsünden (⋮) 'Uygulamayı yükle'yi seç."); return; }
    deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; };
}

/* ---------- bildirimler ---------- */
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function b64ToBytes(b64){ const pad="=".repeat((4-b64.length%4)%4); const s=atob((b64+pad).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from(s,(c)=>c.charCodeAt(0)); }
function setBell(on){ $("bellBtn").setAttribute("aria-pressed",on); $("bellBtn").textContent=on?"🔔 Bildirimler açık":"🔔 Bildirimleri aç"; }
async function saveSub(sub){ const j=sub.toJSON();
  const { error } = await sb.from("push_subs").upsert({ endpoint:j.endpoint, user_id:me, p256dh:j.keys.p256dh, auth:j.keys.auth }); if(error) throw error; }
async function setupBell(){
  const btn=$("bellBtn");
  if(!pushSupported && !(isIOS && !isStandalone)) return;
  btn.hidden=false;
  if(pushSupported && Notification.permission==="granted"){
    try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription(); if(sub){ await saveSub(sub); setBell(true); } }catch{}
  }
  btn.onclick=async()=>{
    if(!pushSupported){ toast("iPhone'da bildirim için önce Ana Ekrana Ekle, sonra oradan aç."); $("installCard").hidden=false; return; }
    try{
      const perm=await Notification.requestPermission();
      if(perm!=="granted"){ toast("Bildirim izni verilmedi. Telefon ayarlarından açabilirsin."); return; }
      const reg=await navigator.serviceWorker.ready;
      const sub=(await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToBytes(VAPID_PUBLIC_KEY) });
      await saveSub(sub); setBell(true);
      toast(isHero()?"Bildirimler açık. Yeni görev gelince haber vereceğim ⚔️":"Bildirimler açık. Arkadaşın görevini bitirince haber vereceğim ✦");
    }catch(err){ console.error(err); toast("Bildirimler açılamadı."); }
  };
}

/* ---------- başlangıç ---------- */
(async()=>{
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((e)=>console.error("SW", e));
  if(!SUPABASE_URL || SUPABASE_URL.includes("PROJE-KODUN") || SUPABASE_ANON_KEY.startsWith("BURAYA")){
    $("gate").hidden=true; $("setupMsg").hidden=false; return;
  }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true } });
  await startFromSession();
})();

async function startFromSession(){
  const gs=$("gateStatus");
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if(session){
      const { error:ue } = await sb.auth.getUser();
      if(ue && (ue.status===401 || ue.status===403 || /session/i.test(ue.message||""))){ await sessionExpired(); return; }
      me=session.user.id;
      const { data:prof } = await sb.from("profiles").select("name").eq("id", me).maybeSingle();
      if(prof){
        myName=prof.name; $("nameIn").value=prof.name;
        const { data:lc } = await sb.rpc("my_login_code"); myLoginCode=lc||null;
        await loadMemberships();
        if(memberships.length){
          const saved=store.get("yks-current");
          const code=(memberships.find((m)=>m.room_code===saved)||memberships.find((m)=>m.role==="hero")||memberships[0]).room_code;
          await enterRoom(code); showApp(); return;
        }
      }
    }
  }catch(err){ console.error(err); gs.textContent="Bağlanılamadı. İnternet bağlantını kontrol edip sayfayı yenile."; return; }
  gs.hidden=true; $("welcomeForm").hidden=false;
}
