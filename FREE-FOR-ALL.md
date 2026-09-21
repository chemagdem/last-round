# Free for All

Select **Free for All**, choose **Dockyard** or **Atrium**, then host a room and share its link/code. Each participant clicks **I'M READY** after loading the map. Guests and signed-in profiles can both play; an authenticated Supabase session is not required to count as a human.

## Match rules

- Maximum **12 connected humans**, with **12 total human/bot roster slots**.
- At least **3 ready humans** are required. Bots fill the active roster to **6**: three humans get three bots, four get two, five get one, six or more need none.
- A **15-second warmup** starts only when at least six participants (including three humans) are ready. Losing the required population resets the warmup.
- Players may join a live match. When ready, they replace a bot if one remains; otherwise they occupy a free slot. The match clock and existing scores are retained. A full room rejects additional connections.
- After a match starts, bots backfill departures to retain six participants. The host must remain connected. Host migration and public matchmaking are not included.
- **30 kills or 10 minutes** ends the match. Kills rank first, fewer deaths break ties, and exact ties share their placing. FFA is unranked and does not alter the existing team-mode ELO.
- Respawn after **3 seconds**, retaining firearms and replenishing ammunition. Spawn selection favours cover and distance from living opponents, avoiding nearby spawns where possible.
- **2 seconds of spawn protection**, cancelled by firing or throwing a weapon/utility. A compact HUD message identifies protection.
- **B** opens the shop at any point while alive. Every firearm and utility item costs **$0**; carrying limits still apply. **Tab** shows individual scores including bots.
- At the result screen, the host selects either FFA map for another match with a 15-second warmup.

## Maps

**Dockyard** is a 72 × 64 metre cargo yard. Staggered corrugated containers, a solid port control tower, shielded outer spawn bays, low central cover, freight markings and an overhead gantry create several interconnected routes. Teal and orange cargo sectors give directional cues.

**Atrium** is a 64 × 64 metre research courtyard. Four roofed pavilions, a central planted block, low planters, sightline screens and an outer circulation route allow short fights and flanking. Structural roofs and walls participate in collision. Decorative geometry is batched; shared materials and packaged textures avoid new external asset downloads.

Both maps have twelve distributed spawn locations. Their conservative navigation graph is fully connected and accounts for bot clearance; bots cannot take diagonal shortcuts through corners.

## Bots and networking

The host owns bot movement, health, deaths, respawns and firing. Other players receive interpolated snapshots, shot effects and scores. Bots scan visible opponents, keep a short last-seen memory, use a field of view and proximity awareness, navigate around obstacles, strafe, turn towards targets, and fire three-shot bursts after a 250–500 ms reaction delay. Angular error reduces accuracy with distance. Shot obstruction, spawn protection, flash blindness and smoke affect their decisions. FFA smoke is shared between peers so the host's bots see the same obstruction.

Human hit reporting retains the game's existing client-authoritative model. This is not a dedicated competitive server or an anti-cheat implementation. All players must use the same release. No SQL migration is required.

## Validation

- Automated policy checks cover minimum population, bot replacement counts, capacity, spawn selection, individual ranking and full navigation connectivity on both maps, alongside existing team-mode regression tests.
- A Chromium integration run used multiple game clients with local simulated PeerJS signaling. It covered three-human start, bot kill synchronization, zero-cost live purchases, death/respawn, live bot replacement, twelve-player capacity and rejection of a thirteenth, score-limit results, switching maps, departure backfill and joining after a rematch.
- Both maps were rendered and visually inspected. Rendering was suppressed on background test clients to keep software-rendering costs bounded; this is not a GPU performance benchmark.
- Internet WebRTC signaling, TURN/NAT behaviour and twelve real players on different networks still need a live playtest. This ZIP does not deploy itself.
