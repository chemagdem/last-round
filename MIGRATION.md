# Production migration plan

## Decision

Keep this Three.js build as the playable vertical slice. Rebuild the production game in Unreal Engine 5 if the target is high-end realism, or Godot 4 if open-source tooling and a smaller team are stronger constraints. Do not attempt an incremental engine swap: gameplay code, physics, networking, assets, UI, animation, and build tooling all change.

## Milestones

1. **Pre-production:** freeze the rules, movement values, weapon data, round flow, maps, and visual target. Record the current build as a behavioural reference.
2. **Core slice:** implement controller, camera, one weapon, damage, one grey-box map, round lifecycle, and replayable automated tests.
3. **Networking:** use a dedicated authoritative server, client prediction, reconciliation, lag compensation, rate limiting, and server-side hit validation. Peer-to-peer networking is unsuitable for ranked competition.
4. **Content pipeline:** replace procedural weapon meshes with licensed PBR assets, first-person rigs, authored reload/fire animations, original audio, VFX, LODs, collision meshes, and texture streaming.
5. **Competitive systems:** matchmaking, parties, reconnect, anti-cheat, reporting, moderation, spectating, replays, telemetry, and skill rating.
6. **Production:** GPU/CPU budgets, automated builds, crash reporting, accessibility, localization, privacy/security review, platform compliance, and staged playtests.

## Acceptance targets for the vertical slice

- Stable 60 FPS at the declared minimum specification with measured frame-time budgets.
- No client-authoritative health, ammunition, position, hit, economy, or round result.
- Reproducible recoil and documented weapon balance data.
- Original or properly licensed production assets with provenance records.
- Automated smoke tests for boot, input, map load, round start/end, reconnect, and match completion.
