# Third-party asset audit

The project owner confirmed on 2026-09-19 that the existing weapon sounds, font and other supplied assets are licensed. The runtime retains those sounds; licence documentation is maintained by the owner.

`assets/fonts/Baserona.ttf` is enabled for game headings under the owner's confirmation of a purchased licence. The bundled original font README remains unchanged.

The six new transparent spray PNGs in `assets/sprays/` were generated for this project. The cat and mounted knight use images supplied by the owner as references. Generation prompts are recorded in `assets/sprays/PROMPTS.md`.

This records the owner's statement, not independent verification of licence terms.

## Enemy soldier model

The enemy/bot character is fully procedural (capsule/cylinder/rounded-box primitives built at
runtime in `game.js` - see `createTacticalSoldier()`), replacing an earlier build that cloned
Khronos's CesiumMan CC0 sample rig from a remote CDN and re-skinned it. Nothing about the soldier
model is downloaded at runtime or sourced from a third party anymore; there is no license to track.
