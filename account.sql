-- Run once in a new Supabase project's SQL editor.
-- These statistics are client-reported, NOT a verified competitive ranking.
create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Player' check (char_length(name) between 1 and 16),
  rating integer not null default 1000 check (rating between 0 and 100000),
  wins integer not null default 0 check (wins between 0 and 1000000),
  losses integer not null default 0 check (losses between 0 and 1000000),
  matches integer not null default 0 check (matches = wins + losses),
  "equippedSkin" text not null default 'gold' check ("equippedSkin" in ('gold','carbon','crimson'))
);
alter table public.player_profiles enable row level security;
revoke all on public.player_profiles from anon;
grant select, insert, update on public.player_profiles to authenticated;
create policy "Read own profile" on public.player_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own profile" on public.player_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own profile" on public.player_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
