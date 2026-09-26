// Free-for-all policy is independent of rendering and transport.
export const FFA = Object.freeze({ capacity: 12, minHumans: 1, minPlayers: 6, duration: 600, goal: 30, warmup: 15, respawn: 3, protection: 3 });
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
// Host-owned bots draw a new weapon every life. burst/interval/pause shape the fire cadence,
// spread scales aim error and weight sets how often each weapon is drawn.
export const BOT_LOADOUTS = Object.freeze([
  { weaponId: 'ak47', weight: 3, burst: 3, interval: 0.15, pause: [0.5, 0.85], spread: 1 },
  { weaponId: 'm4a4', weight: 3, burst: 3, interval: 0.14, pause: [0.5, 0.85], spread: 0.95 },
  { weaponId: 'm4a1', weight: 3, burst: 3, interval: 0.15, pause: [0.5, 0.85], spread: 0.9 },
  { weaponId: 'awp', weight: 1, burst: 1, interval: 1.6, pause: [1.6, 2.2], spread: 0.35 },
  { weaponId: 'deagle', weight: 1.5, burst: 1, interval: 0.55, pause: [0.55, 0.8], spread: 0.8 },
  { weaponId: 'glock', weight: 1, burst: 3, interval: 0.18, pause: [0.45, 0.7], spread: 1.25 },
  { weaponId: 'tec9', weight: 1, burst: 4, interval: 0.13, pause: [0.5, 0.8], spread: 1.35 },
  { weaponId: 'duals', weight: 1, burst: 4, interval: 0.14, pause: [0.5, 0.8], spread: 1.35 },
  { weaponId: 'm249', weight: 1, burst: 6, interval: 0.1, pause: [0.6, 0.95], spread: 1.2 },
  { weaponId: 'ump45', weight: 1.5, burst: 4, interval: 0.12, pause: [0.45, 0.75], spread: 1.1 }
]);
export const BOT_DAMAGE_SCALE = 0.63;
export function pickBotLoadout(random = Math.random) {
  const total = BOT_LOADOUTS.reduce((sum, l) => sum + l.weight, 0);
  let roll = random() * total;
  for (const loadout of BOT_LOADOUTS) { roll -= loadout.weight; if (roll < 0) return loadout; }
  return BOT_LOADOUTS[0];
}
