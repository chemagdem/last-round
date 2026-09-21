import * as THREE from 'three';
import {MALL,MALL_LEVEL,mallRamp,mallSupport,mallNavigation} from './mall-layout.js';
import {metricBoxUV} from './surface-materials.js';

// Compact architectural materials shared across rematches.
const materials=new Map();
function mallMaterial(kind){
 if(materials.has(kind))return materials.get(kind);
 const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');
 let seed=517;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 const colours={tile:'#bdb7aa',shutter:'#89949a',wood:'#796050',stone:'#c9c4b8',metal:'#647079'};
 ctx.fillStyle=colours[kind]||'#c9c4b8';ctx.fillRect(0,0,512,512);
 for(let i=0;i<14000;i++){
   ctx.fillStyle=`rgba(${random()>.5?'255,255,245':'45,45,38'},${kind==='tile'?.14:.05})`;
   const r=kind==='tile'?1+random()*2:1;ctx.fillRect(random()*512,random()*512,r,r);
 }
 if(kind==='tile'){
   ctx.strokeStyle='#74776f';ctx.lineWidth=2;ctx.strokeRect(0,0,512,512);
   for(let y=0;y<512;y+=256){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke();}
 }else if(kind==='shutter'){
   for(let y=0;y<512;y+=22){const g=ctx.createLinearGradient(0,y,0,y+22);g.addColorStop(0,'#59636a');g.addColorStop(.18,'#b6c0c2');g.addColorStop(.9,'#818d91');g.addColorStop(1,'#465258');ctx.fillStyle=g;ctx.fillRect(0,y,512,22);}
 }else if(kind==='wood'){
   for(let i=0;i<280;i++){ctx.strokeStyle=`rgba(40,26,15,${random()*.16})`;ctx.beginPath();const y=random()*512;ctx.moveTo(0,y);ctx.bezierCurveTo(180,y+random()*8,320,y-5,512,y);ctx.stroke();}
 }
 const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=8;
 const mat=new THREE.MeshStandardMaterial({map,roughness:kind==='tile'?.32:kind==='shutter'?.56:.82,metalness:kind==='shutter'||kind==='metal'?.6:0});
 materials.set(kind,mat);return mat;
}
export function buildMall({scene,addBox,floorMeshes,envMeshes}){
 const stone=mallMaterial('stone'),tile=mallMaterial('tile'),shutter=mallMaterial('shutter'),wood=mallMaterial('wood'),metal=mallMaterial('metal');
 const black=new THREE.MeshStandardMaterial({color:0x20292e,metalness:.4,roughness:.55});
 const green=new THREE.MeshStandardMaterial({color:0x385b43,roughness:.95});
 const glass=new THREE.MeshStandardMaterial({color:0xafd4d8,transparent:true,opacity:.32,roughness:.14,metalness:.2,depthWrite:false});
 const warm=new THREE.MeshStandardMaterial({color:0xffe1b8,emissive:0xffd49d,emissiveIntensity:1});
 const cool=new THREE.MeshStandardMaterial({color:0xd4e9f1,emissive:0xb5d8eb,emissiveIntensity:.6});
 function box(x,y,z,w,h,d,mat,solid=false){
   const geo=metricBoxUV(new THREE.BoxGeometry(w,h,d),mat===tile?3:mat===shutter?3:2.5);
   const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
   if(solid)addBox(mesh);return mesh;
 }
 function label(text,x,y,z,rotation=0,w=6,colour='#ede6cf'){
   const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d');
   ctx.fillStyle='#1f3036';ctx.fillRect(0,0,1024,192);ctx.fillStyle=colour;ctx.font='600 72px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,98,960);
   const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
   const mat=new THREE.MeshStandardMaterial({map:t,roughness:.75,emissive:0x36433c,emissiveIntensity:.2});
   const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,w*192/1024),mat);mesh.position.set(x,y,z);mesh.rotation.y=rotation;mesh.userData.disposeMapMaterial=true;scene.add(mesh);
 }
 const ground=box(0,-.15,0,72,.3,64,tile);floorMeshes.push(ground);envMeshes.push(ground);
 // A real ring mezzanine with an open central atrium and walkable space underneath.
 for(const s of [-1,1]){
   const side=box(s*25,MALL_LEVEL-.18,0,22,.36,64,tile,true);floorMeshes.push(side);
   const end=box(0,MALL_LEVEL-.18,s*23,28,.36,18,tile,true);floorMeshes.push(end);
   box(s*36,6,0,.7,12,64,stone,true);box(0,6,s*32,72,12,.7,stone,true);
 }
 for(const o of MALL.cover){
   const mat=o.kind==='shutter'?shutter:o.kind==='rail'||o.kind==='window'?glass:o.kind==='shelf'||o.kind==='bench'||o.kind==='display'||o.kind==='kiosk'?wood:stone;
   box(o.x,o.y+o.h/2,o.z,o.w,o.h,o.d,mat,true);
   if(o.kind==='rail')box(o.x,o.y+o.h+.04,o.z,o.w+.06,.09,o.d+.06,metal);
   if(o.kind==='column'){box(o.x,o.y+.15,o.z,o.w+.1,.3,o.d+.1,black);box(o.x,o.y+4.5,o.z,1.2,.25,1.2,metal);}
   if(o.kind==='planter'){
     box(o.x,o.y+o.h+.2,o.z,o.w-.2,.4,o.d-.2,green);
   }
   if(o.kind==='shutter'){
     box(o.x,o.y+.18,o.z,.65,.2,o.d,metal);
   }
 }
 // Shopfront signs, display lighting and distinct walk-in retail interiors on both levels.
 const names=['NORTH / OUTDOOR','FORMA / HOME','VINYL / RECORDS','STUDIO / WEAR'];
 for(let level=0;level<2;level++)for(const s of [-1,1])for(const [i,z] of [-22,-8,8,22].entries()){
   const y=level*MALL_LEVEL,open=(s<0&&z===-8)||(s>0&&z===8);
   box(s*23,y+3.95,z,.6,.55,12,black,true);
   label(names[(i+(s>0?1:0))%4],s*22.66,y+3.96,z,s<0?Math.PI/2:-Math.PI/2,8);
   for(const dz of [-6,6])box(s*22.7,y+1.85,z+dz,.2,3.7,.2,metal);
   if(open){
     box(s*28,y+.015,z,9,.03,11,wood);
     for(const dz of [-4.5,4.5]){
       for(let j=-1;j<=1;j++)box(s*33+j,y+1.35,z+dz,.55,.9,.35,j%2?black:stone);
     }
     box(s*28,y+3.9,z,7,.08,.35,warm);
     const light=new THREE.PointLight(0xffd8a0,1.6,12,2);light.position.set(s*28,y+3.4,z);scene.add(light);
   }else label('CLOSED',s*22.65,y+1.7,z,s<0?Math.PI/2:-Math.PI/2,1.5,'#a9b6bd');
 }
 // Elevator facade is scenery; the paired escalators provide vertical circulation.
 for(const level of [0,MALL_LEVEL]){
   box(0,level+1.8,-31.6,6,3.6,.15,metal);
   box(0,level+1.8,-31.49,.04,3.6,.03,black);
   label('01 / GALLERIA',0,level+4.2,-31.4,0,8);
   label(level?'L1 / SHOPS':'L0 / CONCOURSE',0,level+3,31.5,Math.PI,8);
 }
 // Opaque upper ceiling over the shopping ring; glazed skylight over the atrium.
 for(const s of [-1,1])box(s*25,11,0,22,.3,64,stone);
 for(const s of [-1,1])box(0,11,s*23,28,.3,18,stone);
 box(0,12,0,28,.12,28,cool);
 for(let x=-14;x<=14;x+=4)box(x,11.85,0,.16,.25,28,metal);
 for(let z=-14;z<=14;z+=4)box(0,11.85,z,28,.25,.16,metal);
 for(const s of [-1,1])for(const level of [0,MALL_LEVEL])for(const z of [-25,-12,0,12,25]){
   box(s*18,level+4.75,z,5,.08,.24,warm);
 }
 // Smooth invisible-to-motion ramp surface plus physical visual treads. Both are shot blockers.
 const escalators=[];
 for(const x of [-8,8]){
   const angle=Math.atan2(MALL_LEVEL,26),length=Math.hypot(26,MALL_LEVEL);
   const ramp=new THREE.Mesh(new THREE.PlaneGeometry(4,length),metal);
   ramp.rotation.x=-Math.PI/2-angle;ramp.position.set(x,MALL_LEVEL/2,1);ramp.material.side=THREE.DoubleSide;scene.add(ramp);floorMeshes.push(ramp);envMeshes.push(ramp);
   for(const s of [-1,1]){
     const rail=box(x+s*2.12,MALL_LEVEL/2+.85,1,.18,.7,length,glass);rail.rotation.x=-angle;
     const handrail=box(x+s*2.12,MALL_LEVEL/2+1.22,1,.22,.12,length,black);handrail.rotation.x=-angle;
     for(let z=-11;z<=13;z+=2){const y=mallRamp(x,z);const skirt=box(x+s*2.13,y+.6,z,.22,1.15,2.08,metal);skirt.rotation.x=-angle;addBox(skirt);}
   }
   const steps=new THREE.InstancedMesh(new THREE.BoxGeometry(3.9,.15,1),metal,27);steps.castShadow=true;steps.receiveShadow=true;scene.add(steps);
   escalators.push({x,steps,direction:x<0?1:-1});
   label(x<0?'UP / L1':'DOWN / L0',x,2.2,-13,0,3);
   label(x<0?'UP / L1':'DOWN / L0',x,MALL_LEVEL+2,15,Math.PI,3);
 }
 const dummy=new THREE.Object3D();let time=0;
 function update(dt){
   time+=dt;
   for(const e of escalators){for(let i=0;i<27;i++){
     const z=-12+((i+e.direction*time*1.25)%26+26)%26;
     dummy.position.set(e.x,mallRamp(e.x,z)-.08,z);dummy.updateMatrix();e.steps.setMatrixAt(i,dummy.matrix);
   }e.steps.instanceMatrix.needsUpdate=true;e.steps.computeBoundingSphere();}
 }
 update(0);
 return {spawn:new THREE.Vector3(-19,2,-27),tSpawn:new THREE.Vector3(-19,2,-27),ctSpawn:new THREE.Vector3(19,2,27),sites:[],ffa:MALL,
  supportHeight:mallSupport,navigation:mallNavigation,update,
  conveyor(x,z,feet){
    let h=mallRamp(x,z);
    if(Math.abs(Math.abs(x)-8)<=2&&z>=-13&&z<=15&&h===null)h=z>14?MALL_LEVEL:0;
    return h!==null&&Math.abs(h-feet)<.3?(x<0?1.25:-1.25):0;
  }};
}
