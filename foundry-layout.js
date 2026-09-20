// Metres; mirrored geometry gives both teams the same routes and cover timing.
export const FOUNDRY = {
  halfWidth: 22, halfDepth: 26,
  spawnA: { xMin: -3, xMax: 3, zMin: -23, zMax: -21 },
  spawnB: { xMin: -3, xMax: 3, zMin: 21, zMax: 23 },
  practiceTargets: [[-5, -10], [5, -10], [-6, 0], [6, 0], [-5, 10], [5, 10], [-19.5, 0], [19.5, 0]],
  cover: [
    { x: 0, z: 0, w: 4, h: 2.8, d: 4, kind: 'reactor' },
    ...[-1, 1].flatMap(side => [
      { x: 0, z: side * 16, w: 9, h: 2.5, d: 1.2, kind: 'screen' },
      { x: side * 10, z: side * 7, w: 5, h: 3.2, d: 8, kind: 'container' },
      { x: side * 10, z: -side * 7, w: 5, h: 3.2, d: 8, kind: 'container' },
      { x: side * 18, z: side * 12, w: 2.4, h: 1.25, d: 3, kind: 'low' },
      { x: side * 18, z: -side * 12, w: 2.4, h: 1.25, d: 3, kind: 'low' },
      { x: side * 17, z: 0, w: 2.8, h: 3.8, d: 2.8, kind: 'tank' },
      { x: side * 4, z: side * 5, w: 1.4, h: 2.5, d: 1.4, kind: 'pillar' },
      { x: side * 4, z: -side * 5, w: 1.4, h: 2.5, d: 1.4, kind: 'pillar' }
    ])
  ]
};
