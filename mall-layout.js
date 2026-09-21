// Two-level circulation graph shared by physics, spawning and host-owned AI.
export const MALL_LEVEL=5.4;
const b=(x,z,w,d,h=3.8,level=0,kind='wall')=>({x,z,w,d,h,y:level*MALL_LEVEL,level,kind});
const cover=[];
for(let level=0;level<2;level++){
  for(const side of [-1,1]){
    for(const z of [-22,-8,8,22]){
      // Three shuttered shops and one walk-in shop on each side, per floor.
      const open=(side<0&&z===-8)||(side>0&&z===8);
      if(!open)cover.push(b(side*23,z,.5,12,3.7,level,'shutter'));
      else {
        cover.push(b(side*23,z-4.5,.5,3,3.7,level,'window'));
        cover.push(b(side*23,z+4.5,.5,3,3.7,level,'window'));
        cover.push(b(side*28,z,2,3,1.2,level,'display'));
        for(const dz of [-4.5,4.5])cover.push(b(side*33,z+dz,3,.6,2,level,'shelf'));
      }
      cover.push(b(side*29,z-6,12,.5,3.8,level));
      cover.push(b(side*29,z+6,12,.5,3.8,level));
    }
    for(const z of [-20,0,20])cover.push(b(side*18,z,1,1,4.8,level,'column'));
    cover.push(b(side*18,12,2,4,1.1,level,'planter'));
    cover.push(b(side*18,-14,2,4,1.1,level,'bench'));
  }
  if(level===0){cover.push(b(0,-21,8,4,2.1,0,'kiosk'));cover.push(b(0,22,6,3,1.2,0,'planter'));}
  // Upper balcony railings stop falls, with openings only at escalator landings.
  if(level===1){
    cover.push(b(-13.7,0,.3,26,1.1,1,'rail'),b(13.7,0,.3,26,1.1,1,'rail'));
    cover.push(b(0,-13.7,27.4,.3,1.1,1,'rail'));
    cover.push(b(0,13.7,9,.3,1.1,1,'rail'),b(-12,13.7,3.4,.3,1.1,1,'rail'),b(12,13.7,3.4,.3,1.1,1,'rail'));
  }
}
export const MALL={name:'Mall',halfWidth:36,halfDepth:32,cover,levels:2,
 spawns:[{x:-19,z:-27,y:0},{x:19,z:-27,y:0},{x:-19,z:27,y:0},{x:19,z:27,y:0},{x:-30,z:-8,y:0},{x:30,z:8,y:0},
 {x:-19,z:-27,y:MALL_LEVEL},{x:19,z:-27,y:MALL_LEVEL},{x:-19,z:27,y:MALL_LEVEL},{x:19,z:27,y:MALL_LEVEL},{x:-30,z:-8,y:MALL_LEVEL},{x:30,z:8,y:MALL_LEVEL}]};
export function mallRamp(x,z){
 if(Math.abs(Math.abs(x)-8)<=2&&z>=-12&&z<=14)return MALL_LEVEL*(z+12)/26;
 return null;
}
export function mallUpper(x,z){return Math.abs(x)>=14||Math.abs(z)>=14;}
export function mallSupport(x,z,feet=0){
 const ramp=mallRamp(x,z);
 if(ramp!==null&&feet>=ramp-.55)return ramp;
 return mallUpper(x,z)&&feet>=MALL_LEVEL-.55?MALL_LEVEL:0;
}
export function mallBlocked(x,z,y,r=.6){
 if(Math.abs(x)>35-r||Math.abs(z)>31-r)return true;
 // Closed retail units are intentionally absent from the walkable graph.
 for(const zc of [-22,-8,8,22])if(Math.abs(x)>23&&Math.abs(z-zc)<6&& !((x<0&&zc===-8)||(x>0&&zc===8)))return true;
 // The metal balustrades flank each moving flight at its local height.
 if(z>-12&&z<14)for(const cx of [-8,8])if(Math.abs(Math.abs(x-cx)-2.13)<.11+r&&Math.abs(y-mallRamp(cx,z))<1.25)return true;
 return cover.some(o=>y+1.8>o.y+.05&&y<o.y+o.h-.05&&Math.abs(x-o.x)<o.w/2+r&&Math.abs(z-o.z)<o.d/2+r);
}
export function mallWalk(x,z,fromY,r=.6){
 const y=mallSupport(x,z,fromY);
 // Bots use the escalators instead of jumping off balconies.
 return Math.abs(y-fromY)<.6&&!mallBlocked(x,z,y,r)?y:null;
}
export function mallNavigation(){
 const nodes=[],keys=new Map();
 for(let z=-28;z<=28;z+=2)for(let x=-32;x<=32;x+=2){
   for(const y of [0,MALL_LEVEL]){
     if(y>0&&!mallUpper(x,z))continue;
     // No floor path beneath the occupied escalator footprint.
     if(mallRamp(x,z)!==null&&z>-12&&z<14)continue;
     if(mallBlocked(x,z,y,.72))continue;
     const n={x,y,z,index:nodes.length,links:[]};nodes.push(n);keys.set(`${x},${z},${y}`,n);
   }
   const y=mallRamp(x,z);
   if(y!==null&&!mallBlocked(x,z,y,.72)&&!nodes.some(n=>n.x===x&&n.z===z&&Math.abs(n.y-y)<.01))nodes.push({x,y,z,index:nodes.length,links:[]});
 }
 for(const n of nodes)for(const m of nodes){
   if(Math.abs(n.x-m.x)+Math.abs(n.z-m.z)!==2||Math.abs(n.y-m.y)>.6)continue;
   if(mallWalk((n.x+m.x)/2,(n.z+m.z)/2,n.y,.72)!==null)n.links.push(m.index);
 }
 const nearest=p=>nodes.reduce((a,b)=>((a.x-p.x)**2+(a.z-p.z)**2+4*(a.y-(p.y||0))**2)<((b.x-p.x)**2+(b.z-p.z)**2+4*(b.y-(p.y||0))**2)?a:b);
 return {nodes,path(from,to){
   const start=nearest(from),end=nearest(to),q=[start.index],prev=new Map([[start.index,null]]);
   for(let i=0;i<q.length;i++){if(q[i]===end.index)break;for(const j of nodes[q[i]].links)if(!prev.has(j)){prev.set(j,q[i]);q.push(j);}}
   if(!prev.has(end.index))return [];
   const route=[];for(let i=end.index;i!==null;i=prev.get(i))route.push(nodes[i]);return route.reverse();
 }};
}
