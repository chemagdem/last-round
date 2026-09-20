// Frame-rate independent viewmodel motion. This never modifies the camera or aim.
export class CombatMotion {
  constructor() { this.reset(); }
  reset() { this.x = 0; this.y = 0; this.targetX = 0; this.targetY = 0; this.phase = 0; this.bloom = 0; }
  look(x, y) {
    this.targetX = Math.max(-0.025, Math.min(0.025, this.targetX + x * 0.000035));
    this.targetY = Math.max(-0.02, Math.min(0.02, this.targetY + y * 0.000035));
  }
  shot() { this.bloom = Math.min(8, this.bloom + 2.2); }
  update(dt, speed, ads, reducedMotion) {
    const blend = 1 - Math.exp(-14 * dt);
    this.targetX *= Math.exp(-10 * dt);
    this.targetY *= Math.exp(-10 * dt);
    this.x += (this.targetX - this.x) * blend;
    this.y += (this.targetY - this.y) * blend;
    this.phase += dt * (speed > 0.1 ? 9 + Math.min(speed, 10) : 1.8);
    this.bloom *= Math.exp(-9 * dt);
    const amount = (reducedMotion ? 0.2 : 1) * (ads ? 0.15 : 1);
    const stride = Math.min(1, speed / 5);
    return {
      x: (-this.x + Math.cos(this.phase * 0.5) * stride * 0.008) * amount,
      y: (this.y + Math.sin(this.phase) * (0.0015 + stride * 0.01)) * amount,
      roll: (-this.x * 0.7 + Math.sin(this.phase * 0.5) * stride * 0.009) * amount
    };
  }
}
