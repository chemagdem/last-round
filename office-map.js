import * as THREE from 'three';

// Hand-authored 2D bot-nav/blockedAt layout mirroring buildOffice()'s real geometry below, so FFA
// can run on this map without a second, FFA-only build - buildOffice()'s own colliders are what
// the player actually walks into; this is only read by blockedAt()/buildNavigation() for FFA bot
// pathing and human spawn-clearing. Doored walls are modelled as two segments flanking the gap so
// bots don't believe a doorway is solid, or a solid stretch is walkable.
export const OFFICE_FFA_LAYOUT = (() => {
  const halfWidth = 32, halfDepth = 24;
  const cover = [];
  // Nav-only door width is well over the real 1.65m gap - the coarse step=2 grid needs to
  // reliably land a sample point inside it wherever doorAt happens to fall, not just when a door
  // sits on a "nice" round coordinate.
  const wallSeg = (cx, cz, len, axis, doorAt = null) => {
    const t = 1.2, door = 3.4;
    if (doorAt === null) { cover.push(axis === 'x' ? { x: cx, z: cz, w: len, d: t } : { x: cx, z: cz, w: t, d: len }); return; }
    const start = -len / 2, left = doorAt - door / 2 - start, right = len - left - door;
    if (left > .1) { const c = start + left / 2; cover.push(axis === 'x' ? { x: cx + c, z: cz, w: left, d: t } : { x: cx, z: cz + c, w: t, d: left }); }
    if (right > .1) { const c = doorAt + door / 2 + right / 2; cover.push(axis === 'x' ? { x: cx + c, z: cz, w: right, d: t } : { x: cx, z: cz + c, w: t, d: right }); }
  };

  // building perimeter: east/west walls (indoor + both terraces) and the two outer terrace rails
  cover.push({ x: -32, z: 0, w: 1.2, d: 48 }, { x: 32, z: 0, w: 1.2, d: 48 });
  cover.push({ x: 0, z: -24, w: 64, d: 2 }, { x: 0, z: 24, w: 64, d: 2 });

  // central garden planter
  cover.push({ x: 0, z: 0, w: 11.5, d: 11.5 });

  // the two boardrooms - same coreX/dir pairing buildOffice() uses below
  [[-20, 1], [20, -1]].forEach(([coreX, dir]) => {
    const innerFace = coreX + dir * 1.65, roomHalfW = 5.5;
    const roomCx = innerFace + dir * roomHalfW, frontX = innerFace + dir * roomHalfW * 2;
    cover.push({ x: coreX, z: 0, w: 3.1, d: 8.4 }); // core
    wallSeg(frontX, 0, 8.4, 'z'); // front, solid - entry is through the two sides instead
    wallSeg(roomCx, -4.2, roomHalfW * 2, 'x', 0); wallSeg(roomCx, 4.2, roomHalfW * 2, 'x', 0); // sides, with doors
    cover.push({ x: roomCx, z: 0, w: 4.5, d: 7 }); // table (rotated north-south, chairs flanking east/west)
  });

  // the eight office bays: front/back doored walls, two tables each, concrete partitions
  const bayXs = [-24, -8, 8, 24], partitionXs = [-16, 0, 16], DOOR_OFF = -6.55;
  [-1, 1].forEach(rowSide => {
    const frontZ = rowSide * 10, backZ = rowSide * 18, bayCz = rowSide * 14;
    bayXs.forEach(bx => {
      wallSeg(bx, frontZ, 16, 'x', DOOR_OFF); // left-of-centre, matching buildOffice()'s real doors
      wallSeg(bx, backZ, 16, 'x', DOOR_OFF);
      // Each table+chairs approximated a bit wider than the real 1.1m table, still leaving the
      // real ~3m aisles (outer and centre) clear for the door and for walking around.
      [bx - 3, bx + 3].forEach(tx => cover.push({ x: tx, z: bayCz, w: 2.6, d: 6 }));
    });
    partitionXs.forEach(px => cover.push({ x: px, z: bayCz, w: 1, d: 8 }));
  });

  // 12 spawns: two open corridor ends, two terrace spots, and one just inside each bay's own
  // front door - lined up with the door's left-of-centre x, except the two bays against the
  // building's own west wall (-24), where the door sits close enough to it that the spawn is
  // nudged further in to stay clear of both the wall and the west table.
  const spawns = [
    { x: -27, z: 0 }, { x: 27, z: 0 }, { x: 0, z: -21 }, { x: 0, z: 21 },
    { x: -29.85, z: -11 }, { x: -8 + DOOR_OFF, z: -11 }, { x: 8 + DOOR_OFF, z: -11 }, { x: 24 + DOOR_OFF, z: -11 },
    { x: -29.85, z: 11 }, { x: -8 + DOOR_OFF, z: 11 }, { x: 8 + DOOR_OFF, z: 11 }, { x: 24 + DOOR_OFF, z: 11 }
  ];
  return { halfWidth, halfDepth, cover, spawns };
})();

