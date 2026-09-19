# Cloud account setup

This integration is implemented but not deployed or connected to a live backend.
Guest mode still works without configuration. Existing guest statistics are not
imported into accounts. The three current finishes remain free prototype cosmetics.

1. Create a Supabase project under your own account.
2. Run `account.sql` once in its SQL editor.
3. Enable email/password authentication and email confirmation. Set the minimum
   password length to 12. Configure SMTP and abuse protection before public release.
4. Set the Auth Site URL and allowed redirect URL to the exact HTTPS game URL
   (including its path). Email confirmation and password recovery return there.
5. In `auth-config.js`, set `url` to the project URL and `publishableKey` to its
   public publishable key (or legacy anon key). NEVER use service_role or secret keys.
6. Publish the updated game files. Register, confirm the email, and sign in.
7. Test password recovery, sign-out, a second account, and a second browser.
   Verify that account B cannot read or update account A's database row.

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
