import test from 'node:test';
import assert from 'node:assert/strict';
import { RoundLives, roundOutcome } from '../pvp-life.js';

const roster = [
  { id: 'host', team: 'A' }, { id: 'ally', team: 'A' },
  { id: 'rival1', team: 'B' }, { id: 'rival2', team: 'B' }
];

test('2v2 awards team B immediately after both team A deaths', () => {
  const lives = new RoundLives(); lives.start(1, roster);
  lives.eliminate('host', 1);
  assert.equal(roundOutcome(lives.count('A', roster), lives.count('B', roster)), undefined);
  lives.eliminate('ally', 1);
  assert.equal(roundOutcome(lives.count('A', roster), lives.count('B', roster)), 'B');
});

test('2v2 elimination is symmetric and duplicate deaths are idempotent', () => {
  const lives = new RoundLives(); lives.start(1, roster);
  lives.eliminate('rival1', 1); lives.eliminate('rival1', 1);
  assert.equal(lives.count('B', roster), 1);
  lives.eliminate('rival2', 1);
  assert.equal(roundOutcome(lives.count('A', roster), lives.count('B', roster)), 'A');
});

test('round reset restores lives and rejects previous-round deaths', () => {
  const lives = new RoundLives(); lives.start(1, roster);
  lives.eliminate('ally', 1);
  lives.start(2, roster); lives.eliminate('ally', 1);
  assert.equal(lives.alive('ally'), true);
  lives.eliminate('ally', 2);
  assert.equal(lives.alive('ally'), false);
  assert.equal(lives.alive('unregistered'), false);
});

test('hidden bots and disconnected players cannot keep a team alive', () => {
  const players = [...roster, { id: 'hidden', team: 'A', isBot: true }];
  const lives = new RoundLives(); lives.start(1, players);
  lives.eliminate('host', 1);
  assert.equal(lives.count('A', players.filter(p => p.id !== 'ally')), 0);
});

test('equal survivors on timeout or mutual elimination never favour team A', () => {
  assert.equal(roundOutcome(1, 1, true), null);
  assert.equal(roundOutcome(0, 0), null);
  assert.equal(roundOutcome(1, 2, true), 'B');
  assert.equal(roundOutcome(2, 1, true), 'A');
});