// OFFICE — rectangular corporate floor: a central garden flanked by two glass boardrooms (each
// using one of the plan's marked concrete cores as its own back wall), eight office bays around
// the outside (long shared desks, dark carpet, concrete partitions between neighbours), and a
// walkable terrace running the length of the building behind every bay.
export function buildOffice({ scene, floorMeshes, addBox, loadTiledTexture }) {
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbfe9f4, transparent: true, opacity: 0.27, roughness: 0.08,
    metalness: 0.05, transmission: 0.62, side: THREE.DoubleSide, depthWrite: false
  });
  const glassEdge = new THREE.MeshStandardMaterial({ color: 0x27343a, roughness: 0.38, metalness: 0.72 });
  // Real photo texture, so no extra colour tint - the "cream" comes from the image itself.
  const concreteCream = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/cream_concrete.png', 2.4, 1.6), roughness: 0.92 });
  const carpetLight = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/moqueta_clara.jpg', 12, 8), roughness: 0.95 });
  const carpetDark = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/moqueta_oscura.webp', 5, 3), roughness: 0.95 });
  const terraceMat = new THREE.MeshStandardMaterial({ color: 0xc9c8c3, roughness: 0.82 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7b5436, roughness: 0.72 });
  const deskTop = new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.55 });
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

  // ---------- Floors ----------
  // Light carpet everywhere indoors first (the "common areas" carpet), dark carpet patches for
  // each office bay laid a hair above it so the two never z-fight, and a separate stone terrace
  // floor for the two exterior strips behind the office rows.
  const indoor = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), carpetLight);
  indoor.rotation.x = -Math.PI / 2; indoor.position.y = 0; indoor.receiveShadow = true;
  scene.add(indoor); floorMeshes.push(indoor);
  [[0, -21], [0, 21]].forEach(([x, z]) => {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(64, 6), terraceMat);
    t.rotation.x = -Math.PI / 2; t.position.set(x, 0, z); t.receiveShadow = true;
    scene.add(t); floorMeshes.push(t);
  });

  // ---------- Glass wall helper ----------
  // Frames are visual only too, so a bullet can wallbang the complete partition.
  const glassWall = (x, z, length, axis = 'x', doorAt = null, h = 3.15) => {
    const t = .10, door = 1.65;
    const pane = (cx, cz, len) => {
      const m = axis === 'x' ? meshBox(cx, h / 2, cz, len, h, t, glass, true, false) : meshBox(cx, h / 2, cz, t, h, len, glass, true, false);
      m.renderOrder = 2;
      const count = Math.max(1, Math.floor(len / 3));
      for (let i = 0; i <= count; i++) {
        const p = -len / 2 + (len * i / count);
        axis === 'x' ? meshBox(cx + p, h / 2, cz, t * .7, h, .08, glassEdge, false) : meshBox(cx, h / 2, cz + p, .08, h, t * .7, glassEdge, false);
      }
      axis === 'x' ? meshBox(cx, h, cz, len + .08, .08, .12, glassEdge, false) : meshBox(cx, h, cz, .12, .08, len + .08, glassEdge, false);
    };
    if (doorAt === null) { pane(x, z, length); return; }
    const start = -length / 2, left = doorAt - door / 2 - start, right = length - left - door;
    if (left > .05) { const c = start + left / 2; axis === 'x' ? pane(x + c, z, left) : pane(x, z + c, left); }
    if (right > .05) { const c = doorAt + door / 2 + right / 2; axis === 'x' ? pane(x + c, z, right) : pane(x, z + c, right); }
  };

  // ---------- Terrace shell ----------
  // East/west walls now run the full depth (indoor + both terraces). The terrace's own outer
  // edge was a low 1.05m rail at first, but that is exactly climbable and jumpable (max jump
  // height is ~1.74m) - full height like every other wall here, since it has to be a hard
  // boundary, not furniture someone can hop over to wander off the map.
  glassWall(-32, 0, 48, 'z'); glassWall(32, 0, 48, 'z');
  [-24, 24].forEach(z => glassWall(0, z, 64, 'x'));

  // ---------- Central garden ----------
  meshBox(0, .35, 0, 11.5, .7, 11.5, concreteCream, true, true);
  meshBox(0, .72, 0, 10.6, .08, 10.6, soil, false);
  const plant = (x, z, s = .8) => {
    meshBox(x, .72, z, .16, .75, .16, wood, false);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), leaf); crown.scale.y = 1.35; crown.position.set(x, 1.25, z); crown.castShadow = true; scene.add(crown);
  };
  [[-3.7, -3.5], [-1.2, -3.8], [2, -3.2], [3.7, -.8], [-3.8, .2], [-1.4, 2.7], [1.4, 3.5], [3.8, 3]].forEach(p => plant(...p, .7));

  // ---------- Boardrooms flanking the garden ----------
  // Each one sits in the gap between the garden and one of the plan's marked concrete cores,
  // which becomes the boardroom's own back wall - every other wall is glass with a door facing
  // the garden corridor.
  const boardroom = (coreX, dir) => { // dir: which way the room sits from its core (+1 = toward +x)
    meshBox(coreX, 1.7, 0, 3.1, 3.4, 8.4, concreteCream, true, true); // the core itself, now cream concrete
    const innerFace = coreX + dir * 1.65; // the core's room-facing surface
    const roomHalfW = 5.5; // gap between the core and the garden edge
    const frontX = innerFace + dir * roomHalfW * 2;
    const roomCx = innerFace + dir * roomHalfW;
    // Entry is through the two side walls (matching the table's own north-south run) rather than
    // the wall facing the garden, which is now solid glass, opposite the concrete core.
    glassWall(frontX, 0, 8.4, 'z');
    glassWall(roomCx, -4.2, roomHalfW * 2, 'x', 0); glassWall(roomCx, 4.2, roomHalfW * 2, 'x', 0);
    // big TV on the inside of the concrete wall
    meshBox(innerFace + dir * .05, 1.9, 0, .08, 1.9, 3.6, screen, false);
    // Conference table runs north-south (chairs flank the east/west sides) rather than along the
    // door-to-TV axis, per a follow-up request - the TV still faces straight down the table.
    const tableLen = 7;
    meshBox(roomCx, .74, 0, 2.5, .06, tableLen, wood, true, true);
    [-1, 1].forEach(lz => meshBox(roomCx, .37, lz * (tableLen / 2 - .3), 2.3, .74, .08, dark, false));
    for (let i = 0; i < 3; i++) {
      const sz = -tableLen * .31 + i * (tableLen * .31);
      [-1, 1].forEach(sx => {
        meshBox(roomCx + sx * 1.75, .45, sz, .55, .12, .55, dark, true, true);
        meshBox(roomCx + sx * 2.0, .82, sz, .55, .7, .1, dark, true, true);
      });
    }
  };
  boardroom(-20, 1);  // west core: the room sits east of it, toward the garden (+x)
  boardroom(20, -1);  // east core: the room sits west of it, toward the garden (-x)

  // ---------- Office bays ----------
  // Four bays a side, 16 units wide each, boundaries at x = -32,-16,0,16,32. Front wall (glass,
  // door) faces the central corridor; back wall (glass, door) opens onto the terrace; the walls
  // between neighbouring bays are solid cream concrete, not glass.
  const bayXs = [-24, -8, 8, 24];
  const partitionXs = [-16, 0, 16];
  // Two tables per bay, chairs flanking both long sides of each (matching the supplied floor
  // plan), plus a TV mounted on the bay's own west wall near the entrance.
  const officeFurniture = (bx, bz, frontZ) => {
    const toFront = Math.sign(frontZ - bz);
    const tableLen = 6, tableW = 1.1;
    [bx - 3, bx + 3].forEach(tx => { // pulled in from +-4 so the door has a clear run into the room
      meshBox(tx, .74, bz, tableW, .06, tableLen, deskTop, true, true);
      [-1, 1].forEach(lz => meshBox(tx, .37, bz + lz * (tableLen / 2 - .3), tableW * .7, .74, .08, dark, false));
      for (let i = 0; i < 3; i++) {
        const sz = bz - tableLen * .31 + i * (tableLen * .31);
        [-1, 1].forEach(sx => {
          const cx = tx + sx * (tableW / 2 + .55);
          meshBox(cx, .45, sz, .55, .12, .55, dark, true, true);
          meshBox(cx + sx * .25, .82, sz, .1, .7, .55, dark, true, true);
        });
      }
    });
    meshBox(bx - 7.92, 1.75, bz + toFront * 2.2, .08, 1.5, 1.8, screen, false);
  };
  [-1, 1].forEach(side => { // -1 = north row (z<0), 1 = south row (z>0)
    const frontZ = side * 10, backZ = side * 18, bayCz = side * 14;
    bayXs.forEach(bx => {
      // Door sits left-of-centre (toward -x), lined up with the clear aisle west of both tables
      // rather than opening straight into the nearer one.
      glassWall(bx, frontZ, 16, 'x', -6.55);
      glassWall(bx, backZ, 16, 'x', -6.55);
      meshBox(bx, .012, bayCz, 15.4, .02, 7.4, carpetDark, false);
      officeFurniture(bx, bayCz, frontZ);
    });
    partitionXs.forEach(px => meshBox(px, 1.575, bayCz, .12, 3.15, 8, concreteCream, true, true));
  });

  // Easter egg: a hand-drawn-marker-style doodle on the north-east bay's back (terrace) wall,
  // on its far right as you walk in through the front door - decal only, doesn't touch the
  // glass material or collision underneath it.
  {
    const eggTex = loadTiledTexture('assets/textures/stars_easter.png', 1, 1);
    const eggMat = new THREE.MeshBasicMaterial({ map: eggTex, transparent: true, opacity: .85, alphaTest: .02, side: THREE.DoubleSide, depthWrite: false });
    const egg = new THREE.Mesh(new THREE.PlaneGeometry(.5, .5), eggMat);
    egg.position.set(27, 1.55, -18 + .04); // just off the glass, facing into the room
    egg.renderOrder = 3;
    scene.add(egg);
  }

  // ---------- Ceiling light strips (no solid ceiling, keeps visibility and perf) ----------
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xf7fbff, emissive: 0xe8f4ff, emissiveIntensity: 1.5 });
  for (let x = -27; x <= 27; x += 9) for (const z of [-13, -7, 7, 13]) meshBox(x, 3.55, z, 4.8, .06, .22, lightMat, false);
  const keyLight = new THREE.PointLight(0xf2f7ff, 2.2, 45, 2); keyLight.position.set(0, 5, 0); scene.add(keyLight);

  return {
    spawn: new THREE.Vector3(-27, 2, 0), tSpawn: new THREE.Vector3(-27, 2, 0), ctSpawn: new THREE.Vector3(27, 2, 0),
    tSpawnZone: { xMin: -30, xMax: -24, zMin: -6, zMax: 6 }, ctSpawnZone: { xMin: 24, xMax: 30, zMin: -6, zMax: 6 }, sites: [],
    ffa: OFFICE_FFA_LAYOUT
  };
}
