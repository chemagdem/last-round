# Gameplay and presentation pass

## Included
- Supabase is disabled; local profiles and cosmetics remain available.
- Same-slot purchases and forced round weapons now rebuild the correct model.
- Round transitions cancel stale reload callbacks and reset recoil and input.
- Weapon recoil no longer leaks into an inspection or newly equipped weapon.
- Firing cancels inspection immediately.
- Magazine reload animation also works on weapons without a charging handle.
- PvP simulation and networking continue while the local pause/shop menu is open.
- Scoreboard names use text nodes rather than interpolated HTML.
- Match results show score, kills, assists, deaths and provisional rating.
- Training includes accuracy, hits, headshots, a weapon selector and counter reset.
- Camera shake can be disabled; reduced camera motion is enabled by default.
- Ammunition, low-health state, keyboard focus and compact layouts are restyled.
- HUD key labels follow shop/inspection rebinding.

## Verification and remaining work
JavaScript syntax and whitespace checks completed. This pass has not been visually
verified in a running browser or tested with two live peers. Training accuracy is
locally counted projectile hits, not server-confirmed competitive accuracy.
Pause does not protect a player from incoming damage in multiplayer.
Reduced motion disables camera shake, while existing aiming recoil is retained.
The Desert Eagle retains weapon-only recoil.

This is an iteration on the existing prototype. Authoritative networking, validated
ranking, production character/weapon art, matchmaking and commercial inventory
are not implemented by this change. Cosmetic cards still use finish swatches.
