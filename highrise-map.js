import * as THREE from 'three';

// Highrise: a single unfinished-skyscraper rooftop (inspired by Modern Warfare 2's map of the same
// name), not a tower-and-pit map like Scrapyard's watchtower - the whole roof is walkable, low
// parapets keep normal play safe, and the one deliberate hazard is the construction crane at the
// NE corner: climb the mast, walk the boom out past the parapet line, and there's nothing under
// you once you step off the sides or the tip - the map's namesake "suicide shot" spot.
export function buildHighrise({ scene, floorMeshes, addBox, makeBoxProp, loadTiledTexture, hazardStripeTexture, metalScratchTexture }) {
  const HALF_X = 28, HALF_Z = 36;
  const CRANE_X = 22, CRANE_Z = -30, DECK_Y = 11, BOOM_LEN = 22, DECK_HALF = 1.5;

  // ---------- materials ----------
  const roofTex = metalScratchTexture('#888c89'); roofTex.repeat.set(9, 11);
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95, color: 0xc9ccc7 });
  roofMat.userData.minimapProp = true;
  const parapetTex = metalScratchTexture('#676c68'); parapetTex.repeat.set(6, 1);
  const parapetMat = new THREE.MeshStandardMaterial({ map: parapetTex, roughness: 0.9, color: 0xa7ada8 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2c3033, roughness: 0.55, metalness: 0.72 });
  steelMat.userData.minimapProp = true;
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x8a4a2c, roughness: 0.82, metalness: 0.25 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe4f2, transparent: true, opacity: 0.3, roughness: 0.1,
    metalness: 0.05, transmission: 0.55, side: THREE.DoubleSide, depthWrite: false
  });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.85 });
  crateMat.userData.penetrable = true; crateMat.userData.minimapProp = true;
  const tarpMat = new THREE.MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.75, side: THREE.DoubleSide });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 0.9 });

  // ---------- roof floor ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2), roofMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); floorMeshes.push(floor);

  // ---------- perimeter parapet (low - a real rail, not a boundary wall; the actual boundary is
  // the fall itself once past it) ----------
  const wallH = 1.15, wallT = 0.55;
  const wall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), parapetMat);
    m.position.set(x, wallH / 2, z); m.castShadow = m.receiveShadow = true; scene.add(m); addBox(m);
  };
  wall(0, -HALF_Z, HALF_X * 2, wallT); wall(0, HALF_Z, HALF_X * 2, wallT);
  wall(-HALF_X, 0, wallT, HALF_Z * 2); wall(HALF_X, 0, wallT, HALF_Z * 2);

  // ---------- central machine-room core: breaks the long sightline between spawns and gives the
  // roof its glass-clerestory Highrise silhouette ----------
  const coreW = 11, coreD = 15, coreH = 2.6;
  const core = new THREE.Mesh(new THREE.BoxGeometry(coreW, coreH, coreD), roofMat);
  core.position.set(-3, coreH / 2, 0); core.castShadow = core.receiveShadow = true; scene.add(core); addBox(core);
  const clerestory = new THREE.Mesh(new THREE.BoxGeometry(coreW, 0.9, coreD), glassMat);
  clerestory.position.set(-3, coreH + 0.45, 0); scene.add(clerestory); addBox(clerestory, false);
  const coreCap = new THREE.Mesh(new THREE.BoxGeometry(coreW + 0.4, 0.2, coreD + 0.4), parapetMat);
  coreCap.position.set(-3, coreH + 0.9 + 0.1, 0); coreCap.castShadow = true; scene.add(coreCap); addBox(coreCap);

  // ---------- construction-site dressing: crates, rebar-tipped pillars, scaffolding, a tarp ----------
  [[14, -20], [-16, -14], [16, 14], [-14, 20], [11, 2], [-20, 6], [6, -8], [-8, 9]]
    .forEach(([x, z]) => makeBoxProp(x, z, 1.8, 1.4, 1.8, crateMat));

  [[19, -9], [-21, 9], [5, -26], [-5, 27]].forEach(([x, z]) => {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 2.2, 10), roofMat);
    pillar.position.set(x, 1.1, z); pillar.castShadow = pillar.receiveShadow = true; scene.add(pillar); addBox(pillar);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const rebar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), rustMat);
      rebar.position.set(x + Math.cos(a) * 0.32, 2.2 + 0.55, z + Math.sin(a) * 0.32);
      rebar.rotation.set((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15);
      scene.add(rebar);
    }
  });

  // a short scaffold frame with a draped tarp for cover on the west lane
  const scaffoldX = -22, scaffoldZ = -18;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), steelMat);
    post.position.set(scaffoldX + dx * 1.4, 1.3, scaffoldZ + dz * 1.4); scene.add(post); addBox(post, false);
  }
  for (const y of [1.0, 2.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.05, 0.05), steelMat);
    rail.position.set(scaffoldX, y, scaffoldZ - 1.4); scene.add(rail);
    const rail2 = rail.clone(); rail2.position.z = scaffoldZ + 1.4; scene.add(rail2);
  }
  const tarp = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3), tarpMat);
  tarp.position.set(scaffoldX, 2.55, scaffoldZ); tarp.rotation.x = -0.12; scene.add(tarp);

  // ---------- helipad marking (roof identity, matches the real map's centerpiece) ----------
  const padCanvas = document.createElement('canvas'); padCanvas.width = padCanvas.height = 256;
  const px = padCanvas.getContext('2d');
  px.fillStyle = '#40443f'; px.fillRect(0, 0, 256, 256);
  px.strokeStyle = '#e7c344'; px.lineWidth = 10; px.beginPath(); px.arc(128, 128, 108, 0, Math.PI * 2); px.stroke();
  px.fillStyle = '#e7c344'; px.font = '900 140px Arial'; px.textAlign = 'center'; px.textBaseline = 'middle';
  px.fillText('H', 128, 138);
  const padTex = new THREE.CanvasTexture(padCanvas); padTex.colorSpace = THREE.SRGBColorSpace;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ map: padTex }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(8, 0.02, 6); scene.add(pad);

  // ---------- crane: mast, deck, boom out past the parapet, counterweight, climb ladder ----------
  const strut = (p0, p1, r0, r1, mat, collide) => {
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, dir.length(), 8), mat);
    mesh.position.copy(p0).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    if (collide) addBox(mesh);
    return mesh;
  };
  const legBottomHalf = 1.5, legTopHalf = 0.65;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dz]) => {
    strut(
      new THREE.Vector3(CRANE_X + dx * legBottomHalf, 0, CRANE_Z + dz * legBottomHalf),
      new THREE.Vector3(CRANE_X + dx * legTopHalf, DECK_Y, CRANE_Z + dz * legTopHalf),
      0.19, 0.12, steelMat, true
    );
  });
  // visual-only cross bracing, same reasoning as Scrapyard's tower: a true diagonal AABB would
  // falsely block a wide band of open air next to the mast
  for (const [loY, hiY] of [[2.2, 5.2], [5.6, 8.6]]) {
    [[[-1, -1], [1, -1]], [[-1, 1], [1, 1]], [[-1, -1], [-1, 1]], [[1, -1], [1, 1]]].forEach(([[dx0, dz0], [dx1, dz1]]) => {
      const t0 = THREE.MathUtils.lerp(legBottomHalf, legTopHalf, loY / DECK_Y);
      const t1 = THREE.MathUtils.lerp(legBottomHalf, legTopHalf, hiY / DECK_Y);
      strut(new THREE.Vector3(CRANE_X + dx0 * t0, loY, CRANE_Z + dz0 * t0), new THREE.Vector3(CRANE_X + dx1 * t1, hiY, CRANE_Z + dz1 * t1), 0.05, 0.05, steelMat, false);
      strut(new THREE.Vector3(CRANE_X + dx0 * t0, hiY, CRANE_Z + dz0 * t0), new THREE.Vector3(CRANE_X + dx1 * t1, loY, CRANE_Z + dz1 * t1), 0.05, 0.05, steelMat, false);
    });
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK_HALF * 2, 0.3, DECK_HALF * 2), steelMat);
  deck.position.set(CRANE_X, DECK_Y, CRANE_Z); deck.castShadow = deck.receiveShadow = true; scene.add(deck); addBox(deck);
  // the boom starts at the deck and runs outward (-Z) past the parapet line (HALF_Z) into open
  // air - it's a real collider the whole way, so walking it is completely normal; there's simply
  // nothing below once you step off its sides or its tip.
  const boomW = 1.1;
  const boom = new THREE.Mesh(new THREE.BoxGeometry(boomW, 0.4, BOOM_LEN), steelMat);
  boom.position.set(CRANE_X, DECK_Y + 0.2, CRANE_Z - BOOM_LEN / 2);
  boom.castShadow = boom.receiveShadow = true; scene.add(boom); addBox(boom);
  const counterweight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), steelMat);
  counterweight.position.set(CRANE_X, DECK_Y + 0.5, CRANE_Z + 2.2); counterweight.castShadow = true; scene.add(counterweight); addBox(counterweight);
  // hazard stripe right at the jump-off point - a clear "past here, nothing" visual cue
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(boomW + 0.2, 0.5), hazardMat);
  warn.rotation.x = -Math.PI / 2; warn.position.set(CRANE_X, DECK_Y + 0.41, CRANE_Z - BOOM_LEN + 0.3); scene.add(warn);

  // Proximity ladder up the mast's west face, same COD-style mechanic as Scrapyard's tower - flush
  // with the deck's own west edge (not tucked behind the legs, which taper inward to x=22-0.65 at
  // the top and left nothing solid under the old position for the climb to hand off onto). Releases
  // comfortably below the deck's real collider top (DECK_Y+0.15) so climb and floor-snap meet
  // cleanly instead of stalling at the boundary - the exact bug the Scrapyard tower ladder had.
  const ladderX = CRANE_X - DECK_HALF, ladderZ = CRANE_Z;
  const ladderTop = DECK_Y + 0.15 - 0.3;
  for (const side of [-1, 1]) {
    strut(new THREE.Vector3(ladderX, 0.2, ladderZ + side * 0.4), new THREE.Vector3(ladderX, ladderTop, ladderZ + side * 0.4), 0.04, 0.04, steelMat, false);
  }
  for (let ry = 0.55; ry < ladderTop; ry += 0.42) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), steelMat);
    rung.rotation.x = Math.PI / 2; rung.position.set(ladderX, ry, ladderZ);
    scene.add(rung);
  }

  const tSpawnZone = { xMin: -12, xMax: 12, zMin: -HALF_Z + 4, zMax: -HALF_Z + 10 };
  const ctSpawnZone = { xMin: -12, xMax: 12, zMin: HALF_Z - 10, zMax: HALF_Z - 4 };
  return {
    spawn: new THREE.Vector3(0, 2, -HALF_Z + 7), tSpawn: new THREE.Vector3(0, 2, -HALF_Z + 7),
    ctSpawn: new THREE.Vector3(0, 2, HALF_Z - 7), tSpawnZone, ctSpawnZone, sites: [],
    ladders: [{ x: ladderX, z: ladderZ, radius: 1.0, bottom: 0, top: ladderTop }],
    halfX: HALF_X, halfZ: HALF_Z
  };
}
