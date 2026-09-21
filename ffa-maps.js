import * as THREE from 'three';
import { FFA_MAPS } from './ffa-layouts.js';

const materialCache = new Map();
let paintedSteelTexture;
function paintTexture(){
  if (paintedSteelTexture) return paintedSteelTexture;
  const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle='#dededb';ctx.fillRect(0,0,512,512);
  let seed=9811;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(let i=0;i<18000;i++){
    const shade=100+Math.floor(random()*100);ctx.fillStyle=`rgba(${shade},${shade},${shade},.12)`;
    ctx.fillRect(random()*512,random()*512,random()*3+1,random()*2+1);
  }
  for(let i=0;i<120;i++){
    ctx.fillStyle='rgba(75,69,58,.1)';ctx.fillRect(random()*512,random()*512,.7,4+random()*32);
  }
  paintedSteelTexture=new THREE.CanvasTexture(c);paintedSteelTexture.colorSpace=THREE.SRGBColorSpace;
  paintedSteelTexture.wrapS=paintedSteelTexture.wrapT=THREE.RepeatWrapping;
  return paintedSteelTexture;
}

export function buildFfaMap(id,{scene,floorMeshes,addBox,loadTiledTexture}) {
  const layout=FFA_MAPS[id], port=id==='dockyard', batches=new Map();
  const material=(color,file,rx=2,rz=2,metalness=0)=>{
    const key=[color,file,rx,rz,metalness].join('|');
    if(!materialCache.has(key)) materialCache.set(key,new THREE.MeshStandardMaterial({color,roughness:metalness?.68:.88,metalness,
      ...(file?{map:file==='paint'?paintTexture():loadTiledTexture(`assets/textures/${file}`,rx,rz)}:{})}));
    return materialCache.get(key);
  };
  const stone=material(port?0xadb7b6:0xe1ded0,'paint');
  const ground=material(port?0x747f81:0xc1bba5,'subway_floor.webp',24,24);
  const teal=material(0x4b98a3,'paint',2,3,.18), rust=material(0xd8834d,'paint',2,3,.18);
  const trim=material(0x43575f,'paint',1,1,.25), leaf=material(0x42644a), soil=material(0x33392e);
  const white=material(0xe7ddd0), paint=material(port?0xd7af60:0x6d9b99);
  const lamp=material(0xd9fff2);lamp.emissive.set(0x91d7c8);lamp.emissiveIntensity=1.1;
  for(const m of [stone,teal,rust,trim])m.userData.minimapProp=true;
  function box(x,y,z,w,h,d,mat,solid=false){
    if(solid){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);
      mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);addBox(mesh);return mesh;}
    const t=new THREE.Object3D();t.position.set(x,y,z);t.scale.set(w,h,d);t.updateMatrix();
    if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(t.matrix.clone());
  }
  function sign(text,x,y,z,rotation=0,color='#d5ebe2',w=4){
    const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');
    ctx.fillStyle='#203138';ctx.fillRect(0,0,512,128);ctx.fillStyle=color;ctx.fillRect(18,22,5,84);
    ctx.font='bold 44px sans-serif';ctx.textAlign='center';ctx.fillText(text,266,82,455);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,w/4),new THREE.MeshStandardMaterial({map:tex,roughness:.8}));
    mesh.position.set(x,y,z);mesh.rotation.y=rotation;mesh.userData.disposeMapMaterial=true;scene.add(mesh);return mesh;
  }
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(layout.halfWidth*2,layout.halfDepth*2),ground);
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);floorMeshes.push(floor);
  for(const s of [-1,1]){
    box(0,3,s*layout.halfDepth,layout.halfWidth*2+1,6,1,stone,true);
    box(s*layout.halfWidth,3,0,1,6,layout.halfDepth*2,stone,true);
    for(let x=-layout.halfWidth+4;x<layout.halfWidth;x+=8)box(x,3,s*(layout.halfDepth-.515),.04,5.8,.02,trim);
    for(let z=-layout.halfDepth+4;z<layout.halfDepth;z+=8)box(s*(layout.halfWidth-.515),3,z,.02,5.8,.04,trim);
    box(0,5.9,s*(layout.halfDepth-.52),layout.halfWidth*2,.18,.12,trim);
    box(s*(layout.halfWidth-.52),5.9,0,.12,.18,layout.halfDepth*2,trim);
    for(let x=-24;x<=24;x+=12){
      box(x,4.3,s*(layout.halfDepth-.54),6,.7,.06,port?teal:trim);
      box(x,5.1,s*(layout.halfDepth-.6),2,.12,.3,lamp);
    }
    sign(port?'DOCKYARD / FREIGHT':'ATRIUM / RESEARCH',0,4.5,s*(layout.halfDepth-.56),s<0?0:Math.PI);
  }
  layout.cover.forEach((b,i)=>{
    const m=b.kind==='cargo'?(b.x<0?teal:rust):b.kind==='tower'?trim:stone;
    box(b.x,b.h/2,b.z,b.w,b.h,b.d,m,true);
    box(b.x,b.h+.04,b.z,b.w+.1,.08,b.d+.1,port?trim:white);
    if(b.kind==='cargo'){
      // Physical ribs, corner castings and locking rods remain within the solid envelope.
      for(let z=-b.d/2+.2;z<b.d/2;z+=.48)for(const s of [-1,1])
        box(b.x+s*(b.w/2+.015),b.h/2,b.z+z,.055,b.h-.25,.08,m);
      for(const s of [-1,1]){
        for(const x of [-b.w/2+.14,b.w/2-.14])box(b.x+x,b.h/2,b.z+s*b.d/2,.16,b.h,.16,trim);
        for(const x of [-.7,.7])box(b.x+x,b.h/2,b.z+s*(b.d/2+.04),.06,b.h-.3,.08,white);
        sign(`LRFU ${String(i+101).padStart(6,'0')}`,b.x,b.h-.7,b.z+s*(b.d/2+.06),s<0?Math.PI:0,'#e4dabe',Math.min(3,b.w-.4));
      }
    }else if(b.kind==='garden'){
      box(b.x,b.h+.08,b.z,b.w-.25,.14,b.d-.25,soil);
      // Dense hedges are inside the collider footprint; no concealed passage through foliage.
      for(let x=-b.w/2+.6;x<b.w/2;x+=1.2)for(let z=-b.d/2+.6;z<b.d/2;z+=1.2)
        box(b.x+x,b.h+.32,b.z+z,.9,.5,.9,leaf);
    }else if(b.kind==='screen'){
      sign(`${port?'BERTH':'WING'} ${String(i%4+1).padStart(2,'0')}`,b.x,b.h-.7,b.z-b.d/2-.03,Math.PI,port?'#efbc71':'#a7dfd0',Math.min(b.w-.1,3));
    }
    if(b.kind==='tower'){
      for(const s of [-1,1]){
        box(b.x+s*(b.w/2+.025),3.8,b.z,.06,1.4,b.d-1,teal);
        sign('PORT CONTROL',0,2.7,s*(b.d/2+.03),s<0?Math.PI:0,'#f4b85f',5);
      }
      box(0,6.3,0,.18,2.6,.18,white);box(0,7.5,0,3,.12,.15,trim);
    }
  });
  if(port){
    // Gantry structure above combat space; all vertical supports are outside the walls.
    for(const s of [-1,1]){
      box(s*37,7,0,1,14,1,rust);box(0,13,s*1.2,76,.7,.5,rust);
      for(let x=-34;x<35;x+=4)box(x,12.3,0,.2,1.4,2.4,trim);
      for(const z of [-20,20]){
        box(s*9,0.012,z,13,.015,.12,paint);
        for(let x=4;x<=14;x+=2)box(s*x,.013,z+1.4,.14,.015,2.8,paint);
      }
    }
    box(0,10.8,0,4,2.4,3,teal);
  }else{
    for(const sx of [-1,1])for(const sz of [-1,1]){
      // Shaded pavilion roof sits over existing walls without blocking the two exits.
      box(sx*13,3.8,sz*15,10,.25,8,white,true);
      for(let x=-4;x<=4;x+=1)box(sx*13+x,4.04,sz*15,.16,.22,8,trim);
      box(sx*13,3.63,sz*15,3,.06,.2,lamp);
      sign(`${sx<0?'WEST':'EAST'} / ${sz<0?'LAB':'COURT'}`,sx*13,2.6,sz*12-sz*.78,sz<0?0:Math.PI,'#a7dfd0');
    }
    for(const s of [-1,1]){
      box(s*5,.012,0,.12,.015,52,paint);box(0,.012,s*6,52,.015,.12,paint);
    }
  }
  // Inlaid spawn bay marks let players learn safe rotation points.
  layout.spawns.forEach((p,i)=>{
    box(p.x,.012,p.z,2,.018,.09,paint);
    const marker=sign(`F${String(i+1).padStart(2,'0')}`,p.x,.024,p.z,0,'#b6cec4',1.5);marker.rotation.set(-Math.PI/2,0,0);
  });
  const unit=new THREE.BoxGeometry(1,1,1);
  for(const [mat,list] of batches){const mesh=new THREE.InstancedMesh(unit,mat,list.length);
    list.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();scene.add(mesh);}
  const p=layout.spawns[0];
  return {spawn:new THREE.Vector3(p.x,2,p.z),tSpawn:new THREE.Vector3(p.x,2,p.z),ctSpawn:new THREE.Vector3(-p.x,2,-p.z),sites:[],ffa:layout};
}

export function ffaThumbnail(id){
  const l=FFA_MAPS[id],c=document.createElement('canvas');c.width=480;c.height=260;
  const ctx=c.getContext('2d');ctx.fillStyle=id==='dockyard'?'#243c45':'#444e46';ctx.fillRect(0,0,480,260);
  const scale=3.1,cx=240,cy=130;
  ctx.strokeStyle='#92ab9d';ctx.strokeRect(cx-l.halfWidth*scale,cy-l.halfDepth*scale,l.halfWidth*6.2,l.halfDepth*6.2);
  for(const b of l.cover){ctx.fillStyle=b.kind==='cargo'?(b.x<0?'#65a8ad':'#d89660'):id==='atrium'?'#c9c7af':'#88969a';
    ctx.fillRect(cx+(b.x-b.w/2)*scale,cy+(b.z-b.d/2)*scale,b.w*scale,b.d*scale);}
  ctx.fillStyle='#a4f0cb';for(const p of l.spawns){ctx.beginPath();ctx.arc(cx+p.x*scale,cy+p.z*scale,2.5,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#e8f0e9';ctx.font='bold 12px sans-serif';ctx.fillText('FFA / 6–12',18,24);
  return c.toDataURL();
}
