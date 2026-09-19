/* ==========================================================
   FIREZONE - FPS battlefield-style prototype (Three.js, r157)
   Enhanced: procedural graphics, bloom, particles, full audio,
   reload animation, ADS, recoil, screen shake, damage vignette.
   ========================================================== */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// ============================================================
// AUDIO ENGINE (fully synthesized with Web Audio API - no files)
// ============================================================
class SoundEngine {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.samples = {}; // name -> decoded AudioBuffer (or null while/if loading fails)
  }
  init(){
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.loadSample('awp', 'assets/awp_02.mp3');
    this.loadSample('scopeClick', 'assets/awp-zoom-sound-effect-cs-go.mp3');
    this.loadSample('ak47', 'assets/ak-47-mp3.mp3');
    this.loadSample('reload', 'assets/uzi-reload.mp3');
    this.loadSample('m4a1', 'assets/m4a1_silencer_01.mp3');
    this.loadSample('glock', 'assets/pistol-shot.mp3');
    this.loadSample('smokeHiss', 'assets/smoke-grenade-sound-effect.mp3');
    this.loadSample('grenadeThrow', 'assets/grenade-plonk-sound-effect-tarkov-louder.mp3');
    this.loadSample('deagle', 'assets/desert-eagle-cs.mp3');
    this.loadSample('explosion', 'assets/exploded_zfp5Xgm.mp3');
    this.loadSample('m4a4', 'assets/m70-rifle.mp3');
    this.loadSample('smg', 'assets/wpn_45_smg_2d_01.mp3');
    this.loadSample('knifeSlash', 'assets/knife-slashing.mp3');
    this.loadSample('knifeStab', 'assets/knife-stab.mp3');
  }
  resume(){ if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  async loadSample(name, url){
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      this.samples[name] = await this.ctx.decodeAudioData(arr);
    } catch (err) {
      console.warn('sound sample failed to load:', url, err);
    }
  }

  // plays a loaded sample once; returns false if it isn't ready yet (caller falls back to a
  // synthesized sound instead of silently doing nothing)
  playSample(name, vol = 1){
    const buffer = this.samples[name];
    if (!this.ctx || !buffer) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(this.master);
    src.start(this.ctx.currentTime);
    return true;
  }

  noiseBuffer(duration = 0.5){
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buffer = this.ctx.createBuffer(1, len, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  gunshot(profile = {}){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const {
      noiseDur = 0.22, bpFreq = 1800, bpQ = 0.6, noiseDecay = 0.16, noiseVol = 1,
      oscType = 'triangle', oscStart = 130, oscEnd = 38, oscDecay = 0.13, oscVol = 0.9,
      tailDur = 0, tailVol = 0, subFreq = 0, subDur = 0, subVol = 0
    } = profile;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(noiseDur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = bpFreq; bp.Q.value = bpQ;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(noiseVol, t); ng.gain.exponentialRampToValueAtTime(0.001, t + noiseDecay);
    noise.connect(bp); bp.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t + noiseDur);

    const osc = ctx.createOscillator(); osc.type = oscType;
    osc.frequency.setValueAtTime(oscStart, t); osc.frequency.exponentialRampToValueAtTime(oscEnd, t + oscDecay);
    const og = ctx.createGain(); og.gain.setValueAtTime(oscVol, t); og.gain.exponentialRampToValueAtTime(0.001, t + oscDecay);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + oscDecay);

    if (tailDur > 0) {
      // distant, low-passed "crack echo" tail - gives heavier weapons (AWP, Deagle) more boom
      const tailNoise = ctx.createBufferSource(); tailNoise.buffer = this.noiseBuffer(tailDur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const tg = ctx.createGain(); tg.gain.setValueAtTime(tailVol, t + 0.02); tg.gain.exponentialRampToValueAtTime(0.001, t + tailDur);
      tailNoise.connect(lp); lp.connect(tg); tg.connect(this.master);
      tailNoise.start(t + 0.02); tailNoise.stop(t + tailDur);
    }

    if (subDur > 0) {
      // a hard sub-bass thump under the crack - a sine that dives in pitch fast, giving the
      // heaviest weapons (AWP) a chest-punch instead of just a sharp snap
      const sub = ctx.createOscillator(); sub.type = 'sine';
      sub.frequency.setValueAtTime(subFreq, t); sub.frequency.exponentialRampToValueAtTime(Math.max(1, subFreq * 0.35), t + subDur);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(subVol, t); sg.gain.exponentialRampToValueAtTime(0.001, t + subDur);
      sub.connect(sg); sg.connect(this.master);
      sub.start(t); sub.stop(t + subDur);
    }
  }

  emptyClick(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + 0.045);
  }

  mechClick(freq = 500, vol = 0.3, dur = 0.06){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + dur);
  }

  // dull, lowpassed thump - a magazine dropping free or seating home
  reloadThud(vol = 0.3, freq = 150){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(0.12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    noise.connect(lp); lp.connect(g); g.connect(this.master);
    noise.start(t); noise.stop(t + 0.12);
  }

  // sharp metallic snap - bolt/slide racking forward and chambering a round
  boltRack(heavy = false){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(0.09);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = heavy ? 2200 : 3000; bp.Q.value = 1.4;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(bp); bp.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t + 0.09);
    this.mechClick(heavy ? 700 : 950, 0.32, 0.05);
  }

  // full layered reload: mag release thud -> mag drops -> fresh mag click-clack -> bolt/slide rack,
  // all timed proportionally to the weapon's own reload duration so fast pistols snap and
  // slow rifles/AWP feel heavier and longer
  reloadSequence(duration = 1.5, heavy = false){
    if (!this.ctx) return;
    const at = (frac, fn) => setTimeout(fn, Math.max(0, frac * duration * 1000));
    at(0.05, () => this.reloadThud(heavy ? 0.32 : 0.2, heavy ? 100 : 160));
    at(0.3, () => this.reloadThud(heavy ? 0.2 : 0.13, heavy ? 140 : 220));
    at(0.55, () => this.mechClick(520, 0.22, 0.05));
    at(0.63, () => this.mechClick(680, 0.26, 0.045));
    at(0.85, () => this.boltRack(heavy));
  }

  footstep(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(0.1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280 + Math.random() * 160;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    noise.connect(lp); lp.connect(g); g.connect(this.master);
    noise.start(t); noise.stop(t + 0.1);
  }

  hitmarker(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(1500, t); osc.frequency.exponentialRampToValueAtTime(950, t + 0.08);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + 0.09);
  }

  playerHurt(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(0.3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    noise.connect(lp); lp.connect(g); g.connect(this.master);
    noise.start(t); noise.stop(t + 0.3);
  }

  headshot(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(2200, t); osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + 0.12);
  }

  enemyGunshot(distance){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const atten = Math.max(0, 1 - distance / 90);
    if (atten <= 0.02) return;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(0.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 1500 - (1 - atten) * 900; bp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.55 * atten, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    noise.connect(bp); bp.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t + 0.2);
  }

  startAmbience(){
    if (!this.ctx) return;
    const ctx = this.ctx;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(4); noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.045;
    noise.connect(lp); lp.connect(g); g.connect(this.master);
    noise.start();
    this._ambienceLoop();
  }
  _ambienceLoop(){
    const delay = 7000 + Math.random() * 10000;
    setTimeout(() => { this.distantExplosion(); this._ambienceLoop(); }, delay);
  }
  distantExplosion(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(55, t); osc.frequency.exponentialRampToValueAtTime(18, t + 0.8);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + 0.9);
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.18, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 1);
    noise.connect(lp); lp.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t + 1);
  }

  explosion(){
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(0.6);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.85, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    noise.connect(lp); lp.connect(ng); ng.connect(this.master);
    noise.start(t); noise.stop(t + 0.6);

    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t); osc.frequency.exponentialRampToValueAtTime(24, t + 0.5);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.5);
  }
}
const audio = new SoundEngine();

// ============================================================
// PROCEDURAL TEXTURES
// ============================================================
function makeCanvas(size = 256){
  const c = document.createElement('canvas'); c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

// shared soft height-field generator used as a bump map companion for the diffuse textures below -
// smooth overlapping radial blotches (not per-pixel static) so lit surfaces get real micro-relief
// instead of a flat plastic look, without the "TV noise" artifacting raw random bump data produces
function bumpNoiseTexture(size = 256, blotches = 160, softness = 0.32){
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < blotches; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = size * (0.03 + Math.random() * 0.09);
    const bright = Math.random() > 0.5;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, bright ? `rgba(255,255,255,${softness})` : `rgba(0,0,0,${softness})`);
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function grassTexture(){
  const size = 512;
  const { c, ctx } = makeCanvas(size);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#4a6b34');
  grad.addColorStop(1, '#42602e');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);

  // large patchy variation (dry patches, richer green clumps) before the fine grain
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = size * (0.04 + Math.random() * 0.09);
    const dry = Math.random() > 0.5;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, dry ? 'rgba(150,130,70,0.28)' : 'rgba(60,95,40,0.3)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // fine blade-like speckle
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const shade = Math.random();
    ctx.fillStyle = shade > 0.5 ? 'rgba(95,130,55,0.45)' : 'rgba(30,50,22,0.45)';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillRect(-0.6, 0, 1.2, 3 + Math.random() * 3);
    ctx.restore();
  }

  // dirt/root blotches for contact grounding
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 8 + Math.random() * 20;
    ctx.fillStyle = 'rgba(90,70,45,0.2)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function grassBumpTexture(){
  const tex = bumpNoiseTexture(256, 200, 0.3);
  tex.repeat.set(26, 26);
  return tex;
}

function brickTexture(baseColor = '#af8c5b'){
  const size = 512;
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = baseColor; ctx.fillRect(0, 0, size, size);

  const rows = 10, cols = 7;
  const brickW = size / cols, brickH = size / rows;
  // tint every individual brick slightly so the wall doesn't read as one flat tiled color
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickW / 2);
    for (let cI = -1; cI < cols + 1; cI++) {
      const x = cI * brickW + offset, y = r * brickH;
      const tint = (Math.random() - 0.5) * 40;
      ctx.fillStyle = `rgba(${tint > 0 ? 255 : 0},${tint > 0 ? 255 : 0},${tint > 0 ? 255 : 0},${Math.abs(tint) / 255 * 0.35})`;
      ctx.fillRect(x, y, brickW, brickH);
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3;
  for (let r = 0; r <= rows; r++) {
    const y = r * brickH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickW / 2);
    for (let cI = 0; cI <= cols + 1; cI++) {
      const x = cI * brickW + offset;
      ctx.beginPath(); ctx.moveTo(x, r * brickH); ctx.lineTo(x, r * brickH + brickH); ctx.stroke();
    }
  }

  // fine grain + weathering streaks
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * size;
    const grad = ctx.createLinearGradient(x, 0, x, size);
    grad.addColorStop(0, 'rgba(40,45,35,0.18)');
    grad.addColorStop(1, 'rgba(40,45,35,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 10, 0, 18 + Math.random() * 14, size);
  }
  // a couple of window-like dark rects for facade feel
  ctx.fillStyle = 'rgba(20,25,30,0.55)';
  ctx.fillRect(size * 0.16, size * 0.24, size * 0.16, size * 0.22);
  ctx.fillRect(size * 0.66, size * 0.55, size * 0.16, size * 0.22);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function brickBumpTexture(){
  const size = 512;
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
  const rows = 10, cols = 7;
  const brickW = size / cols, brickH = size / rows;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 4;
  for (let r = 0; r <= rows; r++) {
    const y = r * brickH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickW / 2);
    for (let cI = 0; cI <= cols + 1; cI++) {
      const x = cI * brickW + offset;
      ctx.beginPath(); ctx.moveTo(x, r * brickH); ctx.lineTo(x, r * brickH + brickH); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function skyGradientTexture(){
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1a3d7a');
  grad.addColorStop(0.45, '#5f8fc7');
  grad.addColorStop(0.75, '#bcd4e8');
  grad.addColorStop(1, '#e8ecdf');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function softDiscTexture(color = 'rgba(255,255,255,1)'){
  const { c, ctx } = makeCanvas(64);
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function desertSkyGradientTexture(){
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3d6fa8');
  grad.addColorStop(0.4, '#8fadc9');
  grad.addColorStop(0.72, '#e0c69a');
  grad.addColorStop(1, '#f2ddb0');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function leafClumpTexture(baseColor = '#2f5c2f'){
  const size = 256;
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = baseColor; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 320; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 3 + Math.random() * 9;
    const dark = Math.random() > 0.5;
    ctx.fillStyle = dark ? `rgba(10,30,10,${0.15 + Math.random() * 0.25})` : `rgba(90,140,60,${0.15 + Math.random() * 0.25})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function siteMarkerTexture(letter){
  const { c, ctx } = makeCanvas(256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(230,60,40,0.85)';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(128, 128, 110, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(230,60,40,0.55)';
  ctx.font = 'bold 150px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  return new THREE.CanvasTexture(c);
}

function woodGrainTexture(baseColor, planks = 0){
  const size = 256;
  const { c, ctx } = makeCanvas(size);
  const base = ctx.createLinearGradient(0, 0, size, 0);
  base.addColorStop(0, baseColor);
  base.addColorStop(1, baseColor);
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);

  // plank seams - only for constructed wood (crates/doors), not a solid piece like a gun stock
  if (planks > 0) {
    ctx.strokeStyle = 'rgba(15,8,3,0.4)'; ctx.lineWidth = 2;
    for (let i = 1; i < planks; i++) {
      const x = (size / planks) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    }
  }

  for (let i = 0; i < 46; i++) {
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(30,15,5,${0.08 + Math.random() * 0.14})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    let cy = y;
    for (let x = 0; x <= size; x += 12) { cy += (Math.random() - 0.5) * 8; ctx.lineTo(x, cy); }
    ctx.stroke();
  }
  // knots
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 5 + Math.random() * 6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(20,10,4,0.5)');
    grad.addColorStop(1, 'rgba(20,10,4,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(255,230,200,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function woodBumpTexture(){
  const size = 256;
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
  const planks = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
  for (let i = 1; i < planks; i++) {
    const x = (size / planks) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  for (let i = 0; i < 30; i++) {
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.15})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y);
    let cy = y;
    for (let x = 0; x <= size; x += 12) { cy += (Math.random() - 0.5) * 8; ctx.lineTo(x, cy); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function metalScratchTexture(baseColor){
  const size = 256;
  const { c, ctx } = makeCanvas(size);
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, baseColor);
  base.addColorStop(0.5, baseColor);
  base.addColorStop(1, baseColor);
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);

  // broad brushed-metal sheen bands
  for (let i = 0; i < 10; i++) {
    const y = Math.random() * size;
    ctx.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.04})`;
    ctx.lineWidth = 6 + Math.random() * 14;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (Math.random() - 0.5) * 30); ctx.stroke();
  }
  // fine directional scratches
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size, y = Math.random() * size, len = 6 + Math.random() * 26;
    const ang = Math.random() * Math.PI;
    ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.14})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  // pitting / grime speckle
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.09})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  // occasional rust/dent blotches
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 4 + Math.random() * 10;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(60,30,10,0.25)');
    grad.addColorStop(1, 'rgba(60,30,10,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function metalBumpTexture(){
  const tex = bumpNoiseTexture(256, 220, 0.28);
  return tex;
}

// small tileable checkered/knurled pattern - a generic grip texture (not any specific product's),
// used to bump-map the knife handle so it doesn't read as a flat black box
function checkeredGripTexture(){
  const size = 64, cell = 8;
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const on = ((x / cell) + (y / cell)) % 2 === 0;
      ctx.fillStyle = on ? '#fff' : '#222';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 8);
  return tex;
}

function camoTexture(colors){
  const size = 512;
  const { c, ctx } = makeCanvas(size);
  ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = colors[1 + Math.floor(Math.random() * (colors.length - 1))];
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const blobPoints = 7;
    for (let p = 0; p <= blobPoints; p++) {
      const ang = (p / blobPoints) * Math.PI * 2;
      const r = size * (0.02 + Math.random() * 0.045);
      ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.8);
    }
    ctx.closePath(); ctx.fill();
  }
  // subtle fabric weave grain on top so it doesn't read as flat vector shapes
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function rainbowFadeTexture(){
  const { c, ctx } = makeCanvas(128);
  const grad = ctx.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#e040c0');
  grad.addColorStop(0.3, '#7040e0');
  grad.addColorStop(0.55, '#3090e0');
  grad.addColorStop(0.75, '#30d0a0');
  grad.addColorStop(1, '#e0d030');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function bloodSplatterTexture(){
  const { c, ctx } = makeCanvas(128);
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 70, y = 64 + (Math.random() - 0.5) * 70, r = 6 + Math.random() * 16;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(120,4,4,0.9)');
    grad.addColorStop(1, 'rgba(120,4,4,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

// ============================================================
// SCENE SETUP
// ============================================================
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const baseFov = 75;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

// post-processing (bloom for muzzle flash / sun glow)
// Note: SSAO was tried here for contact-shadow realism, but three.js's SSAOPass reads the whole
// screen depth buffer as one image, and the first-person weapon sits only centimeters from the
// camera - its depth gradient is steep enough that SSAO's sampling kernel blows out into a bright
// diagonal streak across the gun. Fixing that properly means rendering the viewmodel in its own
// pass on a separate layer with the depth buffer cleared in between, which is a bigger change than
// this pass earns on its own - reverted for now.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.82);
composer.addPass(bloomPass);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Sky ----------
const skyGeo = new THREE.SphereGeometry(400, 24, 16);
const skyMat = new THREE.MeshBasicMaterial({ map: skyGradientTexture(), side: THREE.BackSide, fog: false });
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);
scene.fog = new THREE.FogExp2(0xb9c9c2, 0.0032);

// sun glow sprite (bloom picks this up)
const sunSpriteMat = new THREE.SpriteMaterial({ map: softDiscTexture('rgba(255,244,214,1)'), color: 0xfff2c0, transparent: true, depthWrite: false });
const sunSprite = new THREE.Sprite(sunSpriteMat);
sunSprite.scale.set(60, 60, 1);
sunSprite.position.set(140, 110, -180);
scene.add(sunSprite);

// drifting clouds
const cloudTex = softDiscTexture('rgba(255,255,255,0.9)');
const clouds = [];
for (let i = 0; i < 18; i++) {
  const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.5 + Math.random() * 0.3, depthWrite: false });
  const s = new THREE.Sprite(m);
  const scale = 30 + Math.random() * 40;
  s.scale.set(scale, scale * 0.5, 1);
  s.position.set((Math.random() - 0.5) * 500, 90 + Math.random() * 60, (Math.random() - 0.5) * 500);
  scene.add(s);
  clouds.push(s);
}

// ---------- Lighting ----------
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3a2a, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d0, 1.35);
sun.position.set(140, 110, -180);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);

// soft fill light opposite the sun so faces turned away from it never crush to pure black under
// ACES tone mapping - no shadows of its own, just a cheap "three-point lighting" bounce stand-in
const fillLight = new THREE.DirectionalLight(0xaec6e0, 0.35);
fillLight.position.set(-140, 60, 180);
scene.add(fillLight);
scene.add(fillLight.target);

function applyDesertAtmosphere(){
  sky.material.map = desertSkyGradientTexture();
  sky.material.needsUpdate = true;
  scene.fog.color.set(0xd9bd8c);
  scene.fog.density = 0.0016;
  hemi.color.set(0xffe6b8); hemi.groundColor.set(0x8a6a3c); hemi.intensity = 0.85;
  sun.color.set(0xffdca0); sun.intensity = 1.3;
  fillLight.color.set(0xe0c9a0); fillLight.intensity = 0.32;
}

// ---------- World / Map system ----------
let WORLD_SIZE = 220;
let groundHeightAt = (x, z) => 0;

