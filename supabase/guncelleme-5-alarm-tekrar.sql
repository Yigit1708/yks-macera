-- YKS Macera Defteri — güncelleme 5: takvimde alarm + her hafta tekrarlayan planlar
-- Supabase → SQL Editor'e yapıştırıp Run'a bas. Birden fazla çalıştırmak zarar vermez.
-- (Önce guncelleme-4-takvim.sql çalışmış olmalı.)

alter table public.plans add column if not exists alarm_min    smallint;            -- null = alarm yok; 0 = saatinde; 5/15/30 = dk önce
alter table public.plans add column if not exists alarm_last   date;                -- en son hangi gün alarm gönderildi
alter table public.plans add column if not exists repeat       boolean not null default false; -- her hafta aynı gün/saatte tekrar
alter table public.plans add column if not exists repeat_until date;                -- tekrar bu günden sonra biter
alter table public.plans add column if not exists series       uuid references public.plans(id) on delete set null; -- tekrarlayan planın o haftaki kopyası
alter table public.plans add column if not exists skip         boolean not null default false; -- tekrarlayan plan bu hafta atlandı
do $$ begin
  alter table public.plans add constraint plans_alarm_ok check (alarm_min is null or alarm_min in (0,5,10,15,30,60));
exception when duplicate_object then null; end $$;
create index if not exists plans_series_idx on public.plans(series);

-- Alarm zamanlayıcısı: her dakika bildirim fonksiyonunu dürter; zamanı gelen alarmları fonksiyon gönderir.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;
do $$ begin
  perform cron.unschedule('yks-alarmlar');
exception when others then null; end $$;
select cron.schedule('yks-alarmlar', '* * * * *', $cron$
  select net.http_post(
    url     := 'https://aogprhxewmguypkgbbzj.supabase.co/functions/v1/smooth-task',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_30pjlx7M-h6mrw4oauTxHQ_jKhis_IR"}'::jsonb,
    body    := '{"type":"alarms"}'::jsonb
  );
$cron$);

-- Haftalık temizlik: biten haftaların planları silinir, kazanılan XP kaybolmasın diye önce
-- maceranın "plan_xp" sayacına eklenir. Her hafta tekrarlayan planların ana satırı kalır.
alter table public.rooms add column if not exists plan_xp int not null default 0;
create or replace function public.cleanup_old_plans()
returns void language plpgsql security definer set search_path = public as $$
declare ws date := date_trunc('week', now() at time zone 'Europe/Istanbul')::date;  -- bu haftanın pazartesisi
begin
  with old as (
    delete from plans
    where day < ws and (not repeat or (repeat_until is not null and repeat_until < ws))
    returning room_code, done
  ), x as (select room_code, count(*) filter (where done) as n from old group by room_code)
  update rooms r set plan_xp = r.plan_xp + x.n * 10 from x where r.code = x.room_code and x.n > 0;
end $$;
revoke all on function public.cleanup_old_plans() from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('yks-temizlik');
exception when others then null; end $$;
-- Pazartesi 00:05 (Türkiye) = Pazar 21:05 UTC
select cron.schedule('yks-temizlik', '5 21 * * 0', $cron$ select public.cleanup_old_plans(); $cron$);
