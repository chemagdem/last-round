import * as THREE from 'three';

// Native procedural finish: no image downloads or third-party artwork.
export function createFounderFinish() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111921'; ctx.fillRect(0, 0, 1024, 1024);
  // Fine directional brushing stays below the macro inlay pattern.
  for (let y = 0; y < 1024; y += 2) {
    ctx.fillStyle = `rgba(160,183,199,${0.015 + (y % 13) * 0.002})`;
    ctx.fillRect(0, y, 1024, 1);
  }
  const gold = ctx.createLinearGradient(0, 0, 1024, 1024);
  gold.addColorStop(0, '#775027'); gold.addColorStop(0.28, '#e5be70');
  gold.addColorStop(0.5, '#fff0bd'); gold.addColorStop(0.72, '#ac7837'); gold.addColorStop(1, '#e6c483');
  ctx.strokeStyle = gold;
  for (let k = -2; k <= 4; k++) {
    ctx.lineWidth = 35; ctx.beginPath();
    ctx.moveTo(k * 360, 0); ctx.lineTo(k * 360 + 160, 480); ctx.lineTo(k * 360 + 40, 1024); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(k * 360 + 34, 0); ctx.lineTo(k * 360 + 194, 480); ctx.lineTo(k * 360 + 74, 1024); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(213,176,105,.2)'; ctx.lineWidth = 1;
  for (let y = 0; y < 1100; y += 96) for (let x = -48; x < 1100; x += 96) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 48, y - 28); ctx.lineTo(x + 96, y); ctx.lineTo(x + 48, y + 28); ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = '#d65d39'; ctx.fillRect(0, 740, 1024, 7);
  // Small repeated production marks read as engravings, not a full-screen logo.
  ctx.fillStyle = '#ebd8a9'; ctx.font = '600 21px monospace';
  for (const y of [190, 680]) {
    ctx.fillText('LR / FOUNDER', 74, y);
    ctx.font = 'bold 42px monospace'; ctx.fillText('001', 74, y + 46);
    ctx.font = '600 21px monospace';
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