// real photo/render textures for the arena map (assets/textures/), tiled since they're not
// procedurally generated to an exact size like the rest of this file's canvas-based textures
const textureLoader = new THREE.TextureLoader();
function loadTiledTexture(url, repeatX, repeatY){
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

// smooth raised (positive height) or sunken (negative height) rectangular platform,
// with a ramp-like falloff of `margin` units around its edges - used to give maps real verticality
function plateau(x, z, cx, cz, halfW, halfD, height, margin){
  const dx = Math.max(0, Math.abs(x - cx) - halfW);
  const dz = Math.max(0, Math.abs(z - cz) - halfD);
  const dist = Math.sqrt(dx * dx + dz * dz);
  const t = Math.max(0, 1 - dist / margin);
  const s = t * t * (3 - 2 * t); // smoothstep
  return height * s;
}

const colliders = [];
const envMeshes = [];
function addBox(mesh){
  const box = new THREE.Box3().setFromObject(mesh);
  colliders.push(box);
  envMeshes.push(mesh);
}

// contact shadow blob under an object for cheap AO
const blobTex = softDiscTexture('rgba(0,0,0,0.55)');
function addContactShadow(x, z, radius){
  const geo = new THREE.PlaneGeometry(radius, radius);
  geo.rotateX(-Math.PI / 2);
  const planeMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.55, depthWrite: false });
  const plane = new THREE.Mesh(geo, planeMat);
  plane.position.set(x, groundHeightAt(x, z) + 0.03, z);
  scene.add(plane);
}

function makeBoxProp(x, z, w, h, d, mat, rotY){
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, h / 2 + groundHeightAt(x, z), z);
  if (rotY) mesh.rotation.y = rotY;
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  addBox(mesh);
  addContactShadow(x, z, Math.max(w, d) * 1.15);
  return mesh;
}

// a circular "silo" room built from angled wall segments, with gaps left open for doorways
// (in radians, measured the same way as the segment angle: 0 = +x axis, increasing counter-clockwise)
function makeRoundRoom(cx, cz, radius, wallH, mat, gapAngles = [], gapWidth = 0.9){
  const segments = 12;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const inGap = gapAngles.some(g => {
      let diff = Math.abs(angle - g) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      return diff < gapWidth;
    });
    if (inGap) continue;
    const segLen = (2 * Math.PI * radius / segments) * 1.25;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    makeBoxProp(x, z, segLen, wallH, 1.2, mat, -angle);
  }
}

// leaning trunk + radiating frond cones - decorative desert prop used around the arena's corners
function makePalmTree(x, z, scale = 1){
  const trunkMat = new THREE.MeshStandardMaterial({ map: woodGrainTexture('#8a6a42', 2), bumpMap: woodBumpTexture(), bumpScale: 0.02, roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3a6b2a, roughness: 0.8, side: THREE.DoubleSide });
  const baseY = groundHeightAt(x, z);
  const trunkH = 4.5 * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, trunkH, 8), trunkMat);
  trunk.position.set(x, baseY + trunkH / 2, z);
  trunk.rotation.z = (Math.random() - 0.5) * 0.15;
  trunk.castShadow = true;
  scene.add(trunk);
  addBox(trunk);
  const frondCount = 7;
  for (let i = 0; i < frondCount; i++) {
    const ang = (i / frondCount) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.15 * scale, 2.2 * scale, 4), frondMat);
    frond.position.set(x + Math.cos(ang) * 0.1, baseY + trunkH, z + Math.sin(ang) * 0.1);
    frond.rotation.x = Math.PI / 2.3;
    frond.rotation.y = ang;
    frond.castShadow = true;
    scene.add(frond);
  }
  addContactShadow(x, z, 1.5 * scale);
}

function addPerimeterWalls(){
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1, transparent: true, opacity: 0.0 });
  [[0, -WORLD_SIZE / 2, WORLD_SIZE, 10, 2], [0, WORLD_SIZE / 2, WORLD_SIZE, 10, 2],
   [-WORLD_SIZE / 2, 0, 2, 10, WORLD_SIZE], [WORLD_SIZE / 2, 0, 2, 10, WORLD_SIZE]]
    .forEach(([x, z, w, h, d]) => makeBoxProp(x, z, w, h, d, wallMat));
}

// ---------- Map: Arena (small symmetric 1v1/2v2 duel map) ----------
// Arena layout follows the owner's own hand-drawn top-down diagram: a single elevated strip runs
// the full length of the west edge with a ramp at each end (not the sides - the arena-facing edge
// stays a steep drop, made steep by using a narrow margin only there), two symmetric spawn bands
// (north/south) sized so no single fixed point ever repeats, crate rows screening each spawn's
// exit, a loose center cluster of crates/barrels, and two low (~60%-height) walls flanking the
// elevated strip's ramps.
function buildArenaMap(){
  WORLD_SIZE = 60;
  applyDesertAtmosphere();

  const ELEV_CX = -17, ELEV_HALF_W = 3.5, ELEV_HALF_D = 20, ELEV_HEIGHT = 2.0;
  groundHeightAt = (x, z) => plateau(x, z, ELEV_CX, 0, ELEV_HALF_W, ELEV_HALF_D, ELEV_HEIGHT, 6);

  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 60, 60);
  groundGeo.rotateX(-Math.PI / 2);
  const gPos = groundGeo.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    gPos.setY(i, groundHeightAt(gPos.getX(i), gPos.getZ(i)));
  }
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/sand.jpg', 16, 16), roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  const wallMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/wall.jpg', 6, 1.5), roughness: 1 });
  const crateMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/box.png', 1, 1), roughness: 0.9 });
  crateMat.userData.penetrable = true;
  crateMat.userData.minimapProp = true;
  const lowWallMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/wall.jpg', 1.5, 0.6), roughness: 1 });
  lowWallMat.userData.minimapProp = true;

  // visible boundary all the way round - addPerimeterWalls() alone is invisible collision-only,
  // which is exactly why the arena read as endless; this ring is what actually encloses it.
  // The west wall (the elevated zone's outer, ramp-less side) sits much closer in than the other
  // three - the elevated strip only has ramps at its z-ends, so the flat ground between its outer
  // face and a far-away boundary wall was dead, oversized empty space.
  const halfArenaZ = 27, eastX = 27, westX = ELEV_CX - ELEV_HALF_W - 0.5, wallThk = 2;
  const wallCx = (eastX + westX) / 2, wallSpanX = (eastX - westX) + wallThk * 2;
  // built directly rather than through makeBoxProp: that helper samples groundHeightAt() only at
  // the box's center point, which works for small props but not for a wall this long - the west
  // wall's center sits close enough to the elevated plateau to get lifted onto it, leaving the
  // rest of the wall (over ordinary flat ground) floating with a gap underneath. Anchoring every
  // boundary wall to a fixed baseline well below the lowest possible terrain avoids that entirely.
  const wallBaseY = -1, wallH = 10;
  [[wallCx, -halfArenaZ, wallSpanX, wallH, wallThk], [wallCx, halfArenaZ, wallSpanX, wallH, wallThk],
   [westX, 0, wallThk, wallH, halfArenaZ * 2 + wallThk * 2], [eastX, 0, wallThk, wallH, halfArenaZ * 2 + wallThk * 2]]
    .forEach(([x, z, w, h, d]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      mesh.position.set(x, wallBaseY + h / 2, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      addBox(mesh);
    });
  addPerimeterWalls();

  // crate rows screening each spawn zone's exit into the main area - tight crate-to-crate, but
  // with real breathing room between this row and the center cluster (the mistake last pass was
  // tightening that gap too along with the crate spacing) - mirrored north/south. Pulled in close
  // to the elevated zone's east edge so there's no bare dead strip between them.
  const rowXs = [-11, -7.55, -4.1, -0.65];
  rowXs.forEach(x => { makeBoxProp(x, -15, 1.7, 1.7, 1.7, crateMat); makeBoxProp(x, 15, 1.7, 1.7, 1.7, crateMat); });

  const barrelMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/metal.jpg', 1, 2), roughness: 0.4, metalness: 0.7 });
  barrelMat.userData.minimapProp = true;
  function addBarrel(x, z){
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 12), barrelMat);
    barrel.position.set(x, groundHeightAt(x, z) + 0.8, z);
    barrel.castShadow = true; barrel.receiveShadow = true;
    scene.add(barrel);
    addBox(barrel);
  }

  // an extra row right at the mouth of each spawn zone, spanning the full width of the spawn
  // (including the east side, which had nothing at all) so there's no bare runway between
  // spawning and reaching the screening row above - mirrored north/south
  const entryRowXs = [-9, -5, -1, 3, 7, 11];
  entryRowXs.forEach(x => { makeBoxProp(x, -18.5, 1.6, 1.6, 1.6, crateMat); makeBoxProp(x, 18.5, 1.6, 1.6, 1.6, crateMat); });
  [[14, -19], [14, 19]].forEach(([x, z]) => addBarrel(x, z));

  // center cluster - crates and big drums close together, not perfectly mirrored (matches the
  // reference sketch), sitting in its own open lane well clear of the spawn-exit rows
  makeBoxProp(-3, -4, 1.6, 1.6, 1.6, crateMat);
  makeBoxProp(7, 3, 1.6, 1.6, 1.6, crateMat);
  [[2, -2], [5, 1.5], [-1, 3]].forEach(([x, z]) => addBarrel(x, z));

  // two crates up on the elevated strip
  makeBoxProp(ELEV_CX, -10, 1.5, 1.5, 1.5, crateMat);
  makeBoxProp(ELEV_CX, 3, 1.5, 1.5, 1.5, crateMat);

  // low walls (~60% of player height, so they crouch-cover but not stand-cover) right where each
  // ramp meets the main floor
  makeBoxProp(ELEV_CX + ELEV_HALF_W + 1.5, -17, 2.6, 1.05, 1.1, lowWallMat);
  makeBoxProp(ELEV_CX + ELEV_HALF_W + 1.5, 17, 2.6, 1.05, 1.1, lowWallMat);

  // palm trees for atmosphere, kept clear of the walls (west ones pushed further out now that
  // the west wall itself moved in)
  [[westX - 3, -halfArenaZ - 3], [24, -24], [westX - 3, halfArenaZ + 3], [24, 24]].forEach(([x, z]) => makePalmTree(x, z, 0.8));

  // spawn bands, not single fixed points - a new random spot inside the zone is picked every
  // time a player (re)spawns, so nobody can camp a known exact spawn location (see getTeamSpawnPos)
  const spawnZoneA = { xMin: -11, xMax: 18, zMin: -26, zMax: -20 };
  const spawnZoneB = { xMin: -11, xMax: 18, zMin: 20, zMax: 26 };

  return {
    spawn: new THREE.Vector3(0, 2, -23),
    tSpawn: new THREE.Vector3(0, 2, -23),
    ctSpawn: new THREE.Vector3(0, 2, 23),
    tSpawnZone: spawnZoneA,
    ctSpawnZone: spawnZoneB,
    sites: []
  };
}

// picks a random point inside a map's spawn zone when one is defined (arena), otherwise falls
// back to the fixed spawn point every other map still uses
function getTeamSpawnPos(meta, team){
  const zone = team === 'A' ? meta.tSpawnZone : meta.ctSpawnZone;
  if (zone) {
    const x = zone.xMin + Math.random() * (zone.xMax - zone.xMin);
    const z = zone.zMin + Math.random() * (zone.zMax - zone.zMin);
    return new THREE.Vector3(x, 2, z);
  }
  return (team === 'A' ? meta.tSpawn : meta.ctSpawn).clone();
}

// yaw that faces the player from their spawn toward the middle of the arena (and the opposing
// team) instead of leaving them at whatever yaw they happened to have before - without this,
// team A always spawned staring straight into the wall behind their own spawn
function getSpawnYaw(team){
  return team === 'A' ? Math.PI : 0;
}


const MAPS = {
  arena: { name: 'Desert', build: buildArenaMap }
};
let selectedMap = 'arena';

let currentMapMeta = null;
function buildMap(id){
  const result = MAPS[id].build();
  currentMapMeta = result;
  player.pos.copy(result.spawn);
  player.pos.y = groundHeightAt(result.spawn.x, result.spawn.z) + player.height;
  player.velY = 0;
  camera.position.copy(player.pos);
}

// ============================================================
// PLAYER
// ============================================================
const player = {
  pos: new THREE.Vector3(0, 2, 20),
  velY: 0,
  onGround: true,
  height: 1.8,
  crouchHeight: 1.0,
  crouching: false,
  yaw: 0,
  pitch: 0,
  speed: 8,
  sprintMul: 1.7,
  crouchMul: 0.5,
  health: 100,
  maxHealth: 100,
  alive: true,
  ads: false,
  adsT: 0,
  scopeLevel: 0, // 0 = hip, 1 = scoped, 2 = scoped + extra zoom (sniper click-cycle, not hold)
  footstepTimer: 0
};
camera.position.copy(player.pos);
camera.fov = baseFov;

// screen shake / recoil state
let shakeIntensity = 0;
let recoilKick = 0; // additive pitch kick (radians), decays
let recoilYaw = 0; // additive horizontal kick (radians), decays
let sprayIndex = 0;
let lastFireTime = -999;

// deterministic per-weapon spray pattern: climbs then eases, with a side-to-side zigzag scaled by
// horizAmp - same idea as CS's fixed recoil patterns (learnable, not random), consumed shot by shot
// while firing continuously and reset after a short pause
function buildSprayPattern(steps, vertGain, horizAmp, horizFreq){
  const pat = [];
  for (let i = 0; i < steps; i++) {
    const dy = vertGain * (1 - Math.exp(-i / 4));
    const dx = Math.sin(i / horizFreq) * horizAmp * Math.min(1, i / 3);
    pat.push({ dy, dx });
  }
  return pat;
}
const SPRAY_PATTERNS = {
  ak47: buildSprayPattern(30, 0.018, 0.01, 2.2),
  m4a4: buildSprayPattern(30, 0.012, 0.006, 2.6),
  m4a1: buildSprayPattern(20, 0.011, 0.005, 2.6),
  glock: buildSprayPattern(20, 0.009, 0.004, 3),
  deagle: buildSprayPattern(7, 0.02, 0.008, 2),
  tec9: buildSprayPattern(18, 0.009, 0.004, 3),
  duals: buildSprayPattern(30, 0.008, 0.004, 3),
  awp: buildSprayPattern(5, 0.03, 0.01, 2)
};

// ---------- Weapon system: definitions, inventory, per-weapon visuals ----------
const WEAPONS = {
  knife:  { name: 'Cuchillo Mariposa', slot: 'melee', price: 0, dmg: 55, range: 2.4, fireRate: 0.45 },
  glock:  { name: 'Glock-18', slot: 'secondary', price: 200, dmg: 17, mag: 20, reserve: 60, fireRate: 0.15, range: 100, reloadDuration: 1.3, zoomFov: 55, kickPush: 0.035, kickTilt: 0.05 },
  deagle: { name: 'Desert Eagle', slot: 'secondary', price: 650, dmg: 42, mag: 7, reserve: 35, fireRate: 0.3, range: 130, reloadDuration: 1.6, zoomFov: 52, kickPush: 0.07, kickTilt: 0.09 },
  tec9:   { name: 'Tec-9', slot: 'secondary', price: 450, dmg: 19, mag: 18, reserve: 72, fireRate: 0.11, range: 90, reloadDuration: 1.4, zoomFov: 58, kickPush: 0.03, kickTilt: 0.045 },
  duals:  { name: 'Duales Beretta', slot: 'secondary', price: 750, dmg: 16, mag: 30, reserve: 120, fireRate: 0.08, range: 90, reloadDuration: 1.7, zoomFov: 60, kickPush: 0.03, kickTilt: 0.045 },
  ak47:   { name: 'AK-47', slot: 'primary', price: 2500, dmg: 34, mag: 30, reserve: 90, fireRate: 0.1, range: 150, reloadDuration: 1.7, zoomFov: 48, kickPush: 0.05, kickTilt: 0.07 },
  m4a4:   { name: 'M4A4', slot: 'primary', price: 2900, dmg: 31, mag: 30, reserve: 90, fireRate: 0.095, range: 150, reloadDuration: 1.65, zoomFov: 48, kickPush: 0.045, kickTilt: 0.06 },
  m4a1:   { name: 'M4A1-S', slot: 'primary', price: 2750, dmg: 35, mag: 20, reserve: 80, fireRate: 0.11, range: 150, reloadDuration: 1.6, zoomFov: 45, kickPush: 0.04, kickTilt: 0.055 },
  awp:    { name: 'AWP', slot: 'primary', price: 4500, dmg: 115, mag: 5, reserve: 30, fireRate: 1.35, range: 320, reloadDuration: 2.4, zoomFov: 12, scope: true, scopeFov2: 5, kickPush: 0.15, kickTilt: 0.2 },
  grenade:{ name: 'Grenade', slot: 'grenade', price: 300, dmg: 130, radius: 7, fireRate: 0.8 },
  smoke:  { name: 'Smoke Grenade', slot: 'smoke', price: 400, radius: 9, duration: 14, fireRate: 0.8 }
};

// per-weapon gunshot timbre for the synthesized audio engine (see SoundEngine.gunshot)
const GUNSHOT_PROFILES = {
  glock:  { noiseDur: 0.14, bpFreq: 2100, noiseDecay: 0.09, noiseVol: 0.9, oscStart: 175, oscEnd: 60, oscDecay: 0.07, oscVol: 0.75 },
  deagle: { noiseDur: 0.28, bpFreq: 1150, bpQ: 0.5, noiseDecay: 0.22, noiseVol: 1.3, oscStart: 90, oscEnd: 25, oscDecay: 0.2, oscVol: 1.25, tailDur: 0.32, tailVol: 0.2, subFreq: 90, subDur: 0.16, subVol: 0.6 },
  tec9:   { noiseDur: 0.1, bpFreq: 2500, noiseDecay: 0.055, noiseVol: 0.8, oscStart: 220, oscEnd: 80, oscDecay: 0.045, oscVol: 0.6 },
  duals:  { noiseDur: 0.09, bpFreq: 2300, noiseDecay: 0.05, noiseVol: 0.8, oscStart: 200, oscEnd: 70, oscDecay: 0.045, oscVol: 0.6 },
  ak47:   { noiseDur: 0.2, bpFreq: 1450, noiseDecay: 0.15, noiseVol: 1.05, oscStart: 130, oscEnd: 35, oscDecay: 0.12, oscVol: 1, subFreq: 75, subDur: 0.09, subVol: 0.3 },
  m4a4:   { noiseDur: 0.2, bpFreq: 1800, noiseDecay: 0.14, noiseVol: 1, oscStart: 140, oscEnd: 42, oscDecay: 0.11, oscVol: 0.9 },
  m4a1:   { noiseDur: 0.13, bpFreq: 2600, noiseDecay: 0.07, noiseVol: 0.4, oscStart: 150, oscEnd: 44, oscDecay: 0.06, oscVol: 0.35 }, // suppressed: dull, quiet crack
  // the sniper: deeper crack, longer boom tail, and a hard sub-bass thump underneath for a
  // much more aggressive, chest-punch report than the other weapons
  awp:    { noiseDur: 0.5, bpFreq: 700, bpQ: 0.4, noiseDecay: 0.42, noiseVol: 1.5, oscStart: 55, oscEnd: 14, oscDecay: 0.36, oscVol: 1.7, tailDur: 0.7, tailVol: 0.28, subFreq: 70, subDur: 0.3, subVol: 0.9 }
};

const inventory = { primary: null, secondary: null };
const ammoState = {}; // slot -> { mag, reserve }
let currentSlot = 'melee';
let lastSlot = 'melee';
let money = 1000;
const MAX_GRENADES = 3;
let grenadeCount = 0;
const MAX_SMOKES = 2;
let smokeCount = 0;

const weaponGroup = new THREE.Group();
camera.add(weaponGroup);
scene.add(camera);

