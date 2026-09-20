import * as THREE from 'three';

// Fixed-capacity instancing keeps sustained fire from growing GPU allocations.
export function createImpactMarks(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const halo = ctx.createRadialGradient(32, 32, 3, 32, 32, 29);
  halo.addColorStop(0, 'rgba(12,10,8,1)');
  halo.addColorStop(0.25, 'rgba(24,21,17,.95)');
  halo.addColorStop(0.45, 'rgba(98,89,76,.75)');
  halo.addColorStop(0.65, 'rgba(43,38,32,.5)');
  halo.addColorStop(1, 'rgba(43,38,32,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(15,13,11,.65)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.399;
    ctx.beginPath(); ctx.moveTo(32, 32);
    ctx.lineTo(32 + Math.cos(angle) * 19, 32 + Math.sin(angle) * 19);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    toneMapped: false
  });
  const capacity = 96;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity);
  mesh.name = 'Pooled bullet impacts';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 0, 1);
  const normalMatrix = new THREE.Matrix3();
  const entries = Array.from({ length: capacity }, () => ({ life: 0, matrix: new THREE.Matrix4() }));
  let cursor = 0;
  function clear() {
    dummy.scale.setScalar(0); dummy.updateMatrix();
    entries.forEach((entry, i) => { entry.life = 0; mesh.setMatrixAt(i, dummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true;
    cursor = 0;
  }
  clear();
  return {
    clear,
    add(hit) {
      if (!hit?.face || !hit.object?.isMesh) return;
      normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix);
      dummy.position.copy(hit.point).addScaledVector(normal, 0.006);
      dummy.quaternion.setFromUnitVectors(axis, normal);
      dummy.rotateZ(Math.random() * Math.PI * 2);
      dummy.scale.setScalar(0.10 + Math.random() * 0.065);
      dummy.updateMatrix();
      entries[cursor].life = 24;
      entries[cursor].matrix.copy(dummy.matrix);
      mesh.setMatrixAt(cursor, dummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
      cursor = (cursor + 1) % capacity;
    },
    update(dt) {
      let changed = false;
      entries.forEach((entry, i) => {
        if (entry.life <= 0) return;
        entry.life = Math.max(0, entry.life - dt);
        if (entry.life < 2) {
          dummy.matrix.copy(entry.matrix);
          dummy.matrix.scale(normal.setScalar(entry.life / 2));
          mesh.setMatrixAt(i, dummy.matrix);
          changed = true;
        }
      });
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  };
}
