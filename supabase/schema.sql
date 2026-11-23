-- YKS Macera Defteri — Supabase veritabanı şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
-- Tekrar çalıştırılabilir (var olanları atlar / günceller).

-- ============ TABLOLAR ============

-- Her kullanıcının isim soyismi (anonim Supabase hesabına bağlı)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 3 and 40),
  created_at timestamptz not null default now()
);

-- Her gezginin bir macerası var; 6 haneli geçit kodu birincil anahtar
create table if not exists public.rooms (
  code       text primary key check (code ~ '^[0-9]{6}$'),
  hero_id    uuid not null unique references public.profiles(id) on delete cascade,
  hero_name  text not null,
  elements   jsonb not null default '{}'::jsonb,   -- {"mat":"abyss", ...}
  avatars    text[] not null default '{}',         -- storage yolları: "482913/abc.png"
  created_at timestamptz not null default now()
);

-- Maceradaki kişiler: gezgin (hero) ve yoldaşlar (helper)
create table if not exists public.members (
  room_code  text not null references public.rooms(code) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('hero','helper')),
  joined_at  timestamptz not null default now(),
  primary key (room_code, user_id)
);

-- Görevler
create table if not exists public.quests (
  id             uuid primary key default gen_random_uuid(),
  room_code      text not null references public.rooms(code) on delete cascade,
  title          text not null check (char_length(title) between 1 and 90),
  subject        text not null check (subject in ('turkce','mat','geo','fizik','kimya','biyo','tarih','cog','felsefe','din','deneme')),
  tier           text not null check (tier in ('gunluk','hikaye','efsane')),
  xp             int  not null,
  from_id        uuid not null references public.profiles(id) on delete cascade,
  done           boolean not null default false,
  done_at        timestamptz,
  notified_new   boolean not null default false,
  notified_done  boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint xp_matches_tier check (
    (tier='gunluk' and xp=20) or (tier='hikaye' and xp=50) or (tier='efsane' and xp=120)
  )
);
create index if not exists quests_room_idx on public.quests(room_code);

-- Telefon bildirim abonelikleri
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Data API erişimi (proje "Grant API access to new tables automatically" kapalı açılmışsa gerekli).
-- Satır bazında kim neyi görür/değiştirir, aşağıdaki RLS kuralları belirler.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.rooms, public.members, public.quests, public.push_subs to authenticated;

-- ============ YARDIMCI FONKSİYONLAR ============

create or replace function public.is_member(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where room_code = p_code and user_id = auth.uid());
$$;

create or replace function public.is_hero(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from rooms where code = p_code and hero_id = auth.uid());
$$;

-- Gezgin olarak macera başlat: benzersiz 6 haneli kod üretir
create or replace function public.create_room()
returns text language plpgsql security definer set search_path = public as $$
declare c text; n text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select name into n from profiles where id = auth.uid();
  if n is null then raise exception 'no_profile'; end if;
  select code into c from rooms where hero_id = auth.uid();
  if c is not null then return c; end if;
  loop
    c := (100000 + floor(random() * 900000))::int::text;
    exit when not exists (select 1 from rooms where code = c);
  end loop;
  insert into rooms(code, hero_id, hero_name) values (c, auth.uid(), n);
  insert into members(room_code, user_id, role) values (c, auth.uid(), 'hero');
  return c;
end $$;

