// Free-for-all policy is independent of rendering and transport.
export const FFA = Object.freeze({ capacity: 12, minHumans: 1, minPlayers: 6, duration: 600, goal: 30, warmup: 15, respawn: 3, protection: 2 });
export function botCount(humans) { return humans >= FFA.minHumans ? Math.max(0, FFA.minPlayers - humans) : 0; }
export function canStart(humans, bots) { return humans >= FFA.minHumans && humans + bots >= FFA.minPlayers && humans + bots <= FFA.capacity; }
export function rankPlayers(roster, stats) {
  return [...roster].filter(p => p.ready).sort((a, b) => (stats[b.id]?.kills || 0) - (stats[a.id]?.kills || 0)
    || (stats[a.id]?.deaths || 0) - (stats[b.id]?.deaths || 0) || a.id.localeCompare(b.id));
}
export function chooseSpawn(spawns, actors, visible, random = Math.random) {
  // Prefer unseen spawns, then distance; no random retry can place someone inside cover.
  let best = spawns[0], bestScore = -Infinity;
  for (const p of spawns) {
    let nearest = 60, exposed = 0;
    for (const actor of actors) {
      nearest = Math.min(nearest, Math.hypot(p.x - actor.x, p.z - actor.z));
      if (visible(p, actor)) exposed++;
    }
    const score = nearest < 8 ? nearest - 100 : nearest - exposed * 25 + random() * 2;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}
