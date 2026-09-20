import * as THREE from 'three';

// Thin architectural details stay on existing walls or above playable headroom.
export function addMapFinish(scene, id, groundHeightAt) {
  const root = new THREE.Group(); root.name = `${id}-architectural-finish`;
  const dark = new THREE.MeshStandardMaterial({ color: 0x283537, roughness: 0.7, metalness: 0.4 });
  const warm = new THREE.MeshStandardMaterial({ color: id === 'arena' ? 0x9d7850 : 0xb18d50, roughness: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xafd9d4, emissive: 0x659d96, emissiveIntensity: 0.65 });
  const pools = new Map();
  const dummy = new THREE.Object3D();
  function block(x, y, z, w, h, d, material = dark) {
    dummy.position.set(x,y,z); dummy.scale.set(w,h,d); dummy.updateMatrix();
    if (!pools.has(material)) pools.set(material, []);
    pools.get(material).push(dummy.matrix.clone());
  }
  function plaque(text, x, y, z, rotation, tint = '#d7bd88') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#152025'; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = tint; ctx.fillRect(0, 0, 12, 128);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 38px sans-serif';
    ctx.fillText(text, 258, 64, 470);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.95), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }));
    mesh.position.set(x,y,z); mesh.rotation.y = rotation; root.add(mesh);
    // These resources belong to this map build, not the shared texture cache.
    mesh.userData.disposeMapMaterial = true;
  }
  if (id === 'arena' || id === 'warehouse') {
    for (const z of [-22, -11, 0, 11, 22]) {
      block(25.98, 2.5, z, 0.05, 5, 0.45, warm);
      block(25.94, 0.18, z, 0.06, 0.36, 10.5, dark);
    }
    plaque(id === 'arena' ? 'EAST / COURTYARD' : 'ASSEMBLY / EAST', 25.91, 3.4, 0, -Math.PI / 2);
    if (id === 'warehouse') {
      for (const x of [-8, 8, 19]) {
        block(x, 7.9, 0, 0.15, 0.15, 50, warm);
        for (const z of [-20,-10,0,10,20]) block(x, 8.25, z, 0.32, 0.65, 0.12);
      }
      for (const z of [-5,5]) {
        block(-4, 2.315, z, 2.7, 0.03, 4.6, dark);
        block(-2.48, 1.55, z, 0.03, 0.1, 3.6, glow);
      }
    } else {
      // Fine masonry joints add scale without another full-resolution texture.
      for (let y = 0.8; y < 4.5; y += 0.8) block(25.965, y, 0, 0.035, 0.024, 51, dark);
    }
  }
  if (id === 'subway') {
    for (const z of [-30,-15,0,15,30]) {
      plaque(z < 0 ? 'NORTH / PLATFORM 01' : 'SOUTH / PLATFORM 02', -8.93, 2.9, z, Math.PI / 2, '#afdcd6');
      block(-8.94, 0.19, z, 0.05, 0.38, 14.8);
    }
    for (let z = -37; z <= 37; z += 4) {
      block(8.55, 0.012, z, 0.17, 0.02, 0.65, warm);
      block(-8.92, 4.2, z, 0.06, 0.08, 2.6, glow);
    }
  }
  if (id === 'skyline') {
    for (const side of [-1,1]) {
      block(0, 2.42, side * 33, 66, 0.06, 1.16);
      block(side * 33, 2.42, 0, 1.16, 0.06, 66);
      plaque('SERVICE / CROSSING', side * 7.4, 3.5, 0, side < 0 ? -Math.PI / 2 : Math.PI / 2);
      // Entrance lintels frame the new side doorways without reducing clearance.
      block(side * 7.4, 3.15, 0, 1.2, 0.22, 3.8);
    }
    for (const side of [-1,1]) for (const z of [-2.4,2.4]) block(side * 2.3, 0.015, z, 0.9, 0.02, 0.12, warm);
  }
  if (id === 'foundry') {
    for (const side of [-1,1]) {
      for (const z of [-20,-10,0,10,20]) block(side * 21.46, 0.2, z, 0.05, 0.4, 9.8);
      plaque('FLANK / TANKS', side * 21.4, 3.2, side * 15, side < 0 ? Math.PI / 2 : -Math.PI / 2, '#b8ded7');
    }
  }
  const geometry = new THREE.BoxGeometry(1,1,1);
  for (const [material, matrices] of pools) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    mesh.userData.disposeMapMaterial = true; root.add(mesh);
  }
  scene.add(root);
}
