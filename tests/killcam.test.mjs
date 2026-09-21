import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleReplay,replayEvents,advanceReplay} from '../killcam-timeline.js';
const frame=(t,x,alive=true)=>({t,x,y:1.8,z:0,feet:0,yaw:0,pitch:0,alive});
test('tracks use absolute time even if an actor joined after the killer',()=>{
  assert.equal(sampleReplay([frame(1200,2),frame(1400,4)],1300).x,3);
  assert.equal(sampleReplay([frame(1000,0),frame(1400,4)],1300).x,3);
});
test('the end of a living track never means the actor died',()=>{
  const pose=sampleReplay([frame(0,0),frame(100,1)],500);
  assert.equal(pose.alive,true);assert.equal(pose.x,1);
});
test('death and respawn snapshots are not blended through walls',()=>{
  const track=[frame(0,0,true),frame(100,1,false),frame(200,50,true)];
  assert.equal(sampleReplay(track,99).alive,true);
  assert.equal(sampleReplay(track,199).x,1);
  assert.equal(sampleReplay(track,200).x,50);
});
test('every shot is emitted exactly once, including several in one update',()=>{
  const events=[{t:10},{t:20},{t:21},{t:100}];
  assert.deepEqual([...replayEvents(events,0,21),...replayEvents(events,21,100)],events);
});
test('slow motion is frame-rate independent across both boundaries',()=>{
  let stepped=0;for(let i=0;i<400;i++)stepped=advanceReplay(stepped,10,1000);
  assert.ok(Math.abs(stepped-advanceReplay(0,4000,1000))<1e-6);
  assert.equal(advanceReplay(1000,100,1000),1025);
});
test('aim takes the shortest path around the yaw wrap',()=>{
  const a={...frame(0,0),yaw:Math.PI-.1},b={...frame(100,0),yaw:-Math.PI+.1};
  assert.ok(Math.abs(sampleReplay([a,b],50).yaw-Math.PI)<1e-8);
});