const weaponMetalBump = metalBumpTexture();
const weaponWoodBump = woodBumpTexture();
const gunMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#1c1c1c'), bumpMap: weaponMetalBump, bumpScale: 0.006, roughnessMap: weaponMetalBump, roughness: 0.7, metalness: 0.4 });
const gunMatLight = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#33352f'), bumpMap: weaponMetalBump, bumpScale: 0.006, roughnessMap: weaponMetalBump, roughness: 0.75, metalness: 0.35 });
const woodMat = new THREE.MeshStandardMaterial({ map: woodGrainTexture('#5a3d24'), bumpMap: weaponWoodBump, bumpScale: 0.01, roughness: 0.6 });
const akWoodMat = new THREE.MeshStandardMaterial({ map: woodGrainTexture('#a9743f'), bumpMap: weaponWoodBump, bumpScale: 0.01, roughness: 0.5 }); // honey-brown AK furniture, matching the classic laminate look
const akMetalMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#6b6b66'), bumpMap: weaponMetalBump, bumpScale: 0.01, roughness: 0.55, metalness: 0.6 }); // worn grey parkerized steel, lighter than the flat-black M4/AWP metal
const pistolMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#24241f'), bumpMap: weaponMetalBump, bumpScale: 0.006, roughnessMap: weaponMetalBump, roughness: 0.6, metalness: 0.45 });
const awpStockMat = new THREE.MeshStandardMaterial({ color: 0x6f6f4a, roughness: 0.85, metalness: 0.05 }); // solid matte olive polymer stock, not a camo pattern
const chromeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#d4d4d4'), bumpMap: weaponMetalBump, bumpScale: 0.004, roughness: 0.2, metalness: 0.95 }); // bright polished slide finish, for the Berettas
const deagleMat = chromeMat; // brushed stainless finish, matching the real Desert Eagle's signature silver slide
const skinMat = new THREE.MeshStandardMaterial({ color: 0xb98862, roughness: 0.8 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3a3a35, roughness: 0.9 });
const camoGreenMat = new THREE.MeshStandardMaterial({ map: camoTexture(['#2f3a1e', '#5a6b34', '#1c2412', '#0d0d0d']), roughness: 0.8 });
const bladeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#b23a3a'), bumpMap: metalBumpTexture(), bumpScale: 0.01, roughness: 0.25, metalness: 0.85 });
const handleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.55 });
const knifeHandleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, bumpMap: checkeredGripTexture(), bumpScale: 0.004, roughness: 0.75 });
const grenadeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#384a24'), bumpMap: weaponMetalBump, bumpScale: 0.008, roughnessMap: weaponMetalBump, roughness: 0.65, metalness: 0.15 });
const smokeGrenadeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#8a8f88'), bumpMap: weaponMetalBump, bumpScale: 0.008, roughnessMap: weaponMetalBump, roughness: 0.6, metalness: 0.2 });

// weapon aim position (hip vs ADS)
const hipPos = new THREE.Vector3(0, 0, 0);
const adsPos = new THREE.Vector3(-0.24, -0.02, 0.18);

// muzzle flash light + sprite (re-parented onto whichever weapon is equipped)
const flashLight = new THREE.PointLight(0xffcc66, 0, 8);
const flashSpriteMat = new THREE.SpriteMaterial({ map: softDiscTexture('rgba(255,230,150,1)'), transparent: true, depthWrite: false, opacity: 0 });
const flashSprite = new THREE.Sprite(flashSpriteMat);
flashSprite.scale.set(0.4, 0.4, 1);

let currentVisual = null; // { group, magazine, chargingHandle, magRestY, chargeRestX, muzzle, knifeParts }

function buildWeaponVisual(id){
  const group = new THREE.Group();
  let magazine = null, chargingHandle = null, muzzle = new THREE.Vector3(0.24, -0.185, -1.0), knifeParts = null;

  function rifleModel(magLen, stockLen, barrelLen, mat){
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.5), gunMat);
    receiver.position.set(0.24, -0.2, -0.42);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, barrelLen, 8), gunMatLight);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.24, -0.185, -0.55 - barrelLen / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, stockLen), mat);
    stock.position.set(0.24, -0.23, -0.05);
    magazine = new THREE.Mesh(new THREE.BoxGeometry(0.055, magLen, 0.09), gunMat);
    magazine.position.set(0.24, -0.2 - magLen / 2, -0.42);
    const sightPost = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.015), gunMatLight);
    sightPost.position.set(0.24, -0.13, -0.55 - barrelLen * 0.7);
    chargingHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.06), gunMatLight);
    chargingHandle.position.set(0.19, -0.19, -0.3);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), gunMat);
    grip.position.set(0.24, -0.32, -0.2);
    grip.rotation.x = 0.2;
    group.add(receiver, barrel, stock, magazine, sightPost, chargingHandle, grip);
    muzzle.set(0.24, -0.185, -0.55 - barrelLen);
  }

  function pistolModel(mat, bodyLen, magLen, big){
    const body = new THREE.Mesh(new THREE.BoxGeometry(big ? 0.1 : 0.07, 0.13, bodyLen), mat);
    body.position.set(0.22, -0.22, -0.35);
    const gripM = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), handleMat);
    gripM.position.set(0.22, -0.34, -0.22);
    gripM.rotation.x = 0.15;
    magazine = new THREE.Mesh(new THREE.BoxGeometry(0.04, magLen, 0.05), mat);
    magazine.position.set(0.22, -0.38, -0.24);
    group.add(body, gripM, magazine);
    muzzle.set(0.22, -0.22, -0.35 - bodyLen / 2);
  }

  // Beretta-style pistol: dark frame, a bright chrome slide, wood grip panels and an exposed
  // hammer - used for the duals (each one cloned and mirrored onto the other hand)
  function berettaModel(bodyLen, magLen){
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.11, bodyLen), gunMat);
    frame.position.set(0.22, -0.225, -0.34);
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.055, bodyLen + 0.04), chromeMat);
    slide.position.set(0.22, -0.165, -0.36);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.155, 0.075), woodMat);
    grip.position.set(0.22, -0.335, -0.2);
    grip.rotation.x = 0.15;
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), gunMat);
    hammer.position.set(0.22, -0.145, -0.205);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.012), gunMat);
    frontSight.position.set(0.22, -0.13, -0.34 - bodyLen / 2 + 0.02);
    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.015), gunMat);
    rearSight.position.set(0.22, -0.13, -0.22);
    const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 6, 10, Math.PI * 1.3), gunMat);
    triggerGuard.rotation.z = Math.PI * 0.35;
    triggerGuard.position.set(0.22, -0.27, -0.29);
    magazine = new THREE.Mesh(new THREE.BoxGeometry(0.04, magLen, 0.05), gunMat);
    magazine.position.set(0.22, -0.335 - magLen / 2 + 0.08, -0.24);
    group.add(frame, slide, grip, hammer, frontSight, rearSight, triggerGuard, magazine);
    muzzle.set(0.22, -0.195, -0.34 - bodyLen / 2 - 0.02);
  }

  switch (id) {
    case 'knife': {
      // tapered clip-point blade profile, extruded flat then rotated so it points forward (-Z)
      // with a beveled edge highlight, instead of the old flat box
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, 0.018);
      bladeShape.lineTo(0.16, 0.02);
      bladeShape.lineTo(0.24, 0.012);
      bladeShape.lineTo(0.30, 0);
      bladeShape.lineTo(0.24, -0.026);
      bladeShape.lineTo(0.10, -0.022);
      bladeShape.lineTo(0, -0.006);
      bladeShape.lineTo(0, 0.018);
      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0025, bevelSegments: 2 });
      bladeGeo.translate(0, 0, -0.003);
      bladeGeo.rotateY(Math.PI / 2);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(0.22, -0.17, -0.30);

      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.02), gunMat);
      guard.position.set(0.22, -0.17, -0.30);

      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.16, 8), knifeHandleMat);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0.22, -0.17, -0.22);

      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), gunMat);
      pommel.position.set(0.22, -0.17, -0.14);

      group.add(blade, guard, handle, pommel);
      knifeParts = { handle, blade };
      muzzle = null;
      break;
    }
    case 'glock': {
      pistolModel(pistolMat, 0.32, 0.16, false);
      // front/rear sights
      const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.012), gunMatLight);
      frontSight.position.set(0.22, -0.16, -0.5);
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.015), gunMatLight);
      rearSight.position.set(0.22, -0.16, -0.21);
      group.add(frontSight, rearSight);
      // rear-slide grip serrations, striker-fired pistols' signature vertical grooves
      for (let i = 0; i < 5; i++) {
        const groove = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.1, 0.01), gunMatLight);
        groove.position.set(0.185, -0.22, -0.24 - i * 0.014);
        group.add(groove);
      }
      // trigger guard loop
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 6, 10, Math.PI * 1.3), pistolMat);
      triggerGuard.rotation.z = Math.PI * 0.35;
      triggerGuard.position.set(0.22, -0.29, -0.28);
      group.add(triggerGuard);
      break;
    }
    case 'deagle': {
      pistolModel(deagleMat, 0.42, 0.22, true);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.3), deagleMat);
      rail.position.set(0.22, -0.155, -0.35);
      group.add(rail);
      // slide venting ribs, the Deagle's signature top-slide serrations
      for (let i = 0; i < 4; i++) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.008, 0.015), gunMat);
        vent.position.set(0.22, -0.166, -0.24 - i * 0.03);
        group.add(vent);
      }
      // exposed hammer at the rear of the slide
      const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.018), gunMat);
      hammer.position.set(0.22, -0.155, -0.185);
      group.add(hammer);
      break;
    }
    case 'tec9': {
      pistolModel(pistolMat, 0.36, 0.22, false);
      // the Tec-9's signature chunky, ventilated barrel shroud extending past the slide
      const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 10), pistolMat);
      shroud.rotation.x = Math.PI / 2;
      shroud.position.set(0.22, -0.22, -0.66);
      group.add(shroud);
      for (let i = 0; i < 4; i++) { // vent holes along the top of the shroud
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), gunMat);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(0.22, -0.175, -0.58 - i * 0.05);
        group.add(hole);
      }
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.015), gunMatLight);
      rearSight.position.set(0.22, -0.16, -0.2);
      group.add(rearSight);
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 10, Math.PI * 1.3), pistolMat);
      triggerGuard.rotation.z = Math.PI * 0.35;
      triggerGuard.position.set(0.22, -0.3, -0.28);
      group.add(triggerGuard);
      muzzle.z -= 0.26;
      break;
    }
    case 'duals': {
      // one pistol on each side of the screen (mirrored across center) instead of both
      // clustered together on the usual single-weapon right-hand offset
      berettaModel(0.32, 0.14);
      const original = group.children.slice();
      original.forEach(m => { const c = m.clone(); c.position.x = -m.position.x; group.add(c); });
      break;
    }
    case 'ak47': {
      rifleModel(0.28, 0.28, 0.42, akWoodMat);
      // worn grey parkerized steel receiver/barrel/sights instead of the flat-black M4 metal,
      // and a wood grip to match the classic AKM furniture set
      const receiver = group.children[0], barrel = group.children[1], sightPost = group.children[4], chargingHandle2 = group.children[5], grip = group.children[6];
      receiver.material = akMetalMat;
      barrel.material = akMetalMat;
      sightPost.material = akMetalMat;
      chargingHandle2.material = akMetalMat;
      grip.material = akWoodMat;
      // banana-curved magazine: three angled segments following the curve
      magazine.geometry.dispose();
      magazine.geometry = new THREE.BoxGeometry(0.05, 0.15, 0.08);
      magazine.material = gunMat;
      magazine.position.set(0.24, -0.27, -0.41);
      magazine.rotation.x = -0.25;
      const magMid = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.078), gunMat);
      magMid.position.set(0.24, -0.38, -0.36);
      magMid.rotation.x = -0.55;
      const magTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.075), gunMat);
      magTip.position.set(0.24, -0.48, -0.28);
      magTip.rotation.x = -0.85;
      group.add(magMid, magTip);
      const woodHandguard = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.3), akWoodMat);
      woodHandguard.position.set(0.24, -0.19, -0.65);
      group.add(woodHandguard);
      // gas tube above the barrel, distinctive AK silhouette
      const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.32, 8), akMetalMat);
      gasTube.rotation.x = Math.PI / 2;
      gasTube.position.set(0.24, -0.145, -0.62);
      group.add(gasTube);
      // slant-cut muzzle brake, the classic AK silhouette at the barrel tip
      const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.09, 8), akMetalMat);
      muzzleBrake.rotation.x = Math.PI / 2;
      muzzleBrake.position.set(0.24, -0.185, -0.55 - 0.42 - 0.05);
      group.add(muzzleBrake);
      // hooded ring around the front sight post
      const sightHood = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 10), akMetalMat);
      sightHood.position.copy(sightPost.position); sightHood.position.y += 0.02;
      group.add(sightHood);
      // rear sight leaf near the back of the receiver
      const rearSightLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.05), akMetalMat);
      rearSightLeaf.position.set(0.24, -0.115, -0.28);
      rearSightLeaf.rotation.x = -0.3;
      group.add(rearSightLeaf);
      break;
    }
    case 'm4a4': {
      // flat black M4A4: ribbed RIS handguard, an A-frame front sight tower, a flip-up rear
      // sight on the top rail, a collapsible carbine stock and a birdcage flash hider
      rifleModel(0.24, 0.1, 0.42, gunMat);
      magazine.material = gunMat;
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.32), gunMat);
      handguard.position.set(0.24, -0.185, -0.68);
      group.add(handguard);
      for (let i = 0; i < 6; i++) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.01, 0.02), gunMatLight);
        ridge.position.set(0.24, -0.14, -0.55 - i * 0.05);
        group.add(ridge);
      }
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.34), gunMatLight);
      topRail.position.set(0.24, -0.135, -0.42);
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.02), gunMatLight);
      rearSight.position.set(0.24, -0.11, -0.3);
      group.add(topRail, rearSight);
      // A-frame front sight tower near the muzzle: a triangular post on a small base
      const sightBase = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.05, 3), gunMatLight);
      sightBase.position.set(0.24, -0.145, -0.92);
      const sightPostTop = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), gunMatLight);
      sightPostTop.position.set(0.24, -0.1, -0.92);
      group.add(sightBase, sightPostTop);
      // collapsible carbine stock in place of the fixed rifle stock
      const stockTube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), gunMatLight);
      stockTube.rotation.x = Math.PI / 2;
      stockTube.position.set(0.24, -0.2, -0.1);
      const shoulderPad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), gunMat);
      shoulderPad.position.set(0.24, -0.2, -0.01);
      group.add(stockTube, shoulderPad);
      const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.09, 8), gunMat);
      flashHider.rotation.x = Math.PI / 2;
      flashHider.position.set(0.24, -0.185, -0.975);
      group.add(flashHider);
      break;
    }
    case 'm4a1': {
      // flat black M4A1-S: railed quad handguard, a top rail with a flip-up rear sight and a
      // reflex sight, a collapsible carbine stock, and a long, prominent suppressor
      rifleModel(0.2, 0.1, 0.32, gunMat);
      magazine.material = gunMat;
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.28), gunMat);
      handguard.position.set(0.24, -0.185, -0.58);
      group.add(handguard);
      for (let i = 0; i < 5; i++) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.01, 0.02), gunMatLight);
        ridge.position.set(0.24, -0.14, -0.47 - i * 0.05);
        group.add(ridge);
      }
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.34), gunMatLight);
      topRail.position.set(0.24, -0.135, -0.42);
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.02), gunMatLight);
      rearSight.position.set(0.24, -0.11, -0.3);
      const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.05), gunMat);
      sightBase.position.set(0.24, -0.11, -0.44);
      const sightRing = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 10), gunMatLight);
      sightRing.position.set(0.24, -0.085, -0.44);
      group.add(topRail, rearSight, sightBase, sightRing);
      // collapsible carbine stock in place of the fixed rifle stock: a thin tube plus a shoulder pad
      const stockTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), gunMatLight);
      stockTube.rotation.x = Math.PI / 2;
      stockTube.position.set(0.24, -0.2, -0.1);
      const shoulderPad = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.03), gunMat);
      shoulderPad.position.set(0.24, -0.2, -0.02);
      group.add(stockTube, shoulderPad);
      const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.3, 10), gunMat);
      suppressor.rotation.x = Math.PI / 2;
      suppressor.position.set(0.24, -0.185, -0.55 - 0.32 - 0.15);
      group.add(suppressor);
      muzzle.z -= 0.3;
      break;
    }
    case 'awp': {
      // bullpup bolt-action sniper: solid matte olive stock/handguard (not a camo pattern), a
      // big scope on a raised black mount rail, a bolt handle, and a black box magazine
      rifleModel(0.14, 0.1, 0.85, awpStockMat);
      magazine.material = gunMat;
      const mountRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.4), gunMat);
      mountRail.position.set(0.24, -0.115, -0.4);
      const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.4, 12), gunMat);
      scopeBody.rotation.x = Math.PI / 2;
      scopeBody.position.set(0.24, -0.075, -0.4);
      const scopeLensFront = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 12), gunMatLight);
      scopeLensFront.rotation.x = Math.PI / 2;
      scopeLensFront.position.set(0.24, -0.075, -0.58);
      const scopeLensBack = scopeLensFront.clone();
      scopeLensBack.position.z = -0.22;
      const mountA = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), gunMat);
      mountA.position.set(0.24, -0.13, -0.32);
      const mountB = mountA.clone(); mountB.position.z = -0.48;
      group.add(mountRail, scopeBody, scopeLensFront, scopeLensBack, mountA, mountB);
      // thick angular handguard, longer than the standard rifle model, matching the AWP's bull barrel look
      const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.55), awpStockMat);
      handguard.position.set(0.24, -0.185, -0.85);
      group.add(handguard);
      // bolt handle sticking out the side of the receiver
      const boltHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), gunMat);
      boltHandle.rotation.z = Math.PI / 2;
      boltHandle.position.set(0.31, -0.185, -0.28);
      group.add(boltHandle);
      // trigger guard loop
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 6, 10, Math.PI * 1.3), gunMat);
      triggerGuard.rotation.z = Math.PI * 0.35;
      triggerGuard.position.set(0.24, -0.29, -0.24);
      group.add(triggerGuard);
      // cheek riser behind the scope, same olive as the rest of the stock
      const cheekRiser = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.14), awpStockMat);
      cheekRiser.position.set(0.24, -0.14, -0.02);
      group.add(cheekRiser);
      break;
    }
    case 'grenade': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), grenadeMat);
      body.position.set(0.22, -0.22, -0.3);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.015), gunMatLight);
      lever.position.set(0.27, -0.14, -0.3);
      const pin = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 10), gunMatLight);
      pin.position.set(0.31, -0.13, -0.3);
      pin.rotation.y = Math.PI / 2;
      group.add(body, lever, pin);
      muzzle = null;
      break;
    }
    case 'smoke': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 12), smokeGrenadeMat);
      body.position.set(0.22, -0.22, -0.3);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10), gunMatLight);
      cap.position.set(0.22, -0.15, -0.3);
      group.add(body, cap);
      muzzle = null;
      break;
    }
  }

  flashLight.position.copy(muzzle || new THREE.Vector3(0.22, -0.2, -0.6));
  flashSprite.position.copy(flashLight.position);
  group.add(flashLight, flashSprite);
  return { group, magazine, chargingHandle, magRestY: magazine ? magazine.position.y : 0, chargeRestX: chargingHandle ? chargingHandle.position.x : 0, muzzle, knifeParts };
}

function equipSlot(slot){
  if (slot === 'primary' && !inventory.primary) return;
  if (slot === 'secondary' && !inventory.secondary) return;
  if (slot === 'grenade' && grenadeCount <= 0) return;
  if (slot === 'smoke' && smokeCount <= 0) return;
  if (slot === currentSlot || reloadRuntime.reloading) return;
  lastSlot = currentSlot;
  currentSlot = slot;
  player.ads = false;
  player.scopeLevel = 0;
  const id = slot === 'melee' ? 'knife' : slot === 'grenade' ? 'grenade' : slot === 'smoke' ? 'smoke' : inventory[slot];
  if (currentVisual) weaponGroup.remove(currentVisual.group);
  currentVisual = buildWeaponVisual(id);
  weaponGroup.add(currentVisual.group);
  weaponGroup.rotation.x = 0;
  weaponGroup.position.set(0, 0, 0);
  updateAmmoHUD();
}

currentVisual = buildWeaponVisual('knife');
weaponGroup.add(currentVisual.group);

// forearm + hand holding the grip, so the weapon isn't a disembodied floating prop
const armGroup = new THREE.Group();
const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.4, 8), skinMat);
forearm.rotation.z = Math.PI / 2.3;
forearm.position.set(0.16, -0.32, 0.05);
const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.16, 8), sleeveMat);
sleeve.rotation.z = Math.PI / 2.3;
sleeve.position.set(0.1, -0.29, 0.14);
const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.09), skinMat);
hand.position.set(0.235, -0.32, -0.12);
armGroup.add(forearm, sleeve, hand);
weaponGroup.add(armGroup);

// ============================================================
// INPUT
// ============================================================
const keys = {};
let mouseLocked = false;

