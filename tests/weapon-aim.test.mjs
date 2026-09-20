import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_SIGHTS, sightOffset } from '../weapon-aim.js';

for (const [id, sight] of Object.entries(WEAPON_SIGHTS)) {
  test(`${id}: rear opening and front tip project onto the camera axis`, () => {
    // Test the production scale plus alternatives to catch unscaled offsets.
    for (const scale of [0.65, 0.78, 1]) {
      const offset = sightOffset(sight, scale);
      for (const z of [sight.rearZ, sight.frontZ].filter(z => z !== undefined)) {
        const x = sight.x * scale + offset.x;
        const y = sight.y * scale + offset.y;
        const depth = -(z * scale + offset.z);
        assert.ok(depth > 0.1, 'Sight must remain beyond the camera near plane');
        for (const fov of [40, 65, 75, 100]) {
          const projection = 1 / Math.tan(fov * Math.PI / 360);
          assert.ok(Math.abs(x * projection / depth) < 1e-12);
          assert.ok(Math.abs(y * projection / depth) < 1e-12);
        }
      }
    }
  });
}
