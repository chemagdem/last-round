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

-- Migration 4: replaces the single shared "equippedSkin" column with a per-weapon map (each gun
-- now keeps its own equipped finish - see WEAPON_SKIN_IDS/applyEquippedSkin in game.js). Purely
-- additive: the old "equippedSkin" column is left in place, unused, rather than dropped.
alter table public.player_profiles add column if not exists "equippedSkins" jsonb not null default '{}'::jsonb;

-- Migration 5: global "Find Match" queue (see matchmaking.js). Deliberately keyed by PeerJS peer
-- id, not by auth.uid() - matchmaking has to work for guests too, the same way room-code PvP
-- already does without requiring an account. All access goes through the two SECURITY DEFINER
-- functions below, so the table itself grants nothing directly to anon/authenticated - there's no
-- RLS policy to write because there's no direct table access to allow in the first place.
create table public.matchmaking_queue (
  peer_id text primary key check (char_length(peer_id) between 1 and 64),
  ruleset text not null check (ruleset in ('standard','knife','ffa')),
  team_size integer not null default 1 check (team_size in (1,2)),
  matched_peer_id text,
  created_at timestamptz not null default now()
);
alter table public.matchmaking_queue enable row level security;
revoke all on public.matchmaking_queue from anon, authenticated;

-- Looks for someone already waiting with the same ruleset/team size and claims them atomically
-- (for update skip locked keeps two simultaneous callers from claiming the same opponent). Found:
-- marks that row matched (so its own owner's next find_or_queue call notices and switches to
-- joining someone else, in the rare case they'd also just started a fresh search), drops the
-- caller's own row (a joiner never needs to be found by anyone else) and returns the opponent's
-- peer id. Nobody waiting: queues the caller and returns null - the caller keeps hosting and
-- discovers it's been joined the normal way, through its own PeerJS 'connection' event, not by
-- polling this table.
create or replace function public.find_or_queue(p_peer_id text, p_ruleset text, p_team_size integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  opponent_id text;
begin
  if p_peer_id is null or length(p_peer_id) = 0 or length(p_peer_id) > 64 then
    raise exception 'invalid peer id';
  end if;
  if p_ruleset not in ('standard','knife','ffa') then raise exception 'invalid ruleset'; end if;
  if p_team_size not in (1,2) then raise exception 'invalid team size'; end if;

  -- opportunistic cleanup of anyone who's been sitting for a while (gave up, closed the tab,
  -- crashed) - self-healing, needs no cron job for a queue this small.
  delete from public.matchmaking_queue where created_at < now() - interval '90 seconds';

  select peer_id into opponent_id from public.matchmaking_queue
    where ruleset = p_ruleset and team_size = p_team_size and matched_peer_id is null and peer_id <> p_peer_id
    order by created_at asc
    for update skip locked
    limit 1;

  if opponent_id is not null then
    update public.matchmaking_queue set matched_peer_id = p_peer_id where peer_id = opponent_id;
    delete from public.matchmaking_queue where peer_id = p_peer_id;
    return opponent_id;
  end if;

  insert into public.matchmaking_queue (peer_id, ruleset, team_size)
    values (p_peer_id, p_ruleset, p_team_size)
    on conflict (peer_id) do update set ruleset = excluded.ruleset, team_size = excluded.team_size,
      matched_peer_id = null, created_at = now();
  return null;
end;
$$;

create or replace function public.leave_queue(p_peer_id text)
returns void
language sql security definer set search_path = public as $$
  delete from public.matchmaking_queue where peer_id = p_peer_id;
$$;

grant execute on function public.find_or_queue(text, text, integer) to anon, authenticated;
grant execute on function public.leave_queue(text) to anon, authenticated;


-- Migration 6: persistent per-weapon StatTrak counters. The client increments the counter only
-- when this account is credited with the kill; guest profiles use the same shape in localStorage.
alter table public.player_profiles add column if not exists "weaponKills" jsonb not null default '{}'::jsonb;
