# Mall and Ski Station update

## Ski Station
- Existing local photographs now use physically scaled UVs on cabin walls and furniture.
- Snow gains fine bump detail, broad tonal variation and denser terrain geometry.
- The cafe has a standing-seam metal roof with snow coverage; the Café Gijón sign is preserved.
- Tiered conifers replace stacked foliage boxes; foliage and snow use instancing.
- Ski assets preload before entering the map. Bot and respawn elevation follow the slope.

## Mall
- New Free For All / practice selection and rematch option.
- Two floors around a central atrium, four accessible shops and twelve shuttered shops.
- Terrazzo-style flooring, roller shutters, glass balcony rails, retail signs, shop displays and a skylight.
- Paired moving escalators transport players up and down. Walking against their movement is possible.
- Twelve spawn points and a height-aware bot navigation graph connect both floors.
- Floor support, upper-floor corpses and grenade collisions respect the mezzanine.
- The elevator facade is decorative; use the escalators to change floors.

## Validation and installation
- `npm run check`: 36 tests plus syntax and static smoke checks pass.
- Local Chromium checks cover rendering, walking up/down escalators, automatic transport and bot elevation.
- Multiplayer across real remote clients has not been tested in this environment.
- This archive contains the complete project. No new Supabase migration is required.
- Nothing has been deployed automatically. Publish these files using the project's existing deployment workflow.
