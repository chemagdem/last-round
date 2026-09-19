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
| Crouch | Shift |
| Sprint | Ctrl |
| Fire / aim | Left / right mouse |
| Reload | R |
| Shop | B |
| Weapon slots | 1–5 |
| Previous weapon | Q |
| Graffiti | T |
| Pause | Escape |

Bindings and mouse sensitivity can be changed from the pause menu and persist locally.

## Production status

This repository is a playable prototype, not a release-ready commercial game. Before distribution, replace or verify every file listed in `THIRD_PARTY_ASSETS.md`, add authoritative server-side multiplayer, test across supported GPUs and browsers, and complete accessibility, moderation, telemetry, privacy, and security reviews.
