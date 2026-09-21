import test from 'node:test';
import assert from 'node:assert/strict';
import {FFA,botCount,canStart,chooseSpawn,rankPlayers} from '../ffa-rules.js';
import {FFA_MAPS,blockedAt,buildNavigation} from '../ffa-layouts.js';

test('three humans unlock six participants; humans replace bots through twelve',()=>{
  assert.equal(botCount(2),0);assert.equal(canStart(2,4),false);
  for(let humans=3;humans<=12;humans++){
    const bots=botCount(humans);
    assert.equal(bots,Math.max(0,6-humans));assert.ok(canStart(humans,bots));assert.ok(humans+bots<=FFA.capacity);
  }
  assert.equal(canStart(13,0),false);assert.equal(canStart(3,2),false);
});
test('safe spawn selection prefers cover over a visible alternative',()=>{
  const hidden={x:12,z:0},exposed={x:20,z:0};
  assert.equal(chooseSpawn([hidden,exposed],[{x:0,z:0}],p=>p===exposed,()=>0),hidden);
});
test('individual ranking includes bots, excludes loading players and breaks ties on deaths',()=>{
  const roster=[{id:'a',ready:true},{id:'b',ready:true,isBot:true},{id:'c',ready:false}];
  assert.deepEqual(rankPlayers(roster,{a:{kills:3,deaths:2},b:{kills:3,deaths:1},c:{kills:20}}).map(p=>p.id),['b','a']);
});
for(const [id,map] of Object.entries(FFA_MAPS)){
  test(`${id}: all twelve spawns clear and connected with navigable escape routes`,()=>{
    assert.equal(map.spawns.length,12);
    const nav=buildNavigation(map);
    for(const p of map.spawns){
      assert.ok(!blockedAt(map,p.x,p.z),`Blocked spawn ${JSON.stringify(p)}`);
      const route=nav.path(map.spawns[0],p);assert.ok(route.length>0);
      assert.ok(Math.hypot(route.at(-1).x-p.x,route.at(-1).z-p.z)<=2);
      for(const node of route)assert.ok(!blockedAt(map,node.x,node.z,.8));
    }
    // A single connected graph prevents isolated bot patrol islands.
    const visited=new Set([0]),queue=[0];
    for(let i=0;i<queue.length;i++)for(const j of nav.nodes[queue[i]].links)if(!visited.has(j)){visited.add(j);queue.push(j);}
    assert.equal(visited.size,nav.nodes.length);
  });
}
