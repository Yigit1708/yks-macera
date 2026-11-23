-- YKS Macera Defteri — Güncelleme 2: isim soyisim + 6 haneli giriş kodu
-- Supabase → SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
-- (Yeni kurulumda schema.sql zaten bunu içerir; tekrar çalıştırmak zararsızdır.)

-- Her kişinin kendine ait, herkesten farklı 6 haneli giriş kodu
alter table public.profiles add column if not exists login_code text unique
  check (login_code ~ '^[0-9]{6}$');

-- Giriş kodu gizli: kimse başkasınınkini okuyamaz, kimse elle yazamaz
revoke select, insert, update on public.profiles from authenticated, anon;
grant select (id, name, created_at) on public.profiles to authenticated;
grant insert (id, name) on public.profiles to authenticated;
grant update (id, name) on public.profiles to authenticated;

-- Yanlış giriş denemelerini sayan tablo (aynı yerden 10 yanlışta 15 dakika kilit). Sadece sunucu erişir.
drop table if exists public.login_guard;
create table public.login_guard (
  ip           text primary key,
  fails        int not null default 0,
  locked_until timestamptz
);
alter table public.login_guard enable row level security;
revoke all on public.login_guard from anon, authenticated;

create or replace function public.norm_name(p text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p,'')), '\s+', ' ', 'g'));
$$;

-- Bir 6 haneli sayı herhangi bir yerde (geçit kodu ya da giriş kodu) kullanılıyor mu?
create or replace function public.code_in_use(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from rooms where code = p) or exists (select 1 from profiles where login_code = p);
$$;

-- Kullanıcıya benzersiz giriş kodu ver (zaten varsa aynısını döndür). Sadece sunucu fonksiyonu çağırır.
create or replace function public.assign_login_code(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select login_code into c from profiles where id = p_user;
  if c is not null then return c; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'no_profile'; end if;
  loop
    c := (100000 + floor(random() * 900000))::int::text;
    continue when code_in_use(c);
    begin
      update profiles set login_code = c where id = p_user and login_code is null;
      return c;
    exception when unique_violation then
      -- aynı anda biri aynı kodu aldıysa yeni kod dene
    end;
  end loop;
end $$;

-- Giriş: bu koda ve isme sahip kişiyi bul. Sadece sunucu fonksiyonu çağırır.
create or replace function public.find_by_login(p_code text, p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from profiles where login_code = p_code and norm_name(name) = norm_name(p_name) limit 1;
$$;

-- Kullanıcının kendi giriş kodunu görmesi için
create or replace function public.my_login_code()
returns text language sql stable security definer set search_path = public as $$
  select login_code from profiles where id = auth.uid();
$$;

-- Geçit kodu üretirken giriş kodlarıyla da çakışmasın
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
    exit when not code_in_use(c);
  end loop;
  insert into rooms(code, hero_id, hero_name) values (c, auth.uid(), n);
  insert into members(room_code, user_id, role) values (c, auth.uid(), 'hero');
  return c;
end $$;

revoke all on function public.code_in_use(text), public.assign_login_code(uuid), public.find_by_login(text,text) from public, anon, authenticated;
grant execute on function public.code_in_use(text), public.assign_login_code(uuid), public.find_by_login(text,text) to service_role;
revoke all on function public.my_login_code(), public.create_room() from public, anon;
grant execute on function public.my_login_code(), public.create_room() to authenticated;
