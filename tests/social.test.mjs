import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { SPRAYS, cleanText, validSpray, withinSprayRange, SocialRateLimiter } from '../social-protocol.js';

test('chat preserves international text and bounds untrusted input', () => {
  assert.equal(cleanText('  Hola   مرحبا  '), 'Hola مرحبا');
  assert.equal(cleanText('a\u0000b\u202ec'), 'abc');
  assert.equal(cleanText('x'.repeat(500)).length, 180);
  assert.equal(cleanText({ text: 'fake' }), '');
  assert.equal(cleanText(null), '');
});

test('unknown artwork, invalid vectors and non-unit normals are rejected', () => {
  const valid = { sprayId: 'cat', point: [1, 2, 3], normal: [0, 1, 0] };
  assert.equal(validSpray(valid), true);
  assert.equal(validSpray({ ...valid, sprayId: '../../file' }), false);
  assert.equal(validSpray({ ...valid, point: [NaN, 2, 3] }), false);
  assert.equal(validSpray({ ...valid, point: ['1', 2, 3] }), false);
  assert.equal(validSpray({ ...valid, point: [0, Infinity, 0] }), false);
  assert.equal(validSpray({ ...valid, normal: [0, 0, 0] }), false);
  assert.equal(validSpray({ ...valid, normal: [0, 10, 0] }), false);
  assert.equal(validSpray(null), false);
});

test('spray reach tolerates network movement but rejects distant placement', () => {
  assert.equal(withinSprayRange([0, 1.8, 0], [0, 1.8, 5]), true);
  assert.equal(withinSprayRange([0, 1.8, 0], [0, 1.8, 20]), false);
  assert.equal(withinSprayRange(null, [0, 0, 0]), false);
});

test('chat and spray cooldowns are independent and applied per connection', () => {
  const limiter = new SocialRateLimiter();
  assert.equal(limiter.accept('a', 'chat', 0), true);
  assert.equal(limiter.accept('a', 'chat', 100), false);
  assert.equal(limiter.accept('b', 'chat', 100), true);
  assert.equal(limiter.accept('a', 'spray', 100), true);
  assert.equal(limiter.accept('a', 'spray', 2000), false);
  assert.equal(limiter.accept('a', 'chat', 900), true);
  assert.equal(limiter.accept('a', 'spray', 2600), true);
});

test('all six packaged sprays are real PNG files with alpha channels', async () => {
  assert.equal(SPRAYS.length, 6);
  assert.equal(new Set(SPRAYS.map(s => s.id)).size, 6);
  for (const spray of SPRAYS) {
    const path = new URL(`../${spray.file}`, import.meta.url);
    await access(path);
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes[25], 6, `${spray.id} must be RGBA`);
  }
});
