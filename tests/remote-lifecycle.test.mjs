import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../game.js', import.meta.url), 'utf8');
function productionFunction(name) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `Missing production function ${name}`);
  return match[0];
}
function fixture() {
  const vector = () => ({ x: 0, y: 0, z: 0,
    set(x, y, z) { Object.assign(this, { x, y, z }); },
    copy(v) { this.set(v.x, v.y, v.z); } });
  const avatar = { alive: true, dying: false, deathT: 0, isRemote: true,
    targetPos: vector(), mesh: { position: vector(), rotation: vector() } };
  const context = vm.createContext({ isFfa: () => false, netMyId: 'local', baseFov: 75, roundState: { roundNum: 2 },
    netRoster: [{ id: 'remote', team: 'B', name: 'Opponent' }],
    player: { height: 1.8, crouchHeight: 1 },
    getOrCreateRemoteAvatar: () => avatar,
    enemies: [avatar], groundHeightAt: () => 0,
    scene: { remove() { throw new Error('Remote corpse must remain registered'); } }
  });
  vm.runInContext(productionFunction('applyRemoteState') + '\n' + productionFunction('updateDyingEnemies'), context);
  const state = { id: 'remote', roundNum: 2, pos: [1, 1.8, 2], yaw: 0, alive: false, health: 0 };
  return { avatar, context, state };
}

test('dead snapshots do not replay collapse or remove the remote player', () => {
  const { avatar, context, state } = fixture();
  context.applyRemoteState(state);
  context.updateDyingEnemies(2);
  assert.equal(avatar.deathT, 2);
  context.applyRemoteState(state);
  assert.equal(avatar.deathT, 2);
  assert.equal(avatar.alive, false);
  assert.equal(context.enemies.length, 1);
});

test('warmup revival clears the full death pose', () => {
  const { avatar, context, state } = fixture();
  context.applyRemoteState(state);
  context.updateDyingEnemies(0.7);
  context.applyRemoteState({ ...state, alive: true, health: 100 });
  assert.equal(avatar.dying, false);
  assert.equal(avatar.mesh.rotation.x, 0);
  assert.equal(avatar.mesh.rotation.z, 0);
  assert.equal(avatar.alive, true);
});

test('previous-round deaths cannot kill the new-round avatar', () => {
  const { avatar, context, state } = fixture();
  context.applyRemoteState({ ...state, roundNum: 1 });
  assert.equal(avatar.alive, true);
  assert.equal(avatar.dying, false);
});

test('round-end blocks incoming damage and local firing', () => {
  const context = vm.createContext({ isFfa: () => false, player: { alive: true, health: 100 },
    gameMode: 'pvp', roundState: { phase: 'ended' }, matchFinished: false });
  vm.runInContext(productionFunction('damagePlayer') + '\n' + productionFunction('fireWeapon'), context);
  context.damagePlayer(200, 'remote');
  context.fireWeapon();
  assert.equal(context.player.health, 100);
  assert.equal(context.player.alive, true);
});
