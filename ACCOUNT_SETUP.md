# Cloud account setup

`auth-config.js` is wired to a real Supabase project (`teromfegnfmbxeyppcie`) and
`CLOUD_ACCOUNTS_ENABLED` is `true` in `game.js`. Guest mode still works without an
account. Existing guest statistics are not imported into accounts. The three current
finishes remain free prototype cosmetics.

The base schema (`player_profiles` + `ladder_entries`) has already been run once
against the project. **One more manual step is needed for the new clan tag**: open
https://supabase.com/dashboard/project/teromfegnfmbxeyppcie/sql/new, paste and run
just the "Migration 2" block at the bottom of `account.sql` (two `alter table ... add
column if not exists clan ...` statements - safe to run even if you're not sure it's
already applied). Automated deployment still can't reach the database directly from
this environment (the direct host resolves IPv6-only here, and the connection pooler
doesn't recognize this project as a tenant).

Remaining one-time setup in the Supabase dashboard:
1. Enable email/password authentication and email confirmation
   (Authentication → Providers). Set the minimum password length to 12. Configure SMTP
   and abuse protection before any public release.
2. Set the Auth Site URL and allowed redirect URL (Authentication → URL Configuration)
   to the exact HTTPS game URL (including its path) - email confirmation and password
   recovery links return there.
3. Register an account in-game, confirm the email, and sign in.
4. Test password recovery, sign-out, a second account, and a second browser. Verify
   that account B cannot read or update account A's database row, and cannot see
   account A's row filtered out of the public ladder read either (RLS only restricts
   writes on that table - reads are intentionally public, see below).

## Weekly ladder

`ladder_entries` (added in `account.sql`) holds one row per (user, week). The "week"
(`season_id`) is a fixed 7-day bucket computed client-side in `ladder.js` from a fixed
epoch - there is no scheduled job that resets anything; a write made after a week
boundary simply lands in a new row, and the leaderboard query only ever reads the
current bucket. Old weeks' rows are kept, not deleted. The table is public-read (even
signed-out visitors can load the ladder dialog) but write-restricted to each row's own
owner, same RLS pattern as `player_profiles`.

## Identity: gametag, clan, flag, founder badge

The registration form (and sign-in, for editing) collects a gametag, an optional
5-character clan tag and a country/flag, applied to the local profile immediately on
submit so a brand-new cloud row is seeded with them instead of blank defaults (see
`account.js`'s `applyLocalFields`/`loadUser`). These show next to the player's name in
the Tab scoreboard and the weekly ladder. Country/clan are self-reported per client,
same unverified trust model as every other stat here - purely cosmetic, never used for
scoring.

The account signed in as `josemgarciademarina@hotmail.com` gets a ★ founder badge.
This is derived from the verified session email at load time (`FOUNDER_EMAIL` in
`game.js`), not stored as an editable column, so it can't be granted by editing a
database row - only by actually controlling that mailbox.

## Current boundaries

Profiles save name, clan, country, equipped finish and client-reported wins/losses/matches/rating.
RLS isolates each user's record; it does NOT validate whether a win really happened.
There is no verified ranked leaderboard, paid inventory, anti-cheat or authoritative
match server. The provisional calculation still assumes an opponent rating of 1000.
Never use these values to award money, paid items, or competitive prizes.

The SDK manages sessions and password handling. The game never saves passwords.
Cloud writes are debounced; wait for "Cloud saved" before closing the page. Failed
writes require retry. Concurrent devices use last-write-wins; offline account writes
are not queued durably. Guest data remains separate. Do not change account mid-match.

## Verification before production

The source checks do not validate the live provider. Run real email confirmation,
recovery, token expiry, RLS isolation and two-device persistence tests after setup.
Add authoritative match records and server-computed ratings before ranked release.

References:
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/database/postgres/row-level-security