// ---------- Settings: sensitivity + rebindable keys, persisted across reloads ----------
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'ShiftLeft', sprint: 'ControlLeft',
  reload: 'KeyR', shop: 'KeyB', knife: 'KeyF'
};
const BIND_LABELS = {
  forward: 'MOVE FORWARD', back: 'MOVE BACK', left: 'MOVE LEFT', right: 'MOVE RIGHT',
  jump: 'JUMP', crouch: 'CROUCH', sprint: 'SPRINT',
  reload: 'RELOAD', shop: 'OPEN SHOP', knife: 'KNIFE INSPECT'
};
const settings = { sensitivity: 1, binds: { ...DEFAULT_BINDS } };
(function loadSettings(){
  try {
    const saved = JSON.parse(localStorage.getItem('lastRoundSettings') || 'null');
    if (saved) {
      if (typeof saved.sensitivity === 'number') settings.sensitivity = saved.sensitivity;
      if (saved.binds) Object.assign(settings.binds, saved.binds);
    }
  } catch (err) { /* corrupt/blocked storage - just use defaults */ }
})();
function saveSettings(){
  try { localStorage.setItem('lastRoundSettings', JSON.stringify(settings)); } catch (err) { /* private window / storage blocked - setting still works this session */ }
}
function keyLabel(code){
  if (!code) return '...';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Left', '').replace('Right', '').toUpperCase();
}

document.addEventListener('keydown', e => keys[e.code] = true);
document.addEventListener('keyup', e => keys[e.code] = false);

renderer.domElement.addEventListener('click', () => {
  if (!mouseLocked && gameStarted && player.alive) renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  mouseLocked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener('mousemove', e => {
  if (!mouseLocked) return;
  // sensitivity scales down with the current zoom level - a tighter scope (lower fov) turns the
  // mouse slower, so a heavily-zoomed AWP feels far more controlled than a lightly-zoomed pistol
  const sens = (player.ads ? 0.0022 * (camera.fov / baseFov) : 0.0022) * settings.sensitivity;
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.pitch));
});
document.addEventListener('contextmenu', e => e.preventDefault());

let mouseDown = false;
document.addEventListener('mousedown', e => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) {
    const def = currentWeaponDef();
    // right click on a grenade/smoke throws short instead of aiming down sights
    if (currentSlot === 'grenade' || currentSlot === 'smoke') {
      if (player.alive && !reloadRuntime.reloading && fireCooldown <= 0) {
        fireCooldown = def.fireRate;
        throwGrenade(currentSlot === 'grenade' ? 'frag' : 'smoke', false);
      }
    } else if (def.scope) {
      // scoped weapons (sniper) click-cycle through zoom levels instead of hold-to-aim:
      // hip -> scoped -> extra zoom -> back to hip
      player.scopeLevel = (player.scopeLevel + 1) % 3;
      player.ads = player.scopeLevel > 0;
      if (!audio.playSample('scopeClick', 0.6)) audio.mechClick(700, 0.15, 0.05);
    } else {
      player.ads = true;
    }
  }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2 && !currentWeaponDef().scope) player.ads = false;
});
document.addEventListener('keydown', e => {
  if (!gameStarted || shopOpen || pauseMenuOpen) return;
  if (e.code === settings.binds.reload) startReload();
  if (e.code === 'Digit1') equipSlot('primary');
  if (e.code === 'Digit2') equipSlot('secondary');
  if (e.code === 'Digit3') equipSlot('melee');
  if (e.code === 'Digit4') equipSlot('grenade');
  if (e.code === 'Digit5') equipSlot('smoke');
  if (e.code === 'KeyQ') equipSlot(lastSlot);
  if (e.code === settings.binds.knife) playKnifeFlip();
  if (e.code === settings.binds.shop) toggleBuyMenu();
});
document.addEventListener('wheel', e => {
  if (!gameStarted || shopOpen) return;
  const owned = ['melee'];
  if (inventory.secondary) owned.push('secondary');
  if (inventory.primary) owned.push('primary');
  if (grenadeCount > 0) owned.push('grenade');
  if (smokeCount > 0) owned.push('smoke');
  const idx = owned.indexOf(currentSlot);
  const next = owned[(idx + (e.deltaY > 0 ? 1 : owned.length - 1)) % owned.length];
  equipSlot(next);
});

// ============================================================
// WEAPON / SHOOTING / RELOAD ANIMATION (generic across all weapons)
// ============================================================
const reloadRuntime = { reloading: false, reloadT: 0, duration: 1.5 };
let fireCooldown = 0;
let knifeFlipT = -1;

function currentWeaponDef(){
  if (currentSlot === 'melee') return WEAPONS.knife;
  if (currentSlot === 'grenade') return WEAPONS.grenade;
  if (currentSlot === 'smoke') return WEAPONS.smoke;
  return WEAPONS[inventory[currentSlot]];
}

function playKnifeFlip(){
  if (currentSlot !== 'melee') return;
  knifeFlipT = 0;
}

function startReload(){
  if (currentSlot === 'melee' || currentSlot === 'grenade' || currentSlot === 'smoke' || reloadRuntime.reloading) return;
  const state = ammoState[currentSlot];
  const def = currentWeaponDef();
  if (state.mag === def.mag || state.reserve <= 0) return;
  reloadRuntime.reloading = true;
  reloadRuntime.reloadT = 0;
  reloadRuntime.duration = def.reloadDuration || 1.5;
  if (!audio.playSample('reload', 0.8)) audio.reloadSequence(reloadRuntime.duration, currentSlot === 'primary');
  document.getElementById('reloadLabel').style.opacity = 1;
  setTimeout(() => {
    const need = def.mag - state.mag;
    const take = Math.min(need, state.reserve);
    state.mag += take;
    state.reserve -= take;
    reloadRuntime.reloading = false;
    document.getElementById('reloadLabel').style.opacity = 0;
    updateAmmoHUD();
  }, reloadRuntime.duration * 1000);
}

function updateReloadAnimation(dt){
  const magazine = currentVisual.magazine, chargingHandle = currentVisual.chargingHandle;
  if (!magazine || !chargingHandle) { weaponGroup.rotation.x = 0; return; }
  if (!reloadRuntime.reloading) {
    magazine.position.y = currentVisual.magRestY;
    magazine.visible = true;
    chargingHandle.position.x = currentVisual.chargeRestX;
    return;
  }
  reloadRuntime.reloadT += dt;
  const p = Math.min(1, reloadRuntime.reloadT / reloadRuntime.duration);

  const tilt = Math.sin(p * Math.PI) * 0.45;
  weaponGroup.rotation.x = tilt;
  weaponGroup.position.y = -Math.sin(p * Math.PI) * 0.1;

  const magRestY = currentVisual.magRestY, chargeRestX = currentVisual.chargeRestX;
  if (p < 0.05) {
    magazine.visible = true;
    magazine.position.y = magRestY;
  } else if (p < 0.35) {
    magazine.visible = true;
    const lp = (p - 0.05) / 0.3;
    magazine.position.y = magRestY - lp * 0.35;
  } else if (p < 0.55) {
    magazine.visible = false;
  } else if (p < 0.85) {
    magazine.visible = true;
    const lp = (p - 0.55) / 0.3;
    magazine.position.y = magRestY - 0.35 + lp * 0.35;
  } else {
    magazine.visible = true;
    magazine.position.y = magRestY;
  }

  if (p > 0.85) {
    const lp = (p - 0.85) / 0.15;
    chargingHandle.position.x = chargeRestX - Math.sin(lp * Math.PI) * 0.08;
  } else {
    chargingHandle.position.x = chargeRestX;
  }
}

function updateKnifeFlip(dt){
  if (knifeFlipT < 0 || !currentVisual.knifeParts) return;
  knifeFlipT += dt;
  const dur = 0.6;
  const p = Math.min(1, knifeFlipT / dur);
  currentVisual.group.rotation.z = Math.sin(p * Math.PI * 2) * Math.PI;
  currentVisual.group.position.y = -Math.sin(p * Math.PI) * 0.08;
  if (p >= 1) { knifeFlipT = -1; currentVisual.group.rotation.z = 0; currentVisual.group.position.y = 0; }
}

// quick forward slash/stab swing on attack - separate axes from the flip animation above so the
// two never fight each other if triggered close together
let knifeSwingT = -1;
function playKnifeSwing(){
  knifeSwingT = 0;
}
function updateKnifeSwing(dt){
  if (knifeSwingT < 0 || !currentVisual.knifeParts) return;
  knifeSwingT += dt;
  const dur = 0.22;
  const p = Math.min(1, knifeSwingT / dur);
  const s = Math.sin(p * Math.PI); // 0 -> 1 -> 0
  currentVisual.group.rotation.x = -s * 0.9;
  currentVisual.group.rotation.y = s * 0.5;
  currentVisual.group.position.z = -s * 0.15;
  if (p >= 1) { knifeSwingT = -1; currentVisual.group.rotation.x = 0; currentVisual.group.rotation.y = 0; currentVisual.group.position.z = 0; }
}

const raycaster = new THREE.Raycaster();
const bulletTracers = [];
const particles = []; // {mesh/sprite, vel, life, maxLife, type}

function fireWeapon(){
  if (!player.alive || reloadRuntime.reloading) return;
  const def = currentWeaponDef();
  const weaponId = currentSlot === 'melee' ? 'knife' : currentSlot === 'grenade' ? 'grenade' : currentSlot === 'smoke' ? 'smoke' : inventory[currentSlot];

  if (currentSlot === 'grenade') {
    fireCooldown = def.fireRate;
    throwGrenade('frag', true);
    return;
  }

  if (currentSlot === 'smoke') {
    fireCooldown = def.fireRate;
    throwGrenade('smoke', true);
    return;
  }

  if (currentSlot === 'melee') {
    fireCooldown = def.fireRate;
    playKnifeSwing();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const origin = camera.getWorldPosition(new THREE.Vector3());
    raycaster.set(origin, dir);
    raycaster.far = def.range;
    const enemyHits = raycaster.intersectObjects(enemies.map(e => e.mesh), true);
    let hit = false;
    if (enemyHits.length > 0) {
      let obj = enemyHits[0].object;
      while (obj.parent && !obj.userData.enemyRef) obj = obj.parent;
      const enemy = obj.userData.enemyRef;
      if (enemy) { const killed = damageEnemy(enemy, def.dmg, enemyHits[0].point, { weaponName: def.name, headshot: false }); showHitMarker(false, killed); hit = true; }
    }
    if (!audio.playSample(hit ? 'knifeStab' : 'knifeSlash', 0.85)) audio.mechClick(180, 0.2, 0.05);
    return;
  }

  const state = ammoState[currentSlot];
  if (gameMode !== 'practice') {
    if (state.mag <= 0) {
      if (!reloadRuntime.reloading) { if (state.reserve > 0) startReload(); else audio.emptyClick(); }
      return;
    }
    state.mag--;
  }
  fireCooldown = def.fireRate;
  updateAmmoHUD();
  if (gameMode !== 'practice' && state.mag <= 0 && state.reserve > 0) startReload(); // out of ammo in the mag - reload without waiting for another trigger pull

  const sampledWeapons = { awp: 'awp', ak47: 'ak47', m4a1: 'm4a1', glock: 'glock', deagle: 'deagle', m4a4: 'm4a4', tec9: 'smg', duals: 'smg' };
  if (!sampledWeapons[weaponId] || !audio.playSample(sampledWeapons[weaponId], 0.9)) audio.gunshot(GUNSHOT_PROFILES[weaponId]);
  flashLight.intensity = 5;
  flashSpriteMat.opacity = 1;
  flashSprite.scale.set(0.5 + Math.random() * 0.2, 0.5 + Math.random() * 0.2, 1);
  setTimeout(() => { flashLight.intensity = 0; flashSpriteMat.opacity = 0; }, 45);

  const now = performance.now() / 1000;
  if (now - lastFireTime > 0.3) sprayIndex = 0;
  lastFireTime = now;
  const pattern = SPRAY_PATTERNS[weaponId] || [];
  const sprayStep = pattern[Math.min(sprayIndex, pattern.length - 1)] || { dy: 0.02, dx: 0 };
  sprayIndex++;
  const adsMul = player.ads ? 0.45 : 1;
  recoilKick += sprayStep.dy * adsMul;
  recoilYaw += sprayStep.dx * adsMul;
  shakeIntensity = Math.min(shakeIntensity + (player.ads ? 0.15 : 0.28), 1.2);
  // per-weapon visual kick on the gun model itself - snappy shove back + muzzle-up tilt, both
  // spring back to rest via the existing lerps in updatePlayer (AWP kicks by far the hardest)
  weaponGroup.position.z += def.kickPush ?? 0.06;
  weaponGroup.rotation.x -= def.kickTilt ?? 0.05;

  spawnMuzzleSmoke();
  spawnShellCasing();

  const spread = player.ads ? 0.004 : 0.015;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.normalize();

  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = def.range;

  const enemyHits = raycaster.intersectObjects(enemies.map(e => e.mesh), true);
  const envHits = raycaster.intersectObjects(envMeshes, false);

  let tracerLen = def.range;
  let hitPoint = null;

  function resolveEnemyHit(hit, dmgFalloff){
    const isHeadshot = hit.object.userData.isHead === true;
    const isLimb = hit.object.userData.isLimb === true;
    const dmgMul = (isHeadshot ? 2.5 : (isLimb ? 0.75 : 1)) * dmgFalloff;
    let obj = hit.object;
    while (obj.parent && !obj.userData.enemyRef) obj = obj.parent;
    const enemy = obj.userData.enemyRef;
    if (enemy) {
      const killed = damageEnemy(enemy, def.dmg * dmgMul, hit.point, { weaponName: def.name, headshot: isHeadshot });
      showHitMarker(isHeadshot, killed);
    }
  }

  const envHitIsFirst = envHits.length > 0 && (enemyHits.length === 0 || envHits[0].distance < enemyHits[0].distance);

  if (envHitIsFirst && envHits[0].object.material?.userData?.penetrable) {
    // bullet punches through thin cover (wood crates/doors) and keeps going with reduced damage
    spawnDustPuff(envHits[0].point);
    const behindOrigin = envHits[0].point.clone().addScaledVector(dir, 0.05);
    raycaster.set(behindOrigin, dir);
    raycaster.far = Math.max(0, def.range - envHits[0].distance);
    const behindEnemyHits = raycaster.intersectObjects(enemies.map(e => e.mesh), true);
    const behindEnvHits = raycaster.intersectObjects(envMeshes, false);
    if (behindEnemyHits.length > 0 && (behindEnvHits.length === 0 || behindEnemyHits[0].distance < behindEnvHits[0].distance)) {
      tracerLen = envHits[0].distance + behindEnemyHits[0].distance + 0.05;
      hitPoint = behindEnemyHits[0].point;
      resolveEnemyHit(behindEnemyHits[0], 0.6);
    } else if (behindEnvHits.length > 0) {
      tracerLen = envHits[0].distance + behindEnvHits[0].distance + 0.05;
      hitPoint = behindEnvHits[0].point;
      spawnDustPuff(hitPoint);
    } else {
      tracerLen = def.range;
    }
  } else if (enemyHits.length > 0 && !envHitIsFirst) {
    tracerLen = enemyHits[0].distance;
    hitPoint = enemyHits[0].point;
    resolveEnemyHit(enemyHits[0], 1);
  } else if (envHits.length > 0) {
    tracerLen = envHits[0].distance;
    hitPoint = envHits[0].point;
    spawnDustPuff(hitPoint);
  }

  drawTracer(origin, dir, tracerLen);
}

function drawTracer(origin, dir, length){
  const end = origin.clone().add(dir.clone().multiplyScalar(length));
  const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.75 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  bulletTracers.push({ line, life: 0.05 });
}

// ---------- Particle helpers ----------
const smokeTex = softDiscTexture('rgba(200,200,200,0.9)');
const bloodTex = softDiscTexture('rgba(180,10,10,1)');
const dustTex = softDiscTexture('rgba(190,170,140,0.9)');
const casingGeo = new THREE.BoxGeometry(0.02, 0.05, 0.02);
const casingMat = new THREE.MeshStandardMaterial({ color: 0xcaa544, metalness: 0.8, roughness: 0.3 });

function spawnMuzzleSmoke(){
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.45, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.15, 0.15, 1);
    const worldPos = new THREE.Vector3(); flashSprite.getWorldPosition(worldPos);
    s.position.copy(worldPos);
    scene.add(s);
    particles.push({
      obj: s, type: 'smoke', life: 0.5, maxLife: 0.5,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3)
    });
  }
}

function spawnShellCasing(){
  const mesh = new THREE.Mesh(casingGeo, casingMat);
  const worldPos = new THREE.Vector3(); flashSprite.getWorldPosition(worldPos);
  mesh.position.copy(worldPos);
  const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  scene.add(mesh);
  particles.push({
    obj: mesh, type: 'casing', life: 1.2, maxLife: 1.2,
    vel: rightDir.multiplyScalar(1.5).add(new THREE.Vector3(0, 2.5, 0)),
    angVel: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10)
  });
}

function spawnBlood(point){
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.SpriteMaterial({ map: bloodTex, transparent: true, opacity: 0.9, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.08, 0.08, 1);
    s.position.copy(point);
    scene.add(s);
    particles.push({
      obj: s, type: 'blood', life: 0.6, maxLife: 0.6,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)
    });
  }
}

function spawnDustPuff(point){
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: 0.5, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.2, 0.2, 1);
    s.position.copy(point);
    scene.add(s);
    particles.push({
      obj: s, type: 'dust', life: 0.4, maxLife: 0.4,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8)
    });
  }
}

const explosionTex = softDiscTexture('rgba(255,180,80,1)');
function spawnExplosionFlash(point){
  const mat = new THREE.SpriteMaterial({ map: explosionTex, transparent: true, opacity: 1, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.6, 0.6, 1);
  s.position.copy(point);
  scene.add(s);
  particles.push({ obj: s, type: 'explosion', life: 0.35, maxLife: 0.35, vel: new THREE.Vector3(0, 0.3, 0) });
}

function updateParticles(dt){
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.obj);
      particles.splice(i, 1);
      continue;
    }
    if (p.type === 'casing') {
      p.vel.y -= 9.8 * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.angVel.x * dt;
      p.obj.rotation.y += p.angVel.y * dt;
      const gy = groundHeightAt(p.obj.position.x, p.obj.position.z);
      if (p.obj.position.y <= gy + 0.02) {
        p.obj.position.y = gy + 0.02;
        p.vel.set(0, 0, 0); p.angVel.set(0, 0, 0);
      }
    } else if (p.type === 'explosion') {
      const fade = p.life / p.maxLife;
      const growth = 1 + (1 - fade) * 7;
      p.obj.scale.set(growth, growth, 1);
      p.obj.material.opacity = fade;
    } else {
      p.vel.y -= 1.5 * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      const fade = p.life / p.maxLife;
      p.obj.material.opacity = fade * (p.type === 'blood' ? 0.9 : 0.5);
      const growth = 1 + (1 - fade) * 1.5;
      if (p.obj.scale) p.obj.scale.set(p.obj.scale.x, p.obj.scale.y, 1);
    }
  }
}

// ---------- Grenades (frag + smoke share the same throw/arc physics) ----------
const grenades = []; // { mesh, vel, fuse, type }
const activeSmokes = []; // { pos, radius, life, sprites: [] } - blocks AI line-of-sight and the player's own view

function throwGrenade(type, far = true){
  const count = type === 'smoke' ? smokeCount : grenadeCount;
  if (count <= 0) return;
  if (type === 'smoke') { smokeCount--; updateGrenadeHUD(); }
  else { grenadeCount--; updateGrenadeHUD(); }
  if (!audio.playSample('grenadeThrow', 0.85)) audio.mechClick(420, 0.16, 0.05);

  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  dir.y += 0.18;
  dir.normalize();
  const origin = camera.getWorldPosition(new THREE.Vector3());

  // left click throws far, right click throws short (underhand toss); throwing while airborne
  // adds extra carry on top of whichever button was used
  let speed = far ? 20 : 10;
  if (!player.onGround) speed *= 1.3;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), type === 'smoke' ? smokeGrenadeMat : grenadeMat);
  mesh.position.copy(origin);
  mesh.castShadow = true;
  scene.add(mesh);
  grenades.push({ mesh, vel: dir.multiplyScalar(speed), fuse: 1.6, type });

  // hands go empty until the throw lands - auto-switch back to whatever was equipped before
  equipSlot(lastSlot === 'grenade' || lastSlot === 'smoke' ? 'melee' : lastSlot);
}

