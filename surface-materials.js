import * as THREE from 'three';
const cache=new Map();
// Height and roughness maps are data textures, not colour maps. Keep them linear.
function detailMaps(kind){
 const size=256,c=document.createElement('canvas');c.width=c.height=size;
 const ctx=c.getContext('2d'),pixels=ctx.createImageData(size,size);
 let seed=347;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const grain=random();let h=kind==='snow'?160+40*Math.sin(x*.08+Math.sin(y*.07))+grain*45:130+Math.sin(y*.35)*25+grain*30;
   const i=(y*size+x)*4;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=h;pixels.data[i+3]=255;
 }
 ctx.putImageData(pixels,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(4,4);return t;
}
export function skiMaterials(load){
 if(cache.has('ski'))return cache.get('ski');
 const physical=(file,rx,ry,opts={})=>{
   const map=load(`assets/textures/${file}`,rx,ry);map.anisotropy=8;
   return new THREE.MeshStandardMaterial({map,roughness:.88,...opts});
 };
 const snow=physical('snow.png',36,72,{color:0xeaf1f6,roughness:.96,bumpMap:detailMaps('snow'),bumpScale:.055});
 snow.bumpMap.repeat.set(55,110);
 // Broad variations make the piste read as terrain rather than a repeated photograph.
 snow.onBeforeCompile=shader=>{
   shader.vertexShader='varying vec3 vSnowPosition;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSnowPosition=position;');
   shader.fragmentShader='varying vec3 vSnowPosition;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
     float drift=sin(vSnowPosition.x*.17+sin(vSnowPosition.z*.065))*sin(vSnowPosition.z*.12);
     diffuseColor.rgb*=mix(vec3(.87,.93,.98),vec3(1.),drift*.5+.5);`);
 };
 const wood=physical('cafe.png',1,1,{color:0xc6b2a0,bumpScale:.025});wood.bumpMap=wood.map;
 const table=physical('mesa.png',1,1,{color:0xd0b69b,roughness:.48,bumpScale:.012});table.bumpMap=table.map;
 const floor=physical('mesa.png',4,6,{color:0x958a7b,roughness:.78,bumpScale:.018});floor.bumpMap=floor.map;
 const roof=new THREE.MeshStandardMaterial({color:0x333e46,metalness:.55,roughness:.58,bumpMap:detailMaps('metal'),bumpScale:.03});
 const result={snow,wood,table,floor,roof};cache.set('ski',result);return result;
}
// Box face UV density follows physical dimensions instead of stretching one image per face.
export function metricBoxUV(geometry,meters=3){
 const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  if(Math.abs(n.getY(i))>.5)uv.setXY(i,x/meters,z/meters);
  else if(Math.abs(n.getX(i))>.5)uv.setXY(i,z/meters,y/meters);
  else uv.setXY(i,x/meters,y/meters);
 }
 uv.needsUpdate=true;return geometry;
}
