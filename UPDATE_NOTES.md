# Visual update and Knife Throwing

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
