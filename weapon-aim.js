// Coordinates are in unscaled weapon space; camera forward is local -Z.
export const WEAPON_SIGHTS = {
  ak47: { type: 'notch', x: 0.24, y: -0.07, rearZ: -0.29, frontZ: -1.18 },
  m4a4: { type: 'aperture', x: 0.24, y: -0.065, rearZ: -0.3, frontZ: -0.92 },
  m4a1: { type: 'reflex', x: 0.24, y: -0.075, rearZ: -0.44 }
};

export function sightOffset(sight, scale) {
  // Put the complete sight axis on the camera axis. Keep the rear sight beyond
  // the 0.1 m near plane instead of pulling it toward/through the camera.
  return { x: -sight.x * scale, y: -sight.y * scale, z: 0 };
}
