import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatMotion } from '../combat-motion.js';

test('fast input remains bounded and settles after the mouse stops', () => {
  const motion = new CombatMotion();
  for (let i = 0; i < 120; i++) {
    motion.look(10000, -10000);
    const pose = motion.update(1 / 60, 10, false, false);
    assert.ok(Math.abs(pose.x) < 0.04);
    assert.ok(Math.abs(pose.y) < 0.04);
    assert.ok(Math.abs(pose.roll) < 0.04);
  }
  for (let i = 0; i < 240; i++) motion.update(1 / 60, 0, false, false);
  assert.ok(Math.abs(motion.x) < 1e-8);
  assert.ok(Math.abs(motion.y) < 1e-8);
});

test('ADS and reduced motion attenuate all cosmetic offsets', () => {
  const sample = (ads, reduced) => {
    const motion = new CombatMotion();
    motion.look(40, 20);
    return motion.update(1 / 60, 5, ads, reduced);
  };
  const full = sample(false, false);
  const reduced = sample(false, true);
  const ads = sample(true, false);
  for (const key of ['x', 'y', 'roll']) {
    assert.ok(Math.abs(reduced[key] - full[key] * 0.2) < 1e-10);
    assert.ok(Math.abs(ads[key] - full[key] * 0.15) < 1e-10);
  }
});

test('crosshair recovery is independent of frame rate and resets between rounds', () => {
  const recover = fps => {
    const motion = new CombatMotion();
    for (let i = 0; i < 100; i++) motion.shot();
    assert.equal(motion.bloom, 8);
    for (let i = 0; i < fps; i++) motion.update(1 / fps, 0, false, false);
    return motion;
  };
  const slow = recover(30), fast = recover(144);
  assert.ok(Math.abs(slow.bloom - fast.bloom) < 1e-10);
  slow.reset();
  assert.equal(slow.bloom, 0);
  assert.equal(slow.targetX, 0);
  assert.equal(slow.targetY, 0);
});
