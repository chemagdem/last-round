import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, game] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../game.js', import.meta.url), 'utf8')
]);

// These checks protect the minimum boot contract without requiring a GPU in CI.
assert.match(html, /<script type="module" src="game\.js"><\/script>/);
assert.match(html, /<div id="startScreen">/);
assert.match(html, /<canvas id="minimap"/);
assert.match(game, /function animate\(\)/);
assert.match(game, /requestAnimationFrame\(animate\)/);
assert.match(game, /const WEAPONS = \{/);

console.log('LastRound smoke checks passed.');
