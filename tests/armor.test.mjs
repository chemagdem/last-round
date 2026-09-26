import test from 'node:test';
import assert from 'node:assert/strict';
import {ARMOR,emptyArmor,absorbDamage} from '../armor.js';

const full=()=>({vest:ARMOR.vest.durability,helmet:ARMOR.helmet.durability});

test('no armor passes damage through unchanged',()=>{
  assert.deepEqual(absorbDamage(emptyArmor(),40),{damage:40,armor:emptyArmor()});
  assert.equal(absorbDamage(emptyArmor(),80,{headshot:true}).damage,80);
});

test('vest halves body hits and loses the absorbed amount; helmet is untouched',()=>{
  const {damage,armor}=absorbDamage(full(),40);
  assert.equal(damage,20);assert.equal(armor.vest,80);assert.equal(armor.helmet,100);
});

test('helmet covers headshots only; a vest alone does not stop a headshot',()=>{
  const helmet=absorbDamage(full(),85,{headshot:true});
  assert.equal(helmet.damage,42.5);assert.equal(helmet.armor.helmet,57.5);assert.equal(helmet.armor.vest,100);
  const vestOnly=absorbDamage({vest:100,helmet:0},85,{headshot:true});
  assert.equal(vestOnly.damage,85);assert.equal(vestOnly.armor.vest,100);
});

test('worn armor absorbs only what durability remains, then breaks',()=>{
  const {damage,armor}=absorbDamage({vest:10,helmet:0},60);
  assert.equal(damage,50);assert.equal(armor.vest,0);
  assert.equal(absorbDamage(armor,60).damage,60);
});

test('bypass (fall damage, instant kill) ignores armor and leaves it intact',()=>{
  const {damage,armor}=absorbDamage(full(),9999,{bypass:true});
  assert.equal(damage,9999);assert.deepEqual(armor,full());
});

test('input armor state is not mutated',()=>{
  const state=full();absorbDamage(state,50);assert.deepEqual(state,full());
});
