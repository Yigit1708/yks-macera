-- YKS Macera Defteri — güncelleme 4: haftalık takvim (Haftanı Planla)
-- Supabase → SQL Editor'e yapıştırıp Run'a bas. Birden fazla çalıştırmak zarar vermez.

create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  room_code  text not null references public.rooms(code) on delete cascade,
  day        date not null,
  hour       smallint not null check (hour between 0 and 23),
  text       text not null check (char_length(text) between 1 and 80),
  kind       text not null default 'ders' check (kind in ('ders','tekrar','deneme','mola','ozel')),
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (room_code, day, hour)
);
create index if not exists plans_room_idx on public.plans(room_code);

grant select, insert, update, delete on public.plans to authenticated;
alter table public.plans enable row level security;

-- Maceradaki herkes planı görür; sadece gezgin yazar, işaretler, siler
drop policy if exists "plan oku"   on public.plans;
drop policy if exists "plan yaz"   on public.plans;
drop policy if exists "plan degis" on public.plans;
drop policy if exists "plan sil"   on public.plans;
create policy "plan oku"   on public.plans for select to authenticated using (is_member(room_code));
create policy "plan yaz"   on public.plans for insert to authenticated with check (is_hero(room_code) and not done);
create policy "plan degis" on public.plans for update to authenticated using (is_hero(room_code)) with check (is_hero(room_code));
create policy "plan sil"   on public.plans for delete to authenticated using (is_hero(room_code));

-- Saati gelmemiş plan tamamlanamaz (Türkiye saati), tamamlanma zamanı sunucudan gelir
create or replace function public.plans_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.done and not coalesce(old.done,false) then
    if (new.day + make_time(new.hour,0,0)) > (now() at time zone 'Europe/Istanbul') then
      raise exception 'not_started';
    end if;
    new.done_at := now();
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end $$;
drop trigger if exists plans_guard on public.plans;
create trigger plans_guard before insert or update on public.plans
  for each row execute function public.plans_guard();

do $$ begin
  begin alter publication supabase_realtime add table public.plans; exception when duplicate_object then null; end;
end $$;
