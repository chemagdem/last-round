# Cloud account setup

`auth-config.js` is wired to a real Supabase project (`teromfegnfmbxeyppcie`) and
`CLOUD_ACCOUNTS_ENABLED` is `true` in `game.js`. Guest mode still works without an
account. Existing guest statistics are not imported into accounts. The three current
finishes remain free prototype cosmetics.

**One manual step is still required before sign-in will actually work**: `account.sql`
has not been run against the project yet. Automated deployment could not reach the
database directly (the direct host resolves IPv6-only from this environment, and the
connection pooler didn't recognize the project as a tenant, likely because it's brand
new) - open the project's SQL editor at
https://supabase.com/dashboard/project/teromfegnfmbxeyppcie/sql/new, paste the full
contents of `account.sql`, and press Run. That single step creates `player_profiles`
and the new `ladder_entries` table (see below) with their RLS policies.

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

## Current boundaries

Profiles save name, equipped finish and client-reported wins/losses/matches/rating.
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
