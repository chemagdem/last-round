import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BOT_LOADOUTS} from '../ffa-rules.js';

// game.js needs a browser, so read its declarations as text instead of importing it.
const game=await readFile(new URL('../game.js',import.meta.url),'utf8');
const block=name=>{const start=game.indexOf(`const ${name} = {`);assert.ok(start>=0,name);return game.slice(start,game.indexOf('\n};',start));};
const list=name=>{const start=game.indexOf(`const ${name} = [`);assert.ok(start>=0,name);return JSON.parse(game.slice(game.indexOf('[',start),game.indexOf(']',start)+1).replace(/'/g,'"'));};
const keys=text=>new Set([...text.matchAll(/^\s{2}(\w+):/gm)].map(m=>m[1]));
const weapons=keys(block('WEAPONS')),patterns=keys(block('SPRAY_PATTERNS')),sounds=keys(block('GUNSHOT_PROFILES'));
const guns=[...list('WEAPON_SKIN_IDS')];

test('every gun has stats, a model, a recoil pattern and a sound',()=>{
  for(const id of guns){
    assert.ok(weapons.has(id),`${id}: WEAPONS entry`);
    assert.ok(game.includes(`    case '${id}': {`),`${id}: buildWeaponVisual case`);
    assert.ok(patterns.has(id),`${id}: SPRAY_PATTERNS entry`);
    assert.ok(sounds.has(id),`${id}: GUNSHOT_PROFILES entry`);
  }
});

test('the PvP rotation and FFA bot pool only use declared weapons',()=>{
  for(const id of list('PVP_WEAPON_ROTATION'))assert.ok(weapons.has(id),`rotation: ${id}`);
  for(const {weaponId} of BOT_LOADOUTS)assert.ok(guns.includes(weaponId),`bot pool: ${weaponId}`);
});

test('M249 and UMP-45 are available everywhere guns are',()=>{
  for(const id of ['m249','ump45']){
    assert.ok(guns.includes(id));assert.ok(list('PVP_WEAPON_ROTATION').includes(id));
    assert.ok(BOT_LOADOUTS.some(l=>l.weaponId===id));
  }
  const stats=id=>block('WEAPONS').split('\n').find(line=>line.trim().startsWith(`${id}:`));
  assert.match(stats('m249'),/mag: 100, reserve: 200/);assert.match(stats('ump45'),/mag: 25, reserve: 100/);
});
