import test from 'node:test';
import assert from 'node:assert/strict';
import {MALL,MALL_LEVEL,mallSupport,mallNavigation,mallBlocked,mallWalk} from '../mall-layout.js';
test('Mall preserves the ground floor beneath the mezzanine',()=>{
 assert.equal(mallSupport(20,0,0),0);assert.equal(mallSupport(20,0,5.4),5.4);
 assert.equal(mallSupport(0,0,5.4),0);
});
test('Both escalators can be traversed smoothly in either direction',()=>{
 for(const x of [-8,8]){
  let y=0;
  for(let z=-12;z<=14;z+=.1){const next=mallWalk(x,z,y);assert.notEqual(next,null);y=next;}
  assert.ok(Math.abs(y-MALL_LEVEL)<.03);
  for(let z=14;z>=-12;z-=.1){const next=mallWalk(x,z,y);assert.notEqual(next,null);y=next;}
  assert.ok(y<.03);
 }
});
test('All Mall spawns and both floors connect through the escalators',()=>{
 const nav=mallNavigation();
 for(const p of MALL.spawns){
  assert.ok(!mallBlocked(p.x,p.z,p.y));
  const route=nav.path(MALL.spawns[0],p);assert.ok(route.length>0,JSON.stringify(p));
  assert.ok(Math.abs(route.at(-1).y-p.y)<.1);
  if(p.y>0)assert.ok(route.some(n=>n.y>0&&n.y<MALL_LEVEL));
 }
});
