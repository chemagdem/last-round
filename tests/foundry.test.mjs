import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDRY } from '../foundry-layout.js';

// Expand cover by the game's 0.5 m collision radius before testing routes.
function blocked(x, z) {
  return FOUNDRY.cover.some(c => Math.abs(x - c.x) <= c.w / 2 + 0.5 && Math.abs(z - c.z) <= c.d / 2 + 0.5);
}
test('Foundry spawns and practice targets are clear of player collisions', () => {
  for (const zone of [FOUNDRY.spawnA, FOUNDRY.spawnB]) {
    for (let x = zone.xMin; x <= zone.xMax; x += 0.5)
      for (let z = zone.zMin; z <= zone.zMax; z += 0.5) assert.equal(blocked(x, z), false);
  }
  for (const [x, z] of FOUNDRY.practiceTargets) assert.equal(blocked(x, z), false);
});
test('Foundry collision layout is rotationally symmetric', () => {
  for (const c of FOUNDRY.cover) assert.ok(FOUNDRY.cover.some(other =>
    other.x === -c.x && other.z === -c.z && other.w === c.w && other.d === c.d && other.h === c.h));
});
test('both flanks, centre crossings and opposite spawn are reachable on foot', () => {
  const queue = [[0, -22]], seen = new Set(['0,-22']);
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
      if (Math.abs(nx) > 20 || Math.abs(nz) > 24 || blocked(nx, nz) || seen.has(key)) continue;
      seen.add(key); queue.push([nx, nz]);
    }
  }
  for (const [x, z] of [[0,22],[-20,0],[20,0],[-6,0],[6,0],[0,-7],[0,7]]) assert.ok(seen.has(`${x},${z}`));
});
test('spawn screens block direct eye-level shots between spawn zones', () => {
  for (const ax of [-3,0,3]) for (const bx of [-3,0,3]) {
    let obstructed = false;
    for (let t = 0; t <= 1; t += 0.002) {
      const x = ax + (bx - ax) * t, z = -22 + 44 * t;
      if (FOUNDRY.cover.some(c => c.h >= 1.8 && Math.abs(x - c.x) < c.w / 2 && Math.abs(z - c.z) < c.d / 2)) obstructed = true;
    }
    assert.ok(obstructed);
  }
});
