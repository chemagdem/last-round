// All tracks share the recorder's monotonic clock. Missing samples never imply death.
export function sampleReplay(track, time) {
  if (!track?.length) return null;
  let i = 0;
  while (i + 1 < track.length && track[i + 1].t <= time) i++;
  const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
  const discontinuity = a.alive !== b.alive || Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)>8;
  const alpha = discontinuity ? 0 : Math.max(0, Math.min(1, (time-a.t)/Math.max(1,b.t-a.t)));
  const lerp = key => (a[key] ?? 0) + ((b[key] ?? 0)-(a[key] ?? 0))*alpha;
  const turn = ((b.yaw-a.yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  return {...a, x:lerp('x'),y:lerp('y'),z:lerp('z'),feet:lerp('feet'),pitch:lerp('pitch'),fov:lerp('fov'),yaw:a.yaw+turn*alpha,a,b,alpha};
}
export function replayEvents(events, previous, now) {
  return events.filter(event => event.t > previous && event.t <= now);
}
// Integrate across the slow-motion boundary without frame-rate-dependent overshoot.
export function advanceReplay(time, dtMs, fatalTime) {
  const start=fatalTime-180, end=fatalTime+450;
  for(const [boundary,speed] of [[start,1],[end,.25],[Infinity,1]]) {
    if(time>=boundary)continue;
    const step=Math.min(dtMs,(boundary-time)/speed);
    time+=step*speed;dtMs-=step;
    if(dtMs<=0)break;
  }
  return time;
}
