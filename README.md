# LastRound

Browser-based competitive FPS prototype built with Three.js and PeerJS.

## Run locally

ES modules require an HTTP server. From the project directory:

```bash
python -m http.server 8080
```

Open `http://localhost:8080` in a Chromium-based browser. Use two browser profiles or two devices to test multiplayer.

## Controls

| Action | Default |
| --- | --- |
| Move | W / A / S / D |
| Jump | Space |
| Crouch (toggle) | Ctrl |
| Sprint | Shift |
| Fire / aim | Left / right mouse |
| Reload | R |
| Shop | B |
| Weapon slots | 1–5 |
| Previous weapon | Q |
| Graffiti selector | Hold T, hover a design, release T to spray |
| Match chat | Enter to open/send, Escape to cancel |
| Pause | Escape |

Bindings and mouse sensitivity can be changed from the pause menu and persist locally.

## Chat and graffiti

The all-player chat supports 180 characters per message and 50 visible history entries. In practice, messages are local only. In PvP, the host validates and relays chat and sprays to the room. Both peers must use this version. Typing and spray selection suppress gameplay input without pausing the match. Chat remains available while eliminated.

Hold T while aiming at a surface, move the cursor over one of the six images, then release T. Releasing over empty space or pressing Escape cancels. Sprays reach 5 metres, have a 2.5-second cooldown, and fade to 85% opacity. Each client retains at most 48 decals and disposes older geometry/materials. Sprays synchronize live; players joining later do not receive historical sprays. The host checks sender identity, rate limits, placement and proximity; this does not replace authoritative competitive networking.

The pack includes Qadsiah lettering, a mounted knight with flag based on the supplied reference, Qadsiah Pride, GGEZ, the tutorial taunt, and a caricature of the supplied cat. Transparent PNGs are in `assets/sprays/`. Baserona and the existing sound samples remain enabled, per the owner's licensing confirmation.

## Production status

This repository is a playable prototype, not a release-ready commercial game. Before distribution, replace or verify every file listed in `THIRD_PARTY_ASSETS.md`, add authoritative server-side multiplayer, test across supported GPUs and browsers, and complete accessibility, moderation, telemetry, privacy, and security reviews.
