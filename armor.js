// Renderer-independent armor rules. The helmet covers headshots and the vest covers every other
// hit. Each piece has its own durability: it absorbs part of each hit, loses the absorbed amount
// and breaks at zero.
export const ARMOR = Object.freeze({
  vest: Object.freeze({ name: 'Kevlar Vest', price: 650, durability: 100, reduction: 0.5 }),
  helmet: Object.freeze({ name: 'Helmet', price: 350, durability: 100, reduction: 0.5 })
});

export function emptyArmor() { return { vest: 0, helmet: 0 }; }

// Returns the health damage left after armor and the armor state after this hit.
// bypass covers fall damage and instant kills, which armor never reduces.
export function absorbDamage(armor, dmg, { headshot = false, bypass = false } = {}) {
  const next = { vest: armor.vest, helmet: armor.helmet };
  if (bypass || !(dmg > 0)) return { damage: Math.max(0, dmg || 0), armor: next };
  const piece = headshot ? 'helmet' : 'vest';
  const absorbed = Math.min(next[piece], dmg * ARMOR[piece].reduction);
  next[piece] -= absorbed;
  return { damage: dmg - absorbed, armor: next };
}