function updateGrenades(dt){
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    const nextPos = g.mesh.position.clone().addScaledVector(g.vel, dt);
    const gy = groundHeightAt(nextPos.x, nextPos.z);
    if (nextPos.y <= gy + 0.09) {
      nextPos.y = gy + 0.09;
      g.vel.y *= -0.4; g.vel.x *= 0.7; g.vel.z *= 0.7;
    }
    g.mesh.position.copy(nextPos);
    g.mesh.rotation.x += dt * 6;
    g.mesh.rotation.z += dt * 4;

    if (g.fuse <= 0) {
      if (g.type === 'smoke') deploySmoke(g.mesh.position.clone());
      else explodeGrenade(g.mesh.position.clone());
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

function explodeGrenade(point){
  if (!audio.playSample('explosion', 1)) audio.explosion();
  shakeIntensity = Math.min(shakeIntensity + 1.2, 1.8);

  const light = new THREE.PointLight(0xffaa55, 6, 14);
  light.position.copy(point);
  scene.add(light);
  setTimeout(() => scene.remove(light), 120);

  const def = WEAPONS.grenade;
  enemies.forEach(enemy => {
    if (!enemy.alive) return;
    const d = enemy.mesh.position.distanceTo(point);
    if (d <= def.radius) {
      const falloff = 1 - d / def.radius;
      damageEnemy(enemy, def.dmg * falloff, enemy.mesh.position.clone(), { weaponName: def.name, headshot: false });
    }
  });

  spawnExplosionFlash(point);
  for (let i = 0; i < 10; i++) spawnDustPuff(point);
}

// approximate volumetric smoke with a cluster of soft grey sprites rather than a raymarched shader -
// cheap enough to never touch the framerate, and it still genuinely blocks AI sightlines and the
// player's own screen (see the LOS check in updateEnemies and the #smokeOverlay toggle in animate)
const smokeSpriteTex = softDiscTexture('rgba(200,202,198,0.9)');
function deploySmoke(point){
  if (!audio.playSample('smokeHiss', 0.8)) audio.mechClick(220, 0.2, 0.4);
  const def = WEAPONS.smoke;
  const sprites = [];
  const puffCount = 22;
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeSpriteTex, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const r = Math.random() * def.radius * 0.7;
    const ang = Math.random() * Math.PI * 2;
    const yOff = Math.random() * 3.5;
    s.position.set(point.x + Math.cos(ang) * r, point.y + yOff, point.z + Math.sin(ang) * r);
    s.scale.set(0, 0, 1);
    scene.add(s);
    sprites.push({ sprite: s, targetScale: 3 + Math.random() * 2.5, targetOpacity: 0.75 + Math.random() * 0.15 });
  }
  activeSmokes.push({ pos: point.clone(), radius: def.radius, life: def.duration, maxLife: def.duration, sprites, growT: 0 });
}

function updateSmokes(dt){
  for (let i = activeSmokes.length - 1; i >= 0; i--) {
    const s = activeSmokes[i];
    s.life -= dt;
    s.growT = Math.min(1, s.growT + dt / 1.2);
    const growEase = 1 - Math.pow(1 - s.growT, 2);
    const fade = s.life < 3 ? Math.max(0, s.life / 3) : 1;
    s.sprites.forEach(p => {
      const scale = p.targetScale * growEase;
      p.sprite.scale.set(scale, scale, 1);
      p.sprite.material.opacity = p.targetOpacity * fade;
    });
    if (s.life <= 0) {
      s.sprites.forEach(p => scene.remove(p.sprite));
      activeSmokes.splice(i, 1);
    }
  }
}

function pointInAnySmoke(x, z){
  return activeSmokes.some(s => Math.hypot(x - s.pos.x, z - s.pos.z) <= s.radius);
}

// true if the straight segment between two points passes within `radius` of any active smoke's
// center at some point along it - a 2D closest-point-on-segment test, ignores height (smoke fills
// the segment's ground column, which is close enough for this scale of world)
function segmentCrossesSmoke(ax, az, bx, bz){
  for (const s of activeSmokes) {
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((s.pos.x - ax) * dx + (s.pos.z - az) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t, cz = az + dz * t;
    if (Math.hypot(cx - s.pos.x, cz - s.pos.z) <= s.radius) return true;
  }
  return false;
}

function showHitMarker(isHeadshot, isKill = false){
  if (isHeadshot) audio.headshot(); else audio.hitmarker();
  const el = document.getElementById('hitmarker');
  el.classList.toggle('kill', isKill);
  el.style.opacity = 1;
  el.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${isHeadshot ? 1.7 : 1.3})`;
  el.style.filter = isHeadshot ? 'drop-shadow(0 0 4px #ff0) brightness(1.5)' : 'none';
  setTimeout(() => {
    el.style.opacity = 0;
    el.style.transform = 'translate(-50%,-50%) rotate(45deg) scale(1)';
    el.style.filter = 'none';
  }, isHeadshot ? 180 : 120);
}

// ============================================================
// ENEMIES
// ============================================================
const enemies = [];
let wave = 1;
let kills = 0;
let score = 0;
let localDeaths = 0; // horde/practice - PvP tracks per-player stats in netStats instead

const enemyGunMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#613333'), bumpMap: weaponMetalBump, bumpScale: 0.006, roughnessMap: weaponMetalBump, roughness: 0.5, metalness: 0.6 });
const helmetMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#3a3a30'), bumpMap: weaponMetalBump, bumpScale: 0.006, roughnessMap: weaponMetalBump, roughness: 0.6 });
const goggleMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.2, metalness: 0.4 });
const vestFabricMat = new THREE.MeshStandardMaterial({ map: camoTexture(['#2f3a1e', '#5a6b34', '#1c2412', '#0d0d0d']), roughness: 0.85 });
const pouchMat = new THREE.MeshStandardMaterial({ color: 0x23231c, roughness: 0.9 });

// tactical helmet + goggles - a fixed-offset prop on the character's outer group, the same
// proven pattern the rifle prop below already uses. Bone-attaching this to the skeleton was
// tried first but CesiumMan's joints carry non-uniform scale, which blew the gear up into a
// distorted blob - a fixed offset on the outer (unscaled-by-bones) group avoids that entirely.
// -Z is forward on this group (matches the rifle prop's muzzle direction and the AI's own
// facing convention), so anything that should face front gets a negative Z offset.
function buildHelmetGear(){
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), helmetMat);
  dome.castShadow = true;
  g.add(dome);
  [-1, 1].forEach(side => { // NVG-style side rail nubs
    const nub = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.05), helmetMat);
    nub.position.set(side * 0.145, 0.01, -0.03);
    g.add(nub);
  });
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.03), goggleMat);
  goggles.position.set(0, -0.04, -0.13);
  goggles.castShadow = true;
  g.add(goggles);
  g.position.set(0, soldierHeight * 0.9, 0);
  return g;
}

// plate carrier vest with front pouches - same fixed-offset approach as the helmet above
function buildVestGear(){
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 0.08), vestFabricMat);
  plate.position.set(0, 0, -0.1);
  plate.castShadow = true;
  g.add(plate);
  [-1, 1].forEach(side => {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.06), pouchMat);
    pouch.position.set(side * 0.12, -0.06, -0.135);
    pouch.castShadow = true;
    g.add(pouch);
  });
  g.position.set(0, soldierHeight * 0.62, 0);
  return g;
}

// ---------- Real animated soldier model (glTF, loaded once and cloned per enemy) ----------
// CesiumMan (Khronos glTF-Sample-Assets, CC0) is the only freely-hosted rigged+animated human
// model reachable over the same CDN this project already depends on for three.js itself -
// recolored to a drab uniform tone since it ships in civilian clothing.
const SOLDIER_MODEL_URL = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/CesiumMan/glTF-Binary/CesiumMan.glb';
let soldierTemplate = null;
let soldierClip = null;
let soldierScale = 1;
let soldierHeight = 1.8;
let soldierAssetsReady = false;

function preloadSoldierModel(){
  const loader = new GLTFLoader();
  return loader.loadAsync(SOLDIER_MODEL_URL).then(gltf => {
    const model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.raycast = () => {}; // hit detection uses separate invisible proxies, never the animated mesh itself
        if (o.material) {
          o.material = o.material.clone();
          // CesiumMan is a single mesh with one shared texture for the whole body, face included -
          // a flat color tint here multiplies over the entire texture with no way to spare the
          // face, which is why it came out the same drab olive as the clothes. Leaving the
          // original texture alone keeps a natural skin tone; the helmet/vest gear (see
          // buildHelmetGear/buildVestGear) is what actually reads as "soldier" now anyway.
          o.material.roughness = 0.85;
          o.material.metalness = 0.05;
        }
      }
    });
    model.updateMatrixWorld(true); // bake the source file's corrective root rotation before measuring - otherwise the box reads the wrong axis and the model scales in giant
    const box = new THREE.Box3().setFromObject(model);
    const rawHeight = box.max.y - box.min.y;
    soldierScale = 1.82 / rawHeight; // normalize to the game's ~1.8 unit human height
    soldierHeight = 1.82;
    soldierTemplate = model;
    soldierClip = gltf.animations[0] || null;
    soldierAssetsReady = true;
  }).catch(err => {
    console.warn('No se pudo cargar el modelo de soldado, usando geometría de repuesto:', err);
    soldierAssetsReady = true; // don't block the game forever - fall back to the boxy model below
  });
}
const soldierReadyPromise = preloadSoldierModel();

function makeBoxSoldierFallback(){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xc79a70, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), bodyMat);
  torso.position.y = 1.1; torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), headMat);
  head.position.y = 1.75; head.castShadow = true;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), helmetMat);
  helmet.position.y = 1.78; helmet.castShadow = true;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.3), bodyMat);
  legL.position.set(-0.18, 0.45, 0); legL.castShadow = true;
  const legR = legL.clone(); legR.position.x = 0.18;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.25), bodyMat);
  armL.position.set(-0.5, 1.15, 0); armL.castShadow = true;
  const armR = armL.clone(); armR.position.x = 0.5;
  g.add(torso, head, helmet, legL, legR, armL, armR);
  return g;
}

function makeEnemySoldier(){
  const g = new THREE.Group();

  if (soldierTemplate) {
    const model = cloneSkeleton(soldierTemplate);
    model.scale.setScalar(soldierScale);
    // SkeletonUtils.clone() rebuilds fresh mesh instances, so the raycast override applied to the
    // template's meshes at load time does not carry over - it has to be re-applied on every clone
    model.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
    g.add(model);
    g.add(buildHelmetGear());
    g.add(buildVestGear());
    const mixer = new THREE.AnimationMixer(model);
    let action = null;
    if (soldierClip) {
      action = mixer.clipAction(soldierClip);
      action.play();
    }
    g.userData.mixer = mixer;
    g.userData.action = action;
  } else {
    g.add(makeBoxSoldierFallback());
  }

  // invisible hit-detection proxies - kept independent of the animated mesh so damage never
  // depends on skinned-mesh raycasting (which three.js tests against the bind pose, not the
  // live animated pose, and would make hits feel disconnected from what's on screen)
  const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.4), hitboxMat);
  torso.position.y = soldierHeight * 0.68;
  torso.visible = false;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), hitboxMat);
  head.position.y = soldierHeight * 0.93;
  head.visible = false;
  head.userData.isHead = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, soldierHeight * 0.5, 0.35), hitboxMat);
  legs.position.y = soldierHeight * 0.27;
  legs.visible = false;
  legs.userData.isLimb = true;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, soldierHeight * 0.34, 0.22), hitboxMat);
  armL.position.set(-0.32, soldierHeight * 0.62, 0);
  armL.visible = false;
  armL.userData.isLimb = true;
  const armR = armL.clone();
  armR.position.x = 0.32;
  armR.visible = false;
  armR.userData.isLimb = true;
  g.add(torso, head, legs, armL, armR);
  g.userData.parts = { torso, head, legs, armL, armR };

  // rifle prop at roughly hand height - not bone-attached (the source model has no gun bone),
  // so it stays at a fixed offset rather than swinging with the arm animation
  const gunProp = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), enemyGunMat);
  const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 6), enemyGunMat);
  gunBarrel.rotation.x = Math.PI / 2;
  gunBarrel.position.z = -0.39;
  gunBody.castShadow = gunBarrel.castShadow = true;
  gunProp.add(gunBody, gunBarrel);
  gunProp.position.set(0.34, soldierHeight * 0.6, -0.2);
  gunProp.rotation.y = -0.15;
  g.add(gunProp);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.55); // barrel tip, local to gunProp so it tracks its orientation
  gunProp.add(muzzle);
  g.userData.muzzle = muzzle;

  return g;
}

const BOT_NAMES = ['Tom', 'Mike', 'Matt', 'Jason', 'Jon', 'Chris', 'Steve', 'Alex', 'Dave', 'Nick'];

function spawnEnemy(spawnPos){
  const mesh = makeEnemySoldier();
  let x, z;
  if (spawnPos) {
    x = spawnPos.x; z = spawnPos.z;
  } else {
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 60;
    x = Math.cos(angle) * dist;
    z = Math.sin(angle) * dist;
  }
  mesh.position.set(x, groundHeightAt(x, z), z);
  scene.add(mesh);

  const enemy = {
    mesh, health: 60 + wave * 6, maxHealth: 60 + wave * 6, speed: 2.2 + Math.random() * 0.8,
    state: 'chase', fireCooldown: Math.random() * 2, alive: true, dying: false, deathT: 0,
    name: 'BOT ' + BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    isCarrier: false, targetSite: null
  };
  mesh.traverse(o => { if (o.isMesh) o.userData.enemyRef = enemy; });
  enemies.push(enemy);
  updateEnemyHUD();
  return enemy;
}

// returns true if this hit was the one that killed the enemy (used to color the hitmarker red
// on a kill vs. the default grey for a non-lethal hit). Remote players resolve asynchronously
// over the network, so that path always reports false here.
function damageEnemy(enemy, dmg, point, meta){
  if (!enemy.alive) return false;
  spawnBlood(point);
  if (enemy.isRemote) {
    // don't own their health - tell their real client what happened and let their own broadcast update us.
    // netBroadcast reaches them directly if we're the host, or reaches the host if we're a client, which
    // then relays it onward (see the generic relay in handleNetMessage) - either way it arrives once.
    netBroadcast({ type: 'hit', targetId: enemy.netId, fromId: netMyId, dmg, isHeadshot: !!(meta && meta.headshot) });
    return false;
  }
  enemy.health -= dmg;
  if (enemy.health <= 0) { killEnemy(enemy, meta); return true; }
  return false;
}

function killEnemy(enemy, meta = {}){
  enemy.alive = false;
  enemy.dying = true;
  enemy.deathT = 0;
  // fall roughly backward away from whoever they were facing (the shot's general direction), with some spread
  enemy.fallDir = enemy.mesh.rotation.y + Math.PI + (Math.random() - 0.5) * 1.4;
  kills++; score += 100; money += 150;
  spawnBloodDecal(enemy.mesh.position.x, enemy.mesh.position.z);
  updateEnemyHUD();
  updateMoneyHUD();
  const weaponName = meta.weaponName || 'Unknown';
  showKillFeed(weaponName, !!meta.headshot, enemy.name || 'BOT');
  if (gameMode === 'bomb' && enemy.isCarrier) {
    roundState.carrier = null;
    roundState.plantProgress = 0;
    promoteNewCarrier();
  }
  if (gameMode === 'bomb') checkRoundEndConditions();
}

const bloodDecalTex = bloodSplatterTexture();
const decals = [];
function spawnBloodDecal(x, z){
  const geo = new THREE.PlaneGeometry(1.4 + Math.random(), 1.4 + Math.random());
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: bloodDecalTex, transparent: true, opacity: 0.85, depthWrite: false });
  const decal = new THREE.Mesh(geo, mat);
  decal.rotation.z = Math.random() * Math.PI;
  decal.position.set(x, groundHeightAt(x, z) + 0.025, z);
  scene.add(decal);
  decals.push({ mesh: decal, life: 20 });
}

function updateDecals(dt){
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.life -= dt;
    if (d.life < 3) d.mesh.material.opacity = Math.max(0, d.life / 3) * 0.85;
    if (d.life <= 0) { scene.remove(d.mesh); decals.splice(i, 1); }
  }
}

function updateDyingEnemies(dt){
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (!enemy.dying) continue;
    enemy.deathT += dt;
    const p = Math.min(1, enemy.deathT / 0.7);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out, reads more like a falling weight than a scripted tip
    enemy.mesh.rotation.x = ease * (Math.PI / 2.1) * Math.sin(enemy.fallDir);
    enemy.mesh.rotation.z = ease * (Math.PI / 2.1) * Math.cos(enemy.fallDir);
    const bounce = Math.sin(Math.min(1, p) * Math.PI) * 0.12;
    enemy.mesh.position.y = groundHeightAt(enemy.mesh.position.x, enemy.mesh.position.z) + bounce;
    if (enemy.deathT > 1.6) {
      scene.remove(enemy.mesh);
      enemies.splice(i, 1);
      if (gameMode === 'horde' && enemies.filter(e => e.alive).length === 0 && enemies.length === 0) {
        setTimeout(nextWave, 2000);
      }
      if (enemy.isStatic) setTimeout(() => spawnPracticeTarget(enemy.spawnPos), 2500);
    }
  }
}

// ============================================================
// ROUND / BOMB MODE (defend as CT: eliminate the carrier before they plant, or defuse in time)
// ============================================================
function startMatch(){
  roundState.roundNum = 1;
  roundState.ctWins = 0;
  roundState.tWins = 0;
  startRound();
}

function startRound(){
  wave = roundState.roundNum;
  kills = 0;
  enemies.forEach(e => scene.remove(e.mesh));
  enemies.length = 0;
  clearBomb();
  roundState.phase = 'buy';
  roundState.phaseT = 0;
  roundState.carrier = null;
  roundState.plantProgress = 0;

  player.alive = true;
  player.health = player.maxHealth;
  player.ads = false;
  player.scopeLevel = 0;
  updateHealthHUD();
  const ct = currentMapMeta.ctSpawn;
  player.pos.copy(ct);
  player.pos.y = groundHeightAt(ct.x, ct.z) + player.height;
  player.velY = 0;
  camera.position.copy(player.pos);

  document.getElementById('roundNum').textContent = roundState.roundNum;
  document.getElementById('tWins').textContent = roundState.tWins;
  document.getElementById('ctWins').textContent = roundState.ctWins;
  document.getElementById('bombStatusLabel').textContent = '';
  showWaveBanner(`ROUND ${roundState.roundNum}`);
}

function spawnRoundEnemies(){
  const meta = currentMapMeta;
  const count = 3 + Math.min(4, Math.floor(roundState.roundNum / 2));
  const tSpawn = meta.tSpawn;
  for (let i = 0; i < count; i++) {
    const offset = new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
    spawnEnemy(tSpawn.clone().add(offset));
  }
  const carrier = enemies[Math.floor(Math.random() * enemies.length)];
  carrier.isCarrier = true;
  carrier.targetSite = meta.sites[Math.floor(Math.random() * meta.sites.length)];
  roundState.carrier = carrier;
  updateEnemyHUD();
}

function promoteNewCarrier(){
  const alive = enemies.filter(e => e.alive && !e.dying);
  if (alive.length === 0) return;
  const next = alive[Math.floor(Math.random() * alive.length)];
  next.isCarrier = true;
  next.targetSite = currentMapMeta.sites[Math.floor(Math.random() * currentMapMeta.sites.length)];
  roundState.carrier = next;
}

function updateCarrierEnemy(enemy, dt){
  const ePos = enemy.mesh.position;
  const site = enemy.targetSite;
  const toSite = new THREE.Vector3().subVectors(site.pos, ePos);
  toSite.y = 0;
  const dist = toSite.length();
  const mixer = enemy.mesh.userData.mixer;
  if (dist > site.radius * 0.5) {
    toSite.normalize();
    enemy.mesh.rotation.y = Math.atan2(toSite.x, toSite.z);
    ePos.x += toSite.x * enemy.speed * dt;
    ePos.z += toSite.z * enemy.speed * dt;
    ePos.y = groundHeightAt(ePos.x, ePos.z);
    if (mixer) { const action = enemy.mesh.userData.action; if (action) action.timeScale = enemy.speed / 2.2; mixer.update(dt); }
    roundState.plantProgress = 0;
  } else {
    if (mixer) mixer.update(dt * 0.1); // mostly still while planting, a little idle motion
    roundState.plantProgress += dt;
    if (roundState.plantProgress >= roundState.plantDuration) {
      plantBomb(enemy, site);
    }
  }
}

function plantBomb(enemy, site){
  audio.mechClick(300, 0.3, 0.12);
  const geo = new THREE.BoxGeometry(0.3, 0.15, 0.22);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.6, metalness: 0.2, emissive: 0xff0000, emissiveIntensity: 0.3 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(site.pos);
  mesh.position.y = groundHeightAt(site.pos.x, site.pos.z) + 0.1;
  scene.add(mesh);
  const light = new THREE.PointLight(0xff2222, 1.5, 6);
  light.position.copy(mesh.position);
  scene.add(light);

  roundState.bomb = { pos: mesh.position.clone(), mesh, light, fuse: roundState.fuseDuration, defuseT: 0, defusing: false, site };
  roundState.phase = 'planted';
  document.getElementById('bombStatusLabel').textContent = `BOMB PLANTED AT ${site.id}`;
  showKillFeed('C4', false, `planted at ${site.id}`);
  enemy.isCarrier = false;
  roundState.carrier = null;
}

function clearBomb(){
  if (roundState.bomb) {
    scene.remove(roundState.bomb.mesh);
    scene.remove(roundState.bomb.light);
    roundState.bomb = null;
  }
  document.getElementById('defuseBar').style.display = 'none';
}

function checkRoundEndConditions(){
  if (roundState.phase === 'ended') return;
  if (roundState.phase === 'live') {
    const tAlive = enemies.some(e => e.alive);
    if (!tAlive) { endRound('ct', 'Terroristas eliminados'); return; }
  }
}

function updateRound(dt){
  if (!player.alive && roundState.phase !== 'ended') {
    endRound('t', 'Has caído');
    return;
  }
  if (roundState.phase === 'buy') {
    roundState.phaseT += dt;
    const remaining = Math.max(0, roundState.buyDuration - roundState.phaseT);
    document.getElementById('roundPhaseLabel').textContent = 'BUY';
    document.getElementById('roundTimer').textContent = formatRoundTime(remaining);
    if (roundState.phaseT >= roundState.buyDuration) {
      roundState.phase = 'live';
      roundState.phaseT = 0;
      spawnRoundEnemies();
    }
  } else if (roundState.phase === 'live') {
    roundState.phaseT += dt;
    const remaining = Math.max(0, roundState.roundDuration - roundState.phaseT);
    document.getElementById('roundPhaseLabel').textContent = 'ROUND';
    document.getElementById('roundTimer').textContent = formatRoundTime(remaining);
    if (roundState.carrier) updateCarrierEnemy(roundState.carrier, dt);
    if (roundState.phaseT >= roundState.roundDuration) {
      endRound('ct', 'Time expired');
      return;
    }
  } else if (roundState.phase === 'planted') {
    const bomb = roundState.bomb;
    bomb.fuse -= dt;
    bomb.light.intensity = 1 + Math.sin(performance.now() * 0.02) * 0.8;
    document.getElementById('roundPhaseLabel').textContent = 'BOMBA';
    document.getElementById('roundTimer').textContent = formatRoundTime(bomb.fuse);

    const distToBomb = player.pos.distanceTo(bomb.pos);
    const defusing = keys['KeyE'] && distToBomb < 2.2;
    document.getElementById('defuseBar').style.display = defusing || bomb.defusing ? 'block' : 'none';
    if (defusing) {
      bomb.defusing = true;
      bomb.defuseT += dt;
      document.getElementById('defuseFill').style.width = Math.min(100, (bomb.defuseT / roundState.defuseDuration) * 100) + '%';
      if (bomb.defuseT >= roundState.defuseDuration) {
        endRound('ct', 'Bomb defused');
        return;
      }
    } else {
      bomb.defusing = false;
      bomb.defuseT = Math.max(0, bomb.defuseT - dt * 1.5);
    }

    if (bomb.fuse <= 0) {
      explodeGrenade(bomb.pos.clone()); // reuse the frag explosion FX/damage for the bomb blast
      endRound('t', 'The bomb exploded');
      return;
    }
  }
}

function formatRoundTime(t){
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function endRound(winner, reason){
  roundState.phase = 'ended';
  clearBomb();
  if (winner === 'ct') { roundState.ctWins++; money += 3250; }
  else { roundState.tWins++; money += 1400; }
  updateMoneyHUD();
  document.getElementById('tWins').textContent = roundState.tWins;
  document.getElementById('ctWins').textContent = roundState.ctWins;
  showWaveBanner(`${winner === 'ct' ? 'ROUND WON' : 'ROUND LOST'} — ${reason}`);

  if (roundState.ctWins >= roundState.roundsToWin || roundState.tWins >= roundState.roundsToWin) {
    setTimeout(() => {
      document.getElementById('waveBanner').textContent = winner === 'ct' && roundState.ctWins >= roundState.roundsToWin
        ? 'VICTORY - CT WINS THE MATCH' : 'DEFEAT - T WINS THE MATCH';
      document.getElementById('waveBanner').style.opacity = 1;
    }, 2200);
    return;
  }
  setTimeout(() => {
    roundState.roundNum++;
    startRound();
  }, 3000);
}

// ============================================================
// MULTIPLAYER (WebRTC via PeerJS) + PVP ARENA ROUNDS
// Distributed-authority model: each peer runs the exact same single-player simulation for its own
// player (unchanged), and just broadcasts its resulting position/health/weapon to the others over
// the data channel. Nobody else's client can silently drop damage without also freezing their own
// avatar for everyone else, which is a fine trust model for a "play with a friend" feature - it is
// not hardened against a deliberately modified client. Host relays every message so clients only
// ever need one connection (to the host), even in 2v2 with four peers.
// ============================================================
let netRole = null; // null | 'host' | 'client'
let netPeer = null;
let netHostConn = null; // client's connection to the host
let netClientConns = {}; // host: peerId -> DataConnection
let netMyId = null;
let netTeamSize = 1;
let localPlayerName = 'Player';
let netRoster = []; // [{id, team, isBot, name}] - authoritative on host, mirrored on clients
const PVP_WEAPON_ROTATION = ['glock', 'deagle', 'tec9', 'duals', 'ak47', 'm4a4', 'm4a1', 'awp', 'knife'];

function netSend(conn, msg){
  if (conn && conn.open) conn.send(msg);
}
function netBroadcast(msg, exceptId){
  if (netRole === 'host') {
    Object.entries(netClientConns).forEach(([id, conn]) => { if (id !== exceptId) netSend(conn, msg); });
  } else if (netHostConn) {
    netSend(netHostConn, msg);
  }
}
function netRelayFromHost(msg, fromId){
  // host re-sends a message it received from one client to every other client (star topology)
  Object.entries(netClientConns).forEach(([id, conn]) => { if (id !== fromId) netSend(conn, msg); });
}

function generateRoomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// PeerJS defaults to Google's public STUN servers only, with no TURN relay - that's enough for
// two peers on the same machine/LAN, but two real friends on separate home networks routinely sit
// behind NATs that STUN alone can't punch through, so the connection just silently never
// completes on either side ("host" and "join" both look broken - this is why a TURN relay is
// required, not optional). Fetched fresh from elixir-webrtc's free, no-signup TURN credential
// endpoint (valid for ~28 minutes, plenty for setting up one match) rather than hardcoded, since
// a previous attempt using Open Relay Project's commonly-cited "static" demo credentials turned
// out to be stale - they now require a signup + API key, so those credentials silently did nothing.
let iceConfigPromise = null;
function getIceConfig(){
  if (!iceConfigPromise) {
    iceConfigPromise = fetch('https://turn.elixir-webrtc.org/?service=turn&username=lastround', { method: 'POST' })
      .then(res => res.json())
      .then(data => ({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: data.uris, username: data.username, credential: data.password }
        ]
      }))
      .catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })); // TURN fetch itself failed - fall back to STUN-only rather than block hosting/joining entirely
  }
  return iceConfigPromise;
}

async function hostRoom(teamSize){
  netTeamSize = teamSize;
  netRole = 'host';
  const config = await getIceConfig();
  netPeer = new Peer('lr-' + generateRoomCode(), { config });
  netPeer.on('open', id => {
    netMyId = id;
    const shortCode = id.replace('lr-', '');
    netRoster = [{ id, team: 'A', isBot: false, name: localPlayerName }];
    document.getElementById('pvpStatus').textContent = `Room code: ${shortCode} — waiting for players...`;
    updateScoreboardNames();
    updateStartButtonState();
  });
  netPeer.on('connection', conn => {
    netClientConns[conn.peer] = conn;
    conn.on('data', data => handleNetMessage(data, conn.peer));
    conn.on('close', () => { delete netClientConns[conn.peer]; netRoster = netRoster.filter(p => p.id !== conn.peer); broadcastRoster(); });
    conn.on('error', err => { document.getElementById('pvpStatus').textContent = 'A player failed to connect: ' + err.type; });
    conn.on('open', () => {
      const team = netRoster.filter(p => p.team === 'A').length <= netRoster.filter(p => p.team === 'B').length ? 'A' : 'B';
      netRoster.push({ id: conn.peer, team, isBot: false, name: 'Player' });
      document.getElementById('pvpStatus').textContent = `${netRoster.length} player(s) connected`;
      broadcastRoster();
      if (roundState.phase === 'warmup' && !warmupDroppedToShort && netRoster.filter(p => !p.isBot).length >= 2) {
        warmupDroppedToShort = true;
        warmupTimer = Math.min(warmupTimer, WARMUP_SHORT);
        broadcastWarmup();
      }
    });
  });
  netPeer.on('error', err => { document.getElementById('pvpStatus').textContent = 'Network error: ' + err.type; });
}

async function joinRoom(code){
  netRole = 'client';
  const config = await getIceConfig();
  netPeer = new Peer(undefined, { config });
  netPeer.on('open', id => {
    netMyId = id;
    document.getElementById('pvpStatus').textContent = 'Connecting...';
    netHostConn = netPeer.connect('lr-' + code.trim().toUpperCase());
    // the room existing (peer-unavailable would have fired already by now) doesn't mean the
    // actual WebRTC connection will succeed - two peers behind strict NATs can still fail to
    // negotiate even with a TURN relay configured, and PeerJS doesn't always surface that as an
    // error, it can just hang forever. This timeout is what turns that silent hang into a message.
    let settled = false;
    const connectTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      document.getElementById('pvpStatus').textContent = "Couldn't connect to that player (network/firewall issue) - ask them to try hosting again, or try a different network.";
      netHostConn.close();
    }, 15000);
    netHostConn.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      document.getElementById('pvpStatus').textContent = 'Connected - waiting for the host to start...';
      netSend(netHostConn, { type: 'name', name: localPlayerName });
      updateStartButtonState();
    });
    netHostConn.on('data', data => handleNetMessage(data, 'host'));
    netHostConn.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      document.getElementById('pvpStatus').textContent = 'Connection lost.';
    });
    netHostConn.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      document.getElementById('pvpStatus').textContent = 'Connection error: ' + err.type;
    });
  });
  netPeer.on('error', err => {
    document.getElementById('pvpStatus').textContent = err.type === 'peer-unavailable'
      ? 'Room not found - check the code and try again.'
      : 'Network error: ' + err.type;
  });
}

function broadcastRoster(){
  netBroadcast({ type: 'roster', roster: netRoster, teamSize: netTeamSize });
  updateScoreboardNames();
}

// per-player kill/assist/death counts for the TAB scoreboard - PvP only, kept in sync across
// peers by applying every 'kill' message locally in addition to broadcasting it (broadcasting
// never loops a message back to its own sender, same as the roster/warmup broadcasts above)
let netStats = {};
function ensureStats(id){
  if (!netStats[id]) netStats[id] = { kills: 0, assists: 0, deaths: 0 };
  return netStats[id];
}
function applyKillMessage(msg){
  ensureStats(msg.victimId).deaths++;
  if (msg.killerId) ensureStats(msg.killerId).kills++;
  (msg.assistIds || []).forEach(id => ensureStats(id).assists++);
}

function updateScoreboardNames(){
  if (gameMode !== 'pvp') return;
  const teamA = netRoster.filter(p => p.team === 'A').map(p => p.name);
  const teamB = netRoster.filter(p => p.team === 'B').map(p => p.name);
  document.getElementById('sbNameA').textContent = teamA.length ? teamA.join(' & ').toUpperCase() : 'TEAM A';
  document.getElementById('sbNameB').textContent = teamB.length ? teamB.join(' & ').toUpperCase() : 'TEAM B';
}

function handleNetMessage(msg, fromId){
  if (netRole === 'host' && msg.type !== 'roster') netRelayFromHost(msg, fromId);
  switch (msg.type) {
    case 'roster':
      netRoster = msg.roster; netTeamSize = msg.teamSize;
      updateScoreboardNames();
      break;
    case 'name':
      if (netRole === 'host') {
        const entry = netRoster.find(p => p.id === fromId);
        if (entry) { entry.name = msg.name || entry.name; broadcastRoster(); }
      }
      break;
    case 'warmup':
      applyWarmup(msg.timer);
      break;
    case 'roundStart':
      applyPvpRoundStart(msg.roundNum, msg.weapon, msg.scoreA, msg.scoreB);
      break;
    case 'roundEnd':
      applyPvpRoundEnd(msg.winnerTeam, msg.reason, msg.scoreA, msg.scoreB);
      break;
    case 'state':
      applyRemoteState(msg);
      break;
    case 'hit':
      if (msg.targetId === netMyId) damagePlayer(msg.dmg, msg.fromId);
      break;
    case 'kill':
      applyKillMessage(msg);
      break;
  }
}

let netStateTimer = 0;
function updateNetworking(dt){
  netStateTimer -= dt;
  if (netStateTimer > 0) return;
  netStateTimer = 0.05; // ~20Hz state broadcast
  const msg = {
    type: 'state', id: netMyId,
    pos: [player.pos.x, player.pos.y, player.pos.z],
    yaw: player.yaw, pitch: player.pitch,
    health: player.health, alive: player.alive,
    weaponId: currentSlot === 'melee' ? 'knife' : (inventory[currentSlot] || 'knife')
  };
  if (netRole === 'host') netBroadcast(msg);
  else if (netHostConn) netSend(netHostConn, msg);
}

function myTeam(){
  const me = netRoster.find(p => p.id === netMyId);
  return me ? me.team : 'A';
}

function getOrCreateRemoteAvatar(id, team){
  let avatar = enemies.find(e => e.isRemote && e.netId === id);
  if (avatar) return avatar;
  const mesh = makeEnemySoldier();
  mesh.position.set(0, 0, 0);
  scene.add(mesh);
  const rosterEntry = netRoster.find(p => p.id === id);
  avatar = {
    mesh, health: 100, maxHealth: 100, speed: 0, fireCooldown: 0, alive: true, dying: false, deathT: 0,
    name: (rosterEntry && rosterEntry.name) || 'Player', isRemote: true, netId: id, team,
    targetPos: new THREE.Vector3(), targetYaw: 0, interpStarted: false
  };
  mesh.traverse(o => { if (o.isMesh) o.userData.enemyRef = avatar; });
  enemies.push(avatar);
  return avatar;
}

function applyRemoteState(msg){
  if (msg.id === netMyId) return;
  const rosterEntry = netRoster.find(p => p.id === msg.id);
  const team = rosterEntry ? rosterEntry.team : 'B';
  const avatar = getOrCreateRemoteAvatar(msg.id, team);
  if (rosterEntry) avatar.name = rosterEntry.name;
  // position/rotation snapshots only arrive ~20 times/sec over the network - snapping straight to
  // each one made remote players look jerky/stepped between updates. updateEnemies() now smoothly
  // interpolates the mesh toward this target every render frame instead of jumping to it directly.
  avatar.targetPos.set(msg.pos[0], msg.pos[1] - player.height, msg.pos[2]);
  avatar.targetYaw = msg.yaw;
  if (!avatar.interpStarted) { avatar.mesh.position.copy(avatar.targetPos); avatar.mesh.rotation.y = avatar.targetYaw; avatar.interpStarted = true; }
  avatar.health = msg.health;
  avatar.alive = msg.alive;
  if (!msg.alive && !avatar.dying) {
    avatar.dying = true; avatar.deathT = 0; avatar.fallDir = msg.yaw;
    // a remote player's death is only ever known through this position/health sync - without this,
    // the shooter never gets any confirmation a kill happened (no killfeed, no feedback at all),
    // which combined with the fast warmup respawn makes it look like they never die
    const weaponName = (WEAPONS[msg.weaponId] && WEAPONS[msg.weaponId].name) || 'Unknown';
    showKillFeed(weaponName, false, avatar.name || 'Player');
  }
}

const WARMUP_FULL = 300; // 5 minutes while waiting for an opponent
const WARMUP_SHORT = 60; // dropped to 1 minute once a second real player has joined
let warmupTimer = WARMUP_FULL;
let warmupDroppedToShort = false;
let warmupBroadcastT = 0;

function startPvpMatch(){
  roundState.roundNum = 1;
  roundState.ctWins = 0; // team A score
  roundState.tWins = 0;  // team B score
  netStats = {};
  recentAttackers = [];
  warmupSpawnPlaced = false; // buildMap() always drops everyone at the map's generic (team A) spawn point - this needs correcting to the player's real team as soon as it's known, or a joining team B player stays stuck on team A's side for the whole warmup
  if (netRole === 'host') startWarmup();
}

function startWarmup(){
  roundState.phase = 'warmup';
  warmupTimer = WARMUP_FULL;
  warmupDroppedToShort = false;
  broadcastWarmup();
}

function broadcastWarmup(){
  netBroadcast({ type: 'warmup', timer: warmupTimer });
  applyWarmup(warmupTimer);
}

let warmupSpawnPlaced = false;
function applyWarmup(timer){
  roundState.phase = 'warmup';
  document.getElementById('roundPhaseLabel').textContent = 'WARMUP';
  document.getElementById('roundTimer').textContent = formatRoundTime(timer);
  document.getElementById('centerMessage').textContent = 'Waiting for opponent(s)...';
  money = 9999999; // unlimited during warmup - the shop doesn't matter here, only practicing
  updateMoneyHUD();
  // move the player onto their actual team's side as soon as it's known - once, not every tick
  // (this fires roughly once a second), otherwise it would keep yanking the player back to
  // spawn while they're walking around during warmup
  if (!warmupSpawnPlaced && currentMapMeta) {
    warmupSpawnPlaced = true;
    const team = myTeam();
    const spawnPos = getTeamSpawnPos(currentMapMeta, team);
    player.pos.copy(spawnPos);
    player.pos.y = groundHeightAt(spawnPos.x, spawnPos.z) + player.height;
    player.velY = 0;
    player.yaw = getSpawnYaw(team);
    player.pitch = 0;
    camera.position.copy(player.pos);
  }
}

function updateWarmup(dt){
  if (netRole !== 'host') return;
  warmupTimer -= dt;
  warmupBroadcastT -= dt;
  if (warmupBroadcastT <= 0) { warmupBroadcastT = 1; broadcastWarmup(); }
  else applyWarmup(warmupTimer); // local display still ticks smoothly between broadcasts
  if (warmupTimer <= 0) startPvpRoundAsHost();
}

// bots only ever exist on the host (the only peer that simulates them) - they fill whichever team
// is short of real players in 2v2. Known simplification: their combat AI still targets the host's
// own local player specifically (the same targeting the single-player horde mode always used),
// rather than picking whichever opposing player is actually nearest.
function ensureBotFill(){
  if (netTeamSize !== 2) return;
  const teamACount = netRoster.filter(p => p.team === 'A').length;
  const teamBCount = netRoster.filter(p => p.team === 'B').length;
  const haveA = enemies.filter(e => e.isBot && e.team === 'A').length;
  const haveB = enemies.filter(e => e.isBot && e.team === 'B').length;
  const meta = currentMapMeta;
  for (let i = haveA; i < Math.max(0, 2 - teamACount); i++) {
    const bot = spawnEnemy(meta.tSpawn.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4)));
    bot.isBot = true; bot.team = 'A';
  }
  for (let i = haveB; i < Math.max(0, 2 - teamBCount); i++) {
    const bot = spawnEnemy(meta.ctSpawn.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4)));
    bot.isBot = true; bot.team = 'B';
  }
}

function startPvpRoundAsHost(){
  ensureBotFill();
  const weapon = PVP_WEAPON_ROTATION[(roundState.roundNum - 1) % PVP_WEAPON_ROTATION.length];
  const msg = { type: 'roundStart', roundNum: roundState.roundNum, weapon, scoreA: roundState.ctWins, scoreB: roundState.tWins };
  applyPvpRoundStart(msg.roundNum, msg.weapon, msg.scoreA, msg.scoreB);
  netBroadcast(msg);
}

function applyPvpRoundStart(roundNum, weaponId, scoreA, scoreB){
  roundState.roundNum = roundNum;
  roundState.ctWins = scoreA;
  roundState.tWins = scoreB;
  roundState.phase = 'live';
  roundState.phaseT = 0;
  roundState.forcedWeapon = weaponId;
  document.getElementById('centerMessage').textContent = '';
  if (shopOpen) { shopOpen = false; document.getElementById('buyMenu').style.display = 'none'; renderer.domElement.requestPointerLock(); }

  enemies.filter(e => e.isRemote).forEach(e => { scene.remove(e.mesh); });
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].isRemote) enemies.splice(i, 1);

  const bmeta = currentMapMeta;
  enemies.filter(e => e.isBot).forEach(bot => {
    bot.alive = true; bot.dying = false; bot.deathT = 0;
    bot.health = bot.maxHealth;
    const spawnPos = getTeamSpawnPos(bmeta, bot.team);
    bot.mesh.position.set(spawnPos.x, groundHeightAt(spawnPos.x, spawnPos.z), spawnPos.z);
    bot.mesh.visible = true;
  });

  player.alive = true;
  player.health = player.maxHealth;
  player.ads = false;
  player.scopeLevel = 0;
  const meta = currentMapMeta;
  const team = myTeam();
  const spawnPos = getTeamSpawnPos(meta, team);
  player.pos.copy(spawnPos);
  player.pos.y = groundHeightAt(spawnPos.x, spawnPos.z) + player.height;
  player.velY = 0;
  player.yaw = getSpawnYaw(team);
  player.pitch = 0;
  camera.position.copy(player.pos);
  updateHealthHUD();

  if (weaponId === 'knife') {
    equipSlot('melee');
  } else {
    const def = WEAPONS[weaponId];
    inventory[def.slot] = weaponId;
    ammoState[def.slot] = { mag: def.mag, reserve: def.reserve };
    equipSlot(def.slot);
  }
  updateAmmoHUD();

  document.getElementById('roundNum').textContent = roundNum;
  document.getElementById('tWins').textContent = scoreA;
  document.getElementById('ctWins').textContent = scoreB;
  document.getElementById('bombStatusLabel').textContent = `WEAPON: ${(WEAPONS[weaponId] || WEAPONS.knife).name.toUpperCase()}`;
  showWaveBanner(`ROUND ${roundNum} — ${(WEAPONS[weaponId] || WEAPONS.knife).name.toUpperCase()}`);
}

function checkPvpRoundEnd(){
  if (netRole !== 'host' || roundState.phase !== 'live') return;
  const teamAAlive = (myTeam() === 'A' && player.alive)
    || netRoster.some(p => p.team === 'A' && p.id !== netMyId && isNetPlayerAlive(p.id))
    || enemies.some(e => e.isBot && e.team === 'A' && e.alive);
  const teamBAlive = (myTeam() === 'B' && player.alive)
    || netRoster.some(p => p.team === 'B' && p.id !== netMyId && isNetPlayerAlive(p.id))
    || enemies.some(e => e.isBot && e.team === 'B' && e.alive);
  if (!teamAAlive || !teamBAlive) {
    const winner = teamAAlive ? 'A' : 'B';
    endPvpRoundAsHost(winner, 'Team eliminated');
  }
}
function isNetPlayerAlive(id){
  const avatar = enemies.find(e => e.isRemote && e.netId === id);
  return avatar ? avatar.alive : true;
}

function endPvpRoundAsHost(winnerTeam, reason){
  if (winnerTeam === 'A') roundState.ctWins++; else roundState.tWins++;
  const msg = { type: 'roundEnd', winnerTeam, reason, scoreA: roundState.ctWins, scoreB: roundState.tWins };
  applyPvpRoundEnd(winnerTeam, reason, roundState.ctWins, roundState.tWins);
  netBroadcast(msg);
}

function applyPvpRoundEnd(winnerTeam, reason, scoreA, scoreB){
  roundState.phase = 'ended';
  roundState.ctWins = scoreA; roundState.tWins = scoreB;
  document.getElementById('tWins').textContent = scoreA;
  document.getElementById('ctWins').textContent = scoreB;
  const youWon = winnerTeam === myTeam();
  showWaveBanner(`${youWon ? 'ROUND WON' : 'ROUND LOST'} — ${reason}`);
  if (scoreA >= roundState.roundsToWin || scoreB >= roundState.roundsToWin) {
    setTimeout(() => {
      const el = document.getElementById('waveBanner');
      el.textContent = (winnerTeam === myTeam()) ? 'VICTORY' : 'DEFEAT';
      el.style.opacity = 1;
    }, 2200);
    return;
  }
  if (netRole === 'host') {
    setTimeout(() => { roundState.roundNum++; startPvpRoundAsHost(); }, 3000);
  }
}

const PVP_ROUND_DURATION = 90; // 1:30 max per round

function countAliveOnTeam(team){
  let count = 0;
  if (myTeam() === team && player.alive) count++;
  netRoster.forEach(p => { if (p.team === team && p.id !== netMyId && isNetPlayerAlive(p.id)) count++; });
  enemies.forEach(e => { if (e.isBot && e.team === team && e.alive) count++; });
  return count;
}

function updatePvpRound(dt){
  updateNetworking(dt);
  if (roundState.phase === 'warmup') {
    updateWarmup(dt);
  } else if (roundState.phase === 'live') {
    roundState.phaseT += dt;
    const remaining = Math.max(0, PVP_ROUND_DURATION - roundState.phaseT);
    document.getElementById('roundPhaseLabel').textContent = 'ROUND';
    document.getElementById('roundTimer').textContent = formatRoundTime(remaining);
    checkPvpRoundEnd();
    if (netRole === 'host' && roundState.phase === 'live' && roundState.phaseT >= PVP_ROUND_DURATION) {
      const aliveA = countAliveOnTeam('A'), aliveB = countAliveOnTeam('B');
      endPvpRoundAsHost(aliveA >= aliveB ? 'A' : 'B', 'Time expired');
    }
  }
}

function nextWave(){
  wave++;
  const count = 3 + wave * 2;
  for (let i = 0; i < count; i++) spawnEnemy();
  money += 500;
  updateMoneyHUD();
  showWaveBanner();
  updateEnemyHUD();
}

// ---------- Enemy AI ----------
function updateEnemies(dt){
  const playerPos = camera.getWorldPosition(new THREE.Vector3());
  enemies.forEach(enemy => {
    if (!enemy.alive || enemy.dying) return;
    if (enemy.isRemote) {
      // smoothly close the gap to the latest network snapshot instead of snapping straight to it -
      // snapshots only arrive ~20 times/sec, so without this the avatar visibly teleports each time
      const smoothing = 1 - Math.pow(0.0001, dt);
      enemy.mesh.position.lerp(enemy.targetPos, smoothing);
      let yawDiff = enemy.targetYaw - enemy.mesh.rotation.y;
      yawDiff = ((yawDiff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; // shortest path, avoids a spin on wraparound
      enemy.mesh.rotation.y += yawDiff * smoothing;
    }
    // walk-cycle animation is tied to actually moving through space - static practice-mode
    // targets never move, so they're frozen once on a natural mid-stride pose (seeded when they
    // spawn, see spawnPracticeTarget) rather than either the raw T-pose bind pose or endlessly
    // "walking" in place while standing still, which looks just as wrong. Remote players have no
    // local "speed" value (they're driven entirely by position snapshots from the network), so
    // their animation speed is estimated from how far they actually moved since the last frame.
    if (!enemy.isStatic) {
      const mixer = enemy.mesh.userData.mixer;
      if (mixer) {
        const action = enemy.mesh.userData.action;
        if (action) {
          let animSpeed = enemy.speed;
          if (enemy.isRemote) {
            const ePos = enemy.mesh.position;
            const last = enemy._lastAnimPos || ePos.clone();
            animSpeed = dt > 0 ? last.distanceTo(ePos) / dt : 0;
            enemy._lastAnimPos = ePos.clone();
          }
          action.timeScale = Math.min(2, animSpeed / 2.2);
        }
        mixer.update(dt);
      }
    }
    if (enemy.isRemote) return; // driven entirely by network state in applyRemoteState, not local AI
    if (enemy.isStatic) return; // practice-mode target dummy - doesn't move, aim, or shoot back
    if (gameMode === 'bomb' && enemy.isCarrier && roundState.phase === 'live') return; // handled by updateCarrierEnemy instead
    const ePos = enemy.mesh.position;
    const toPlayer = new THREE.Vector3().subVectors(playerPos, ePos);
    const dist = toPlayer.length();
    toPlayer.y = 0;
    toPlayer.normalize();

    const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
    enemy.mesh.rotation.y = targetAngle;

    if (dist > 12) {
      ePos.x += toPlayer.x * enemy.speed * dt;
      ePos.z += toPlayer.z * enemy.speed * dt;
      ePos.y = groundHeightAt(ePos.x, ePos.z);
    } else {
      const strafe = Math.sin(performance.now() * 0.001 + ePos.x) * enemy.speed * 0.4 * dt;
      ePos.x += toPlayer.z * strafe;
      ePos.z -= toPlayer.x * strafe;
      ePos.y = groundHeightAt(ePos.x, ePos.z);

      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown <= 0 && dist < 45) {
        const eyeOrigin = ePos.clone().add(new THREE.Vector3(0, soldierHeight * 0.85, 0));
        const toP = new THREE.Vector3().subVectors(playerPos, eyeOrigin);
        const losDist = toP.length();
        toP.normalize();
        raycaster.set(eyeOrigin, toP);
        raycaster.far = Math.max(0.1, losDist - 0.3);
        const blocked = raycaster.intersectObjects(envMeshes, false).length > 0 ||
          segmentCrossesSmoke(eyeOrigin.x, eyeOrigin.z, playerPos.x, playerPos.z);
        if (blocked) {
          enemy.fireCooldown = 0.25; // wall in the way - re-check soon instead of waiting out the full cooldown
        } else {
          enemy.fireCooldown = 1.1 + Math.random() * 0.8;
          enemyShoot(enemy, playerPos);
        }
      }
    }
  });
}

function enemyShoot(enemy, playerPos){
  const muzzle = enemy.mesh.userData.muzzle;
  const origin = muzzle ? muzzle.getWorldPosition(new THREE.Vector3()) : enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const dir = new THREE.Vector3().subVectors(playerPos, origin).normalize();
  dir.x += (Math.random() - 0.5) * 0.06;
  dir.y += (Math.random() - 0.5) * 0.06;
  dir.normalize();
  drawEnemyTracer(origin, dir);
  spawnEnemyMuzzleFlash(origin);

  const dist = origin.distanceTo(playerPos);
  audio.enemyGunshot(dist);
  const hitChance = Math.max(0.05, 0.5 - dist * 0.006);
  if (Math.random() < hitChance) damagePlayer(6 + Math.random() * 6);
}

function spawnEnemyMuzzleFlash(origin){
  const mat = new THREE.SpriteMaterial({ map: softDiscTexture('rgba(255,220,140,1)'), transparent: true, depthWrite: false, opacity: 0.9 });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.35, 0.35, 1);
  s.position.copy(origin);
  scene.add(s);
  setTimeout(() => scene.remove(s), 45);
}

function drawEnemyTracer(origin, dir){
  const end = origin.clone().add(dir.clone().multiplyScalar(60));
  const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.6 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  bulletTracers.push({ line, life: 0.06 });
}

// tracks who's hit the local player recently (PvP only) so a death can credit a kill to whoever
// landed the finishing blow and an assist to anyone else who damaged them in the last few seconds
const ASSIST_WINDOW = 8;
let recentAttackers = []; // [{id, t}], most recent last
function damagePlayer(dmg, fromId){
  if (!player.alive) return;
  player.health -= dmg;
  regenDelayT = REGEN_DELAY;
  audio.playerHurt();
  shakeIntensity = Math.min(shakeIntensity + 0.5, 1.5);
  document.getElementById('hitFlash').style.background = 'rgba(255,0,0,0.35)';
  setTimeout(() => document.getElementById('hitFlash').style.background = 'rgba(255,0,0,0)', 120);
  if (fromId) {
    const now = performance.now() / 1000;
    recentAttackers = recentAttackers.filter(a => a.id !== fromId && now - a.t < ASSIST_WINDOW);
    recentAttackers.push({ id: fromId, t: now });
  }
  if (player.health <= 0) {
    player.health = 0;
    playerDie();
  }
  updateHealthHUD();
}

// slow out-of-combat regen: resets a cooldown on every hit taken, so health only climbs back
// once the player hasn't been shot for a few seconds
const REGEN_DELAY = 4, REGEN_RATE = 3; // seconds before it kicks in, hp/sec once it does
let regenDelayT = 0;
function updatePlayerRegen(dt){
  if (!player.alive || player.health >= player.maxHealth) return;
  if (regenDelayT > 0) { regenDelayT -= dt; return; }
  player.health = Math.min(player.maxHealth, player.health + REGEN_RATE * dt);
}

function playerDie(){
  player.alive = false;
  if (gameMode === 'bomb') return; // round loss is handled by the round system, not the horde game-over screen
  if (gameMode === 'pvp') {
    // credit whoever landed the finishing blow with a kill, and anyone else who hit us in the
    // last few seconds with an assist, then tell every peer (see applyKillMessage/'kill' case)
    const killerId = recentAttackers.length ? recentAttackers[recentAttackers.length - 1].id : null;
    const assistIds = recentAttackers.slice(0, -1).map(a => a.id);
    const killMsg = { type: 'kill', victimId: netMyId, killerId, assistIds };
    netBroadcast(killMsg);
    applyKillMessage(killMsg);
    recentAttackers = [];
    if (roundState.phase === 'warmup') {
      showWaveBanner('You died - respawning...');
      setTimeout(respawnInWarmup, 2000);
    } else {
      document.getElementById('bombStatusLabel').textContent = 'ELIMINATED - waiting for the round to end...';
    }
    return; // during a live round, staying dead is what ends it for your team (see checkPvpRoundEnd)
  }
  localDeaths++;
  document.exitPointerLock();
  document.getElementById('deathScreen').style.display = 'flex';
  document.getElementById('finalScore').textContent = `Wave reached: ${wave} — Kills: ${kills} — Score: ${score}`;
}

function respawnInWarmup(){
  if (roundState.phase !== 'warmup') return; // a real round may have started while we waited to respawn
  player.alive = true;
  player.health = player.maxHealth;
  player.ads = false;
  player.scopeLevel = 0;
  updateHealthHUD();
  const meta = currentMapMeta;
  const team = myTeam();
  const spawnPos = getTeamSpawnPos(meta, team);
  player.pos.copy(spawnPos);
  player.pos.y = groundHeightAt(spawnPos.x, spawnPos.z) + player.height;
  player.velY = 0;
  player.yaw = getSpawnYaw(team);
  player.pitch = 0;
  camera.position.copy(player.pos);
}

// ============================================================
// MOVEMENT / COLLISION
// ============================================================
function checkCollision(newPos){
  // player.pos.y is eye height (ground + height/crouchHeight), not feet height - the box has to
  // span feet-to-head or it floats above anything shorter than the player and never touches it
  const radius = 0.5;
  const feetY = groundHeightAt(newPos.x, newPos.z);
  const topY = feetY + (player.crouching ? player.crouchHeight : player.height);
  const box = new THREE.Box3(
    new THREE.Vector3(newPos.x - radius, feetY, newPos.z - radius),
    new THREE.Vector3(newPos.x + radius, topY, newPos.z + radius)
  );
  for (const c of colliders) if (box.intersectsBox(c)) return true;
  return false;
}

function updatePlayer(dt){
  if (!player.alive) return;

  // recoil / shake decay
  recoilKick = Math.max(0, recoilKick - dt * 0.08);
  recoilYaw += (0 - recoilYaw) * Math.min(1, dt * 3);
  shakeIntensity = Math.max(0, shakeIntensity - dt * 2.5);
  const shakeX = (Math.random() - 0.5) * shakeIntensity * 0.01;
  const shakeY = (Math.random() - 0.5) * shakeIntensity * 0.01;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw + recoilYaw + shakeX;
  camera.rotation.x = player.pitch + recoilKick + shakeY;

  // ADS fov transition - each weapon zooms to its own zoomFov (AWP zooms in much further than iron
  // sights); a scoped weapon at scope level 2 zooms in further still via scopeFov2
  const weaponDef = currentWeaponDef();
  const scopeFov = weaponDef.scope && player.scopeLevel === 2 && weaponDef.scopeFov2 != null ? weaponDef.scopeFov2 : weaponDef.zoomFov;
  const targetFov = player.ads && scopeFov != null ? scopeFov : baseFov;
  player.adsT += ((player.ads ? 1 : 0) - player.adsT) * Math.min(1, dt * 10);
  camera.fov = baseFov + (targetFov - baseFov) * player.adsT;
  camera.updateProjectionMatrix();

  const scoped = player.ads && weaponDef.scope && player.adsT > 0.9;
  document.getElementById('scopeOverlay').style.display = scoped ? 'block' : 'none';
  document.getElementById('adsDot').style.display = (player.ads && !weaponDef.scope) ? 'block' : 'none';
  document.getElementById('crosshair').style.opacity = player.ads ? 0 : 1;
  weaponGroup.visible = !scoped;

  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  let move = new THREE.Vector3();
  if (keys[settings.binds.forward]) move.add(forward);
  if (keys[settings.binds.back]) move.sub(forward);
  if (keys[settings.binds.right]) move.add(right);
  if (keys[settings.binds.left]) move.sub(right);
  if (move.lengthSq() > 0) move.normalize();

  let speed = player.speed;
  const sprinting = !!keys[settings.binds.sprint] && !player.ads;
  if (sprinting) speed *= player.sprintMul;
  player.crouching = !!keys[settings.binds.crouch];
  if (player.crouching) speed *= player.crouchMul;
  if (player.ads) speed *= 0.6;

  const newPos = player.pos.clone().addScaledVector(move, speed * dt);
  if (!checkCollision(newPos)) {
    player.pos.x = newPos.x; player.pos.z = newPos.z;
  } else {
    const tryX = player.pos.clone(); tryX.x = newPos.x;
    if (!checkCollision(tryX)) player.pos.x = newPos.x;
    const tryZ = player.pos.clone(); tryZ.z = newPos.z;
    if (!checkCollision(tryZ)) player.pos.z = newPos.z;
  }

  const half = WORLD_SIZE / 2 - 3;
  player.pos.x = Math.max(-half, Math.min(half, player.pos.x));
  player.pos.z = Math.max(-half, Math.min(half, player.pos.z));

  const groundY = groundHeightAt(player.pos.x, player.pos.z);
  const targetHeight = player.crouching ? player.crouchHeight : player.height;

  if (keys[settings.binds.jump] && player.onGround) { player.velY = 5.2; player.onGround = false; }
  player.velY -= 14 * dt;
  player.pos.y += player.velY * dt;

  const floorY = groundY + targetHeight;
  if (player.pos.y <= floorY) { player.pos.y = floorY; player.velY = 0; player.onGround = true; }

  camera.position.set(player.pos.x + shakeX, player.pos.y + shakeY, player.pos.z);

  // footstep audio
  const moving = move.lengthSq() > 0 && player.onGround;
  if (moving) {
    player.footstepTimer -= dt;
    if (player.footstepTimer <= 0) {
      audio.footstep();
      player.footstepTimer = sprinting ? 0.28 : (player.crouching ? 0.55 : 0.4);
    }
  } else {
    player.footstepTimer = 0;
  }

  // weapon sway / bob / ADS positioning
  const t = performance.now() * 0.008;
  const targetPos = player.ads ? adsPos : hipPos;
  const bobY = (moving && player.onGround && !player.ads) ? Math.sin(t * (sprinting ? 1.8 : 1)) * 0.015 : 0;
  const bobX = (moving && player.onGround && !player.ads) ? Math.cos(t * (sprinting ? 1.8 : 1) * 0.5) * 0.01 : 0;
  weaponGroup.position.x = targetPos.x + bobX;
  weaponGroup.position.y = targetPos.y + bobY;
  weaponGroup.position.z += (targetPos.z - weaponGroup.position.z) * Math.min(1, dt * 15);
  if (!reloadRuntime.reloading) weaponGroup.rotation.x += (0 - weaponGroup.rotation.x) * Math.min(1, dt * 10);

  fireCooldown -= dt;
  if (mouseLocked && mouseDown && fireCooldown <= 0) fireWeapon();

  updateReloadAnimation(dt);
  updateKnifeFlip(dt);
  updateKnifeSwing(dt);
}

// ============================================================
// HUD
// ============================================================
function updateAmmoHUD(){
  const def = currentWeaponDef();
  document.getElementById('ammoLabel').textContent = def.name.toUpperCase();
  if (currentSlot === 'melee') {
    document.getElementById('ammoCount').textContent = '';
    document.getElementById('ammoReserve').textContent = '';
  } else if (currentSlot === 'grenade') {
    document.getElementById('ammoCount').textContent = grenadeCount;
    document.getElementById('ammoReserve').textContent = '';
  } else if (currentSlot === 'smoke') {
    document.getElementById('ammoCount').textContent = smokeCount;
    document.getElementById('ammoReserve').textContent = '';
  } else {
    const state = ammoState[currentSlot];
    document.getElementById('ammoCount').textContent = reloadRuntime.reloading ? '...' : state.mag;
    document.getElementById('ammoReserve').textContent = state.reserve;
  }
}
function updateGrenadeHUD(){
  document.getElementById('grenadeCount').textContent = grenadeCount;
  document.getElementById('smokeCount').textContent = smokeCount;
  if (currentSlot === 'grenade' || currentSlot === 'smoke') updateAmmoHUD();
}
function updateMoneyHUD(){
  document.getElementById('moneyDisplay').textContent = '$' + money;
  document.getElementById('buyMoney').textContent = 'Available money: $' + money;
}
function updateHealthHUD(){
  const pct = Math.max(0, player.health / player.maxHealth * 100);
  document.getElementById('healthInner').style.width = pct + '%';
  const danger = 1 - pct / 100;
  document.getElementById('vignette').style.boxShadow = `inset 0 0 ${120 * danger}px ${40 * danger}px rgba(160,0,0,${0.55 * danger})`;
}
function updateEnemyHUD(){
  document.getElementById('enemyCount').textContent = enemies.filter(e => e.alive).length;
  document.getElementById('killCount').textContent = kills;
  document.getElementById('score').textContent = score;
  document.getElementById('waveNum').textContent = wave;
}
function showWaveBanner(text){
  const el = document.getElementById('waveBanner');
  el.textContent = text || `WAVE ${wave}`;
  el.style.opacity = 1;
  setTimeout(() => el.style.opacity = 0, 1800);
}
function showKillFeed(weaponName, isHeadshot, victimName){
  const feed = document.getElementById('killfeed');
  const entry = document.createElement('div');
  entry.className = 'killEntry';
  entry.innerHTML = `
    <span class="kfKiller">TÚ</span>
    <span class="kfWeapon">${weaponName}${isHeadshot ? '<span class="kfSkull">☠</span>' : ''}</span>
    <span class="kfVictim">${victimName}</span>
  `;
  feed.insertBefore(entry, feed.firstChild);
  while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  setTimeout(() => {
    entry.classList.add('fade');
    setTimeout(() => entry.remove(), 400);
  }, 4000);
}

// ---------- Minimap ----------
const miniCanvas = document.getElementById('minimap');
const miniCtx = miniCanvas.getContext('2d');
function drawMinimap(){
  const scale = 170 / WORLD_SIZE;
  miniCtx.clearRect(0, 0, 170, 170);
  miniCtx.fillStyle = 'rgba(0,20,0,0.3)';
  miniCtx.fillRect(0, 0, 170, 170);
  // static map layout (crates, barrels, cover) - shown in every mode, since it's just the map
  // itself, not intel about where anyone is
  miniCtx.fillStyle = 'rgba(180,150,100,0.8)';
  envMeshes.forEach(m => {
    if (!m.material || !m.material.userData || !m.material.userData.minimapProp) return;
    const mx = 85 + m.position.x * scale;
    const mz = 85 + m.position.z * scale;
    miniCtx.fillRect(mx - 2, mz - 2, 4, 4);
  });
  if (gameMode === 'pvp') return; // no player/enemy position blips in PvP - that would be free intel
  const px = 85 + player.pos.x * scale;
  const pz = 85 + player.pos.z * scale;
  miniCtx.save();
  miniCtx.translate(px, pz);
  miniCtx.rotate(player.yaw);
  miniCtx.fillStyle = '#7CFC00';
  miniCtx.beginPath();
  miniCtx.moveTo(0, -6); miniCtx.lineTo(4, 5); miniCtx.lineTo(-4, 5);
  miniCtx.closePath(); miniCtx.fill();
  miniCtx.restore();
  miniCtx.fillStyle = '#ff4444';
  enemies.forEach(en => {
    if (!en.alive) return;
    const ex = 85 + en.mesh.position.x * scale;
    const ez = 85 + en.mesh.position.z * scale;
    miniCtx.beginPath(); miniCtx.arc(ex, ez, 3, 0, Math.PI * 2); miniCtx.fill();
  });
}

// ============================================================
// GAME LOOP
// ============================================================
let gameStarted = false;
let shopOpen = false;
let gameMode = 'horde'; // 'horde' | 'bomb'
const clock = new THREE.Clock();

// ---------- Round/bomb mode state ----------
const roundState = {
  phase: 'buy', // 'buy' | 'live' | 'planted' | 'ended'
  phaseT: 0,
  buyDuration: 8,
  roundDuration: 100,
  plantDuration: 3,
  fuseDuration: 35,
  defuseDuration: 6,
  roundsToWin: 15,
  ctWins: 0,
  tWins: 0,
  roundNum: 1,
  carrier: null,
  bomb: null, // { pos, mesh, light, fuse, defuseT, defusing }
  plantProgress: 0
};

function toggleBuyMenu(){
  if (!player.alive) return;
  // once a PvP round is actually live the weapon is forced and buying is off the table entirely -
  // the shop is only for spending the unlimited warmup money before the match starts
  if (gameMode === 'pvp' && roundState.phase !== 'warmup') return;
  shopOpen = !shopOpen;
  document.getElementById('buyMenu').style.display = shopOpen ? 'flex' : 'none';
  if (shopOpen) { document.exitPointerLock(); mouseDown = false; }
  else renderer.domElement.requestPointerLock();
}

// ============================================================
// PAUSE MENU (ESC): sensitivity, key bindings, resume, main menu
// ============================================================
let pauseMenuOpen = false;
let listeningForBind = null; // action name currently waiting for a keypress, or null

function togglePauseMenu(){
  if (!gameStarted || shopOpen) return;
  pauseMenuOpen = !pauseMenuOpen;
  document.getElementById('pauseMenu').style.display = pauseMenuOpen ? 'flex' : 'none';
  if (pauseMenuOpen) { document.exitPointerLock(); mouseDown = false; listeningForBind = null; renderBindList(); }
  else renderer.domElement.requestPointerLock();
}

function renderBindList(){
  const list = document.getElementById('bindList');
  list.innerHTML = '';
  Object.keys(DEFAULT_BINDS).forEach(action => {
    const row = document.createElement('div');
    row.className = 'bindRow';
    const listening = listeningForBind === action;
    row.innerHTML = `<span>${BIND_LABELS[action]}</span><button class="bindKeyBtn${listening ? ' listening' : ''}" data-action="${action}">${listening ? 'PRESS A KEY...' : keyLabel(settings.binds[action])}</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.bindKeyBtn').forEach(btn => {
    btn.addEventListener('click', () => { listeningForBind = btn.dataset.action; renderBindList(); });
  });
}

