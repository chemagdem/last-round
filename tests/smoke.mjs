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

// Legacy samples have unclear redistribution rights and must not return to runtime loading.
const forbiddenRuntimeSamples = [
  'cs_go-awp-sound.mp3',
  'ak-47-mp3.mp3',
  'desert-eagle-cs.mp3',
  'grenade-plonk-sound-effect-tarkov-louder.mp3'
];
for (const sample of forbiddenRuntimeSamples) {
  assert.equal(game.includes(sample), false, `Runtime references forbidden sample: ${sample}`);
}

console.log('LastRound smoke checks passed.');
