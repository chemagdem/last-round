import * as THREE from 'three';

export class PlayerLabels {
  constructor() {
    this.labels = new Map();
    this.ray = new THREE.Raycaster();
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3();
  }
  remove(enemy) {
    const label = this.labels.get(enemy);
    if (!label) return;
    enemy.mesh.remove(label.sprite);
    label.sprite.material.map.dispose(); label.sprite.material.dispose();
    this.labels.delete(enemy);
  }
  clear() { for (const enemy of this.labels.keys()) this.remove(enemy); }
  update(enemies, camera, walls, team, dt) {
    for (const enemy of this.labels.keys()) if (!enemies.includes(enemy)) this.remove(enemy);
    for (const enemy of enemies) {
      if (!enemy.isRemote) continue;
      const text = String(enemy.name || 'Player').slice(0, 24);
      const friendly = enemy.team === team;
      const key = `${friendly}:${text}`;
      let label = this.labels.get(enemy);
      if (label && label.key !== key) { this.remove(enemy); label = null; }
      if (!label) {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(8,13,19,.78)'; ctx.fillRect(0, 0, 512, 80);
        ctx.fillStyle = friendly ? '#82d9cd' : '#ff9e8c'; ctx.fillRect(0, 74, 512, 6);
        ctx.font = '600 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 39, 480);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false });
        const sprite = new THREE.Sprite(material); sprite.scale.set(1.5, 0.235, 1);
        // Labels must never intercept bullets or melee raycasts.
        sprite.raycast = () => {};
        enemy.mesh.add(sprite);
        label = { sprite, key, timer: 0, visible: false };
        this.labels.set(enemy, label);
      }
      label.sprite.position.y = 2.2 - (enemy.mesh.userData.crouchBlend || 0) * 0.7;
      label.timer -= dt;
      if (label.timer <= 0) {
        label.timer = 0.1;
        this.target.copy(enemy.mesh.position); this.target.y += enemy.targetCrouching ? 0.8 : 1.4;
        this.direction.copy(this.target).sub(camera.position);
        const distance = this.direction.length();
        this.ray.set(camera.position, this.direction.normalize()); this.ray.far = Math.max(0, distance - 0.25);
        label.visible = distance < 65 && this.ray.intersectObjects(walls, false).length === 0;
      }
      label.sprite.visible = enemy.alive && !enemy.dying && label.visible;
    }
  }
}
