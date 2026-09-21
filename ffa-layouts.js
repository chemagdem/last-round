const box = (x,z,w,d,h=3,kind='wall') => ({x,z,w,d,h,kind});
const ringSpawns = (x,z) => [
  {x:-x,z:-z},{x:0,z:-z},{x:x,z:-z},
  {x:x,z:-z/2},{x:x,z:0},{x:x,z:z/2},
  {x:x,z:z},{x:0,z:z},{x:-x,z:z},
  {x:-x,z:z/2},{x:-x,z:0},{x:-x,z:-z/2}
];
const docks = [box(0,0,10,8,5,'tower')];
// Staggered stacks break long sightlines. Every cluster has at least two exits.
for (const s of [-1,1]) {
  docks.push(box(s*18,-14,6,12,3.2,'cargo'),box(s*18,14,6,12,3.2,'cargo'));
  docks.push(box(s*10,-23,9,3,3.2,'cargo'),box(s*10,23,9,3,3.2,'cargo'));
  docks.push(box(s*28,-12,2,6,2.7,'screen'),box(s*28,12,2,6,2.7,'screen'));
  docks.push(box(s*28,0,2,5,2.7,'screen'),box(s*9,0,2,4,1.25,'crate'));
  docks.push(box(s*29,-23,5,2,2.8,'screen'),box(s*29,23,5,2,2.8,'screen'));
  docks.push(box(0,s*25,7,2,2.7,'screen'),box(0,s*14,5,2,1.25,'crate'));
}
const atrium = [box(0,0,6,6,3.6,'garden')];
for (const sx of [-1,1]) for (const sz of [-1,1]) {
  // Four offset pavilions: cross passages through the inner courtyard, outer rotation loop.
  atrium.push(box(sx*13,sz*12,9,1.5,3.5),box(sx*17,sz*16,1.5,7,3.5));
  atrium.push(box(sx*9,sz*18,3,3,1.15,'garden'));
  atrium.push(box(sx*24,sz*23,5,1.5,2.8,'screen'));
  atrium.push(box(sx*24,sz*13.5,1.5,5,2.8,'screen'));
}
for (const s of [-1,1]) {
  atrium.push(box(0,s*23,6,1.5,2.8,'screen'));
  atrium.push(box(s*24,0,1.5,5,2.8,'screen'));
  atrium.push(box(s*12,0,3,5,1.2,'garden'));
  atrium.push(box(0,s*11,5,2,1.2,'garden'));
}
// Ski Station: a long, wide north-south piste (twice the area of Dockyard) running downhill from
// north to south - see the SKI_DROP grade applied in buildFreeForAllMap - flanked by three staggered
// pine columns per side and edge snowbanks, with Café Gijón - a walk-in chalet east of the slope -
// reached through a 3m gap in its west wall.
export const SKI_HALF_WIDTH = 55, SKI_HALF_DEPTH = 110, SKI_DROP = 14;
export const SKI_CAFE = {x:30,z:60,w:10,d:14,h:3.6};
const ski = [];
const {x:cafeX,z:cafeZ,w:cafeW,d:cafeD,h:cafeH} = SKI_CAFE;
const treeZ = [];
for (let z = -98; z <= 98; z += 14) treeZ.push(z);
for (const x of [18, 30, 42]) for (const s of [-1, 1]) {
  // The middle column on the café's side skips the two rows the building itself occupies.
  const nearCafe = s > 0 && x === 30;
  for (const z of treeZ) {
    if (nearCafe && Math.abs(z - cafeZ) < 12) continue;
    ski.push(box(s * x, z, x === 42 ? 1.6 : 1.2, x === 42 ? 1.6 : 1.2, 3.4 + (x === 42 ? .6 : 0), 'pine'));
  }
}
for (const s of [-1, 1]) {
  ski.push(box(s * 52, -55, 5, 34, 2.6, 'snowbank'));
  ski.push(box(s * 52, 55, 5, 34, 2.6, 'snowbank'));
}
// Café Gijón: walls modelled as separate segments so the west (piste-facing) wall keeps a 3m doorway.
ski.push(box(cafeX + cafeW / 2, cafeZ, .4, cafeD, cafeH, 'chalet'));                 // east wall
ski.push(box(cafeX, cafeZ + cafeD / 2, cafeW, .4, cafeH, 'chalet'));                 // north wall
ski.push(box(cafeX, cafeZ - cafeD / 2, cafeW, .4, cafeH, 'chalet'));                 // south wall
ski.push(box(cafeX - cafeW / 2, cafeZ + 4.25, .4, 5.5, cafeH, 'chalet'));             // west wall, north of the door
ski.push(box(cafeX - cafeW / 2, cafeZ - 4.25, .4, 5.5, cafeH, 'chalet'));             // west wall, south of the door
ski.push(box(cafeX + 2, cafeZ, 3, 1, 1.1, 'counter'));
ski.push(box(cafeX - 2, cafeZ - 5, 1.4, 1.4, .9, 'diner'), box(cafeX - 2, cafeZ + 5, 1.4, 1.4, .9, 'diner'));
const skiSpawns = [
  {x:0,z:-95},{x:0,z:-65},{x:0,z:-35},{x:0,z:-5},{x:0,z:55},{x:0,z:85},
  {x:-24,z:-40},{x:-24,z:40},{x:20,z:-20},{x:20,z:20},{x:-40,z:0},{x:40,z:-60}
];
export const FFA_MAPS = {
  dockyard: {name:'Dockyard',halfWidth:36,halfDepth:32,cover:docks,spawns:ringSpawns(32,28)},
  atrium: {name:'Atrium',halfWidth:32,halfDepth:32,cover:atrium,spawns:ringSpawns(28,28)},
  ski: {name:'Ski Station',halfWidth:SKI_HALF_WIDTH,halfDepth:SKI_HALF_DEPTH,cover:ski,spawns:skiSpawns}
};
export function blockedAt(layout,x,z,radius=.65) {
  return Math.abs(x)>layout.halfWidth-1-radius || Math.abs(z)>layout.halfDepth-1-radius ||
    layout.cover.some(b=>Math.abs(x-b.x)<b.w/2+radius && Math.abs(z-b.z)<b.d/2+radius);
}
// Four-neighbour graph avoids diagonal corner clipping. Built once per map.
export function buildNavigation(layout, step=2) {
  const nodes=[], byKey=new Map();
  for(let z=-layout.halfDepth+2;z<=layout.halfDepth-2;z+=step)
    for(let x=-layout.halfWidth+2;x<=layout.halfWidth-2;x+=step)
      if(!blockedAt(layout,x,z,.8)){ const n={x,z,links:[],index:nodes.length}; nodes.push(n);byKey.set(`${x},${z}`,n); }
  for(const n of nodes) for(const [dx,dz] of [[step,0],[-step,0],[0,step],[0,-step]]) {
    const next=byKey.get(`${n.x+dx},${n.z+dz}`);
    if(next && !blockedAt(layout,n.x+dx/2,n.z+dz/2,.8)) n.links.push(next.index);
  }
  const nearest=p=>{
    const sorted=[...nodes].sort((a,b)=>(a.x-p.x)**2+(a.z-p.z)**2-((b.x-p.x)**2+(b.z-p.z)**2));
    // Attach moving actors to a reachable node on their side of a wall.
    if(blockedAt(layout,p.x,p.z,.65))return sorted[0];
    return sorted.find(n=>{
      const steps=Math.ceil(Math.hypot(n.x-p.x,n.z-p.z)/.3);
      for(let i=1;i<=steps;i++)if(blockedAt(layout,p.x+(n.x-p.x)*i/steps,p.z+(n.z-p.z)*i/steps,.65))return false;
      return true;
    })||sorted[0];
  };
  return {nodes,path(from,to){
    const start=nearest(from),end=nearest(to),queue=[start.index],previous=new Map([[start.index,null]]);
    for(let i=0;i<queue.length;i++) {
      const current=queue[i]; if(current===end.index) break;
      for(const next of nodes[current].links) if(!previous.has(next)){previous.set(next,current);queue.push(next);}
    }
    if(!previous.has(end.index))return [];
    const route=[];for(let i=end.index;i!==null;i=previous.get(i))route.push(nodes[i]);
    return route.reverse();
  }};
}
