-- Run once in a new Supabase project's SQL editor.
-- These statistics are client-reported, NOT a verified competitive ranking.
create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Player' check (char_length(name) between 1 and 16),
  country text not null default '' check (char_length(country) <= 2),
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

-- Weekly ladder: one row per (user, week). "season_id" is computed client-side (see ladder.js,
-- currentSeasonId()) as a fixed 7-day bucket from a shared epoch - there is no cron job here,
-- the ladder simply "resets" because every write after the boundary lands in a new season_id and
-- the leaderboard query only ever looks at the current one. Older rows are kept, not deleted, so a
-- past week's standings remain available if ever wanted later.
-- These are also client-reported, unverified numbers - same caveat as player_profiles.
create table public.ladder_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_id integer not null,
  name text not null default 'Player' check (char_length(name) between 1 and 16),
  country text not null default '' check (char_length(country) <= 2),
  rating integer not null default 1000 check (rating between 0 and 100000),
  wins integer not null default 0 check (wins between 0 and 1000000),
  losses integer not null default 0 check (losses between 0 and 1000000),
  matches integer not null default 0 check (matches = wins + losses),
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
alter table public.ladder_entries enable row level security;
revoke all on public.ladder_entries from anon;
-- the leaderboard itself is public read (even signed-out visitors can see it), but only the
-- authenticated owner of a row can ever write to it
grant select on public.ladder_entries to anon, authenticated;
grant insert, update on public.ladder_entries to authenticated;
create policy "Anyone can read the ladder" on public.ladder_entries for select to anon, authenticated using (true);
create policy "Create own ladder row" on public.ladder_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own ladder row" on public.ladder_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Migration 2 (run this separately if player_profiles/ladder_entries already exist from an
-- earlier run of the script above): adds an optional short clan/team tag, shown next to the
-- name in the Tab scoreboard and the ladder. `if not exists` makes this safe to run again.
alter table public.player_profiles add column if not exists clan text not null default '' check (char_length(clan) <= 5);
alter table public.ladder_entries add column if not exists clan text not null default '' check (char_length(clan) <= 5);

-- Migration 3: tightens the clan tag from 5 to 4 characters. Postgres names an inline column
-- check constraint "<table>_<column>_check" by default, which is what Migration 2 above created.
alter table public.player_profiles drop constraint if exists player_profiles_clan_check;
alter table public.player_profiles add constraint player_profiles_clan_check check (char_length(clan) <= 4);
alter table public.ladder_entries drop constraint if exists ladder_entries_clan_check;
alter table public.ladder_entries add constraint ladder_entries_clan_check check (char_length(clan) <= 4);