document.addEventListener('keydown', e => {
  if (e.code === 'Escape') { togglePauseMenu(); return; }
  if (!pauseMenuOpen || !listeningForBind) return;
  e.preventDefault();
  settings.binds[listeningForBind] = e.code;
  listeningForBind = null;
  saveSettings();
  renderBindList();
});

document.getElementById('sensSlider').addEventListener('input', e => {
  settings.sensitivity = parseFloat(e.target.value);
  document.getElementById('sensValue').textContent = settings.sensitivity.toFixed(1);
  saveSettings();
});
document.getElementById('sensSlider').value = settings.sensitivity;
document.getElementById('sensValue').textContent = settings.sensitivity.toFixed(1);

document.getElementById('resumeBtn').addEventListener('click', togglePauseMenu);
document.getElementById('mainMenuBtn').addEventListener('click', () => location.reload());

// ============================================================
// TAB SCOREBOARD (hold to view kills/assists/deaths)
// ============================================================
function renderTabScoreboard(){
  const body = document.getElementById('tabScoreboardBody');
  body.innerHTML = '';
  const addRow = (name, team, k, a, d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${name}</td><td>${team}</td><td class="num">${k}</td><td class="num">${a}</td><td class="num">${d}</td>`;
    body.appendChild(tr);
  };
  if (gameMode === 'pvp') {
    netRoster.filter(p => !p.isBot).forEach(p => {
      const s = ensureStats(p.id);
      addRow(p.name + (p.id === netMyId ? ' (you)' : ''), p.team, s.kills, s.assists, s.deaths);
    });
  } else {
    addRow('You', '-', kills, 0, localDeaths);
  }
}
document.addEventListener('keydown', e => {
  if (e.code !== 'Tab' || !gameStarted || shopOpen || pauseMenuOpen) return;
  e.preventDefault();
  if (document.getElementById('tabScoreboard').style.display === 'block') return;
  renderTabScoreboard();
  document.getElementById('tabScoreboard').style.display = 'block';
});
document.addEventListener('keyup', e => {
  if (e.code !== 'Tab') return;
  document.getElementById('tabScoreboard').style.display = 'none';
});

function buyWeapon(id){
  const def = WEAPONS[id];
  if (money < def.price) return;
  money -= def.price;
  inventory[def.slot] = id;
  ammoState[def.slot] = { mag: def.mag, reserve: def.reserve };
  updateMoneyHUD();
  equipSlot(def.slot);
  renderBuyMenu();
}

function buyGrenade(){
  const def = WEAPONS.grenade;
  if (money < def.price || grenadeCount >= MAX_GRENADES) return;
  money -= def.price;
  grenadeCount++;
  updateMoneyHUD();
  updateGrenadeHUD();
  renderBuyMenu();
}

function buySmoke(){
  const def = WEAPONS.smoke;
  if (money < def.price || smokeCount >= MAX_SMOKES) return;
  money -= def.price;
  smokeCount++;
  updateMoneyHUD();
  updateGrenadeHUD();
  renderBuyMenu();
}

function renderBuyMenu(){
  const primaryList = document.getElementById('primaryList');
  const secondaryList = document.getElementById('secondaryList');
  primaryList.innerHTML = ''; secondaryList.innerHTML = '';
  Object.entries(WEAPONS).forEach(([id, def]) => {
    if (def.slot !== 'primary' && def.slot !== 'secondary') return;
    const owned = inventory[def.slot] === id;
    const card = document.createElement('div');
    card.className = 'weaponCard' + (owned ? ' owned' : '');
    card.innerHTML = `<div class="wName">${def.name}</div><div class="wPrice">${owned ? 'EQUIPPED' : '$' + def.price}</div>`;
    if (!owned) card.addEventListener('click', () => buyWeapon(id));
    (def.slot === 'primary' ? primaryList : secondaryList).appendChild(card);
  });

  const grenadeList = document.getElementById('grenadeList');
  grenadeList.innerHTML = '';
  const gdef = WEAPONS.grenade;
  const gmaxed = grenadeCount >= MAX_GRENADES;
  const gcard = document.createElement('div');
  gcard.className = 'weaponCard' + (gmaxed ? ' owned' : '');
  gcard.innerHTML = `<div class="wName">${gdef.name} (${grenadeCount}/${MAX_GRENADES})</div><div class="wPrice">${gmaxed ? 'MAX' : '$' + gdef.price}</div>`;
  if (!gmaxed) gcard.addEventListener('click', buyGrenade);
  grenadeList.appendChild(gcard);

  const sdef = WEAPONS.smoke;
  const smaxed = smokeCount >= MAX_SMOKES;
  const scard = document.createElement('div');
  scard.className = 'weaponCard' + (smaxed ? ' owned' : '');
  scard.innerHTML = `<div class="wName">${sdef.name} (${smokeCount}/${MAX_SMOKES})</div><div class="wPrice">${smaxed ? 'MAX' : '$' + sdef.price}</div>`;
  if (!smaxed) scard.addEventListener('click', buySmoke);
  grenadeList.appendChild(scard);
}

document.getElementById('closeBuyMenu').addEventListener('click', toggleBuyMenu);

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameStarted && !shopOpen && !pauseMenuOpen) {
    updatePlayer(dt);
    updatePlayerRegen(dt);
    updateEnemies(dt);
    updateDyingEnemies(dt);
    updateHealthHUD();
    updateParticles(dt);
    updateDecals(dt);
    updateGrenades(dt);
    updateSmokes(dt);
    document.getElementById('smokeOverlay').style.opacity = pointInAnySmoke(player.pos.x, player.pos.z) ? 1 : 0;
    if (gameMode === 'bomb') updateRound(dt);
    if (gameMode === 'pvp') updatePvpRound(dt);
    if (gameMode === 'practice') updatePractice(dt);

    // drifting clouds
    clouds.forEach((c, i) => { c.position.x += dt * (2 + (i % 3)); if (c.position.x > 300) c.position.x = -300; });

    for (let i = bulletTracers.length - 1; i >= 0; i--) {
      bulletTracers[i].life -= dt;
      if (bulletTracers[i].life <= 0) { scene.remove(bulletTracers[i].line); bulletTracers.splice(i, 1); }
    }
    drawMinimap();
  }

  composer.render();
}
animate();

// ============================================================
// START / RESTART
// ============================================================
let mapChosen = true; // only one map exists now (Desert), pre-selected - no click needed
function updateStartButtonState(){
  let ready = mapChosen && soldierAssetsReady;
  if (selectedMode === 'pvp') ready = ready && !!netPeer && !!netMyId;
  document.getElementById('startBtn').disabled = !ready;
}
document.getElementById('loadingNote').textContent = 'Loading soldier model...';
soldierReadyPromise.then(() => {
  document.getElementById('loadingNote').textContent = "";
  updateStartButtonState();
});

let selectedMode = 'pvp';

document.querySelectorAll('.mapCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.mapCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedMap = card.dataset.map;
    mapChosen = true;
    updateStartButtonState();
  });
});

document.querySelectorAll('.modeCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.modeCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedMode = card.dataset.mode;
    document.getElementById('pvpPanel').style.display = selectedMode === 'pvp' ? 'flex' : 'none';
    document.getElementById('startBtn').textContent = selectedMode === 'practice' ? 'START PRACTICE' : "I'M READY";
    updateStartButtonState();
  });
});

document.querySelectorAll('.teamSizeBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.teamSizeBtn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    netTeamSize = parseInt(btn.dataset.size, 10);
  });
});

document.querySelectorAll('.pvpChoiceBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pvpChoiceBtn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const joining = btn.dataset.choice === 'join';
    document.getElementById('pvpHostSection').style.display = joining ? 'none' : 'flex';
    document.getElementById('pvpJoinSection').style.display = joining ? 'flex' : 'none';
    // a joiner never picks a map/mode themselves - they inherit whatever the host is running,
    // so hide the pickers entirely rather than leave controls on screen that don't do anything for them
    document.getElementById('mapSelect').style.display = joining ? 'none' : 'flex';
    document.getElementById('modeSelect').style.display = joining ? 'none' : 'flex';
    if (joining) {
      selectedMap = 'arena';
      selectedMode = 'pvp';
      mapChosen = true;
    }
    updateStartButtonState();
  });
});

document.getElementById('playerNameInput').addEventListener('input', e => {
  localPlayerName = e.target.value.trim() || 'Player';
});

document.getElementById('pvpHostBtn').addEventListener('click', () => {
  document.getElementById('pvpStatus').textContent = 'Setting up...';
  hostRoom(netTeamSize);
});
document.getElementById('pvpJoinBtn').addEventListener('click', () => {
  const code = document.getElementById('pvpJoinCode').value;
  if (code.trim()) { document.getElementById('pvpStatus').textContent = 'Setting up...'; joinRoom(code); }
});

document.getElementById('startBtn').addEventListener('click', () => {
  if (document.getElementById('startBtn').disabled) return;
  audio.init();
  audio.resume();
  audio.startAmbience();
  buildMap(selectedMap);
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  gameStarted = true;
  updateAmmoHUD();
  updateGrenadeHUD();
  updateHealthHUD();
  updateEnemyHUD();
  updateMoneyHUD();
  renderBuyMenu();
  gameMode = selectedMode;
  document.getElementById('hordeStats').style.display = gameMode === 'horde' ? 'block' : 'none';
  document.getElementById('roundStats').style.display = (gameMode === 'bomb' || gameMode === 'pvp') ? 'block' : 'none';
  document.getElementById('scoreboardBar').style.display = (gameMode === 'bomb' || gameMode === 'pvp' || gameMode === 'practice') ? 'flex' : 'none';
  // practice has no teams - just the centered timer, same look as the 1v1 scoreboard's clock
  document.querySelectorAll('#scoreboardBar .sbTeam, #scoreboardBar .sbScore').forEach(el => { el.style.display = gameMode === 'practice' ? 'none' : 'flex'; });
  document.getElementById('sbNameA').textContent = gameMode === 'bomb' ? 'T' : 'TEAM A';
  document.getElementById('sbNameB').textContent = gameMode === 'bomb' ? 'CT' : 'TEAM B';
  if (gameMode === 'bomb') startMatch();
  else if (gameMode === 'pvp') startPvpMatch();
  else if (gameMode === 'practice') startPractice();
  else nextWaveInit();
  renderer.domElement.requestPointerLock();
});

document.getElementById('restartBtn').addEventListener('click', () => location.reload());

function nextWaveInit(){
  wave = 1; kills = 0; score = 0;
  const count = 4;
  for (let i = 0; i < count; i++) spawnEnemy();
  showWaveBanner();
  updateEnemyHUD();
}

// ============================================================
// PRACTICE MODE (static aim-training targets, unlimited budget, 60-minute session)
// ============================================================
const PRACTICE_TARGET_POS = [[10, -5], [10, 5], [-5, -8], [-5, 8], [3, 10], [3, -10]];
const PRACTICE_DURATION = 3600; // 60 minutes
let practiceTimer = PRACTICE_DURATION;

function spawnPracticeTarget(pos){
  const enemy = spawnEnemy(pos);
  enemy.isStatic = true;
  enemy.spawnPos = pos.clone();
  // pose it partway through the walk cycle once instead of leaving it at frame 0, which is the
  // raw T-pose bind pose - a static target should look like it's standing, not broken
  const action = enemy.mesh.userData.action;
  if (action) {
    action.play();
    action.time = 0.25 * action.getClip().duration;
    enemy.mesh.userData.mixer.update(0);
  }
  return enemy;
}

function startPractice(){
  money = 9999999;
  updateMoneyHUD();
  practiceTimer = PRACTICE_DURATION;
  PRACTICE_TARGET_POS.forEach(([x, z]) => spawnPracticeTarget(new THREE.Vector3(x, 2, z)));
}

function updatePractice(dt){
  if (practiceTimer > 0) {
    practiceTimer = Math.max(0, practiceTimer - dt);
    if (practiceTimer === 0) showWaveBanner('Practice time is up');
  }
  document.getElementById('roundPhaseLabel').textContent = 'PRACTICE';
  document.getElementById('roundTimer').textContent = formatRoundTime(practiceTimer);
}
