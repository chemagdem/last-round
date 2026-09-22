import * as THREE from 'three';

// OFFICE — rectangular corporate floor built from the supplied plan.
// Glass uses collision-only geometry: players cannot walk through it, while hitscan bullets
// ignore it because the panes are deliberately not registered in envMeshes.
export function buildOffice({ scene, floorMeshes, addBox }) {
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbfe9f4, transparent: true, opacity: 0.27, roughness: 0.08,
    metalness: 0.05, transmission: 0.62, side: THREE.DoubleSide, depthWrite: false
  });
  const glassEdge = new THREE.MeshStandardMaterial({ color: 0x27343a, roughness: 0.38, metalness: 0.72 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x555a5d, roughness: 0.9 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9c8c3, roughness: 0.82 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x59656d, roughness: 0.96 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7b5436, roughness: 0.72 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20262a, roughness: 0.5, metalness: 0.2 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x07131a, emissive: 0x153b50, emissiveIntensity: 0.65, roughness: 0.2 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x315f3c, roughness: 0.95 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x3c3024, roughness: 1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e5dd, roughness: 0.75 });

  const meshBox = (x, y, z, w, h, d, mat, solid = true, blocksBullets = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    if (solid) addBox(mesh, blocksBullets);
    return mesh;
  };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); floorMeshes.push(floor);

  // Thin carpet in every office bay.
  const rugs = [
    [-26,-14,12,8],[-10,-14,20,8],[10.5,-14,21,8],[29,-14,6,8],
    [-26,14,12,8],[-10,14,20,8],[10,14,20,8],[26,14,12,8]
  ];
  rugs.forEach(([x,z,w,d]) => meshBox(x,.012,z,w,.02,d,carpet,false));

  // Glass wall helper. Frames are visual only too, so a bullet can wallbang the complete partition.
  const glassWall = (x, z, length, axis='x', doorAt=null) => {
    const h=3.15, t=.10, door=1.65;
    const pane = (cx,cz,len) => {
      const m = axis==='x' ? meshBox(cx,h/2,cz,len,h,t,glass,true,false) : meshBox(cx,h/2,cz,t,h,len,glass,true,false);
      m.renderOrder = 2;
      // mullions
      const count=Math.max(1,Math.floor(len/3));
      for(let i=0;i<=count;i++){
        const p=-len/2+(len*i/count);
        axis==='x' ? meshBox(cx+p,h/2,cz,t*.7,h,.08,glassEdge,false) : meshBox(cx,h/2,cz+p,.08,h,t*.7,glassEdge,false);
      }
      axis==='x' ? meshBox(cx,h,cz,len+.08,.08,.12,glassEdge,false) : meshBox(cx,h,cz,.12,.08,len+.08,glassEdge,false);
    };
    if(doorAt===null){ pane(x,z,length); return; }
    const start=-length/2, left=doorAt-door/2-start, right=length-left-door;
    if(left>.05){ const c=start+left/2; axis==='x'?pane(x+c,z,left):pane(x,z+c,left); }
    if(right>.05){ const c=doorAt+door/2+right/2; axis==='x'?pane(x+c,z,right):pane(x,z+c,right); }
  };

  // Exterior shell is glass as requested; it is a movement boundary but bullets pass through it.
  glassWall(0,-18,64,'x'); glassWall(0,18,64,'x'); glassWall(-32,0,36,'z'); glassWall(32,0,36,'z');

  // North offices (top of plan): corridor-facing fronts and office-to-office glass partitions.
  glassWall(-26,-10,12,'x',0); glassWall(-10,-10,20,'x',0); glassWall(10.5,-10,21,'x',0); glassWall(29,-10,6,'x',0);
  [-20,0,21,26].forEach(x => glassWall(x,-14,8,'z',0));
  // WC in north-east, also glass-partitioned.
  glassWall(26,-14,8,'z',2.2);

  // South offices.
  glassWall(-26,10,12,'x',0); glassWall(-10,10,20,'x',0); glassWall(10,10,20,'x',0); glassWall(26,10,12,'x',0);
  [-20,0,20].forEach(x => glassWall(x,14,8,'z',0));

  // Two explicitly marked HORMIGÓN blocks from the plan.
  meshBox(-20,1.7,0,3.1,3.4,8.4,concrete,true,true);
  meshBox(20,1.7,0,3.1,3.4,8.4,concrete,true,true);

  // Central square garden: low concrete planter, soil and dense plants. Low enough to shoot over.
  meshBox(0,.35,0,11.5,.7,11.5,concrete,true,true);
  meshBox(0,.72,0,10.6,.08,10.6,soil,false);
  const plant = (x,z,s=.8) => {
    meshBox(x,.72,z,.16,.75,.16,wood,false);
    const crown=new THREE.Mesh(new THREE.SphereGeometry(s,8,6),leaf); crown.scale.y=1.35; crown.position.set(x,1.25,z); crown.castShadow=true; scene.add(crown);
  };
  [[-3.7,-3.5],[-1.2,-3.8],[2,-3.2],[3.7,-.8],[-3.8,.2],[-1.4,2.7],[1.4,3.5],[3.8,3]].forEach(p=>plant(...p,.7));

  // High tables beside the concrete blocks.
  const highTable = x => {
    meshBox(x,1.05,0,4.4,.18,2.5,wood,true,true);
    for(const sx of [-1,1]) for(const sz of [-1,1]) meshBox(x+sx*1.65,.52,sz*.75,.14,1.04,.14,dark,true,true);
  };
  highTable(-26); highTable(26);

  // Office furniture: desks, computers, chairs and occasional plants/TVs.
  const officeCenters=[[-26,-14],[-10,-14],[10,-14],[29,-14],[-26,14],[-10,14],[10,14],[26,14]];
  officeCenters.forEach(([x,z],i)=>{
    const deskZ=z+(z<0?1.2:-1.2);
    meshBox(x,.43,deskZ,3.8,.12,1.35,wood,true,true);
    for(const sx of [-1,1]) meshBox(x+sx*1.45,.22,deskZ,.14,.44,1.05,dark,true,true);
    // monitor + stand
    meshBox(x,.94,deskZ,1.15,.68,.10,screen,true,true);
    meshBox(x,.62,deskZ,.10,.28,.10,dark,true,true);
    // keyboard
    meshBox(x,.53,deskZ+(z<0?.42:-.42),.9,.035,.28,dark,false);
    // chair
    meshBox(x,.46,deskZ+(z<0?1.15:-1.15),.7,.12,.7,dark,true,true);
    meshBox(x,.88,deskZ+(z<0?1.42:-1.42),.72,.8,.12,dark,true,true);
    if(i%2===0){
      const px=x+(i%4<2?3.8:-3.8), pz=z;
      meshBox(px,.3,pz,.65,.6,.65,white,true,true); plant(px,pz,.55);
    }
    if(i===1||i===5){ // wall-mounted TVs in two larger offices
      const tvZ=z+(z<0?-3.86:3.86);
      meshBox(x,1.95,tvZ,3.2,1.65,.08,screen,false);
    }
  });

  // Ceiling light strips without a solid ceiling, preserving visibility and performance.
  const lightMat=new THREE.MeshStandardMaterial({color:0xf7fbff,emissive:0xe8f4ff,emissiveIntensity:1.5});
  for(let x=-27;x<=27;x+=9) for(const z of [-7,7]) meshBox(x,3.55,z,4.8,.06,.22,lightMat,false);
  const keyLight=new THREE.PointLight(0xf2f7ff,2.2,45,2); keyLight.position.set(0,5,0); scene.add(keyLight);

  return {
    spawn:new THREE.Vector3(-27,2,0), tSpawn:new THREE.Vector3(-27,2,0), ctSpawn:new THREE.Vector3(27,2,0),
    tSpawnZone:{xMin:-30,xMax:-24,zMin:-6,zMax:6}, ctSpawnZone:{xMin:24,xMax:30,zMin:-6,zMax:6}, sites:[]
  };
}
