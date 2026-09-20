import * as THREE from 'three';
import { WEAPON_SIGHTS } from './weapon-aim.js';

export function attachWeaponSight(group, id, material) {
  const sight = WEAPON_SIGHTS[id];
  if (!sight) return null;
  const { x, y, rearZ, frontZ, type } = sight;
  const assembly = new THREE.Group();
  assembly.name = `${id} aligned sight assembly`;
  function box(width, height, depth, px, py, pz) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(px, py, pz);
    assembly.add(mesh);
    return mesh;
  }
  function ring(radius, tube, pz) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 32), material);
    mesh.position.set(x, y, pz);
    assembly.add(mesh);
  }
  if (type === 'notch') {
    // An actual U-shaped opening, not a solid block across the aiming line.
    box(0.052, 0.008, 0.016, x, y - 0.022, rearZ);
    for (const side of [-1, 1]) box(0.017, 0.022, 0.016, x + side * 0.0175, y - 0.007, rearZ);
  } else if (type === 'aperture') {
    ring(0.019, 0.004, rearZ);
    box(0.032, 0.023, 0.02, x, y - 0.032, rearZ);
  } else {
    ring(0.027, 0.004, rearZ);
    box(0.045, 0.022, 0.05, x, y - 0.038, rearZ);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.023, 32), new THREE.MeshBasicMaterial({
      color: 0x6babb7, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide
    }));
    glass.position.set(x, y, rearZ);
    assembly.add(glass);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 12), new THREE.MeshBasicMaterial({
      color: 0xff4632, toneMapped: false, depthWrite: false
    }));
    dot.position.set(x, y, rearZ + 0.001);
    assembly.add(dot);
  }
  if (frontZ !== undefined) {
    // The tip, not the centre of the post, defines the point of aim.
    box(0.007, 0.056, 0.012, x, y - 0.028, frontZ);
    box(0.052, 0.014, 0.03, x, y - 0.061, frontZ);
    for (const side of [-1, 1]) {
      const ear = box(0.006, 0.042, 0.018, x + side * 0.024, y - 0.024, frontZ);
      ear.rotation.z = side * -0.18;
    }
  }
  group.add(assembly);
  return sight;
}
