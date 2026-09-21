# Final-kill replay repair

Based on the supplied FireZone (8) project. Existing maps, skins and account code are preserved.

- Capture actor transforms at 30 Hz, plus shot-time samples. Record weapon, aim, field of view, crouch and alive state.
- Record individual firearm shot events instead of inventing one final shot. Replay each event once with sound, tracer, muzzle flash and cosmetic weapon kick.
- Interpolate all actors on one absolute timeline, with discontinuities at death/respawn.
- Suspend live death animation and spectator camera updates during playback. Restore actor transforms and camera state after playback.
- Create a temporary world avatar when the local player is the victim of a remote killer.
- Play at normal speed until 180 ms before the recorded fatal shot, then at quarter speed through 450 ms after it.
- Preserve FFA's existing end-of-match ranking and final-kill sequence. This does not add a per-death replay to other modes.

Validation: 42 automated checks pass. A local Chromium test using the real Three.js runtime verifies an initially upright victim, subsequent collapse, three distinct shots, local-victim representation and restoration after two consecutive playbacks. No real WAN multiplayer test was performed.

Limitations: this is a state/event replay, not video or server-authoritative lag-compensated reconstruction. Remote positions/aim are limited by received network snapshots; cosmetic recoil is reconstructed. The discrete shot recorder covers firearms, not grenade or thrown-knife trajectories. No database migration is required. No deployment was performed.
