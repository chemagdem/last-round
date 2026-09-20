import * as THREE from 'three';

// Stable randomness for cover geometry: every peer must build identical collisions.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// A prefiltered studio-like sky provides actual reflections for metallic surfaces.
// This is generated locally and adds no external asset download.
export function createReflectionEnvironment(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#7f9eb7'); gradient.addColorStop(.43, '#c2d0d7');
  gradient.addColorStop(.5, '#f1e8ce'); gradient.addColorStop(.57, '#666058');
  gradient.addColorStop(1, '#242a30');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#fff6dd'; ctx.fillRect(80, 40, 70, 58);
  ctx.fillStyle = '#dcecff'; ctx.fillRect(340, 70, 42, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(texture);
  texture.dispose(); generator.dispose();
  return target;
}

// Shared detail resources survive rematches. They are not collision geometry.
const box = new THREE.BoxGeometry(1, 1, 1);
const signPlane = new THREE.PlaneGeometry(1, 1);
const darkSteel = new THREE.MeshStandardMaterial({ color: 0x35434b, metalness: .7, roughness: .48 });
const edgeSteel = new THREE.MeshStandardMaterial({ color: 0x899397, metalness: .65, roughness: .55 });
const timber = new THREE.MeshStandardMaterial({ color: 0x64513a, roughness: .92 });
const warmStone = new THREE.MeshStandardMaterial({ color: 0xb99e77, roughness: .94 });
const darkStone = new THREE.MeshStandardMaterial({ color: 0x485661, roughness: .9 });
const lightStrip = new THREE.MeshStandardMaterial({ color: 0xb9d4dc, emissive: 0x9eb8c6, emissiveIntensity: .75 });
const signCache = new Map();
let surfaceGrain;
function grainTexture() {
  if (surfaceGrain) return surfaceGrain;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'), data = ctx.createImageData(128, 128);
  const random = seededRandom(308);
  for (let i = 0; i < data.data.length; i += 4) {
    const value = 150 + Math.floor(random() * 70);
    data.data[i] = data.data[i+1] = data.data[i+2] = value; data.data[i+3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  surfaceGrain = new THREE.CanvasTexture(canvas);
  surfaceGrain.wrapS = surfaceGrain.wrapT = THREE.RepeatWrapping;
  surfaceGrain.repeat.set(12, 12);
  return surfaceGrain;
}

export function refineWorldMaterials(meshes, mapId) {
  const seen = new Set();
  for (const mesh of meshes) {
    if (mesh.material?.opacity === 0) continue;
    mesh.receiveShadow = true;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material?.isMeshStandardMaterial || seen.has(material)) continue;
      seen.add(material);
      material.envMapIntensity = material.metalness > .4 ? .6 : .22;
      if (!material.bumpMap && material.metalness < .4) {
        material.bumpMap = grainTexture();
        material.bumpScale = mapId === 'arena' ? .015 : .006;
      }
      material.roughness = Math.max(material.roughness, material.metalness > .4 ? .4 : .72);
      material.needsUpdate = true;
    }
  }
}

function block(parent, material, x, y, z, w, h, d) {
  const mesh = new THREE.Mesh(box, material);
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function sign(parent, title, subtitle, color, x, y, z, rotation = 0, width = 3.5) {
  const key = `${title}|${subtitle}|${color}`;
  if (!signCache.has(key)) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#172129'; ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 12, 192);
    ctx.fillRect(26, 160, 460, 2);
    ctx.fillStyle = '#e9eff0'; ctx.font = 'bold 54px sans-serif'; ctx.fillText(title, 30, 80);
    ctx.fillStyle = color; ctx.font = '20px sans-serif'; ctx.fillText(subtitle, 32, 124);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    signCache.set(key, new THREE.MeshStandardMaterial({ map: texture, roughness: .8, emissive: 0x25323a, emissiveIntensity: .15 }));
  }
  const mesh = new THREE.Mesh(signPlane, signCache.get(key));
  mesh.scale.set(width, width * 192 / 512, 1);
  mesh.position.set(x, y, z); mesh.rotation.y = rotation;
  parent.add(mesh);
}

export function addWorldDetail(scene, envMeshes, mapId) {
  const root = new THREE.Group(); root.name = 'environment-detail';
  root.userData.preserveResources = true;
  scene.add(root);
  // Thin edge strips stay on existing cover, preserving every firing lane.
  const instances = [];
  const worldBox = new THREE.Box3();
  for (const mesh of envMeshes) {
    if (!mesh.material?.userData?.minimapProp || mesh.geometry.type !== 'BoxGeometry') continue;
    worldBox.setFromObject(mesh);
    const s = worldBox.getSize(new THREE.Vector3()), p = worldBox.getCenter(new THREE.Vector3());
    if (s.x > 4 || s.z > 4 || s.y > 4) continue;
    for (const side of [-1, 1]) {
      instances.push([p.x + side * (s.x / 2 - .05), p.y, p.z + s.z / 2 + .008, .075, s.y, .025]);
      instances.push([p.x + side * (s.x / 2 - .05), p.y, p.z - s.z / 2 - .008, .075, s.y, .025]);
      instances.push([p.x, p.y + side * (s.y / 2 - .06), p.z, s.x, .10, s.z + .025]);
    }
  }
  if (instances.length) {
    const instanced = new THREE.InstancedMesh(box, mapId === 'arena' ? timber : edgeSteel, instances.length);
    const dummy = new THREE.Object3D();
    instances.forEach(([x,y,z,w,h,d], i) => {
      dummy.position.set(x,y,z); dummy.scale.set(w,h,d); dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    });
    instanced.castShadow = true; instanced.receiveShadow = true; root.add(instanced);
  }

  if (mapId === 'arena' || mapId === 'skyline') {
    const random = seededRandom(mapId === 'arena' ? 47 : 83);
    // Exterior architecture fills the horizon without adding playable obstacles.
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      const radius = mapId === 'arena' ? 55 : 85;
      const height = mapId === 'arena' ? 5 + random() * 8 : 12 + random() * 45;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const building = new THREE.Group(); building.position.set(x, mapId === 'arena' ? 0 : -16, z);
      building.rotation.y = -angle; root.add(building);
      block(building, mapId === 'arena' ? warmStone : darkStone, 0, height / 2, 0, 8, height, 10);
      block(building, darkSteel, 0, height + .25, 0, 8.4, .5, 10.4);
      for (let level = 2; level < height - 1; level += mapId === 'arena' ? 3 : 4) {
        for (const side of [-1, 1]) {
          block(building, mapId === 'arena' ? darkSteel : lightStrip, side * 2.4, level, 5.015, 1.1, 1.45, .025);
          block(building, mapId === 'arena' ? darkSteel : lightStrip, side * 2.4, level, -5.015, 1.1, 1.45, .025);
        }
      }
    }
  }
  if (mapId === 'skyline') {
    // Vent grilles on the central block: visible equipment rather than blank slabs.
    for (const side of [-1, 1]) {
      for (let i = -5; i <= 5; i += 2.5) {
        block(root, darkSteel, i, 1.65, side * 4.41, 1.65, 1.2, .025);
        for (let j = 0; j < 6; j++) block(root, edgeSteel, i, 1.18 + j * .18, side * 4.435, 1.55, .035, .02);
      }
    }
    sign(root, 'ROOF ACCESS', 'SERVICE DECK / 07', '#deb873', 0, 2.0, -32.4);
    sign(root, 'EXTRACTION', 'SERVICE DECK / 07', '#8bbdcf', 0, 2.0, 32.4, Math.PI);
  }
  if (mapId === 'arena') {
    sign(root, 'SECTOR A', 'NORTH APPROACH', '#d7af73', 0, 3, -25.94);
    sign(root, 'SECTOR B', 'SOUTH APPROACH', '#88b5c5', 0, 3, 25.94, Math.PI);
  }
  if (mapId === 'warehouse') {
    sign(root, 'LOADING 01', 'AUTHORIZED PERSONNEL', '#deb873', 0, 3.5, -25.94);
    sign(root, 'LOADING 02', 'KEEP ACCESS CLEAR', '#8bbdcf', 0, 3.5, 25.94, Math.PI);
    for (const z of [-20, -10, 0, 10, 20]) {
      block(root, darkSteel, 0, 7.1, z, 47, .22, .24);
      for (const x of [-12, 0, 12]) block(root, lightStrip, x, 6.95, z, 2.4, .035, .16);
    }
  }
  if (mapId === 'subway') {
    sign(root, 'NORTHBOUND', 'PLATFORM 01 / EXIT A', '#8bbdcf', -3, 3.2, -39.94, 0, 4);
    sign(root, 'SOUTHBOUND', 'PLATFORM 01 / EXIT B', '#deb873', -3, 3.2, 39.94, Math.PI, 4);
    for (const z of [-28, -8, 12, 32]) {
      sign(root, 'LAST ROUND', 'TRANSIT AUTHORITY / LINE 07', '#8bbdcf', -8.94, 2.8, z, Math.PI / 2, 3);
    }
    // A narrow safety stripe follows the platform, outside the central combat lane.
    block(root, edgeSteel, 8.65, .013, 0, .10, .02, 80);
  }
  // Batch repeated panels by material to keep draw calls bounded.
  root.updateMatrixWorld(true);
  const batches = new Map();
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.geometry !== box) return;
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(mesh);
  });
  for (const [material, meshes] of batches) {
    const batch = new THREE.InstancedMesh(box, material, meshes.length);
    meshes.forEach((mesh, index) => {
      batch.setMatrixAt(index, mesh.matrixWorld);
      mesh.removeFromParent();
    });
    batch.castShadow = true; batch.receiveShadow = true;
    root.add(batch);
  }
  return root;
}