-- Yoldaş olarak koda katıl. Kod yoksa null döner.
create or replace function public.join_room(p_code text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'no_profile'; end if;
  if p_code !~ '^[0-9]{6}$' or not exists (select 1 from rooms where code = p_code) then return null; end if;
  insert into members(room_code, user_id, role)
  values (p_code, auth.uid(), case when exists (select 1 from rooms where code = p_code and hero_id = auth.uid()) then 'hero' else 'helper' end)
  on conflict do nothing;
  return p_code;
end $$;

-- Sadece gezgin, Deneme dışındaki derslerin elementini değiştirebilir
create or replace function public.set_element(p_code text, p_subject text, p_el text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_hero(p_code) then raise exception 'only_hero'; end if;
  if p_subject not in ('turkce','mat','geo','fizik','kimya','biyo','tarih','cog','felsefe','din') then raise exception 'bad_subject'; end if;
  if p_el not in ('pyro','hydro','anemo','electro','dendro','cryo','geo','abyss') then raise exception 'bad_element'; end if;
  update rooms set elements = elements || jsonb_build_object(p_subject, p_el) where code = p_code;
end $$;

-- Sadece gezgin görev tamamlayabilir
create or replace function public.complete_quest(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update quests q set done = true, done_at = now()
  where q.id = p_id and not q.done
    and exists (select 1 from rooms r where r.code = q.room_code and r.hero_id = auth.uid());
  if not found then raise exception 'cannot_complete'; end if;
end $$;

-- Maceradaki herkes pixel art ekleyebilir
create or replace function public.add_avatar(p_code text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_code) then raise exception 'not_member'; end if;
  if p_path not like p_code || '/%' then raise exception 'bad_path'; end if;
  update rooms set avatars = array_append(avatars, p_path) where code = p_code;
end $$;

revoke all on function public.create_room(), public.join_room(text), public.set_element(text,text,text),
  public.complete_quest(uuid), public.add_avatar(text,text), public.is_member(text), public.is_hero(text) from public, anon;
grant execute on function public.create_room(), public.join_room(text), public.set_element(text,text,text),
  public.complete_quest(uuid), public.add_avatar(text,text), public.is_member(text), public.is_hero(text) to authenticated;

-- ============ GÜVENLİK KURALLARI (RLS) ============

alter table public.profiles  enable row level security;
alter table public.rooms     enable row level security;
alter table public.members   enable row level security;
alter table public.quests    enable row level security;
alter table public.push_subs enable row level security;

drop policy if exists "profil oku"      on public.profiles;
drop policy if exists "profil ekle"     on public.profiles;
drop policy if exists "profil guncelle" on public.profiles;
create policy "profil oku"      on public.profiles for select to authenticated using (true);
create policy "profil ekle"     on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profil guncelle" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Maceralar sadece üyelerine görünür; değişiklikler fonksiyonlar üzerinden
drop policy if exists "macera oku" on public.rooms;
create policy "macera oku" on public.rooms for select to authenticated using (is_member(code));

drop policy if exists "uyeler oku"  on public.members;
drop policy if exists "uyelikten cik" on public.members;
create policy "uyeler oku"    on public.members for select to authenticated using (is_member(room_code));
create policy "uyelikten cik" on public.members for delete to authenticated using (user_id = auth.uid() and role = 'helper');

-- Görevler: üyeler görür; yoldaşlar verir (gezgin kendine veremez); veren siler
drop policy if exists "gorev oku" on public.quests;
drop policy if exists "gorev ver" on public.quests;
drop policy if exists "gorev sil" on public.quests;
create policy "gorev oku" on public.quests for select to authenticated using (is_member(room_code));
create policy "gorev ver" on public.quests for insert to authenticated with check (
  from_id = auth.uid() and is_member(room_code) and not is_hero(room_code)
  and done = false and done_at is null and notified_new = false and notified_done = false
);
create policy "gorev sil" on public.quests for delete to authenticated using (from_id = auth.uid());

drop policy if exists "abonelik kendi" on public.push_subs;
create policy "abonelik kendi" on public.push_subs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ CANLI GÜNCELLEME (Realtime) ============
do $$ begin
  begin alter publication supabase_realtime add table public.quests;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rooms;   exception when duplicate_object then null; end;
end $$;

-- ============ PIXEL ART DEPOLAMA ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp'];

drop policy if exists "pixel art yukle" on storage.objects;
create policy "pixel art yukle" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_member((storage.foldername(name))[1]));
