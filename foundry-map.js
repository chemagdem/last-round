import * as THREE from 'three';
import { FOUNDRY } from './foundry-layout.js';

export function buildFoundry({ scene, floorMeshes, addBox, makeBoxProp, loadTiledTexture, hazardStripeTexture }) {
  const concrete = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/wall.jpg', 3, 2), color: 0x8e9897, roughness: 0.9 });
  const floorMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/subway_floor.webp', 18, 22), color: 0x929b98, roughness: 0.82 });
  const steel = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/metal.jpg', 2, 2), color: 0x586467, roughness: 0.56, metalness: 0.48 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x286766, roughness: 0.62, metalness: 0.35 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xc86c36, roughness: 0.65, metalness: 0.32 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x263337, roughness: 0.48, metalness: 0.65 });
  const light = new THREE.MeshStandardMaterial({ color: 0xb8e8e8, emissive: 0x90d4d5, emissiveIntensity: 1.1 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffb355, emissive: 0xee831c, emissiveIntensity: 0.75 });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 0.8 });
  for (const material of [steel, teal, orange, concrete]) material.userData.minimapProp = true;
  const batches = new Map();
  const transform = new THREE.Object3D();
  function box(x, y, z, w, h, d, material, solid = false) {
    if (!solid) {
      transform.position.set(x, y, z); transform.scale.set(w, h, d); transform.updateMatrix();
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material).push(transform.matrix.clone());
      return;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); if (solid) addBox(mesh);
    return mesh;
  }
  function sign(text, x, y, z, rotation = 0, color = '#a5e4db') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#152327'; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 12, 128);
    ctx.font = 'bold 50px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 66, 470);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.125), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 }));
    mesh.position.set(x, y, z); mesh.rotation.y = rotation; scene.add(mesh);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 52), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor); floorMeshes.push(floor);
  for (const side of [-1, 1]) {
    box(0, 3, side * 26, 45, 6, 1, concrete, true);
    box(side * 22, 3, 0, 1, 6, 52, concrete, true);
    // Clerestory panels and overhead gantries stay outside player movement space.
    for (const z of [-20, -10, 0, 10, 20]) {
      box(side * 21.43, 4.65, z, 0.05, 1.5, 5.5, light);
      box(side * 21, 3.9, z, 0.45, 7.8, 0.55, trim);
    }
    for (const z of [-12, 12]) {
      if (side < 0) box(0, 7.5, z, 44, 0.55, 0.45, trim);
      box(side * 9, 7.16, z, 5, 0.09, 0.25, light);
    }
    // Safe spawn exits split left/right behind a screen that blocks opening shots.
    sign(side < 0 ? '01 / CASTING' : '02 / ASSEMBLY', 0, 4.15, side * 25.45, side < 0 ? 0 : Math.PI);
    sign('FOUNDRY', side * 21.43, 3.1, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  for (const item of FOUNDRY.cover) {
    const { x, z, w, h, d, kind } = item;
    const color = x < 0 ? teal : orange;
    if (kind === 'tank') {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, h, 24), steel);
      tank.position.set(x, h / 2, z); tank.castShadow = true; tank.receiveShadow = true;
      scene.add(tank); addBox(tank);
      for (const y of [0.3, 1.9, 3.5]) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(1.41, 0.045, 6, 24), trim);
        band.rotation.x = Math.PI / 2; band.position.set(x, y, z); scene.add(band);
      }
    } else {
      makeBoxProp(x, z, w, h, d, kind === 'container' ? color : kind === 'reactor' ? orange : concrete);
      if (kind === 'container') {
        for (let offset = -3.6; offset <= 3.6; offset += 0.6) {
          for (const side of [-1, 1]) box(x + side * (w / 2 + 0.025), h / 2, z + offset, 0.055, h - 0.12, 0.09, color);
        }
        for (const side of [-1, 1]) {
          box(x, 0.12, z + side * d / 2, w, 0.14, 0.1, trim);
          box(x, h - 0.12, z + side * d / 2, w, 0.14, 0.1, trim);
        }
      }
      if (kind === 'screen' || kind === 'low') box(x, h - 0.12, z - d / 2 - 0.015, w, 0.24, 0.025, hazard);
      if (kind === 'reactor') {
        for (const side of [-1, 1]) {
          box(side * 2.015, 1.8, 0, 0.03, 0.12, 3.6, amber);
          box(0, 1.8, side * 2.015, 3.6, 0.12, 0.03, amber);
          sign('CORE / 03', 0, 1, side * 2.02, side < 0 ? Math.PI : 0, '#ffb56e');
        }
        box(0, 3, 0, 3, 0.4, 3, steel);
      }
    }
  }
  // Flush floor markings guide rotations without adding collision lips or steps.
  const paint = new THREE.MeshBasicMaterial({ color: 0xd9b975 });
  for (const side of [-1, 1]) {
    box(side * 14.7, 0.008, 0, 0.08, 0.01, 43, paint);
    for (const z of [-19, 19]) box(side * 9, 0.009, z, 9, 0.01, 0.1, paint);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.8, 4.87, 48), paint);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.018; scene.add(ring);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const [material, matrices] of batches) {
    const mesh = new THREE.InstancedMesh(unitBox, material, matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.castShadow = material !== paint; mesh.receiveShadow = true;
    mesh.computeBoundingSphere(); scene.add(mesh);
  }
  return { spawn: new THREE.Vector3(0, 2, -22), tSpawn: new THREE.Vector3(0, 2, -22),
    ctSpawn: new THREE.Vector3(0, 2, 22), tSpawnZone: FOUNDRY.spawnA, ctSpawnZone: FOUNDRY.spawnB, sites: [] };
}
