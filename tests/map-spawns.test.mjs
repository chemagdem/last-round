import test from 'node:test';
import assert from 'node:assert/strict';
import { findClearSpawn } from '../map-spawns.js';

test('blocked random attempts fall back to a clear grid position', () => {
  const zone = { xMin: 0, xMax: 3, zMin: 0, zMax: 3 };
  const blocked = (x,z) => x < 2 || z < 2;
  const point = findClearSpawn(zone, blocked, () => 0);
  assert.ok(point);
  assert.equal(blocked(point.x, point.z), false);
});
test('fully blocked zones return no spawn rather than a position inside geometry', () => {
  assert.equal(findClearSpawn({ xMin: 0, xMax: 2, zMin: 0, zMax: 2 }, () => true, () => 0.5), null);
});
