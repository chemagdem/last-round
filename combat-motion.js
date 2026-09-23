// Frame-rate independent first-person viewmodel motion.
// This module is cosmetic only: it never modifies the camera ray or gameplay aim.
export class CombatMotion {
  constructor() { this.reset(); }

  reset() {
    this.x = 0; this.y = 0;
    this.targetX = 0; this.targetY = 0;
    this.phase = 0; this.bloom = 0;
    this.moveBlend = 0; this.sprintBlend = 0;
  }

  look(x, y) {
    // Deliberately lag behind fast mouse movement. The bounded target keeps 180-degree flicks
    // readable without ever letting the weapon leave the useful part of the screen.
    this.targetX = Math.max(-0.032, Math.min(0.032, this.targetX + x * 0.000042));
    this.targetY = Math.max(-0.024, Math.min(0.024, this.targetY + y * 0.000040));
  }

  shot() { this.bloom = Math.min(8, this.bloom + 2.2); }

  update(dt, speed, ads, reducedMotion, lateral = 0, sprinting = false) {
    const blend = 1 - Math.exp(-12 * dt);
    this.targetX *= Math.exp(-8.5 * dt);
    this.targetY *= Math.exp(-8.5 * dt);
    this.x += (this.targetX - this.x) * blend;
    this.y += (this.targetY - this.y) * blend;

    const moving = speed > 0.1 ? 1 : 0;
    this.moveBlend += (moving - this.moveBlend) * (1 - Math.exp(-10 * dt));
    this.sprintBlend += ((sprinting ? 1 : 0) - this.sprintBlend) * (1 - Math.exp(-9 * dt));
    this.phase += dt * (speed > 0.1 ? 8.5 + Math.min(speed, 12) * 0.55 : 1.8);
    this.bloom *= Math.exp(-9 * dt);

    const amount = (reducedMotion ? 0.2 : 1) * (ads ? 0.15 : 1);
    const stride = Math.min(1.35, speed / 6) * this.moveBlend;
    const step = Math.sin(this.phase);
    const halfStep = Math.cos(this.phase * 0.5);
    const strafe = Math.max(-1, Math.min(1, lateral));

    return {
      x: (-this.x + halfStep * stride * 0.009 + strafe * 0.006) * amount,
      y: (this.y + Math.abs(step) * stride * 0.010 + this.sprintBlend * 0.018) * amount,
      z: (this.sprintBlend * 0.055) * amount,
      roll: (-this.x * 0.82 + halfStep * stride * 0.011 - strafe * 0.018) * amount,
      // Look inertia is intentionally opposite the camera turn: the hands arrive a fraction later.
      yaw: (this.x * 2.4 - strafe * 0.012) * amount,
      pitch: (-this.y * 1.35 + this.sprintBlend * 0.055) * amount
    };
  }
}
