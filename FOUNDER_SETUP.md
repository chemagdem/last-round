# First Light / 001

An obsidian brushed-metal finish with gold inlays, copper accent and repeated LR / FOUNDER 001 engravings. Applies to the weapon components already controlled by the inventory skin system; grips, sights and other functional parts retain their original materials.

## Activate on the existing Supabase project

1. Open Supabase Dashboard, select the project's SQL Editor and create a new query.
2. Paste the complete contents of `founder-access.sql` and run it once.
3. Deploy this complete game build, then sign out and sign in using the confirmed account `josemgarciademarina@hotmail.com`.
4. Open Inventory and equip First Light / 001.

Do not rerun the full account.sql setup on an existing database. The new migration is transactional and repeatable. This delivery does not apply that migration or deploy the website.

## Access rules and limits

- Supabase checks the authenticated user against Auth's confirmed email, not a profile flag. Other accounts cannot save this skin to their profile after the migration is installed.
- The client defaults to no entitlement on RPC failures and hides the Founder skin for guests and other accounts. Standard skins continue working if the migration is missing.
- A modified browser client can still draw downloaded/procedural artwork locally. Exclusivity here means the authenticated inventory and saved profile, not DRM or prevention of copying public game code.
- Like the existing skin system, this finish is a first-person cosmetic. Remote weapon skin replication has not been added.
- JavaScript checks and the existing 25 tests pass. The migration has not been executed against a live database, and the finish has not been visually verified in a browser.
