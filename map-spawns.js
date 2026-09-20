// Random starts retain variety; the deterministic scan guarantees a safe fallback.
export function findClearSpawn(zone, blocked, random = Math.random) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = zone.xMin + random() * (zone.xMax - zone.xMin);
    const z = zone.zMin + random() * (zone.zMax - zone.zMin);
    if (!blocked(x, z)) return { x, z };
  }
  for (let z = zone.zMin; z <= zone.zMax; z += 0.5) {
    for (let x = zone.xMin; x <= zone.xMax; x += 0.5) {
      if (!blocked(x, z)) return { x, z };
    }
  }
  return null;
}
