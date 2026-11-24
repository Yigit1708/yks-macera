-- YKS Macera Defteri — güncelleme 3: haftalık XP hedefi
-- Supabase → SQL Editor'e yapıştırıp Run'a bas. Birden fazla çalıştırmak zarar vermez.

alter table public.rooms add column if not exists weekly_goal int not null default 1000;
do $$ begin
  alter table public.rooms add constraint weekly_goal_range check (weekly_goal between 100 and 10000);
exception when duplicate_object then null; end $$;

-- Haftalık hedefi sadece gezgin değiştirebilir
create or replace function public.set_weekly_goal(p_code text, p_goal int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_hero(p_code) then raise exception 'only_hero'; end if;
  if p_goal is null or p_goal < 100 or p_goal > 10000 then raise exception 'bad_goal'; end if;
  update rooms set weekly_goal = p_goal where code = p_code;
end $$;

revoke all on function public.set_weekly_goal(text,int) from public, anon;
grant execute on function public.set_weekly_goal(text,int) to authenticated;
