import * as THREE from 'three';

export function selectSpectatorTarget(enemies, team, roster) {
  return enemies.find(e => e.isRemote && e.team === team && e.alive && !e.dying
    && roster.some(p => p.id === e.netId)) || null;
}

export class TeammateSpectator {
  constructor(camera, weapon, arms) {
    this.camera = camera; this.weapon = weapon; this.arms = arms;
    this.target = null; this.active = false;
    this.orientation = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.banner = document.getElementById('spectatorBanner');
    this.hud = ['ammo', 'healthbar', 'buyHint', 'reloadLabel', 'crosshair', 'adsDot', 'scopeOverlay', 'minimap']
      .map(id => document.getElementById(id)).filter(Boolean);
  }
  update({ dead, enemies, team, roster, phase, baseFov, dt, standingHeight, crouchingHeight }) {
    // Restore the previously hidden avatar before selecting this frame's target.
    if (this.target) this.target.mesh.visible = true;
    if (!dead) {
      if (this.active) {
        this.hud.forEach((el, i) => { el.style.visibility = this.savedVisibility[i]; });
        this.weapon.visible = true; this.arms.visible = true;
        this.camera.fov = baseFov; this.camera.updateProjectionMatrix();
      }
      this.banner.hidden = true; this.target = null; this.active = false;
      return;
    }
    if (!this.active) {
      this.savedVisibility = this.hud.map(el => el.style.visibility);
      this.hud.forEach(el => { el.style.visibility = 'hidden'; });
      this.active = true;
    }
    this.weapon.visible = false; this.arms.visible = false;
    this.banner.hidden = false;
    const target = phase === 'live' ? selectSpectatorTarget(enemies, team, roster) : null;
    if (!target) {
      this.target = null;
      this.banner.textContent = phase === 'warmup' ? 'ELIMINATED · RESPAWNING…' : 'ELIMINATED · WAITING FOR NEXT ROUND';
      return;
    }
    this.camera.position.copy(target.mesh.position);
    this.camera.position.y += target.targetCrouching ? crouchingHeight : standingHeight;
    this.euler.set(target.targetPitch || 0, target.targetYaw, 0, 'YXZ');
    this.orientation.setFromEuler(this.euler);
    if (target !== this.target) this.camera.quaternion.copy(this.orientation);
    else this.camera.quaternion.slerp(this.orientation, 1 - Math.exp(-25 * dt));
    this.camera.fov = target.targetFov || baseFov;
    this.camera.updateProjectionMatrix();
    target.mesh.visible = false;
    this.target = target;
    this.banner.textContent = `SPECTATING · ${target.name || 'TEAMMATE'} · ${Math.max(0, Math.ceil(target.health))} HP`;
  }
}
