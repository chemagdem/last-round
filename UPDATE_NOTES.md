# Visual update and Knife Throwing

## Teammate spectator

- Eliminated PvP players follow a living teammate's eye position, view direction and networked FOV. Crouching uses the teammate's eye height.
- The English banner reads SPECTATING with the teammate's name and health. Without a living teammate, the camera stays put and displays a waiting message.
- The observed avatar is hidden locally to avoid rendering inside its head. The dead player's weapon and personal combat HUD are hidden; spectator mode does not reconstruct the teammate's first-person weapon or scope overlay.
- Camera/HUD return automatically on respawn. Spectating never changes the dead player's network position and cannot target enemies or disconnected teammates.
- Existing checks and a teammate-selection regression test pass; live two-client camera verification remains pending. Update all clients to share pitch/FOV correctly.

## 2v2 round resolution and player names

- Removed host-only bot filling from PvP: those bots were not visible to clients but still kept teams alive. Standard 2v2 now waits for four human players; use 1v1 for two players.
- Round life tracking is independent of scene avatars. Both death events and dead state snapshots mark a player eliminated; later alive snapshots cannot revive that player in the same live round.
- A new round resets lives. Old-round deaths are rejected. State and death sender identities are checked by the host.
- Equal survivors at timeout and mutual elimination produce a draw with no score awarded; the previous timeout rule favoured team A.
- Remote player names appear above their heads: teal for teammates and coral for opponents. Names follow crouching, hide on death or behind cover, and cannot intercept hit detection.
- Five new round-rule tests cover both 2v2 winners, duplicate deaths, resets, stale messages, invisible bots, disconnections and draws. The complete 20-test suite passes. Visual nameplate and live four-player verification remain pending.

All players must update to this build. No deployment has been performed.

## Multiplayer death and shot feedback

- Remote corpses remain registered until respawn/round reset, preventing repeated collapse animations and incorrect alive-player counts.
- Respawning clears the death pose. Round-tagged hit, kill and end messages reject stale events. Ended rounds reject new damage and firing.
- Local deaths publish their state immediately. Cosmetic death animations finish even on the final round.
- Killfeed uses the reported killer and killing weapon instead of attributing every remote death to the local player; names render as text, not HTML.
- Round-end HUD distinguishes SURVIVED from ELIMINATED.
- Damage produces a fading blood vignette; critical health adds a soft edge pulse.
- Remote firearm events add barrel flashes, tracers and sampled stereo gunshots with distance attenuation. Shot events are cosmetic and do not duplicate damage. Audio uses stereo positioning, not acoustic wall occlusion.
- Four regression tests cover repeated dead snapshots, revival, stale deaths and damage/fire after round end. All 15 tests pass.

All players must use this version because combat events now carry round identifiers. Live two-client audiovisual verification remains pending. The existing client-authoritative networking is retained; this does not eliminate legitimate simultaneous kills under latency.

## Rifle sight alignment

- AK-47 now has an open U-notch rear sight aligned with the front post tip.
- M4A4 now uses a rear aperture with a matching front post; M4A1 uses an open reflex housing and an in-model red dot.
- Per-weapon ADS offsets account for the viewmodel scale and retain sufficient eye relief beyond the camera near plane.
- Cosmetic sway fades out during ADS on these rifles; the HUD aiming dot is hidden so the physical sight provides the reference. Existing recoil remains visible and recovers normally.
- AWP scope and other weapons retain their previous aiming behaviour.
- Three projection tests validate alignment at multiple scales and fields of view. These mathematical checks do not replace visual browser verification, which remains pending.

## Combat presentation follow-up

- First-person weapon inertia, subtle breathing and movement offsets, with smooth ADS positioning. Cosmetic offsets never modify camera aim and respect reduced-motion settings.
- Reduced excessive bump relief on weapon metal, grips and wood while retaining the equipped skin.
- Tracers originate at the barrel and converge on the camera-ray endpoint; nearby obstructions use the camera origin to avoid backward tracers.
- Bullet impact marks on walls and floors use a fixed 96-instance pool and expire after 24 seconds. These are local cosmetic effects.
- Corpses no longer intercept firearm hit queries. Floors participate in bullet obstruction queries.
- Crosshair expands on firing and recovers smoothly. Hit markers have an open centre, and repeated hits no longer inherit an earlier marker's hide timer.
- Low/empty ammunition styling, peripheral damage vignette and a short directional damage indicator for known multiplayer attackers.
- Smoke and dust now expand over their lifetime. Expired tracer geometry/materials, particle sprite materials and blood decals are released; shared casing resources are retained.
- Added three motion tests covering bounds, settling, ADS/reduced-motion attenuation and frame-rate-independent crosshair recovery. All eight tests and existing smoke checks pass.

Browser rendering and live multiplayer were not verified in this environment. No deployment was performed. Existing maps, skins, accounts configuration and Knife Throwing are retained.

## Knife Throwing

Select Knife Throwing on the landing page, choose a map and 1v1 or 2v2, then host a room. Other players join with its code using this same version.

- Five knives per player at the start of each round.
- Right click throws one knife with gravity; a direct enemy hit is lethal.
- Walk within 1.8 metres of your landed knives to recover them, with a clear path to the knife. Recovery works before or after exhausting the supply.
- With no knives left, the first-person hand remains visible and attacks are disabled until recovery.
- No firearms, grenades, smoke or shop in this mode.
- Waits for the required human players, then uses a 15-second warmup. No bot substitutes in this mode.
- Existing scores, round flow and rematch map selection remain in use.

## Rendering and environments

- Reflection environment, output pass and restrained bloom.
- Shared texture source requests, immediate fallback textures and selected-map preloading.
- Repeatable map decoration and cover placement across clients.
- Instanced architectural details, skyline buildings, signs and structural trim.
- Performance, balanced and quality graphics presets; adjustable field of view in the pause menu.
- Additional first-person glove geometry and corrected generic weapon recoil direction.

## Verification and limits

JavaScript syntax checks, existing social tests, smoke checks and diff whitespace checks passed. Browser visual verification and a live two-player match were not available in this environment. The new gameplay and graphics still need those checks before public release. This is an incremental Three.js update, not an Unreal migration or a claim of AAA visual quality. Multiplayer retains the existing peer-to-peer, client-authoritative architecture.

The archive includes the complete project. Extract over your project folder, keeping your local Git metadata, then commit and push from that folder. This archive has not been deployed automatically.
