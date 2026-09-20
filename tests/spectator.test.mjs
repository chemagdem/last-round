import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../spectator.js', import.meta.url), 'utf8');
const selection = source.match(/function selectSpectatorTarget\([^]*?\n\}/)[0];
const context = vm.createContext({});
vm.runInContext(selection, context);

test('spectator selects a living teammate, never an opponent or disconnected avatar', () => {
  const opponent = { netId: 'enemy', team: 'B', isRemote: true, alive: true };
  const disconnected = { netId: 'gone', team: 'A', isRemote: true, alive: true };
  const teammate = { netId: 'ally', team: 'A', isRemote: true, alive: true };
  const roster = [{ id: 'enemy' }, { id: 'ally' }];
  assert.equal(context.selectSpectatorTarget([opponent, disconnected, teammate], 'A', roster), teammate);
  teammate.dying = true;
  assert.equal(context.selectSpectatorTarget([opponent, disconnected, teammate], 'A', roster), null);
});
