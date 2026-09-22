/* ==========================================================
   FIREZONE - FPS battlefield-style prototype (Three.js, r157)
   Enhanced: procedural graphics, bloom, particles, full audio,
   reload animation, ADS, recoil, screen shake, damage vignette.
   ========================================================== */
import * as THREE from 'three';
import { sampleReplay, replayEvents, advanceReplay } from './killcam-timeline.js';
import { buildMall } from './mall-map.js';
import { mallWalk } from './mall-layout.js';
import { FFA, botCount, canStart, rankPlayers, chooseSpawn } from './ffa-rules.js';
import { FFA_MAPS, buildNavigation, blockedAt, SKI_DROP, SKI_CAFE } from './ffa-layouts.js';
import { buildFfaMap, ffaThumbnail } from './ffa-maps.js';
import { addMapFinish } from './map-finish.js';
import { findClearSpawn } from './map-spawns.js';
import { createFounderFinish } from './founder-skin.js';
import { buildFoundry } from './foundry-map.js';
import { buildOffice } from './office-map.js';
import { FOUNDRY } from './foundry-layout.js';
import { TeammateSpectator } from './spectator.js';
import { PlayerLabels } from './player-labels.js';
import { RoundLives, roundOutcome } from './pvp-life.js';
import { sightOffset } from './weapon-aim.js';
import { attachWeaponSight } from './weapon-sights.js';
import { CombatMotion } from './combat-motion.js';
import { createImpactMarks } from './combat-effects.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SocialUI } from './social-ui.js';
import { mountAccount } from './account.js';
import { COUNTRY_LIST, flagEmoji } from './ladder.js';
import { seededRandom, createReflectionEnvironment, addWorldDetail, refineWorldMaterials } from './world-art.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SPRAYS, CHAT_COOLDOWN, SPRAY_COOLDOWN, SPRAY_RANGE, cleanText, validSpray, withinSprayRange, SocialRateLimiter } from './social-protocol.js';
import { findOrQueue, leaveQueue } from './matchmaking.js';

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
    this.loadSample('awp', 'assets/cs_go-awp-sound.mp3');
    this.loadSample('scopeClick', 'assets/awp-zoom-sound-effect-cs-go.mp3');
    this.loadSample('ak47', 'assets/ak-47-mp3.mp3');
    this.loadSample('reload', 'assets/uzi-reload.mp3');
    this.loadSample('m4a1', 'assets/m4a1_silencer_01.mp3');
    this.loadSample('glock', 'assets/pistol-shot.mp3');
    this.loadSample('smokeHiss', 'assets/smoke-grenade-sound-effect.mp3');
    this.loadSample('grenadeThrow', 'assets/grenade-plonk-sound-effect-tarkov-louder.mp3');
    this.loadSample('deagle', 'assets/desert-eagle-cs.mp3');
    this.loadSample('explosion', 'assets/exploded_zfp5Xgm.mp3');
    this.loadSample('flashbang', 'assets/cs-go-flashbang.mp3');
    this.loadSample('m4a4', 'assets/m70-rifle.mp3');
    this.loadSample('smg', 'assets/wpn_45_smg_2d_01.mp3');
    this.loadSample('knifeSlash', 'assets/knife-slashing.mp3');
    this.loadSample('knifeStab', 'assets/knife-stab.mp3');
    this.loadSample('subwayAmbience', 'assets/subway.mp3');
    this.loadSample('graffiti', 'assets/graffiti.mp3');
    this.loadSample('hitmarkerHit', 'assets/hitmarker_2.mp3');
    this.loadSample('snowStep', 'assets/crunchysnow.mp3');
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
  // synthesized sound instead of silently doing nothing). maxDuration truncates long source
  // files (with a short fade-out so the cut isn't an audible click) rather than playing them
  // to the end - the graffiti can/spray sample runs much longer than the spray animation itself
  playSample(name, vol = 1, maxDuration = null){
    const buffer = this.samples[name];
    if (!this.ctx || !buffer) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    if (maxDuration && buffer.duration > maxDuration) {
      g.gain.setValueAtTime(vol, t);
      g.gain.setValueAtTime(vol, t + Math.max(0, maxDuration - 0.08));
      g.gain.linearRampToValueAtTime(0, t + maxDuration);
      src.connect(g); g.connect(this.master);
      src.start(t);
      src.stop(t + maxDuration);
    } else {
      g.gain.value = vol;
      src.connect(g); g.connect(this.master);
      src.start(t);
    }
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
    const g = ctx.createGain(); g.gain.setValueAtTime(0.19, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
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

  startAmbience(mapId){
    if (!this.ctx) return;
    const ctx = this.ctx;
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(4); noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.045;
    noise.connect(lp); lp.connect(g); g.connect(this.master);
    noise.start();
    this._ambienceLoop();
    if (mapId === 'subway') this._subwayAmbienceLoop();
  }
  _ambienceLoop(){
    const delay = 7000 + Math.random() * 10000;
    setTimeout(() => { this.distantExplosion(); this._ambienceLoop(); }, delay);
  }
  // distant train rumble/announcement loop for the Subway map - quiet background flavor,
  // roughly once a minute, not gated to the other (much more frequent) combat ambience above
  _subwayAmbienceLoop(){
    const delay = 50000 + Math.random() * 20000;
    setTimeout(() => { this.playSample('subwayAmbience', 0.22); this._subwayAmbienceLoop(); }, delay);
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
    grad.addColorStop(0, 'rgba(90, 0, 0, 0.9)');
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
let baseFov = 75;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = true;
document.body.appendChild(renderer.domElement);
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
const reflectionEnvironment = createReflectionEnvironment(renderer);
scene.environment = reflectionEnvironment.texture;
const impactMarks = createImpactMarks(scene);
const combatMotion = new CombatMotion();
const playerLabels = new PlayerLabels();

// post-processing (bloom for muzzle flash / sun glow)
// Note: SSAO was tried here for contact-shadow realism, but three.js's SSAOPass reads the whole
// screen depth buffer as one image, and the first-person weapon sits only centimeters from the
// camera - its depth gradient is steep enough that SSAO's sampling kernel blows out into a bright
// diagonal streak across the gun. Fixing that properly means rendering the viewmodel in its own
// pass on a separate layer with the depth buffer cleared in between, which is a bigger change than
// this pass earns on its own - reverted for now.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.16, 0.35, 1.0);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Dynamic resolution keeps input latency stable on integrated GPUs. It changes slowly to avoid
// visible oscillation and never exceeds the display's native pixel density.
const renderQuality = {
  scale: Math.min(window.devicePixelRatio, 1.5),
  min: 0.75,
  max: Math.min(window.devicePixelRatio, 1.75),
  sampleTime: 0,
  frameCount: 0
};
function updateRenderQuality(dt){
  renderQuality.sampleTime += dt;
  renderQuality.frameCount++;
  if (renderQuality.sampleTime < 2) return;
  const fps = renderQuality.frameCount / renderQuality.sampleTime;
  const previous = renderQuality.scale;
  if (fps < 50) renderQuality.scale = Math.max(renderQuality.min, renderQuality.scale - 0.1);
  else if (fps > 58) renderQuality.scale = Math.min(renderQuality.max, renderQuality.scale + 0.05);
  if (Math.abs(previous - renderQuality.scale) > 0.001) {
    renderer.setPixelRatio(renderQuality.scale);
    composer.setPixelRatio(renderQuality.scale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  renderQuality.sampleTime = 0;
  renderQuality.frameCount = 0;
}

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
sun.shadow.camera.left = -43; sun.shadow.camera.right = 43;
sun.shadow.camera.top = 43; sun.shadow.camera.bottom = -43;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.035;
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

// dim interior lighting for the Warehouse map - mostly dark, with the hanging lamps built into
// the map itself (see buildWarehouseMap) doing the real work of lighting the floor
function applyIndustrialAtmosphere(){
  sky.material.map = desertSkyGradientTexture(); // barely visible under a roof, just needs to not be blank
  sky.material.needsUpdate = true;
  scene.fog.color.set(0x2a2a2a);
  scene.fog.density = 0.01;
  hemi.color.set(0x5a5a66); hemi.groundColor.set(0x232320); hemi.intensity = 0.9;
  sun.color.set(0xaab0b8); sun.intensity = 0.45;
  fillLight.color.set(0x606060); fillLight.intensity = 0.3;
}

// cool, fluorescent-lit subway station - kept as bright as the (already-corrected) Warehouse
// pass from the first version, rather than risk the same "too dark" mistake
function applySubwayAtmosphere(){
  sky.material.map = desertSkyGradientTexture(); // barely visible under a roof, just needs to not be blank
  sky.material.needsUpdate = true;
  scene.fog.color.set(0x30343a);
  scene.fog.density = 0; // enclosed corridor map - the fog read as a haze right in front of the player, not distance atmosphere
  hemi.color.set(0x8fa4b8); hemi.groundColor.set(0x2a2c30); hemi.intensity = 1.0;
  sun.color.set(0xcfe4f5); sun.intensity = 0.5;
  fillLight.color.set(0x7a8a96); fillLight.intensity = 0.35;
}

// ---------- World / Map system ----------
let WORLD_SIZE = 220;
let groundHeightAt = (x, z) => 0;
let mapRandom = seededRandom(1);

// real photo/render textures for the arena map (assets/textures/), tiled since they're not
// procedurally generated to an exact size like the rest of this file's canvas-based textures
const textureLoader = new THREE.TextureLoader();
const tiledTextureCache = new Map();
const textureSources = new Map();
function textureSource(url){
  if (!textureSources.has(url)) {
    textureSources.set(url, new Promise(resolve => {
      textureLoader.load(url, texture => resolve(texture.image), undefined, () => {
        const fallback = metalScratchTexture('#867e6e');
        resolve(fallback.image);
      });
    }));
  }
  return textureSources.get(url);
}
function loadTiledTexture(url, repeatX, repeatY){
  const cacheKey = `${url}|${repeatX}|${repeatY}`;
  if (tiledTextureCache.has(cacheKey)) return tiledTextureCache.get(cacheKey);
  const tex = metalScratchTexture('#867e6e');
  textureSource(url).then(image => {
    tex.image = image;
    tex.needsUpdate = true;
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tiledTextureCache.set(cacheKey, tex);
  return tex;
}

const MAP_TEXTURE_URLS = {
  dockyard: ['assets/textures/subway_floor.webp'],
  atrium: ['assets/textures/subway_floor.webp'],
  arena: ['assets/textures/sand.jpg', 'assets/textures/wall.jpg', 'assets/textures/box.png', 'assets/textures/metal.jpg'],
  warehouse: ['assets/textures/warehouse_floor.avif', 'assets/textures/warehouse_wall.avif', 'assets/textures/box.png', 'assets/textures/metal.jpg'],
  subway: ['assets/textures/subway_floor.webp', 'assets/textures/subway_walls.jpg', 'assets/textures/train.png', 'assets/textures/trainfront.png', 'assets/textures/metal.jpg'],
  foundry: ['assets/textures/wall.jpg', 'assets/textures/subway_floor.webp', 'assets/textures/metal.jpg'],
  skyline: [],
  ski: ['assets/textures/snow.png','assets/textures/cafe.png','assets/textures/mesa.png','assets/textures/arbol_tronco.png','assets/textures/arbol_hojas.png','assets/textures/cafe_gijon.png'],
  mall: [],
  office: ['assets/textures/cream_concrete.png','assets/textures/moqueta_clara.jpg','assets/textures/moqueta_oscura.webp','assets/textures/stars_easter.png']
};
const texturePreloadState = new Map();
function preloadMapTextures(mapId){
  if (texturePreloadState.get(mapId) === 'ready') return Promise.resolve();
  const urls = MAP_TEXTURE_URLS[mapId] || [];
  texturePreloadState.set(mapId, 'loading');
  return Promise.all(urls.map(textureSource)).then(() => { texturePreloadState.set(mapId, 'ready'); });
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
// ground/floor meshes aren't collidable props (no addBox call), but graffiti still needs to be
// sprayable onto them - each buildXMap() pushes its own ground mesh(es) here
const floorMeshes = [];
function addBox(mesh, blocksBullets = true){
  const box = new THREE.Box3().setFromObject(mesh);
  colliders.push(box);
  // Some surfaces (Office glass) block movement but intentionally allow bullets through.
  if (blocksBullets) envMeshes.push(mesh);
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
  trunk.rotation.z = (mapRandom() - 0.5) * 0.15;
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
  floorMeshes.push(ground);

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
  makeBoxProp(-3, 4, 1.6, 1.6, 1.6, crateMat);
  [[4, -5], [4, 5], [9, 0]].forEach(([x, z]) => addBarrel(x, z));

  // two crates up on the elevated strip
  makeBoxProp(ELEV_CX, -10, 1.5, 1.5, 1.5, crateMat);
  makeBoxProp(ELEV_CX, 10, 1.5, 1.5, 1.5, crateMat);

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

// ---------- Map: Warehouse (abandoned factory interior) ----------
// Deliberately the exact same layout as Arena/Desert (same crate rows, elevated strip, spawn
// zones, low walls - just call sites copy-pasted with different materials) rather than a new
// design - the ask was "same style of crates and cover, symmetric, but different theme", so only
// the reskin (indoor ceiling, dim hanging lights, worn metal instead of sandstone/sand) changes.
function buildWarehouseMap(){
  WORLD_SIZE = 60;
  applyIndustrialAtmosphere();

  const ELEV_CX = -17, ELEV_HALF_W = 3.5, ELEV_HALF_D = 20, ELEV_HEIGHT = 2.0;
  groundHeightAt = (x, z) => plateau(x, z, ELEV_CX, 0, ELEV_HALF_W, ELEV_HALF_D, ELEV_HEIGHT, 6);

  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 60, 60);
  groundGeo.rotateX(-Math.PI / 2);
  const gPos = groundGeo.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    gPos.setY(i, groundHeightAt(gPos.getX(i), gPos.getZ(i)));
  }
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/warehouse_floor.avif', 14, 14), roughness: 0.95 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
  floorMeshes.push(ground);

  const wallMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/warehouse_wall.avif', 8, 2), roughness: 0.95 });
  const crateMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/box.png', 1, 1), roughness: 0.9 }); // same crate look as Desert
  crateMat.userData.penetrable = true;
  crateMat.userData.minimapProp = true;
  const lowWallMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/warehouse_wall.avif', 2, 1), roughness: 0.95 });
  lowWallMat.userData.minimapProp = true;

  const halfArenaZ = 27, eastX = 27, westX = ELEV_CX - ELEV_HALF_W - 0.5, wallThk = 2;
  const wallCx = (eastX + westX) / 2, wallSpanX = (eastX - westX) + wallThk * 2;
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

  // a roof closing the building off, otherwise it'd just be an open-topped box under the sky
  const ceilingTex = metalScratchTexture('#26262a'); ceilingTex.repeat.set(10, 10);
  const ceilingMat = new THREE.MeshStandardMaterial({ map: ceilingTex, roughness: 1, side: THREE.DoubleSide });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(wallSpanX, halfArenaZ * 2 + wallThk * 2), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(wallCx, wallBaseY + wallH, 0);
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // hanging lamps - a denser grid covering the whole floor (including the spawn zones and the
  // east side, which a sparser 6-lamp layout left almost completely black) plus much brighter
  // general lighting above (see applyIndustrialAtmosphere) - the very first pass here was so dim
  // it was nearly unplayable
  const lampFixtureMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.5, metalness: 0.6 });
  const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0 });
  const lampXs = [-15, -1, 13, 24], lampZs = [-22, -8, 8, 22];
  lampXs.forEach(x => lampZs.forEach(z => {
    const lampY = 6.5;
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.3, 10), lampFixtureMat);
    fixture.position.set(x, lampY, z);
    scene.add(fixture);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), lampBulbMat);
    bulb.position.set(x, lampY - 0.25, z);
    scene.add(bulb);
    const light = new THREE.PointLight(0xffd9a0, 7, 26, 1.7);
    light.position.set(x, lampY - 0.3, z);
    scene.add(light);
  }));

  // crate/barrel positions are randomized (within safe, non-overlapping bounds) every time this
  // map builds, rather than reusing Desert's exact coordinates - jitter is mirrored north/south
  // so the two spawns still get equivalent cover, just laid out differently each match
  const jit = n => (mapRandom() - 0.5) * n;

  const rowXs = [-11, -7, -3, 1];
  rowXs.forEach(x => {
    const zj = jit(2);
    makeBoxProp(x, -15 + zj, 1.7, 1.7, 1.7, crateMat);
    makeBoxProp(x, 15 - zj, 1.7, 1.7, 1.7, crateMat);
  });

  const barrelMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/metal.jpg', 1, 2), roughness: 0.4, metalness: 0.7 });
  barrelMat.userData.minimapProp = true;
  function addBarrel(x, z){
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 12), barrelMat);
    barrel.position.set(x, groundHeightAt(x, z) + 0.8, z);
    barrel.castShadow = true; barrel.receiveShadow = true;
    scene.add(barrel);
    addBox(barrel);
  }

  const entryRowXs = [-9, -5, -1, 3, 7, 11];
  entryRowXs.forEach(x => {
    const zj = jit(1.5);
    makeBoxProp(x, -18.5 + zj, 1.6, 1.6, 1.6, crateMat);
    makeBoxProp(x, 18.5 - zj, 1.6, 1.6, 1.6, crateMat);
  });
  [[14, -19], [14, 19]].forEach(([x, z]) => addBarrel(x + jit(2), z + jit(1.5)));

  // Offset machinery forms two short crossing lanes instead of random clutter.
  const machineryMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/metal.jpg', 2, 2), color: 0x657c79, roughness: 0.65, metalness: 0.35 });
  machineryMat.userData.minimapProp = true;
  makeBoxProp(-4, -5, 3, 2.3, 5, machineryMat);
  makeBoxProp(-4, 5, 3, 2.3, 5, machineryMat);
  [[5, -5], [5, 5], [11, 0]].forEach(([x, z]) => addBarrel(x, z));

  makeBoxProp(ELEV_CX, -10 + jit(3), 1.5, 1.5, 1.5, crateMat);
  makeBoxProp(ELEV_CX, 10 + jit(3), 1.5, 1.5, 1.5, crateMat);

  makeBoxProp(ELEV_CX + ELEV_HALF_W + 1.5, -17, 2.6, 1.05, 1.1, lowWallMat);
  makeBoxProp(ELEV_CX + ELEV_HALF_W + 1.5, 17, 2.6, 1.05, 1.1, lowWallMat);

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

// hazard tape for the platform edge - diagonal yellow/black stripes, the universal "don't
// walk past here" marking real stations paint right at the track lip
function hazardStripeTexture(){
  const { c, ctx } = makeCanvas(128);
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#e6c62e';
  const stripeW = 24;
  for (let x = -128; x < 256; x += stripeW * 2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, 128); ctx.lineTo(x + stripeW, 128); ctx.lineTo(x + stripeW + 128, 0); ctx.lineTo(x + 128, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// wall-mounted station name plate - dark tile background with a bold painted station name,
// same idea as siteMarkerTexture but styled like real subway signage
function stationSignTexture(text){
  const { c, ctx } = makeCanvas(256);
  ctx.fillStyle = '#0e3d2e'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#123f30'; ctx.fillRect(0, 40, 256, 176);
  ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 6;
  ctx.strokeRect(10, 50, 236, 156);
  ctx.fillStyle = '#f4efe0';
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 130);
  return new THREE.CanvasTexture(c);
}

// small hanging illuminated exit sign
function exitSignTexture(){
  const { c, ctx } = makeCanvas(128);
  ctx.fillStyle = '#0d4d1f'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', 64, 68);
  return new THREE.CanvasTexture(c);
}

// Hand-authored 2D bot-nav/blockedAt layout mirroring Subway's real geometry (walls, columns,
// train car, benches, crates) so FFA can run on it without a second, FFA-only build of the map -
// buildSubwayMap()'s own colliders are what the player actually walks into; this is only read by
// blockedAt()/buildNavigation() for FFA bot pathing and human spawn-clearing.
const SUBWAY_FFA_LAYOUT = (() => {
  const westX = -10, eastX = 17, halfLen = 41, wallThk = 2, wallCx = (westX + eastX) / 2;
  const halfWidth = 18, halfDepth = 42;
  const cover = [
    { x: wallCx, z: -halfLen - wallThk / 2, w: eastX - westX, d: wallThk },
    { x: wallCx, z: halfLen + wallThk / 2, w: eastX - westX, d: wallThk },
    { x: westX, z: 0, w: wallThk, d: halfLen * 2 + wallThk * 2 },
    { x: eastX, z: 0, w: wallThk, d: halfLen * 2 + wallThk * 2 },
    { x: 13, z: 0, w: 5.2, d: 34 }, // parked train car
    // The corridor isn't centered on x=0 (the pit side runs further east than the platform runs
    // west), so a halfWidth wide enough for the pit leaves slack past the platform's real wall -
    // seal it, or that leftover strip becomes its own walkable-but-unreachable pocket for bots.
    { x: -14.5, z: 0, w: 8, d: halfDepth * 2 + 10 }
  ];
  for (const z of [-30, -20, -10, 0, 10, 20, 30]) {
    const bucket = Math.round(Math.abs(z) / 10);
    cover.push({ x: bucket % 2 === 0 ? -1.8 : 1.8, z, w: 1.2, d: 1.2 });
  }
  for (const z of [-30, -12, 12, 30]) cover.push({ x: westX + 1.1, z, w: 1, d: 2.6 });
  for (const z of [-33, 33]) {
    cover.push({ x: -3, z, w: 1.6, d: 1.6 }, { x: 3, z, w: 1.6, d: 1.6 }, { x: -6, z: z * 0.9, w: 1.5, d: 1.5 });
  }
  const spawns = [
    { x: 0, z: -38 }, { x: 0, z: 38 }, { x: -5, z: -25 }, { x: 5, z: -25 }, { x: -5, z: 25 }, { x: 5, z: 25 },
    { x: 0, z: -10 }, { x: 0, z: 10 }, { x: -5, z: 0 }, { x: 5, z: 0 }, { x: 13, z: -33 }, { x: 13, z: 33 }
  ];
  return { halfWidth, halfDepth, cover, spawns };
})();

// ---------- Map: Subway (abandoned station platform) ----------
// A genuinely different shape from Desert/Warehouse rather than the same footprint reskinned:
// a long, narrow platform with a sunken track pit and parked train car along one side, support
// columns down the centerline breaking the sightline, wall benches and station signage.
function buildSubwayMap(){
  WORLD_SIZE = 100;
  applySubwayAtmosphere();

  // platform runs x: -9..9, track pit x: 9..16 with a smoothed curb dropping PIT_DEPTH down
  const PIT_X0 = 9, PIT_MARGIN = 1.4, PIT_DEPTH = 1.3;
  const halfLen = 41, wallThk = 2;
  const westX = -9 - wallThk / 2, eastX = 16 + wallThk / 2;
  groundHeightAt = (x, z) => {
    const t = Math.min(1, Math.max(0, (x - PIT_X0) / PIT_MARGIN));
    const s = t * t * (3 - 2 * t);
    return -PIT_DEPTH * s;
  };

  // platform floor and track-bed floor are two separate, non-overlapping planes (rather than one
  // full-width plane plus a flat overlay dropped on top of it) - the previous overlapping version
  // z-fought with the ground right at the platform/pit boundary, showing up as a hazy flicker there
  const platformW = PIT_X0 - (westX + wallThk / 2);
  const platformGeo = new THREE.PlaneGeometry(platformW, halfLen * 2, 20, 100);
  platformGeo.rotateX(-Math.PI / 2);
  const platformCx = westX + wallThk / 2 + platformW / 2;
  const pfPos = platformGeo.attributes.position;
  for (let i = 0; i < pfPos.count; i++) {
    pfPos.setY(i, groundHeightAt(pfPos.getX(i) + platformCx, pfPos.getZ(i)));
  }
  platformGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/subway_floor.webp', 12, 18), roughness: 0.85 });
  const platformFloor = new THREE.Mesh(platformGeo, groundMat);
  platformFloor.position.x = platformCx;
  platformFloor.receiveShadow = true;
  scene.add(platformFloor);
  floorMeshes.push(platformFloor);

  const pitW = (eastX - wallThk / 2) - PIT_X0;
  const pitGeo = new THREE.PlaneGeometry(pitW, halfLen * 2, 10, 100);
  pitGeo.rotateX(-Math.PI / 2);
  const pitCx = PIT_X0 + pitW / 2;
  const ptPos = pitGeo.attributes.position;
  for (let i = 0; i < ptPos.count; i++) {
    ptPos.setY(i, groundHeightAt(ptPos.getX(i) + pitCx, ptPos.getZ(i)));
  }
  pitGeo.computeVertexNormals();
  const pitMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/metal.jpg', 3, 30), color: 0x555555, roughness: 0.7, metalness: 0.3 });
  const pitFloor = new THREE.Mesh(pitGeo, pitMat);
  pitFloor.position.x = pitCx;
  pitFloor.receiveShadow = true;
  scene.add(pitFloor);
  floorMeshes.push(pitFloor);

  // rails
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.8 });
  [11.8, 13.6].forEach(x => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, halfLen * 2), railMat);
    rail.position.set(x, -PIT_DEPTH + 0.1, 0);
    scene.add(rail);
  });

  // hazard stripe right at the platform lip
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 1 });
  hazardMat.map.repeat.set(1, halfLen * 2 / 1.2);
  const hazard = new THREE.Mesh(new THREE.PlaneGeometry(0.6, halfLen * 2), hazardMat);
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.set(PIT_X0 - 0.4, 0.02, 0);
  scene.add(hazard);

  const wallMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/subway_walls.jpg', 10, 1.8), roughness: 0.8 });
  const crateMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/box.png', 1, 1), roughness: 0.9 }); // same crate look as Desert/Warehouse
  crateMat.userData.penetrable = true;
  crateMat.userData.minimapProp = true;
  const columnMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/subway_walls.jpg', 1.2, 3), roughness: 0.75 });
  columnMat.userData.minimapProp = true;
  const barrelMat = new THREE.MeshStandardMaterial({ map: loadTiledTexture('assets/textures/metal.jpg', 1, 2), roughness: 0.4, metalness: 0.7 });
  barrelMat.userData.minimapProp = true;
  const trainSideTex = loadTiledTexture('assets/textures/train.png', 6, 1);
  const trainSideMat = new THREE.MeshStandardMaterial({ map: trainSideTex, roughness: 0.5, metalness: 0.3 });
  const trainRoofTex = loadTiledTexture('assets/textures/metal.jpg', 2, 6);
  const trainRoofMat = new THREE.MeshStandardMaterial({ map: trainRoofTex, roughness: 0.4, metalness: 0.6 });
  const trainFrontTex = loadTiledTexture('assets/textures/metal.jpg', 2, 1.2);
  const trainFrontMat = new THREE.MeshStandardMaterial({ map: trainFrontTex, color: 0x3a4046, roughness: 0.35, metalness: 0.75 });

  const wallBaseY = -2, wallH = 11;
  const wallCx = (westX + eastX) / 2;
  // the end walls must be centered on the corridor's actual midpoint (not x=0) - the platform
  // and pit are asymmetric widths, so a wall centered at 0 left a gap at the tunnel-side end,
  // showing the sky gradient through it and reading as a haze right at the far end of the corridor
  [[wallCx, -halfLen - wallThk / 2, eastX - westX, wallH, wallThk], [wallCx, halfLen + wallThk / 2, eastX - westX, wallH, wallThk],
   [westX, 0, wallThk, wallH, halfLen * 2 + wallThk * 2], [eastX, 0, wallThk, wallH, halfLen * 2 + wallThk * 2]]
    .forEach(([x, z, w, h, d]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      mesh.position.set(x, wallBaseY + h / 2, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      addBox(mesh);
    });
  addPerimeterWalls();

  // flat concrete ceiling
  const ceilingTex = metalScratchTexture('#3a3d42'); ceilingTex.repeat.set(8, 16);
  const ceilingMat = new THREE.MeshStandardMaterial({ map: ceilingTex, roughness: 1, side: THREE.DoubleSide });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(eastX - westX, halfLen * 2 + wallThk * 2), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((westX + eastX) / 2, wallBaseY + wallH, 0);
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // a single line of fluorescent tubes down the platform centerline - narrow corridor needs far
  // fewer fixtures than Warehouse's open square to read just as bright
  const tubeFixtureMat = new THREE.MeshStandardMaterial({ color: 0xe8f0f5, roughness: 0.3, metalness: 0.1, emissive: 0xdfeeff, emissiveIntensity: 0.6 });
  const lampZs = [-35, -25, -15, -5, 5, 15, 25, 35];
  lampZs.forEach(z => {
    const lampY = wallBaseY + wallH - 0.5;
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.3), tubeFixtureMat);
    tube.position.set(0, lampY, z);
    scene.add(tube);
    const light = new THREE.PointLight(0xdfeeff, 8, 24, 1.7);
    light.position.set(0, lampY - 0.3, z);
    scene.add(light);
  });

  // the centerline tubes alone are 13 units from the pit/train car and fall off well before
  // reaching it - dedicated pit lights so the track area doesn't read as unlit black
  [-25, -5, 15, 35].forEach(z => {
    const pitLight = new THREE.PointLight(0xcfe0ee, 5, 20, 1.7);
    pitLight.position.set(12, wallBaseY + wallH - 2.5, z);
    scene.add(pitLight);
  });

  // support columns down the platform centerline, offset by distance-from-center bucket (so the
  // zigzag stays mirror-symmetric north/south) - the real cover-defining feature of this map
  function makeColumn(x, z){
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, wallH - 1.5, 10), columnMat);
    col.position.set(x, groundHeightAt(x, z) + (wallH - 1.5) / 2, z);
    col.castShadow = true; col.receiveShadow = true;
    scene.add(col);
    addBox(col);
    addContactShadow(x, z, 1.6);
  }
  [-30, -20, -10, 0, 10, 20, 30].forEach(z => {
    const bucket = Math.round(Math.abs(z) / 10);
    makeColumn(bucket % 2 === 0 ? -1.8 : 1.8, z);
  });

  // parked train car in the pit, centered so both spawns have equal access to it as pit cover -
  // built directly rather than through makeBoxProp since each face needs its own texture: tiled
  // door/window side panels on the long faces, brushed metal on the roof, and the real train-front
  // render capping both ends (both ends get the same front render - it reads as a stopped unit
  // blocking the track in both directions, not a single car with one modeled end)
  const trainW = 5.2, trainH = 3.0, trainD = 34;
  const trainGeo = new THREE.BoxGeometry(trainW, trainH, trainD);
  const trainMesh = new THREE.Mesh(trainGeo, [trainSideMat, trainSideMat, trainRoofMat, trainRoofMat, trainFrontMat, trainFrontMat]);
  trainMesh.position.set(13, groundHeightAt(13, 0) + trainH / 2, 0);
  trainMesh.castShadow = true; trainMesh.receiveShadow = true;
  scene.add(trainMesh);
  addBox(trainMesh);

  // wall benches, mirrored north/south - backX is the backrest's position, flush against the
  // west wall's inner face; the bench's long axis runs along z (parallel to the wall) since that's
  // the direction the wall itself runs, not along x
  function makeBench(backX, z){
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.85 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.6 });
    const seatX = backX + 0.35;
    const baseY = groundHeightAt(seatX, z);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 2.6), seatMat);
    seat.position.set(seatX, baseY + 0.5, z);
    seat.castShadow = true; seat.receiveShadow = true;
    scene.add(seat); addBox(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 2.6), seatMat);
    back.position.set(backX, baseY + 0.85, z);
    back.castShadow = true;
    scene.add(back); addBox(back);
    [[-0.25, -1.15], [-0.25, 1.15], [0.25, -1.15], [0.25, 1.15]].forEach(([dx, dz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), legMat);
      leg.position.set(seatX + dx, baseY + 0.25, z + dz);
      scene.add(leg);
    });
    addContactShadow(seatX, z, 1.8);
  }
  [-30, -12, 12, 30].forEach(z => makeBench(westX + wallThk / 2 + 0.05, z));

  // station name plates on the west wall, and hanging exit signs above each spawn end
  const signMat = new THREE.MeshStandardMaterial({ map: stationSignTexture('SUBWAY'), roughness: 0.6 });
  [-25, 0, 25].forEach(z => {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 2.4), signMat);
    plate.rotation.y = Math.PI / 2;
    plate.position.set(westX + 0.55, 3.2, z);
    scene.add(plate);
  });
  const exitMat = new THREE.MeshStandardMaterial({ map: exitSignTexture(), emissive: 0x0d4d1f, emissiveIntensity: 0.6, roughness: 0.4 });
  [-halfLen + 3, halfLen - 3].forEach(z => {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.15), exitMat);
    sign.position.set(0, wallBaseY + wallH - 1.3, z);
    scene.add(sign);
  });

  // a few maintenance crates/drums for close-range cover near each spawn - lighter touch than
  // Desert/Warehouse since columns and the train car now carry most of the map's cover
  const jit = n => (mapRandom() - 0.5) * n;
  function addBarrel(x, z){
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 12), barrelMat);
    barrel.position.set(x, groundHeightAt(x, z) + 0.8, z);
    barrel.castShadow = true; barrel.receiveShadow = true;
    scene.add(barrel);
    addBox(barrel);
  }
  [-33, 33].forEach(z => {
    makeBoxProp(-3 + jit(1.5), z + jit(2), 1.6, 1.6, 1.6, crateMat);
    makeBoxProp(3 + jit(1.5), z + jit(2), 1.6, 1.6, 1.6, crateMat);
    addBarrel(-6 + jit(1.5), z * 0.9 + jit(2));
  });

  const spawnZoneA = { xMin: -7, xMax: 6, zMin: -40, zMax: -33 };
  const spawnZoneB = { xMin: -7, xMax: 6, zMin: 33, zMax: 40 };

  return {
    spawn: new THREE.Vector3(0, 2, -36),
    tSpawn: new THREE.Vector3(0, 2, -36),
    ctSpawn: new THREE.Vector3(0, 2, 36),
    tSpawnZone: spawnZoneA,
    ctSpawnZone: spawnZoneB,
    sites: [],
    ffa: SUBWAY_FFA_LAYOUT
  };
}

// picks a random point inside a map's spawn zone when one is defined (arena), otherwise falls
// back to the fixed spawn point every other map still uses
function getTeamSpawnPos(meta, team){
  const zone = team === 'A' ? meta.tSpawnZone : meta.ctSpawnZone;
  if (zone) {
    // crate/barrel positions are randomized per match (see buildWarehouseMap/buildSubwayMap's
    // jitter), so a spawn zone that was clear last game can have a prop sitting in it this time -
    // retry a handful of random spots and skip any that land inside a collider, rather than
    // trapping the player inside a crate the moment they spawn
    const point = findClearSpawn(zone, (x, z) => {
      const feet = groundHeightAt(x, z);
      const bounds = new THREE.Box3(new THREE.Vector3(x - 0.6, feet + 0.02, z - 0.6),
        new THREE.Vector3(x + 0.6, feet + player.height, z + 0.6));
      return colliders.some(box => bounds.intersectsBox(box));
    });
    if (!point) throw new Error('Map spawn zone has no safe standing position');
    return new THREE.Vector3(point.x, 2, point.z);
  }
  return (team === 'A' ? meta.tSpawn : meta.ctSpawn).clone();
}

// yaw that faces the player from their spawn toward the middle of the arena (and the opposing
// team) instead of leaving them at whatever yaw they happened to have before - without this,
// team A always spawned staring straight into the wall behind their own spawn
function getSpawnYaw(team){
  return team === 'A' ? Math.PI : 0;
}


// ---------- Map: Skyline (industrial rooftop) ----------
// A compact vertical-feeling rooftop arena: a central service block creates two lanes,
// parapets provide readable boundaries, and HVAC units/vents create close-range cover.
function buildSkylineMap(){
  WORLD_SIZE = 72;
  sky.material.map = desertSkyGradientTexture(); sky.material.needsUpdate = true;
  scene.fog.color.set(0x667687); scene.fog.density = 0.0022;
  hemi.color.set(0xaac3d8); hemi.groundColor.set(0x26313d); hemi.intensity = 0.95;
  sun.color.set(0xffd4a0); sun.intensity = 1.15;
  fillLight.color.set(0x91b7d9); fillLight.intensity = 0.42;

  const half = 33, wallH = 2.4, wallThk = 1.1;
  groundHeightAt = () => 0;
  // Keep Skyline self-contained: canvas textures work even on browsers that reject AVIF/JPG
  // decoding or when the game is opened directly from a local file instead of a web server.
  const floorTex = metalScratchTexture('#737d83'); floorTex.repeat.set(18, 18);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, color: 0xb0b5b5 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor); floorMeshes.push(floor);

  const parapetTex = metalScratchTexture('#4f5b63'); parapetTex.repeat.set(10, 1);
  const parapetMat = new THREE.MeshStandardMaterial({ map: parapetTex, roughness: 0.86, color: 0xa5afb5 });
  [[0, -half, half * 2, wallH, wallThk], [0, half, half * 2, wallH, wallThk], [-half, 0, wallThk, wallH, half * 2], [half, 0, wallThk, wallH, half * 2]].forEach(([x, z, w, h, d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), parapetMat);
    wall.position.set(x, h / 2, z); wall.castShadow = true; wall.receiveShadow = true; scene.add(wall); addBox(wall);
  });
  addPerimeterWalls();

  const concreteTex = metalScratchTexture('#59636a'); concreteTex.repeat.set(3, 2);
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.74, color: 0xb3bbc0 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 0.9 });
  const crateTex = woodGrainTexture('#8b5f38', 3); crateTex.repeat.set(1, 1);
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9, color: 0xd0a06d });
  crateMat.userData.penetrable = true; crateMat.userData.minimapProp = true;
  concreteMat.userData.minimapProp = true;

  // Four usable entrances replace the sealed central box. A service core breaks
  // the direct spawn-to-spawn sightline while allowing rotations around it.
  for (const side of [-1, 1]) {
    makeBoxProp(-4.9, side * 3.8, 6.2, 2.8, 1.2, concreteMat);
    makeBoxProp(4.9, side * 3.8, 6.2, 2.8, 1.2, concreteMat);
    makeBoxProp(side * 7.4, -2.5, 1.2, 2.8, 1.8, concreteMat);
    makeBoxProp(side * 7.4, 2.5, 1.2, 2.8, 1.8, concreteMat);
  }
  makeBoxProp(0, 0, 2.4, 2.1, 2.4, concreteMat);
  [[-20, -18], [20, -18], [-20, 18], [20, 18]].forEach(([x, z]) => makeBoxProp(x, z, 3.2, 2.1, 3.2, crateMat));
  [[-13, -13], [13, -13], [-13, 13], [13, 13], [-25, 0], [25, 0]].forEach(([x, z]) => makeBoxProp(x, z, 2.2, 1.5, 2.2, concreteMat));

  // hazard stripes around the service block make the playable lanes legible from first spawn
  [[0, -5.35, 16, 0.45], [0, 5.35, 16, 0.45]].forEach(([x, z, w, d]) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hazardMat);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0.025, z); strip.material.map.repeat.set(4, 1); scene.add(strip);
  });

  // rooftop beacons and a soft central pool of light give Skyline a distinct night-match identity
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff3d32, emissive: 0xff1c16, emissiveIntensity: 1.6 });
  [[-27, -27], [27, -27], [-27, 27], [27, 27]].forEach(([x, z]) => {
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.5, 8), beaconMat);
    beacon.position.set(x, wallH + 0.75, z); scene.add(beacon);
    const light = new THREE.PointLight(0xff3328, 1.6, 10, 2); light.position.set(x, wallH + 1.2, z); scene.add(light);
  });
  const centerLight = new THREE.PointLight(0x9fc8ff, 3.5, 24, 2); centerLight.position.set(0, 7, 0); scene.add(centerLight);

  const spawnZoneA = { xMin: -22, xMax: 22, zMin: -29, zMax: -23 };
  const spawnZoneB = { xMin: -22, xMax: 22, zMin: 23, zMax: 29 };
  return {
    spawn: new THREE.Vector3(0, 2, -26), tSpawn: new THREE.Vector3(0, 2, -26), ctSpawn: new THREE.Vector3(0, 2, 26),
    tSpawnZone: spawnZoneA, ctSpawnZone: spawnZoneB, sites: []
  };
}

function buildOfficeMap(){
  WORLD_SIZE = 74;
  groundHeightAt = () => 0;
  sky.material.map = desertSkyGradientTexture(); sky.material.needsUpdate = true;
  scene.fog.color.set(0xdde5e8); scene.fog.density = 0.001;
  hemi.color.set(0xeaf4f7); hemi.groundColor.set(0x777b78); hemi.intensity = 1.45;
  sun.color.set(0xfff4df); sun.intensity = 0.85;
  fillLight.color.set(0xdcecff); fillLight.intensity = 0.75;
  return buildOffice({ scene, floorMeshes, addBox, loadTiledTexture });
}

function buildFoundryMap(){
  WORLD_SIZE = 58;
  groundHeightAt = () => 0;
  sky.material.map = desertSkyGradientTexture(); sky.material.needsUpdate = true;
  scene.fog.color.set(0x829796); scene.fog.density = 0.003;
  hemi.color.set(0xc9e6e5); hemi.groundColor.set(0x424039); hemi.intensity = 1.05;
  sun.color.set(0xffdeba); sun.intensity = 1.3;
  fillLight.color.set(0xa6c9da); fillLight.intensity = 0.45;
  return buildFoundry({ scene, floorMeshes, addBox, makeBoxProp, loadTiledTexture, hazardStripeTexture });
}

function buildFreeForAllMap(id){
  applyDesertAtmosphere();
  if (id === 'mall') {
    WORLD_SIZE=80;groundHeightAt=()=>0;
    hemi.color.set(0xe3eaf2);hemi.groundColor.set(0x8c8174);hemi.intensity=1.35;
    sun.color.set(0xffedda);sun.intensity=.7;fillLight.intensity=.55;scene.fog.density=0;
    return buildMall({scene,addBox,floorMeshes,envMeshes});
  }
  if (id === 'ski') {
    const L = FFA_MAPS.ski;
    WORLD_SIZE = Math.max(L.halfWidth, L.halfDepth) * 2 + 10;
    // A gentle, continuous downhill grade along z (north high, south low), plus a little rolling
    // relief so the piste doesn't read as a perfectly flat ramp.
    const skiSlope = (x, z) => Math.min(1, Math.max(0, (z + L.halfDepth) / (L.halfDepth * 2))) * SKI_DROP;
    const skiBumps = (x, z) => Math.sin(x * 0.28) * Math.cos(z * 0.31) * 0.28 + Math.sin(x * 0.12 + z * 0.17) * 0.18;
    // The relief makes the doorway unwalkable if the café itself isn't standing on a flat pad, so
    // the ground flattens to the building's own reference height under and just around it (a wider
    // smooth blend margin beyond that), the same "plateau with a margin" idiom used by Arena/Skyline.
    const cafeFlatHeight = skiSlope(SKI_CAFE.x, SKI_CAFE.z);
    const cafePadHalfW = SKI_CAFE.w / 2 + 3, cafePadHalfD = SKI_CAFE.d / 2 + 3, cafePadMargin = 6;
    groundHeightAt = (x, z) => {
      const natural = skiSlope(x, z) + skiBumps(x, z);
      const dx = Math.max(0, Math.abs(x - SKI_CAFE.x) - cafePadHalfW);
      const dz = Math.max(0, Math.abs(z - SKI_CAFE.z) - cafePadHalfD);
      const t = Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / cafePadMargin);
      const flatten = t * t * (3 - 2 * t);
      return natural * (1 - flatten) + cafeFlatHeight * flatten;
    };
    hemi.color.set(0xeaf6ff); hemi.groundColor.set(0xc7d6d2); hemi.intensity = 1.3;
    sun.color.set(0xfff7e8); sun.intensity = 1.7;
    fillLight.intensity = 0.6; scene.fog.color.set(0xdfeef4); scene.fog.density = 0.0011;
  } else {
    WORLD_SIZE = 76; groundHeightAt = () => 0;
    hemi.color.set(0xd9eee7); hemi.groundColor.set(0x616b65); hemi.intensity = 1.15;
    sun.color.set(id === 'dockyard' ? 0xffd5a5 : 0xfff1d8); sun.intensity = 1.45;
    fillLight.intensity = 0.6; scene.fog.color.set(0xb8cbc8); scene.fog.density = 0.002;
  }
  return buildFfaMap(id, {scene, floorMeshes, addBox, loadTiledTexture, groundHeightAt});
}

const MAPS = {
  mall: { name: 'Mall', ffa: true, build: () => buildFreeForAllMap('mall') },
  dockyard: { name: 'Dockyard', ffa: true, build: () => buildFreeForAllMap('dockyard') },
  atrium: { name: 'Atrium', ffa: true, build: () => buildFreeForAllMap('atrium') },
  ski: { name: 'Ski Station', ffa: true, build: () => buildFreeForAllMap('ski') },
  arena: { name: 'Desert', build: buildArenaMap },
  warehouse: { name: 'Warehouse', build: buildWarehouseMap },
  subway: { name: 'Subway', build: buildSubwayMap, dualFfa: true },
  skyline: { name: 'Skyline', build: buildSkylineMap },
  foundry: { name: 'Foundry', build: buildFoundryMap },
  office: { name: 'Office', build: buildOfficeMap, dualFfa: true }
};
let selectedMap = 'arena';

let currentMapMeta = null;
let persistentSceneObjects = null;
function buildMap(id){
  playerLabels.clear();
  impactMarks.clear();
  combatMotion.reset();
  // Dispose transient allocations before removing scene children on a rematch.
  particles.forEach(p => { if (p.type !== 'casing') p.obj.material.dispose(); });
  bulletTracers.forEach(t => { t.line.geometry.dispose(); t.line.material.dispose(); });
  decals.forEach(d => d.mesh.material.dispose());
  if (!persistentSceneObjects) persistentSceneObjects = new Set(scene.children);
  else {
    // Keep sky, global lights and the camera; remove the previous arena and effects.
    const geometries = new Set();
    for (const object of [...scene.children]) {
      if (persistentSceneObjects.has(object)) continue;
      scene.remove(object);
      if (object.userData.preserveResources) {
        object.traverse(child => { if (child.isInstancedMesh) child.dispose(); });
        continue;
      }
      object.traverse(child => {
        if (child.isInstancedMesh) child.dispose();
        if (child.geometry) geometries.add(child.geometry);
        if (child.userData.disposeMapMaterial) { child.material.map?.dispose(); child.material.dispose(); }
        // Maps and actors share materials/textures: retain those caches across matches.
      });
    }
    geometries.forEach(geometry => geometry.dispose());
    colliders.length = 0; envMeshes.length = 0; floorMeshes.length = 0;
    enemies.length = 0; particles.length = 0; grenades.length = 0;
    activeSmokes.length = 0; bulletTracers.length = 0; decals.length = 0;
    thrownKnives.length = 0;
    graffitiDecals.forEach(decal => decal.mat.dispose());
    graffitiDecals.length = 0;
  }
  mapRandom = seededRandom(({ arena: 47, warehouse: 91, subway: 137, skyline: 211, foundry: 317, dockyard: 401, atrium: 503, ski: 601, mall: 719 })[id]);
  const result = MAPS[id].build();
  refineWorldMaterials(envMeshes.concat(floorMeshes), id);
  addWorldDetail(scene, envMeshes, id);
  addMapFinish(scene, id, groundHeightAt);
  currentMapMeta = result;
  player.pos.copy(result.spawn);
  player.pos.y = groundHeightAt(result.spawn.x, result.spawn.z) + player.height;
  player.velY = 0;
  player.onGround = false; // force a fresh multi-level support resolve next frame instead of trusting a stale groundLevel
  camera.position.copy(player.pos);
}

// ============================================================
// PLAYER
// ============================================================
const player = {
  pos: new THREE.Vector3(0, 2, 20),
  velY: 0,
  onGround: true,
  groundLevel: 0, // last resolved multi-level support height (Mall) - a stable hysteresis anchor, see updatePlayer
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
const movementVelocity = new THREE.Vector3();
let jumpWasDown = false;
let crouchWasDown = false;
camera.position.copy(player.pos);
camera.fov = baseFov;

// flashbang whiteout state (see detonateFlash) - playerFlashT counts down to 0, playerFlashMax is
// whatever it was set to on the hit that's currently fading, used to compute the overlay's opacity
let playerFlashT = 0, playerFlashMax = 0;

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
  deagle: buildSprayPattern(7, 0.026, 0.008, 2),
  tec9: buildSprayPattern(18, 0.009, 0.004, 3),
  duals: buildSprayPattern(30, 0.008, 0.004, 3),
  awp: buildSprayPattern(5, 0.03, 0.01, 2)
};

// ---------- Weapon system: definitions, inventory, per-weapon visuals ----------
const WEAPONS = {
  knife:  { name: 'Knife', slot: 'melee', price: 0, dmg: 55, range: 2.4, fireRate: 0.45 },
  glock:  { name: 'Glock-18', slot: 'secondary', price: 250, dmg: 13, mag: 20, reserve: 60, fireRate: 0.15, range: 100, reloadDuration: 1.3, zoomFov: 55, kickPush: 0.035, kickTilt: 0.05 },
  deagle: { name: 'Desert Eagle', slot: 'secondary', price: 650, dmg: 42, mag: 7, reserve: 35, fireRate: 0.3, range: 130, reloadDuration: 1.6, zoomFov: 52, kickPush: 0.07, kickTilt: 0.09 },
  tec9:   { name: 'Tec-9', slot: 'secondary', price: 450, dmg: 17, mag: 18, reserve: 72, fireRate: 0.11, range: 90, reloadDuration: 1.4, zoomFov: 58, kickPush: 0.03, kickTilt: 0.045 },
  duals:  { name: 'Duales Beretta', slot: 'secondary', price: 750, dmg: 16, mag: 30, reserve: 120, fireRate: 0.12, range: 90, reloadDuration: 1.7, zoomFov: 60, kickPush: 0.03, kickTilt: 0.045 },
  ak47:   { name: 'AK-47', slot: 'primary', price: 2500, dmg: 34, mag: 30, reserve: 90, fireRate: 0.1, range: 150, reloadDuration: 1.7, zoomFov: 48, kickPush: 0.05, kickTilt: 0.07 },
  m4a4:   { name: 'M4A4', slot: 'primary', price: 2900, dmg: 31, mag: 30, reserve: 90, fireRate: 0.095, range: 150, reloadDuration: 1.65, zoomFov: 48, kickPush: 0.045, kickTilt: 0.06 },
  m4a1:   { name: 'M4A1-S', slot: 'primary', price: 2750, dmg: 35, mag: 20, reserve: 80, fireRate: 0.11, range: 150, reloadDuration: 1.6, zoomFov: 45, kickPush: 0.04, kickTilt: 0.055 },
  awp:    { name: 'AWP', slot: 'primary', price: 4500, dmg: 115, mag: 5, reserve: 30, fireRate: 1.35, range: 320, reloadDuration: 2.4, zoomFov: 12, scope: true, scopeFov2: 5, kickPush: 0.15, kickTilt: 0.2, boltAction: true },
  grenade:{ name: 'Grenade', slot: 'grenade', price: 350, dmg: 130, radius: 9, fireRate: 0.8 },
  smoke:  { name: 'Smoke Grenade', slot: 'smoke', price: 300, radius: 10, duration: 14, fireRate: 0.8 },
  // radius is the max effective range of the blind, duration is how long a point-blank (distance
  // 0, full line of sight) hit lasts - both taper to 0 by the time you reach the edge of radius
  flash:  { name: 'Flashbang', slot: 'flash', price: 200, radius: 13, duration: 3.4, fireRate: 0.8 }
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
let knifeAvailable = true;
let knifeCount = 1;
let selectedRuleset = 'standard';
const isFfa = () => selectedRuleset === 'ffa';
const ffaState = { phase: 'waiting', timer: FFA.warmup, sendT: 0, active: false, bots: new Map(), navigation: null, respawnT: 0, protection: 0, serial: 0, resultShown: false };
// Host-chosen kill/time limits, picked from the room-control panel before creating a room and
// synced to clients via broadcastRoster(). Infinity means "unlimited" - comparisons against it
// (kills>=Infinity, timer<=0) naturally never trigger, so nothing else needs a special case
// beyond display (see formatRoundTime) and the wire format (Infinity doesn't serialize, so 0
// stands in for it in roster messages - see broadcastRoster/handleNetMessage's 'roster' case).
let ffaKillGoal = FFA.goal, ffaTimeLimit = FFA.duration;
const weaponPrice = def => isFfa() ? 0 : def.price;
function knifeCapacity(){ return selectedRuleset === 'knife' && gameMode === 'pvp' ? 5 : 1; }
function resetKnifeSupply(){ knifeCount = knifeCapacity(); knifeAvailable = true; }
const ammoState = {}; // slot -> { mag, reserve }
let currentSlot = 'melee';
let lastSlot = 'melee';
let money = 1000;
const MAX_GRENADES = 3;
let grenadeCount = 0;
const MAX_SMOKES = 2;
let smokeCount = 0;
const MAX_FLASHES = 2;
let flashCount = 0;

const weaponGroup = new THREE.Group();
// First-person weapon proportions: the previous procedural meshes were technically small in
// world units but appeared oversized at the camera because the whole group sat too close to the
// lens. This scale and offset restore a believable shoulder-mounted framing.
weaponGroup.scale.setScalar(0.78);
weaponGroup.position.set(0.015, -0.015, 0.04);
camera.add(weaponGroup);
scene.add(camera);

const weaponMetalBump = metalBumpTexture();
const weaponWoodBump = woodBumpTexture();
const goldWeaponMat = new THREE.MeshPhysicalMaterial({
  map: loadTiledTexture('assets/textures/gold.png', 1.2, 2.2),
  bumpMap: weaponMetalBump,
  bumpScale: 0.0008,
  roughness: 0.3,
  metalness: 0.88
});
const goldTexture = goldWeaponMat.map;
const luxuryTexture = loadTiledTexture('assets/luxury_skin.png', 1.4, 1.4);
const pinkSiberianTexture = loadTiledTexture('assets/pink_siberian.png', 3, 3);
const greekGodsTexture = loadTiledTexture('assets/greek.png', 1.4, 1.4);
const founderTexture = loadTiledTexture('assets/founder.png', 1.4, 1.4);
const samuraiTexture = loadTiledTexture('assets/samurai.png', 1.4, 1.4);
let founderEntitled = false; 
let founderStatus = 'FOUNDER ACCESS: SIGN IN REQUIRED';
const SKIN_CATALOG = {
  founder: { name: 'First Light · 001', meta: 'FOUNDER EXCLUSIVE · Obsidian / gold inlay', preview: 'founder', color: 0xffffff, roughness: 0.3, metalness: 0.82 },
  gold: { name: 'Gold Standard', meta: 'Metallic gold · equipped by default', preview: 'gold', owned: true, color: 0xffffff, roughness: 0.3, metalness: 0.88 },
  carbon: { name: 'Carbon Black', meta: 'Brushed tactical carbon', preview: 'carbon', owned: true, color: 0x63707a, roughness: 0.42, metalness: 0.78 },
  crimson: { name: 'Crimson Core', meta: 'Red alloy · prototype finish', preview: 'crimson', owned: true, color: 0xd23a32, roughness: 0.34, metalness: 0.84 },
  luxury: { name: 'Luxury', meta: 'Black & gold marble finish', preview: 'luxury', owned: true, color: 0xffffff, roughness: 0.2, metalness: 0.5 },
  pinkSiberian: { name: 'Pink Siberian', meta: 'Pink digital camo · matte finish', preview: 'pinkSiberian', owned: true, color: 0xffffff, roughness: 0.55, metalness: 0.12 },
  greekGods: { name: 'Greek Gods', meta: 'Mythical bronze · divine finish', preview: 'greekGods', owned: true, color: 0xffffff, roughness: 0.3, metalness: 0.8 },
  samurai: { name: 'Samurai', meta: 'ULTRA RARE · Koi / Sakura / Gold', preview: 'samurai', owned: true, color: 0xffffff, roughness: 0.3, metalness: 0.8 }
};
const PROFILE_STORAGE_KEY = 'lastRoundProfile';
let cloudAccount = null;
let cloudProfileActive = false;
// Every gun that builds its skinnable parts from a material (see buildWeaponVisual) gets its own
// equipped skin instead of one finish shared across the whole armory.
// Only the guns whose model actually builds skinnable parts from a shared material in
// buildWeaponVisual's switch - knife/grenade/smoke/flash are utility items with no finish to equip.
const WEAPON_SKIN_IDS = ['glock', 'deagle', 'tec9', 'duals', 'ak47', 'm4a4', 'm4a1', 'awp'];
// A factory, not a shared object literal: `{...DEFAULT_PROFILE}` only shallow-copies, so every
// caller used to get the SAME nested equippedSkins object - equipping a skin silently mutated
// "the default" itself, and any later `{...defaultProfile(), ...somethingWithNoSkins}` merge
// picked up that leftover mutation instead of a clean gold baseline.
function defaultProfile(){
  return { name: 'Player', country: '', clan: '', rating: 1000, wins: 0, losses: 0, matches: 0,
    equippedSkins: Object.fromEntries(WEAPON_SKIN_IDS.map(id => [id, 'gold'])) };
}
// Fills in any weapon missing a valid skin id (unset, or not in SKIN_CATALOG) with `fallback` -
// used both for a fresh/partial local save and for whatever a cloud profile sends back.
function sanitizeEquippedSkins(source, fallback = 'gold'){
  const skins = source && typeof source === 'object' ? source : {};
  const legacy = SKIN_CATALOG[fallback] ? fallback : 'gold';
  const out = {};
  for (const id of WEAPON_SKIN_IDS) out[id] = SKIN_CATALOG[skins[id]] ? skins[id] : legacy;
  return out;
}
// Founder entitlement comes from the authenticated database RPC, never guest storage.
let playerProfile = defaultProfile();
try {
  const savedProfile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || 'null');
  if (savedProfile && typeof savedProfile === 'object') playerProfile = { ...defaultProfile(), ...savedProfile };
} catch (err) { /* local storage can be disabled in private browsing */ }
// Migrate the old single shared-skin field into the new per-weapon map - everything used to
// equip whatever that one field named - and backfill any weapon a save is missing.
playerProfile.equippedSkins = sanitizeEquippedSkins(playerProfile.equippedSkins, playerProfile.equippedSkin);
delete playerProfile.equippedSkin;
playerProfile.isFounder = false;
function savePlayerProfile(){
  if (!cloudProfileActive) {
    try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(playerProfile)); } catch (err) { /* keep this session usable */ }
  }
  cloudAccount?.save();
}
function profileRank(rating){
  if (rating >= 1800) return 'ELITE';
  if (rating >= 1500) return 'MASTER';
  if (rating >= 1250) return 'VETERAN';
  if (rating >= 1000) return 'ROOKIE';
  return 'RECRUIT';
}
// Each gun gets its own clone of the shared template material instead of every weapon fighting
// over one mutable goldWeaponMat, so equipping a finish on the AK-47 no longer reskins the AWP too.
const weaponSkinMats = {};
function weaponSkinMat(id){
  if (!weaponSkinMats[id]) weaponSkinMats[id] = goldWeaponMat.clone();
  return weaponSkinMats[id];
}
function skinTexture(preview){
  return preview === 'founder' ? founderTexture : preview === 'gold' ? goldTexture
    : preview === 'luxury' ? luxuryTexture : preview === 'pinkSiberian' ? pinkSiberianTexture
    : preview === 'greekGods' ? greekGodsTexture : preview === 'samurai' ? samuraiTexture : null;
}
// weaponId: re-apply just that weapon's stored skin (e.g. right after equipping it in the
// inventory). Omitted: re-apply every weapon's - used once at startup.
function applyEquippedSkin(weaponId){
  for (const id of weaponId ? [weaponId] : WEAPON_SKIN_IDS) {
    if (playerProfile.equippedSkins[id] === 'founder' && !founderEntitled) playerProfile.equippedSkins[id] = 'gold';
    const skin = SKIN_CATALOG[playerProfile.equippedSkins[id]] || SKIN_CATALOG.gold;
    const mat = weaponSkinMat(id);
    mat.map = skinTexture(skin.preview);
    mat.clearcoat = skin.preview === 'founder' ? 0.4 : 0;
    mat.clearcoatRoughness = 0.26;
    mat.color.setHex(skin.color);
    mat.roughness = skin.roughness;
    mat.metalness = skin.metalness;
    mat.needsUpdate = true;
    // The AWP's chassis/handguard/cheek riser use their own material (distinct bump map for the
    // polymer-stock look) instead of its skin material, so they need the same values copied over
    // by hand or they stay stuck on the default camo regardless of the AWP's equipped skin.
    if (id === 'awp') {
      awpStockMat.map = mat.map;
      awpStockMat.color.copy(mat.color);
      awpStockMat.roughness = skin.roughness;
      awpStockMat.metalness = skin.metalness;
      awpStockMat.needsUpdate = true;
    }
  }
}
const gunMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#1c1c1c'), bumpMap: weaponMetalBump, bumpScale: 0.0006, roughnessMap: weaponMetalBump, roughness: 0.7, metalness: 0.4 });
const gunMatLight = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#33352f'), bumpMap: weaponMetalBump, bumpScale: 0.0006, roughnessMap: weaponMetalBump, roughness: 0.75, metalness: 0.35 });
const woodMat = new THREE.MeshStandardMaterial({ map: woodGrainTexture('#5a3d24'), bumpMap: weaponWoodBump, bumpScale: 0.001, roughness: 0.6 });
const akWoodMat = new THREE.MeshStandardMaterial({ map: woodGrainTexture('#8f5a2e', 3), bumpMap: weaponWoodBump, bumpScale: 0.0012, roughness: 0.58, metalness: 0.02 }); // visible laminate furniture, not an unreadable black blob
const akMetalMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#50575a'), bumpMap: weaponMetalBump, bumpScale: 0.0012, roughness: 0.42, metalness: 0.72 }); // parkerized steel with highlights that survive the FPS lighting
const pistolMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#24241f'), bumpMap: weaponMetalBump, bumpScale: 0.0006, roughnessMap: weaponMetalBump, roughness: 0.6, metalness: 0.45 });
const awpStockMat = new THREE.MeshStandardMaterial({ map: camoTexture(['#6f6f6e', '#555555', '#989b95', '#4d4f4d']), bumpMap: weaponWoodBump, bumpScale: 0.0006, roughness: 0.72, metalness: 0.04 }); // textured olive precision-rifle polymer stock
const scopeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#202625'), bumpMap: weaponMetalBump, bumpScale: 0.0008, roughness: 0.32, metalness: 0.82 });
const scopeGlassMat = new THREE.MeshStandardMaterial({ color: 0x173e4c, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.88, emissive: 0x06252f, emissiveIntensity: 0.65 });
const chromeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#d4d4d4'), bumpMap: weaponMetalBump, bumpScale: 0.0004, roughness: 0.2, metalness: 0.95 }); // bright polished slide finish, for the Berettas
const deagleMat = chromeMat; // brushed stainless finish, matching the real Desert Eagle's signature silver slide
const skinMat = new THREE.MeshStandardMaterial({ color: 0xb98862, roughness: 0.8 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3a3a35, roughness: 0.9 });
const camoGreenMat = new THREE.MeshStandardMaterial({ map: camoTexture(['#2f3a1e', '#5a6b34', '#1c2412', '#0d0d0d']), roughness: 0.8 });
const bladeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#b23a3a'), bumpMap: metalBumpTexture(), bumpScale: 0.001, roughness: 0.25, metalness: 0.85 });
const handleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.55 });
const knifeHandleMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, bumpMap: checkeredGripTexture(), bumpScale: 0.0004, roughness: 0.75 });
const grenadeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#384a24'), bumpMap: weaponMetalBump, bumpScale: 0.0008, roughnessMap: weaponMetalBump, roughness: 0.65, metalness: 0.15 });
const smokeGrenadeMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#8a8f88'), bumpMap: weaponMetalBump, bumpScale: 0.0008, roughnessMap: weaponMetalBump, roughness: 0.6, metalness: 0.2 });
applyEquippedSkin(); // now that awpStockMat (and every other skinnable material) exists
const flashMat = new THREE.MeshStandardMaterial({ map: metalScratchTexture('#d8d8d0'), bumpMap: weaponMetalBump, bumpScale: 0.0008, roughnessMap: weaponMetalBump, roughness: 0.35, metalness: 0.55 });

// weapon aim position (hip vs ADS)
const hipPos = new THREE.Vector3(0, 0, 0);
const adsPos = new THREE.Vector3(-0.24, -0.02, 0.18);

// muzzle flash light + sprite (re-parented onto whichever weapon is equipped)
const flashLight = new THREE.PointLight(0xffcc66, 0, 8);
const flashSpriteMat = new THREE.SpriteMaterial({ map: softDiscTexture('rgba(255,230,150,1)'), transparent: true, depthWrite: false, opacity: 0 });
const flashSprite = new THREE.Sprite(flashSpriteMat);
flashSprite.scale.set(0.4, 0.4, 1);

let currentVisual = null; // { group, magazine, chargingHandle, magRestY, chargeRestX, muzzle, knifeParts }

// Weapon silhouettes are read at a few centimetres from the camera. Rounded receivers and
// stocks remove the toy-like CAD look of raw BoxGeometry while keeping the models procedural,
// lightweight and license-independent.
function weaponBox(width, height, depth, material, radius = 0.018){
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, Math.min(radius, width / 3, height / 3, depth / 3)), material);
  mesh.castShadow = true;
  return mesh;
}

function buildWeaponVisual(id){
  const group = new THREE.Group();
  let magazine = null, chargingHandle = null, muzzle = new THREE.Vector3(0.24, -0.185, -1.0), knifeParts = null, boltHandle = null;
  // Every skinnable part below is built with this one weapon's own material, not the shared
  // template, so each gun keeps its own independently-equipped finish (see applyEquippedSkin).
  const skinMat = weaponSkinMat(id);

  function rifleModel(magLen, stockLen, barrelLen, mat){
    const receiver = weaponBox(0.09, 0.11, 0.5, skinMat, 0.018);
    receiver.position.set(0.24, -0.2, -0.42);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, barrelLen, 16), gunMatLight);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.24, -0.185, -0.55 - barrelLen / 2);
    const stock = weaponBox(0.08, 0.09, stockLen, mat, 0.02);
    stock.position.set(0.24, -0.23, -0.05);
    magazine = weaponBox(0.055, magLen, 0.09, skinMat, 0.014);
    magazine.position.set(0.24, -0.2 - magLen / 2, -0.42);
    const sightPost = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.015), gunMatLight);
    sightPost.position.set(0.24, -0.13, -0.55 - barrelLen * 0.7);
    chargingHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.06), gunMatLight);
    chargingHandle.position.set(0.19, -0.19, -0.3);
    const grip = weaponBox(0.06, 0.16, 0.06, gunMat, 0.016);
    grip.position.set(0.24, -0.32, -0.2);
    grip.rotation.x = 0.2;
    group.add(receiver, barrel, stock, magazine, sightPost, chargingHandle, grip);
    muzzle.set(0.24, -0.185, -0.55 - barrelLen);
  }

  function pistolModel(mat, bodyLen, magLen, big){
    const body = weaponBox(big ? 0.1 : 0.07, 0.13, bodyLen, skinMat, 0.02);
    body.position.set(0.22, -0.22, -0.35);
    const gripM = weaponBox(0.06, 0.16, 0.07, handleMat, 0.018);
    gripM.position.set(0.22, -0.34, -0.22);
    gripM.rotation.x = 0.15;
    magazine = weaponBox(0.04, magLen, 0.05, skinMat, 0.012);
    magazine.position.set(0.22, -0.38, -0.24);
    group.add(body, gripM, magazine);
    muzzle.set(0.22, -0.22, -0.35 - bodyLen / 2);
  }

  // Beretta-style pistol: dark frame, a bright chrome slide, wood grip panels and an exposed
  // hammer - used for the duals (each one cloned and mirrored onto the other hand)
  function berettaModel(bodyLen, magLen){
    const frame = weaponBox(0.062, 0.11, bodyLen, gunMat, 0.016);
    frame.position.set(0.22, -0.225, -0.34);
    const slide = weaponBox(0.058, 0.055, bodyLen + 0.04, skinMat, 0.014);
    slide.position.set(0.22, -0.165, -0.36);
    const grip = weaponBox(0.058, 0.155, 0.075, woodMat, 0.016);
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
    magazine = weaponBox(0.04, magLen, 0.05, skinMat, 0.012);
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
      // built from scratch instead of the shared pistolModel() box - the real Desert Eagle's
      // silhouette is a distinct two-tier stack (a slim lower frame + a taller, wider slide sitting
      // above it), which a single flat box can never read as no matter what's bolted onto it
      const frame = weaponBox(0.085, 0.09, 0.4, skinMat, 0.02);
      frame.position.set(0.22, -0.245, -0.34);
      const slide = weaponBox(0.1, 0.065, 0.44, skinMat, 0.018);
      slide.position.set(0.22, -0.17, -0.35);
      const gripM = weaponBox(0.06, 0.16, 0.075, handleMat, 0.018);
      gripM.position.set(0.22, -0.34, -0.2);
      gripM.rotation.x = 0.18;
      magazine = weaponBox(0.045, 0.22, 0.055, skinMat, 0.012);
      magazine.position.set(0.22, -0.42, -0.22);
      group.add(frame, slide, gripM, magazine);
      muzzle.set(0.22, -0.17, -0.57);

      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.3), deagleMat);
      rail.position.set(0.22, -0.133, -0.35);
      group.add(rail);
      // slide venting ribs, the Deagle's signature top-slide serrations
      for (let i = 0; i < 4; i++) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.015), gunMat);
        vent.position.set(0.22, -0.144, -0.24 - i * 0.03);
        group.add(vent);
      }
      // exposed hammer at the rear of the slide
      const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.018), gunMat);
      hammer.position.set(0.22, -0.15, -0.15);
      group.add(hammer);
      // trigger guard loop
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 6, 10, Math.PI * 1.3), deagleMat);
      triggerGuard.rotation.z = Math.PI * 0.35;
      triggerGuard.position.set(0.22, -0.3, -0.27);
      group.add(triggerGuard);
      break;
    }
    case 'tec9': {
      pistolModel(pistolMat, 0.36, 0.22, false);
      // the Tec-9's signature chunky, ventilated barrel shroud extending past the slide
      const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 10), skinMat);
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
      // AKM silhouette built from separate steel, laminate and polymer components. The curved
      // magazine is a tube rather than three intersecting boxes, so it reads as one manufactured
      // part in motion and during reloads.
      const receiver = weaponBox(0.11, 0.135, 0.43, skinMat, 0.025);
      receiver.position.set(0.24, -0.205, -0.39);
      const dustCover = weaponBox(0.095, 0.045, 0.34, skinMat, 0.018);
      dustCover.position.set(0.24, -0.132, -0.42);
      const stock = weaponBox(0.082, 0.105, 0.34, akWoodMat, 0.025);
      stock.position.set(0.24, -0.22, -0.02); stock.rotation.y = -0.06;
      const grip = weaponBox(0.065, 0.17, 0.07, akWoodMat, 0.02);
      grip.position.set(0.24, -0.335, -0.2); grip.rotation.x = 0.22;
      const handguard = weaponBox(0.09, 0.09, 0.34, akWoodMat, 0.022);
      handguard.position.set(0.24, -0.195, -0.68);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.48, 20), akMetalMat);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0.24, -0.185, -0.99);
      const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.36, 16), akMetalMat);
      gasTube.rotation.x = Math.PI / 2; gasTube.position.set(0.24, -0.135, -0.73);
      const magazineCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, -0.07, -0.015),
        new THREE.Vector3(0, -0.16, -0.045), new THREE.Vector3(0, -0.24, -0.11)
      ]);
      magazine = new THREE.Mesh(new THREE.TubeGeometry(magazineCurve, 12, 0.036, 10, false), skinMat);
      magazine.position.set(0.24, -0.27, -0.405);
      const magazineFloor = weaponBox(0.065, 0.035, 0.08, skinMat, 0.012);
      magazineFloor.position.set(0.24, -0.53, -0.52);
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.008, 8, 16, Math.PI * 1.35), akMetalMat);
      triggerGuard.rotation.z = Math.PI * 0.35; triggerGuard.position.set(0.24, -0.285, -0.255);
      const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.026, 0.11, 16), akMetalMat);
      muzzleBrake.rotation.x = Math.PI / 2; muzzleBrake.position.set(0.24, -0.185, -1.25);
      const chargingHandle2 = weaponBox(0.025, 0.025, 0.08, akMetalMat, 0.008);
      chargingHandle2.position.set(0.185, -0.19, -0.3);
      group.add(receiver, dustCover, stock, grip, handguard, barrel, gasTube, magazine, magazineFloor, triggerGuard, muzzleBrake, chargingHandle2);
      chargingHandle = chargingHandle2;
      muzzle.set(0.24, -0.185, -1.305);
      break;
    }
    case 'm4a4': {
      // flat black M4A4: ribbed RIS handguard, an A-frame front sight tower, a flip-up rear
      // sight on the top rail, a collapsible carbine stock and a birdcage flash hider
      rifleModel(0.24, 0.1, 0.42, gunMat);
      magazine.material = skinMat;
      const handguard = weaponBox(0.09, 0.09, 0.32, skinMat, 0.018);
      handguard.position.set(0.24, -0.185, -0.68);
      group.add(handguard);
      for (let i = 0; i < 6; i++) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.01, 0.02), gunMatLight);
        ridge.position.set(0.24, -0.14, -0.55 - i * 0.05);
        group.add(ridge);
      }
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.34), gunMatLight);
      topRail.position.set(0.24, -0.135, -0.42);
      group.add(topRail);
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
      magazine.material = skinMat;
      const handguard = weaponBox(0.09, 0.09, 0.28, skinMat, 0.018);
      handguard.position.set(0.24, -0.185, -0.58);
      group.add(handguard);
      for (let i = 0; i < 5; i++) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.01, 0.02), gunMatLight);
        ridge.position.set(0.24, -0.14, -0.47 - i * 0.05);
        group.add(ridge);
      }
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.34), gunMatLight);
      topRail.position.set(0.24, -0.135, -0.42);
      group.add(topRail);
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
      // Precision bolt-action silhouette: a separate polymer chassis, steel receiver, long free-
      // floated barrel and a multi-part optic. This avoids the old generic rifle template, whose
      // rectangular stock made the AWP read like an enlarged toy carbine.
      const chassis = weaponBox(0.105, 0.12, 0.82, awpStockMat, 0.028);
      chassis.position.set(0.24, -0.225, -0.2);
      chassis.rotation.y = -0.035;
      const butt = weaponBox(0.12, 0.15, 0.24, awpStockMat, 0.035);
      butt.position.set(0.24, -0.22, 0.23); butt.rotation.y = -0.08;
      const recoilPad = weaponBox(0.13, 0.16, 0.035, handleMat, 0.016);
      recoilPad.position.set(0.24, -0.22, 0.365);
      const receiver = weaponBox(0.115, 0.14, 0.42, skinMat, 0.024);
      receiver.position.set(0.24, -0.18, -0.39);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.031, 0.82, 24), akMetalMat);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0.24, -0.17, -1.0);
      const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.029, 0.13, 20), scopeMat);
      muzzleBrake.rotation.x = Math.PI / 2; muzzleBrake.position.set(0.24, -0.17, -1.46);
      const handguard = weaponBox(0.105, 0.105, 0.48, awpStockMat, 0.025);
      handguard.position.set(0.24, -0.205, -0.78);
      const magazineBody = weaponBox(0.06, 0.16, 0.095, skinMat, 0.018);
      magazineBody.position.set(0.24, -0.335, -0.46);
      magazine = magazineBody;
      const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.008, 8, 18, Math.PI * 1.35), scopeMat);
      triggerGuard.rotation.z = Math.PI * 0.35; triggerGuard.position.set(0.24, -0.29, -0.29);
      const trigger = weaponBox(0.012, 0.045, 0.018, akMetalMat, 0.004);
      trigger.position.set(0.24, -0.28, -0.295); trigger.rotation.x = -0.18;

      // Raised picatinny rail and two optic rings.
      const mountRail = weaponBox(0.045, 0.028, 0.47, skinMat, 0.009);
      mountRail.position.set(0.24, -0.085, -0.4);
      const railSlots = [];
      for (let i = 0; i < 8; i++) {
        const slot = weaponBox(0.052, 0.008, 0.018, scopeMat, 0.003);
        slot.position.set(0.24, -0.067, -0.21 - i * 0.052); railSlots.push(slot);
      }
      const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.46, 20), skinMat);
      scopeBody.rotation.x = Math.PI / 2; scopeBody.position.set(0.24, -0.015, -0.42);
      const scopeObjective = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.058, 0.075, 20), skinMat);
      scopeObjective.rotation.x = Math.PI / 2; scopeObjective.position.set(0.24, -0.015, -0.68);
      const scopeEyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.09, 20), skinMat);
      scopeEyepiece.rotation.x = Math.PI / 2; scopeEyepiece.position.set(0.24, -0.015, -0.16);
      const scopeLensFront = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 20), scopeGlassMat);
      scopeLensFront.rotation.x = Math.PI / 2; scopeLensFront.position.set(0.24, -0.015, -0.725);
      const scopeLensBack = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.012, 20), scopeGlassMat);
      scopeLensBack.rotation.x = Math.PI / 2; scopeLensBack.position.set(0.24, -0.015, -0.105);
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.008, 8, 20), skinMat);
      ringA.rotation.x = Math.PI / 2; ringA.position.set(0.24, -0.015, -0.57);
      const ringB = ringA.clone(); ringB.position.z = -0.27;
      const mountA = weaponBox(0.055, 0.09, 0.055, skinMat, 0.012); mountA.position.set(0.24, -0.11, -0.56);
      const mountB = mountA.clone(); mountB.position.z = -0.28;

      // Bolt body and handle remain separate so the existing bolt-cycle animation has a visible
      // mechanical part to move after each shot.
      const boltBody = weaponBox(0.07, 0.07, 0.18, scopeMat, 0.014); boltBody.position.set(0.24, -0.145, -0.24);
      boltHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 16), scopeMat);
      boltHandle.rotation.z = Math.PI / 2; boltHandle.position.set(0.315, -0.17, -0.25);
      const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.027, 14, 10), scopeMat);
      boltKnob.position.set(0.375, -0.17, -0.25);
      const cheekRiser = weaponBox(0.075, 0.065, 0.2, awpStockMat, 0.018);
      cheekRiser.position.set(0.24, -0.12, 0.03);
      const bipodLegA = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.18, 10), scopeMat);
      bipodLegA.position.set(0.19, -0.28, -1.06); bipodLegA.rotation.z = -0.22;
      const bipodLegB = bipodLegA.clone(); bipodLegB.position.x = 0.29; bipodLegB.rotation.z = 0.22;
      group.add(chassis, butt, recoilPad, receiver, barrel, muzzleBrake, handguard, magazineBody, triggerGuard, trigger,
        mountRail, ...railSlots, scopeBody, scopeObjective, scopeEyepiece, scopeLensFront, scopeLensBack,
        ringA, ringB, mountA, mountB, boltBody, boltHandle, boltKnob, cheekRiser, bipodLegA, bipodLegB);
      muzzle.set(0.24, -0.17, -1.525);
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
    case 'flash': {
      // same spoon/pin silhouette as the frag, but a bright silver body so it's never mistaken
      // for the olive frag or the grey smoke canister at a glance
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), flashMat);
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
  }

  const sight = attachWeaponSight(group, id, gunMatLight);
  const aimOffset = sight ? sightOffset(sight, weaponGroup.scale.x) : null;
  flashLight.position.copy(muzzle || new THREE.Vector3(0.22, -0.2, -0.6));
  flashSprite.position.copy(flashLight.position);
  group.add(flashLight, flashSprite);
  return {
    group, sight, aimOffset, magazine, chargingHandle, magRestY: magazine ? magazine.position.y : 0, chargeRestX: chargingHandle ? chargingHandle.position.x : 0, muzzle, knifeParts,
    boltHandle, boltRestZ: boltHandle ? boltHandle.position.z : 0, boltRestX: boltHandle ? boltHandle.position.x : 0
  };
}

function equipSlot(slot, force = false){
  if (gameMode === 'pvp' && selectedRuleset === 'knife' && slot !== 'melee') return;
  if (slot === 'primary' && !inventory.primary) return;
  if (slot === 'secondary' && !inventory.secondary) return;
  if (slot === 'grenade' && grenadeCount <= 0) return;
  if (slot === 'smoke' && smokeCount <= 0) return;
  if (slot === 'flash' && flashCount <= 0) return;
  if (!force && (slot === currentSlot || reloadRuntime.reloading)) return;
  if (force) {
    reloadGeneration++;
    reloadRuntime.reloading = false;
    document.getElementById('reloadLabel').style.opacity = 0;
  }
  weaponRecoilT = -1;
  lastSlot = currentSlot;
  currentSlot = slot;
  player.ads = false;
  player.scopeLevel = 0;
  weaponInspectT = -1;
  weaponInspectId = null;
  const id = slot === 'melee' ? 'knife' : slot === 'grenade' ? 'grenade' : slot === 'smoke' ? 'smoke' : slot === 'flash' ? 'flash' : inventory[slot];
  if (currentVisual) weaponGroup.remove(currentVisual.group);
  currentVisual = buildWeaponVisual(id);
  currentVisual.group.visible = id !== 'knife' || knifeAvailable;
  weaponGroup.add(currentVisual.group);
  weaponGroup.scale.setScalar(0.78);
  weaponGroup.position.set(0.015, -0.015, 0.04);
  weaponGroup.rotation.x = 0;
  updateAmmoHUD();
}

currentVisual = buildWeaponVisual('knife');
weaponGroup.add(currentVisual.group);

// forearm + hand holding the grip, so the weapon isn't a disembodied floating prop
const armGroup = new THREE.Group();
const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.3, 6, 12), skinMat);
forearm.rotation.z = Math.PI / 2.3;
forearm.position.set(0.16, -0.32, 0.05);
const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.08, 5, 10), sleeveMat);
sleeve.rotation.z = Math.PI / 2.3;
sleeve.position.set(0.1, -0.29, 0.14);
const playerGloveMat = new THREE.MeshStandardMaterial({ color: 0x363d3b, roughness: .94,
  bumpMap: checkeredGripTexture(), bumpScale: .002 });
const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 24, 16), playerGloveMat);
hand.position.set(0.235, -0.32, -0.12);
armGroup.add(forearm, sleeve, hand);
// Segmented fingers keep the empty hand readable after a knife throw.
for (let i = 0; i < 4; i++) {
  const finger = new THREE.Mesh(new THREE.CapsuleGeometry(.012, .035, 4, 8), playerGloveMat);
  finger.position.set(.21 + i * .018, -.354, -.15); finger.rotation.x = -.7;
  armGroup.add(finger);
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(.014, 10, 8), playerGloveMat);
  knuckle.position.set(.21 + i * .018, -.323, -.167); armGroup.add(knuckle);
}
const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(.016, .04, 4, 10), playerGloveMat);
thumb.position.set(.184, -.31, -.135); thumb.rotation.z = -.65; armGroup.add(thumb);
weaponGroup.add(armGroup);
const spectator = new TeammateSpectator(camera, weaponGroup, armGroup);

// ============================================================
// INPUT
// ============================================================
const keys = {};
let mouseLocked = false;

// ---------- Settings: sensitivity + rebindable keys, persisted across reloads ----------
// Sprint defaults to Shift (not Ctrl): holding Ctrl while tapping W/A/S/D collides with
// Ctrl+W/Ctrl+N/etc, browser shortcuts a page is never allowed to preventDefault() - holding
// sprint-forward would silently close the tab. Crouch takes Ctrl instead, since crouch is a
// quick tap, not something held down continuously alongside WASD.
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft',
  reload: 'KeyR', shop: 'KeyB', inspect: 'KeyF'
};
const LEGACY_DEFAULT_BINDS = { ...DEFAULT_BINDS, crouch: 'ShiftLeft', sprint: 'ControlLeft' };
const BIND_LABELS = {
  forward: 'MOVE FORWARD', back: 'MOVE BACK', left: 'MOVE LEFT', right: 'MOVE RIGHT',
  jump: 'JUMP', crouch: 'CROUCH', sprint: 'SPRINT',
  reload: 'RELOAD', shop: 'OPEN SHOP', inspect: 'INSPECT WEAPON'
};
const settings = { sensitivity: 1, reducedMotion: true, graphics: 'balanced', fov: 75, binds: { ...DEFAULT_BINDS } };
(function loadSettings(){
  try {
    const saved = JSON.parse(localStorage.getItem('lastRoundSettings') || 'null');
    if (saved) {
      settings.reducedMotion = saved.reducedMotion !== false;
      if (['performance', 'balanced', 'quality'].includes(saved.graphics)) settings.graphics = saved.graphics;
      if (Number.isFinite(saved.fov)) settings.fov = Math.max(65, Math.min(100, saved.fov));
      if (typeof saved.sensitivity === 'number') settings.sensitivity = saved.sensitivity;
      if (saved.binds) Object.assign(settings.binds, saved.binds);
    }
  } catch (err) { /* corrupt/blocked storage - just use defaults */ }
  // one-time migration: only touch crouch/sprint if they still exactly match the OLD default
  // combo (i.e. this player never customized either one) - an intentional custom bind is left
  // alone even if it happens to be Ctrl
  if (settings.binds.crouch === LEGACY_DEFAULT_BINDS.crouch && settings.binds.sprint === LEGACY_DEFAULT_BINDS.sprint) {
    settings.binds.crouch = DEFAULT_BINDS.crouch;
    settings.binds.sprint = DEFAULT_BINDS.sprint;
  }
})();
function saveSettings(){
  try { localStorage.setItem('lastRoundSettings', JSON.stringify(settings)); } catch (err) { /* private window / storage blocked - setting still works this session */ }
}
function applyGraphicsSettings(){
  const preset = {
    performance: { max: 1, shadow: 1024, bloom: false },
    balanced: { max: 1.5, shadow: 2048, bloom: true },
    quality: { max: 2, shadow: 4096, bloom: true }
  }[settings.graphics];
  renderQuality.max = Math.min(window.devicePixelRatio, preset.max);
  renderQuality.scale = renderQuality.max;
  renderQuality.sampleTime = 0; renderQuality.frameCount = 0;
  renderer.setPixelRatio(renderQuality.scale);
  composer.setPixelRatio(renderQuality.scale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.enabled = preset.bloom;
  if (sun.shadow.mapSize.x !== preset.shadow) {
    sun.shadow.map?.dispose(); sun.shadow.map = null;
    sun.shadow.mapSize.set(preset.shadow, preset.shadow);
    sun.shadow.needsUpdate = true;
  }
  baseFov = settings.fov;
  camera.fov = baseFov; camera.updateProjectionMatrix();
}
applyGraphicsSettings();
function keyLabel(code){
  if (!code) return '...';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Left', '').replace('Right', '').toUpperCase();
}

document.addEventListener('keydown', e => keys[e.code] = true);
document.addEventListener('keyup', e => keys[e.code] = false);

function clearGameplayInput(){
  combatMotion.reset();
  Object.keys(keys).forEach(key => { keys[key] = false; });
  mouseDown = false;
  movementVelocity.set(0, 0, 0);
  player.ads = false;
  player.scopeLevel = 0;
  weaponInspectT = -1;
  weaponInspectId = null;
  if (currentVisual && !reloadRuntime.reloading) {
    currentVisual.group.position.set(0, 0, 0);
    currentVisual.group.rotation.set(0, 0, 0);
    weaponRecoilT = -1;
  }
  boltRescopeLevel = 0;
  document.getElementById('tabScoreboard').style.display = 'none';
}
function restoreGameplayPointer(){
  if (!gameStarted || !player.alive || shopOpen || pauseMenuOpen || matchFinished) return;
  try {
    const request = renderer.domElement.requestPointerLock();
    if (request?.catch) request.catch(() => socialUI.notice('Click the game to resume mouse control.'));
  } catch { socialUI.notice('Click the game to resume mouse control.'); }
}
const socialUI = new SocialUI({
  state: () => ({ started: gameStarted, menu: shopOpen || pauseMenuOpen, alive: player.alive, locked: mouseLocked }),
  clearInput: clearGameplayInput,
  restoreLock: restoreGameplayPointer,
  sendChat: sendChatMessage,
  spray: sprayGraffiti
});

renderer.domElement.addEventListener('click', () => {
  if (!mouseLocked && gameStarted && player.alive && !socialUI.blocked && !shopOpen && !pauseMenuOpen) restoreGameplayPointer();
});
document.addEventListener('pointerlockchange', () => {
  mouseLocked = document.pointerLockElement === renderer.domElement;
  if (!mouseLocked) clearGameplayInput();
});
document.addEventListener('mousemove', e => {
  if (!mouseLocked || socialUI.blocked || !player.alive) return;
  // sensitivity scales down with the current zoom level - a tighter scope (lower fov) turns the
  // mouse slower, so a heavily-zoomed AWP feels far more controlled than a lightly-zoomed pistol
  const sens = (player.ads ? 0.0022 * (camera.fov / baseFov) : 0.0022) * settings.sensitivity;
  combatMotion.look(e.movementX * settings.sensitivity, e.movementY * settings.sensitivity);
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.pitch));
});
document.addEventListener('contextmenu', e => e.preventDefault());

let mouseDown = false;
document.addEventListener('mousedown', e => {
  if (!mouseLocked || !gameStarted || !player.alive || socialUI.blocked || shopOpen || pauseMenuOpen) return;
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) {
    const def = currentWeaponDef();
    // right click on a grenade/smoke/flash throws short instead of aiming down sights
    if (currentSlot === 'melee') {
      throwKnife();
    } else if (currentSlot === 'grenade' || currentSlot === 'smoke' || currentSlot === 'flash') {
      if (player.alive && !reloadRuntime.reloading && fireCooldown <= 0) {
        fireCooldown = def.fireRate;
        throwGrenade(currentSlot === 'grenade' ? 'frag' : currentSlot === 'smoke' ? 'smoke' : 'flash', false);
      }
    } else if (def.scope) {
      if (def.boltAction && boltCyclingT > 0) return; // busy working the bolt - the scope comes back on its own once it's done
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
  // Checked before the shopOpen guard below (which exists to block other gameplay input while
  // the shop is up) so the same key that opens the shop also closes it, instead of being
  // swallowed by that guard the moment the shop is open.
  if (gameStarted && !pauseMenuOpen && !socialUI.blocked && e.code === settings.binds.shop) { toggleBuyMenu(); return; }
  if (!gameStarted || shopOpen || pauseMenuOpen || socialUI.blocked) return;
  if (e.code === settings.binds.reload) startReload();
  if (e.code === 'Digit1') equipSlot('primary');
  if (e.code === 'Digit2') equipSlot('secondary');
  if (e.code === 'Digit3') equipSlot('melee');
  if (e.code === 'Digit4') equipSlot('grenade');
  if (e.code === 'Digit5') equipSlot('smoke');
  if (e.code === 'Digit6') equipSlot('flash');
  if (e.code === 'KeyQ') equipSlot(lastSlot);
  if (e.code === settings.binds.inspect) playWeaponInspect();
});
document.addEventListener('wheel', e => {
  if (!gameStarted || shopOpen || pauseMenuOpen || socialUI.blocked) return;
  const owned = ['melee'];
  if (inventory.secondary) owned.push('secondary');
  if (inventory.primary) owned.push('primary');
  if (grenadeCount > 0) owned.push('grenade');
  if (smokeCount > 0) owned.push('smoke');
  if (flashCount > 0) owned.push('flash');
  const idx = owned.indexOf(currentSlot);
  const next = owned[(idx + (e.deltaY > 0 ? 1 : owned.length - 1)) % owned.length];
  equipSlot(next);
});

// ============================================================
// WEAPON / SHOOTING / RELOAD ANIMATION (generic across all weapons)
// ============================================================
const reloadRuntime = { reloading: false, reloadT: 0, duration: 1.5 };
let reloadGeneration = 0;
const sessionMetrics = { shots: 0, hits: 0, headshots: 0 };
let matchFinished = false;
let fireCooldown = 0;
let knifeFlipT = -1;
let weaponInspectT = -1;
let weaponInspectId = null;
let weaponRecoilT = -1;
let shotVisualScale = 1;

function currentWeaponDef(){
  if (currentSlot === 'melee') return WEAPONS.knife;
  if (currentSlot === 'grenade') return WEAPONS.grenade;
  if (currentSlot === 'smoke') return WEAPONS.smoke;
  if (currentSlot === 'flash') return WEAPONS.flash;
  return WEAPONS[inventory[currentSlot]];
}

function playKnifeFlip(){
  if (currentSlot !== 'melee') return;
  knifeFlipT = 0;
}

function playWeaponInspect(){
  if (currentSlot === 'melee' && !knifeAvailable) return;
  if (!gameStarted || !player.alive || reloadRuntime.reloading || boltCyclingT > 0 || weaponInspectT >= 0) return;
  weaponInspectT = 0;
  weaponRecoilT = -1;
  currentVisual.group.position.set(0, 0, 0);
  currentVisual.group.rotation.set(0, 0, 0);
  weaponInspectId = currentSlot === 'melee' ? 'knife' : currentSlot === 'grenade' ? 'grenade' : currentSlot === 'smoke' ? 'smoke' : currentSlot === 'flash' ? 'flash' : inventory[currentSlot];
  player.ads = false;
  player.scopeLevel = 0;
}

function startReload(){
  if (currentSlot === 'melee' || currentSlot === 'grenade' || currentSlot === 'smoke' || currentSlot === 'flash' || reloadRuntime.reloading) return;
  const state = ammoState[currentSlot];
  const def = currentWeaponDef();
  if (state.mag === def.mag || state.reserve <= 0) return;
  reloadRuntime.reloading = true;
  reloadRuntime.reloadT = 0;
  reloadRuntime.duration = def.reloadDuration || 1.5;
  if (!audio.playSample('reload', 0.8)) audio.reloadSequence(reloadRuntime.duration, currentSlot === 'primary');
  document.getElementById('reloadLabel').style.opacity = 1;
  const reloadToken = ++reloadGeneration;
  setTimeout(() => {
    if (reloadToken !== reloadGeneration) return;
    const need = def.mag - state.mag;
    // FFA has no resupply loop (all weapons free, no buy phase), so reloading there tops the
    // magazine back up to full without draining reserve - the reserve number is just a display
    // of "rounds left to top up with", not a depletable pool, in that mode.
    const take = isFfa() ? need : Math.min(need, state.reserve);
    state.mag += take;
    if (!isFfa()) state.reserve -= take;
    reloadRuntime.reloading = false;
    document.getElementById('reloadLabel').style.opacity = 0;
    updateAmmoHUD();
  }, reloadRuntime.duration * 1000);
}

function updateReloadAnimation(dt){
  const magazine = currentVisual.magazine, chargingHandle = currentVisual.chargingHandle;
  if (!magazine) { weaponGroup.rotation.x = 0; return; }
  if (!reloadRuntime.reloading) {
    magazine.position.y = currentVisual.magRestY;
    magazine.visible = true;
    if (chargingHandle) chargingHandle.position.x = currentVisual.chargeRestX;
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

  if (!chargingHandle) return;
  if (p > 0.85) {
    const lp = (p - 0.85) / 0.15;
    chargingHandle.position.x = chargeRestX - Math.sin(lp * Math.PI) * 0.08;
  } else {
    chargingHandle.position.x = chargeRestX;
  }
}

// bolt-action cycling between shots (AWP): the scope drops the instant the shot fires (see
// fireWeapon), then automatically comes back once this timer runs out and the bolt handle has
// finished its animated back-and-forth, restoring whatever zoom level was active before firing
const BOLT_CYCLE_DURATION = 1.0;
let boltCyclingT = 0;
let boltRescopeLevel = 0;
function updateBoltCycle(dt){
  if (boltCyclingT > 0) {
    boltCyclingT = Math.max(0, boltCyclingT - dt);
    if (boltCyclingT === 0 && boltRescopeLevel > 0 && currentWeaponDef().boltAction) {
      player.scopeLevel = boltRescopeLevel;
      player.ads = true;
    }
  }
  const boltHandle = currentVisual.boltHandle;
  if (!boltHandle) return;
  if (boltCyclingT <= 0) {
    boltHandle.position.z = currentVisual.boltRestZ;
    boltHandle.position.x = currentVisual.boltRestX;
    return;
  }
  const p = 1 - boltCyclingT / BOLT_CYCLE_DURATION; // 0 -> 1 over the cycle
  // lift+pull back for the first half, push forward+drop for the second - a simple two-stroke
  // stand-in for "lift, pull, push, lock"
  const pull = p < 0.5 ? Math.sin((p / 0.5) * (Math.PI / 2)) : Math.cos(((p - 0.5) / 0.5) * (Math.PI / 2));
  boltHandle.position.z = currentVisual.boltRestZ + pull * 0.12;
  boltHandle.position.x = currentVisual.boltRestX + pull * 0.02;
}

// Visible first-person kick for heavy weapons. Camera recoil changes aim, but this local model
// recoil is what tells the player that the rifle itself violently cycled. The AWP gets a longer,
// heavier impulse than automatic weapons and settles before the next bolt can be fired.
function updateWeaponRecoil(dt){
  if (!currentVisual || weaponRecoilT < 0) return;
  weaponRecoilT += dt;
  const isDeagle = currentSlot === 'secondary' && inventory.secondary === 'deagle';
  if (isDeagle) {
    // Positive X rotation lifts a muzzle pointing along local -Z.
    // Reach the peak in 35 ms, then settle before the next 300 ms shot.
    const p = Math.min(1, weaponRecoilT / 0.28);
    const rise = 0.125;
    const kick = p < rise ? Math.sin((p / rise) * Math.PI / 2)
      : Math.pow(1 - (p - rise) / (1 - rise), 2);
    const tilt = kick * 0.38 * shotVisualScale;
    currentVisual.group.rotation.x = tilt;
    // Rotate around the grip at y=-0.34, z=-0.20 rather than the camera origin.
    const gripY = -0.34, gripZ = -0.20;
    currentVisual.group.position.y = gripY - (Math.cos(tilt) * gripY - Math.sin(tilt) * gripZ);
    currentVisual.group.position.z = gripZ - (Math.sin(tilt) * gripY + Math.cos(tilt) * gripZ) + kick * 0.045 * shotVisualScale;
    if (p >= 1) {
      weaponRecoilT = -1;
      currentVisual.group.rotation.x = 0;
      currentVisual.group.position.y = 0;
      currentVisual.group.position.z = 0;
    }
    return;
  }
  const duration = currentWeaponDef().boltAction ? 0.34 : 0.16;
  const p = Math.min(1, weaponRecoilT / duration);
  const impulse = p < 0.16 ? p / 0.16 : 1 - ((p - 0.16) / 0.84);
  const clamped = Math.max(0, impulse);
  const strength = (currentWeaponDef().boltAction ? 1 : 0.45) * shotVisualScale;
  currentVisual.group.position.z = clamped * 0.105 * strength;
  currentVisual.group.rotation.x = clamped * 0.19 * strength;
  if (p >= 1) {
    weaponRecoilT = -1;
    currentVisual.group.position.z = 0;
    currentVisual.group.rotation.x = 0;
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

function updateWeaponInspect(dt){
  if (weaponInspectT < 0 || !currentVisual) return;
  weaponInspectT += dt;
  const duration = 1.15;
  const p = Math.min(1, weaponInspectT / duration);
  const phase = p < 0.18 ? p / 0.18 : p > 0.78 ? (1 - p) / 0.22 : 1;
  const eased = Math.sin(Math.max(0, phase) * Math.PI / 2);
  const id = weaponInspectId;
  if (id === 'knife') {
    currentVisual.group.rotation.z = eased * Math.PI * 0.85;
    currentVisual.group.rotation.y = eased * 0.55;
    currentVisual.group.position.set(-eased * 0.06, eased * 0.035, eased * 0.04);
  } else if (id === 'awp') {
    currentVisual.group.rotation.y = -eased * 0.48;
    currentVisual.group.rotation.z = eased * 0.16;
    currentVisual.group.position.set(-eased * 0.1, eased * 0.06, eased * 0.08);
  } else if (id === 'grenade' || id === 'smoke' || id === 'flash') {
    currentVisual.group.rotation.y = -eased * 0.7;
    currentVisual.group.rotation.z = eased * 0.28;
    currentVisual.group.position.set(-eased * 0.08, eased * 0.08, eased * 0.06);
  } else {
    // Pistols and assault rifles rotate just enough to expose the slide, magazine and receiver.
    currentVisual.group.rotation.y = -eased * 0.62;
    currentVisual.group.rotation.z = eased * 0.12;
    currentVisual.group.position.set(-eased * 0.09, eased * 0.045, eased * 0.07);
  }
  if (p >= 1) {
    weaponInspectT = -1;
    weaponInspectId = null;
    currentVisual.group.position.set(0, 0, 0);
    currentVisual.group.rotation.set(0, 0, 0);
  }
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
const thrownKnives = [];
const thrownKnifeRay = new THREE.Raycaster();
const thrownKnifeGeometry = new THREE.ConeGeometry(0.035, 0.35, 4);
const thrownKnifeGrip = new THREE.BoxGeometry(0.045, 0.14, 0.04);

function createThrownKnife(origin, direction, damaging = false, id = crypto.randomUUID()){
  const mesh = new THREE.Group();
  const blade = new THREE.Mesh(thrownKnifeGeometry, bladeMat);
  blade.rotation.x = -Math.PI / 2;
  const grip = new THREE.Mesh(thrownKnifeGrip, knifeHandleMat);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.24;
  mesh.add(blade, grip);
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
  scene.add(mesh);
  thrownKnives.push({ mesh, id, velocity: direction.clone().multiplyScalar(38), damaging,
    landed: false, hitEnemy: false, epoch: matchEpoch, round: roundState.roundNum });
  return id;
}

function throwKnife(){
  if (isFfa()) ffaState.protection = 0;
  if ((gameMode === 'pvp' && roundState.phase === 'ended') || !knifeAvailable || matchFinished || fireCooldown > 0 || reloadRuntime.reloading) return;
  weaponInspectT = -1; weaponInspectId = null; weaponRecoilT = -1;
  currentVisual.group.position.set(0, 0, 0);
  currentVisual.group.rotation.set(0, 0, 0);
  player.ads = false;
  fireCooldown = 1.2;
  playKnifeSwing();
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const id = createThrownKnife(origin, direction, true);
  knifeCount--;
  knifeAvailable = knifeCount > 0;
  currentVisual.group.visible = knifeAvailable;
  updateAmmoHUD();
  if (gameMode === 'pvp') netBroadcast({ type: 'knifeThrow', id, origin: origin.toArray(), direction: direction.toArray() });
  audio.playSample('knifeSlash', 0.8);
}

function updateThrownKnives(dt){
  for (let i = thrownKnives.length - 1; i >= 0; i--) {
    const knife = thrownKnives[i];
    if (knife.epoch !== matchEpoch || knife.round !== roundState.roundNum) {
      scene.remove(knife.mesh); thrownKnives.splice(i, 1); continue;
    }
    if (knife.landed) {
      if (knife.damaging && player.alive) {
        const feet = player.pos.clone(); feet.y -= player.crouching ? player.crouchHeight : player.height;
        const reach = knife.mesh.position.clone().sub(player.pos);
        thrownKnifeRay.set(player.pos, reach.clone().normalize());
        thrownKnifeRay.far = Math.max(0, reach.length() - 0.15);
        if (knifeCount < knifeCapacity() && feet.distanceTo(knife.mesh.position) < 1.8 && !thrownKnifeRay.intersectObjects(envMeshes, false).length) {
          knifeCount++;
          knifeAvailable = true;
          if (currentSlot === 'melee') currentVisual.group.visible = true;
          updateAmmoHUD();
          socialUI.notice('Knife recovered');
          if (gameMode === 'pvp') netBroadcast({ type: 'knifePickup', id: knife.id });
          scene.remove(knife.mesh); thrownKnives.splice(i, 1);
        }
      }
      continue;
    }
    // Ballistic motion: fast initial throw, then gravity bends the trajectory.
    const step = knife.velocity.clone().multiplyScalar(dt);
    step.y -= 0.5 * 9.81 * dt * dt;
    knife.velocity.y -= 9.81 * dt;
    const distance = step.length();
    const direction = step.clone().normalize();
    // Sweep the entire step so fast knives cannot skip thin walls or soldiers.
    thrownKnifeRay.set(knife.mesh.position, direction);
    thrownKnifeRay.far = distance;
    const walls = thrownKnifeRay.intersectObjects(envMeshes.concat(floorMeshes), false);
    const targets = enemies.filter(enemy => enemy.alive && !(gameMode === 'pvp' && enemy.team === myTeam()));
    const hits = knife.damaging && !knife.hitEnemy ? thrownKnifeRay.intersectObjects(targets.map(enemy => enemy.mesh), true) : [];
    const hit = hits[0];
    const blocked = walls.length && (!hit || walls[0].distance <= hit.distance);
    if (hit && !blocked && knife.damaging && knife.epoch === matchEpoch && knife.round === roundState.roundNum) {
      let object = hit.object;
      while (object && !object.userData.enemyRef) object = object.parent;
      const enemy = object?.userData.enemyRef;
      if (enemy) {
        const killed = damageEnemy(enemy, Math.max(enemy.health, enemy.maxHealth, 100) + 1, hit.point,
          { weaponName: 'Throwing Knife', instantKill: true });
        showHitMarker(false, killed);
        audio.playSample('knifeStab', 0.8);
        knife.hitEnemy = true;
        knife.velocity.multiplyScalar(0.15);
      }
    }
    if (blocked) {
      const wall = walls[0];
      const normal = wall.face.normal.clone().transformDirection(wall.object.matrixWorld);
      if (normal.dot(direction) > 0) normal.negate();
      knife.mesh.position.copy(wall.point).addScaledVector(normal, 0.06);
      if (normal.y > 0.45) knife.landed = true;
      else knife.velocity.reflect(normal).multiplyScalar(0.18);
    } else if (hit) knife.mesh.position.copy(hit.point);
    else knife.mesh.position.add(step);
    if (knife.mesh.position.y < groundHeightAt(knife.mesh.position.x, knife.mesh.position.z) + 0.05) {
      knife.mesh.position.y = groundHeightAt(knife.mesh.position.x, knife.mesh.position.z) + 0.05;
      knife.landed = true;
    }
    if (knife.landed) {
      knife.mesh.rotation.set(0, 0, 0.4);
      if (knife.damaging && gameMode === 'pvp') netBroadcast({ type: 'knifeLanded', id: knife.id, point: knife.mesh.position.toArray() });
    } else knife.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), knife.velocity.clone().normalize());
  }
}
const bulletTracers = [];
const particles = []; // {mesh/sprite, vel, life, maxLife, type}

function fireWeapon(){
  if (isFfa()) ffaState.protection = 0;
  if (!player.alive || matchFinished || (gameMode === 'pvp' && roundState.phase === 'ended') || reloadRuntime.reloading) return;
  if (weaponInspectT >= 0) {
    weaponInspectT = -1;
    weaponInspectId = null;
    currentVisual.group.position.set(0, 0, 0);
    currentVisual.group.rotation.set(0, 0, 0);
  }
  const def = currentWeaponDef();
  const weaponId = currentSlot === 'melee' ? 'knife' : currentSlot === 'grenade' ? 'grenade' : currentSlot === 'smoke' ? 'smoke' : currentSlot === 'flash' ? 'flash' : inventory[currentSlot];

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

  if (currentSlot === 'flash') {
    fireCooldown = def.fireRate;
    throwGrenade('flash', true);
    return;
  }

  if (currentSlot === 'melee') {
    if (!knifeAvailable) return;
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
  const aimedShot = player.ads;
  shotVisualScale = aimedShot ? 0.55 : 1;
  fireCooldown = def.fireRate;
  updateAmmoHUD();
  if (gameMode !== 'practice' && state.mag <= 0 && state.reserve > 0) startReload(); // out of ammo in the mag - reload without waiting for another trigger pull

  if (def.boltAction) {
    // working the bolt between shots kicks the scope off, then hands it back once the bolt
    // animation finishes - remembers whatever zoom level was active so it comes back the same way
    boltRescopeLevel = player.scopeLevel;
    player.ads = false;
    player.scopeLevel = 0;
    boltCyclingT = BOLT_CYCLE_DURATION;
  }

  const sampledWeapons = { awp: 'awp', ak47: 'ak47', m4a1: 'm4a1', glock: 'glock', deagle: 'deagle', m4a4: 'm4a4', tec9: 'smg', duals: 'smg' };
  sessionMetrics.shots++;
  combatMotion.shot();
  if (!sampledWeapons[weaponId] || !audio.playSample(sampledWeapons[weaponId], 0.9)) audio.gunshot(GUNSHOT_PROFILES[weaponId]);
  flashLight.intensity = aimedShot ? 2.5 : 5;
  flashSpriteMat.opacity = aimedShot ? 0.45 : 1;
  const flashSize = (0.5 + Math.random() * 0.2) * (aimedShot ? 0.55 : 1);
  flashSprite.scale.set(flashSize, flashSize, 1);
  setTimeout(() => { flashLight.intensity = 0; flashSpriteMat.opacity = 0; }, 45);

  const now = performance.now() / 1000;
  if (now - lastFireTime > 0.3) sprayIndex = 0;
  lastFireTime = now;
  const pattern = SPRAY_PATTERNS[weaponId] || [];
  const sprayStep = pattern[Math.min(sprayIndex, pattern.length - 1)] || { dy: 0.02, dx: 0 };
  sprayIndex++;
  const adsMul = aimedShot ? 0.30 : 1;
  if (weaponId !== 'deagle') {
    recoilKick += sprayStep.dy * adsMul;
    recoilYaw += sprayStep.dx * adsMul;
    shakeIntensity = Math.min(shakeIntensity + (aimedShot ? 0.07 : 0.28), 1.2);
  }
  // per-weapon visual kick on the gun model itself - snappy shove back + muzzle-up tilt, both
  // spring back to rest via the existing lerps in updatePlayer (AWP kicks by far the hardest)
  // The Deagle uses its grip-pivot animation only, without a second downward tilt.
  if (weaponId !== 'deagle') {
    weaponGroup.position.z += (def.kickPush ?? 0.06) * shotVisualScale;
    weaponGroup.rotation.x += (def.kickTilt ?? 0.05) * shotVisualScale;
  }
  weaponRecoilT = 0;

  spawnMuzzleSmoke(aimedShot);
  spawnShellCasing();

  const horizontalSpeed = Math.hypot(movementVelocity.x, movementVelocity.z);
  const movementPenalty = THREE.MathUtils.clamp(horizontalSpeed / (player.speed * player.sprintMul), 0, 1);
  const stanceMultiplier = player.crouching ? 0.72 : 1;
  const baseSpread = player.ads ? 0.0024 : 0.011;
  const spread = baseSpread * stanceMultiplier + movementPenalty * (player.ads ? 0.006 : 0.018);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.normalize();

  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = def.range;

  const hittableEnemies = enemies.filter(e => e.alive);
  const enemyHits = raycaster.intersectObjects(hittableEnemies.map(e => e.mesh), true);
  const envHits = raycaster.intersectObjects(envMeshes.concat(floorMeshes), false);

  recordKillcamShot({id:netMyId,weaponId,origin:origin.toArray(),end:origin.clone().addScaledVector(dir,Math.min(enemyHits[0]?.distance??def.range,envHits[0]?.distance??def.range)).toArray()});
  let tracerLen = def.range;
  let hitPoint = null;

  function resolveEnemyHit(hit, dmgFalloff){
    const isHeadshot = hit.object.userData.isHead === true;
    sessionMetrics.hits++;
    if (isHeadshot) sessionMetrics.headshots++;
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
    impactMarks.add(envHits[0]);
    const behindOrigin = envHits[0].point.clone().addScaledVector(dir, 0.05);
    raycaster.set(behindOrigin, dir);
    raycaster.far = Math.max(0, def.range - envHits[0].distance);
    const behindEnemyHits = raycaster.intersectObjects(hittableEnemies.map(e => e.mesh), true);
    const behindEnvHits = raycaster.intersectObjects(envMeshes.concat(floorMeshes), false);
    if (behindEnemyHits.length > 0 && (behindEnvHits.length === 0 || behindEnemyHits[0].distance < behindEnvHits[0].distance)) {
      tracerLen = envHits[0].distance + behindEnemyHits[0].distance + 0.05;
      hitPoint = behindEnemyHits[0].point;
      resolveEnemyHit(behindEnemyHits[0], 0.6);
    } else if (behindEnvHits.length > 0) {
      tracerLen = envHits[0].distance + behindEnvHits[0].distance + 0.05;
      hitPoint = behindEnvHits[0].point;
      spawnDustPuff(hitPoint);
      impactMarks.add(behindEnvHits[0]);
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
    impactMarks.add(envHits[0]);
  }

  // The camera ray decides the hit; the visual tracer starts at the barrel.
  const tracerEnd = origin.clone().addScaledVector(dir, tracerLen);
  const barrelOrigin = flashSprite.getWorldPosition(new THREE.Vector3());
  // Very close surfaces can sit behind the barrel: avoid a backwards tracer.
  const tracerOrigin = tracerLen < origin.distanceTo(barrelOrigin) ? origin : barrelOrigin;
  const tracerDirection = tracerEnd.sub(tracerOrigin);
  const visualDistance = tracerDirection.length();
  drawTracer(tracerOrigin, tracerDirection.normalize(), visualDistance);
  if (gameMode === 'pvp') netBroadcast({ type: 'shot', id: netMyId, roundNum: roundState.roundNum,
    weaponId, end: tracerOrigin.clone().addScaledVector(tracerDirection, visualDistance).toArray() });
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

function spawnMuzzleSmoke(aimed = false){
  const opacity = aimed ? 0.12 : 0.45;
  const lifetime = aimed ? 0.22 : 0.5;
  const size = aimed ? 0.08 : 0.15;
  for (let i = 0; i < (aimed ? 1 : 3); i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    const worldPos = new THREE.Vector3(); flashSprite.getWorldPosition(worldPos);
    s.position.copy(worldPos);
    scene.add(s);
    particles.push({
      obj: s, type: 'smoke', life: lifetime, maxLife: lifetime, initialOpacity: aimed ? opacity : 0.5,
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
const flashPopTex = softDiscTexture('rgba(255,255,255,1)');
function spawnFlashPop(point){
  const mat = new THREE.SpriteMaterial({ map: flashPopTex, transparent: true, opacity: 1, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.4, 1.4, 1);
  s.position.copy(point);
  scene.add(s);
  particles.push({ obj: s, type: 'explosion', life: 0.25, maxLife: 0.25, vel: new THREE.Vector3(0, 0.1, 0) });
}
// bigger, layered frag blast: a bright core flash, a slower billowing fireball that lingers, and a
// burst of glowing embers thrown outward - reads as a real explosion instead of one flat sprite
function spawnExplosionFlash(point){
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: explosionTex, transparent: true, opacity: 1, depthWrite: false }));
  core.scale.set(1.3, 1.3, 1);
  core.position.copy(point);
  scene.add(core);
  particles.push({ obj: core, type: 'explosion', life: 0.22, maxLife: 0.22, vel: new THREE.Vector3(0, 0.5, 0) });

  const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: explosionTex, transparent: true, opacity: 0.85, depthWrite: false }));
  cloud.scale.set(1.9, 1.9, 1);
  cloud.position.copy(point).add(new THREE.Vector3(0, 0.35, 0));
  scene.add(cloud);
  particles.push({ obj: cloud, type: 'explosion', life: 0.9, maxLife: 0.9, vel: new THREE.Vector3(0, 1.2, 0) });

  for (let i = 0; i < 16; i++) {
    const ember = new THREE.Sprite(new THREE.SpriteMaterial({ map: explosionTex, transparent: true, opacity: 1, depthWrite: false }));
    ember.scale.set(0.14, 0.14, 1);
    ember.position.copy(point);
    scene.add(ember);
    const ang = Math.random() * Math.PI * 2;
    const spd = 3 + Math.random() * 6;
    particles.push({
      obj: ember, type: 'ember', life: 0.4 + Math.random() * 0.35, maxLife: 0.4 + Math.random() * 0.35,
      initialOpacity: 1, vel: new THREE.Vector3(Math.cos(ang) * spd, 3 + Math.random() * 4, Math.sin(ang) * spd)
    });
  }
}

function updateParticles(dt){
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.obj);
      // Casing material/geometry are shared; sprite materials are per-particle.
      if (p.type !== 'casing') p.obj.material.dispose();
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
      p.obj.material.opacity = fade * (p.initialOpacity ?? (p.type === 'blood' ? 0.9 : 0.5));
      const growth = 1 + (1 - fade) * 1.5;
      if (p.obj.scale) {
        if (!p.initialScale) p.initialScale = p.obj.scale.clone();
        p.obj.scale.set(p.initialScale.x * growth, p.initialScale.y * growth, 1);
      }
    }
  }
}

// ---------- Grenades (frag + smoke share the same throw/arc physics) ----------
const grenades = []; // { mesh, vel, fuse, type }
const activeSmokes = []; // { pos, radius, life, sprites: [] } - blocks AI line-of-sight and the player's own view

function throwGrenade(type, far = true){
  if (isFfa()) ffaState.protection = 0;
  const count = type === 'smoke' ? smokeCount : type === 'flash' ? flashCount : grenadeCount;
  if (count <= 0) return;
  if (type === 'smoke') { smokeCount--; updateGrenadeHUD(); }
  else if (type === 'flash') { flashCount--; updateGrenadeHUD(); }
  else { grenadeCount--; updateGrenadeHUD(); }
  if (type === 'flash') {
    // one clip covers both the toss and the pop - delaying it lines its own internal timing up
    // with roughly when the thing actually lands and goes off, instead of playing a separate
    // (and now removed) detonation sound on top of it
    setTimeout(() => { if (!audio.playSample('flashbang', 0.85)) audio.mechClick(420, 0.16, 0.05); }, 750);
  } else if (!audio.playSample('grenadeThrow', 0.85)) audio.mechClick(420, 0.16, 0.05);

  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  dir.y += 0.18;
  dir.normalize();
  const origin = camera.getWorldPosition(new THREE.Vector3());

  // left click throws far, right click throws short (underhand toss); throwing while airborne
  // adds extra carry on top of whichever button was used
  let speed = far ? 20 : 10;
  if (!player.onGround) speed *= 1.3;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), type === 'smoke' ? smokeGrenadeMat : type === 'flash' ? flashMat : grenadeMat);
  mesh.position.copy(origin);
  mesh.castShadow = true;
  scene.add(mesh);
  grenades.push({ mesh, vel: dir.multiplyScalar(speed), fuse: 1.6, type });

  // hands go empty until the throw lands - auto-switch back to whatever was equipped before
  equipSlot(lastSlot === 'grenade' || lastSlot === 'smoke' || lastSlot === 'flash' ? 'melee' : lastSlot);
}

function updateGrenades(dt){
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    const nextPos = g.mesh.position.clone().addScaledVector(g.vel, dt);
    if(selectedMap === 'mall'){
      const travel=nextPos.clone().sub(g.mesh.position),length=travel.length();
      if(length>0){
        const sweep=new THREE.Raycaster(g.mesh.position,travel.normalize(),0,length+.09);
        const hit=sweep.intersectObjects(envMeshes.concat(floorMeshes),false)[0];
        if(hit){
          const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          if(normal.dot(g.vel)>0)normal.negate();
          nextPos.copy(hit.point).addScaledVector(normal,.1);g.vel.reflect(normal).multiplyScalar(.45);
        }
      }
    }
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
      else if (g.type === 'flash') detonateFlash(g.mesh.position.clone());
      else explodeGrenade(g.mesh.position.clone());
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

function explodeGrenade(point){
  if (!audio.playSample('explosion', 1)) audio.explosion();
  shakeIntensity = Math.min(shakeIntensity + 1.3, 1.9);

  const light = new THREE.PointLight(0xffaa55, 10, 20);
  light.position.copy(point);
  scene.add(light);
  setTimeout(() => scene.remove(light), 160);

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
  for (let i = 0; i < 16; i++) spawnDustPuff(point);
}

// distance+line-of-sight check shared by every target a flashbang can blind: calls onHit(intensity)
// - 1 at point-blank, fading to 0 at the edge of def.radius - only if `from` is within radius AND
// nothing in envMeshes blocks the straight line to `point` (ducking behind a wall/crate defeats it
// entirely, same as a real flashbang)
function applyFlashTo(from, point, def, onHit){
  const toPoint = new THREE.Vector3().subVectors(point, from);
  const dist = toPoint.length();
  if (dist > def.radius) return;
  if (dist < 0.05) { onHit(1); return; }
  toPoint.normalize();
  raycaster.set(from, toPoint);
  raycaster.far = Math.max(0.05, dist - 0.15);
  if (raycaster.intersectObjects(envMeshes, false).length > 0) return; // blocked by a wall/obstacle
  onHit(1 - dist / def.radius);
}

function detonateFlash(point){
  // no detonation sound here on purpose - the throw sound (see throwGrenade) is delayed half a
  // second so its own clip already covers the pop
  const light = new THREE.PointLight(0xffffff, 9, 22);
  light.position.copy(point);
  scene.add(light);
  setTimeout(() => scene.remove(light), 90);
  spawnFlashPop(point);

  const def = WEAPONS.flash;
  const eye = camera.getWorldPosition(new THREE.Vector3());
  applyFlashTo(eye, point, def, intensity => {
    playerFlashMax = def.duration * intensity;
    playerFlashT = Math.max(playerFlashT, playerFlashMax);
  });

  enemies.forEach(enemy => {
    if (!enemy.alive) return;
    const eyePos = enemy.mesh.position.clone().add(new THREE.Vector3(0, soldierHeight * 0.85, 0));
    applyFlashTo(eyePos, point, def, intensity => {
      if (isFfa() && netRole === 'host' && ffaState.bots.has(enemy.netId)) {
        enemy.flashedT = Math.max(enemy.flashedT || 0, def.duration * intensity);
      } else if (enemy.isRemote) {
        // only that enemy's own client can white out their own screen - tell them to
        netBroadcast({ type: 'flash', targetId: enemy.netId, intensity });
      } else {
        enemy.flashedT = Math.max(enemy.flashedT || 0, def.duration * intensity);
      }
    });
  });
}

// approximate volumetric smoke with a cluster of soft grey sprites rather than a raymarched shader -
// cheap enough to never touch the framerate, and it still genuinely blocks AI sightlines and the
// player's own screen (see the LOS check in updateEnemies and the #smokeOverlay toggle in animate)
const smokeSpriteTex = softDiscTexture('rgba(200,202,198,0.9)');
function deploySmoke(point, replicated = false){
  if (isFfa() && !replicated) netBroadcast({type:'ffaSmoke', point:point.toArray()});
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

let hitMarkerTimer;
function showHitMarker(isHeadshot, isKill = false){
  clearTimeout(hitMarkerTimer);
  if (isHeadshot) audio.headshot(); else if (!audio.playSample('hitmarkerHit', 0.9)) audio.hitmarker();
  const el = document.getElementById('hitmarker');
  el.classList.toggle('kill', isKill);
  el.style.opacity = 1;
  el.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${isHeadshot ? 1.7 : 1.3})`;
  el.style.filter = isHeadshot ? 'drop-shadow(0 0 4px #ff0) brightness(1.5)' : 'none';
  hitMarkerTimer = setTimeout(() => {
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

// tactical helmet + goggles - fully encloses the skull (no bare-sphere-head gap underneath) and
// is parented directly to the head joint below, so it turns and nods with the neck/head instead
// of sitting at a fixed offset from the whole character.
function buildHelmetGear(){
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.55), helmetMat);
  dome.position.y = 0.015;
  dome.castShadow = true;
  g.add(dome);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.013, 8, 20, Math.PI * 1.15), helmetMat);
  brim.rotation.x = Math.PI / 2; brim.rotation.y = Math.PI * 0.08; brim.position.set(0, -0.025, -0.01);
  g.add(brim);
  [-1, 1].forEach(side => { // NVG-style side rail nubs
    const nub = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.02, 0.035), helmetMat);
    nub.position.set(side * 0.1, 0.03, -0.065);
    g.add(nub);
  });
  const faceCover = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.05, 4, 10), vestFabricMat);
  faceCover.rotation.x = Math.PI / 2; faceCover.position.set(0, -0.06, -0.075); faceCover.scale.set(1, 0.7, 0.4); g.add(faceCover);
  const goggles = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.045, 0.032, 2, 0.012), goggleMat);
  goggles.position.set(0, -0.028, -0.12);
  goggles.castShadow = true;
  g.add(goggles);
  // front shroud, ear protection and side rails so the silhouette reads as a modern combat
  // helmet rather than a bare dome
  const shroud = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.055, 0.035, 3, 0.01), helmetMat);
  shroud.position.set(0, 0.015, -0.08); g.add(shroud);
  [-1, 1].forEach(side => {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.026, 12), helmetMat);
    ear.rotation.z = Math.PI / 2; ear.position.set(side * 0.1, -0.025, 0.01); g.add(ear);
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.017, 0.035, 0.078, 3, 0.006), helmetMat);
    rail.position.set(side * 0.098, 0.02, 0.02); g.add(rail);
  });
  return g;
}

// plate carrier vest with front pouches, shoulder armor, radio and antenna - parented to the
// torso/chest joint below (local coordinates), so it moves and turns with the chest instead of
// sitting at a fixed world offset from the root.
function buildVestGear(){
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.34, 0.1, 3, 0.02), vestFabricMat);
  plate.position.set(0, 0, -0.1);
  plate.castShadow = true;
  g.add(plate);
  [-1, 1].forEach(side => {
    const pouch = new THREE.Mesh(new RoundedBoxGeometry(0.086, 0.1, 0.06, 3, 0.012), pouchMat);
    pouch.position.set(side * 0.11, -0.09, -0.135);
    pouch.castShadow = true;
    g.add(pouch);
    const shoulder = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.065, 0.13, 3, 0.016), vestFabricMat);
    shoulder.position.set(side * 0.2, 0.2, -0.02); shoulder.rotation.z = side * 0.15; shoulder.castShadow = true; g.add(shoulder);
  });
  const radio = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.12, 0.05, 3, 0.01), pouchMat);
  radio.position.set(-0.17, 0.11, 0.05); radio.castShadow = true; g.add(radio);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 8), goggleMat);
  antenna.position.set(-0.19, 0.24, 0.05); antenna.rotation.z = -0.12; g.add(antenna);
  return g;
}

// ---------- Procedural tactical soldier ----------
// Replaces the old CesiumMan clone entirely: a chain of pivot groups (hip -> knee,
// shoulder -> elbow) rather than a borrowed civilian rig. A prop parented to a hand/head/torso
// joint inherits every ancestor rotation automatically, so gear and weapons move as one piece
// with the body instead of sitting at a fixed offset that only ever looked right in a T-pose.
const soldierHeight = 1.8;
const soldierAssetsReady = true; // fully procedural now - nothing to load or wait on
const soldierReadyPromise = Promise.resolve();

const uniformMat = new THREE.MeshStandardMaterial({ color: 0x3c4030, roughness: 0.85, metalness: 0.04 });
const uniformDarkMat = new THREE.MeshStandardMaterial({ color: 0x24251d, roughness: 0.88, metalness: 0.03 });
const soldierSkinMat = new THREE.MeshStandardMaterial({ color: 0xc79a70, roughness: 0.75 });
const bootMat = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.7, metalness: 0.12 });
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1c1c19, roughness: 0.8, metalness: 0.05 });

const THIGH_LEN = 0.42, THIGH_R = 0.095, SHIN_LEN = 0.4, SHIN_R = 0.075;
const UPPER_ARM_LEN = 0.28, UPPER_ARM_R = 0.062, FOREARM_LEN = 0.26, FOREARM_R = 0.05;
const HIP_TO_GROUND = THIGH_LEN + SHIN_LEN + 0.12;
// the gun-holding (right) arm's rest pose is built from pure X-axis joint rotations only, so the
// two angles compose by simple addition (rotating about a shared axis commutes) - a weapon socket
// on the hand can then cancel that exact sum and always point forward, whatever the pose is.
// Shoulder and elbow must lean the SAME direction here (not oppose each other) - that's what
// extends the arm forward-and-up to chest height; opposing signs fold it back down near the knee.
const RIGHT_SHOULDER_REST_X = 1.0, RIGHT_ELBOW_REST_X = 0.5;

// one "joint" is a pivot Group at the hinge with the limb mesh hanging beyond it - rotating the
// pivot swings the whole limb from that hinge, the same idea a bone would give
function makeJointLimb(radius, length, mat){
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), mat);
  mesh.position.y = -(length / 2 + radius * 0.35);
  mesh.castShadow = true; mesh.receiveShadow = true;
  pivot.add(mesh);
  return pivot;
}

// builds one full tactical soldier as a hierarchy of pivot groups and capsule/cylinder meshes -
// never a single mesh, never a raw unrounded box for the body. Returns { root, rig } where rig
// exposes the joints animateSoldierRig() drives every frame and the socket weapons attach to.
function createTacticalSoldier(){
  const root = new THREE.Group();
  const rig = { legs: {}, arms: {} };

  const hips = new THREE.Group();
  hips.position.y = HIP_TO_GROUND;
  root.add(hips);
  rig.hips = hips;

  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 4, 8), uniformDarkMat);
  pelvis.castShadow = true;
  hips.add(pelvis);

  [-1, 1].forEach(side => {
    const key = side < 0 ? 'L' : 'R';
    const hip = makeJointLimb(THIGH_R, THIGH_LEN, uniformDarkMat);
    hip.position.set(side * 0.11, -0.02, 0);
    const knee = makeJointLimb(SHIN_R, SHIN_LEN, uniformDarkMat);
    knee.position.y = -THIGH_LEN;
    const kneepad = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.08, 0.07, 2, 0.018), pouchMat);
    kneepad.position.set(0, -0.05, 0.06); kneepad.castShadow = true;
    knee.add(kneepad);
    const boot = new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.09, 0.22, 2, 0.02), bootMat);
    boot.position.set(0, -SHIN_LEN - 0.02, 0.04); boot.castShadow = true;
    knee.add(boot);
    hip.add(knee);
    hips.add(hip);
    rig.legs[key] = { hip, knee };
  });

  const torso = new THREE.Group();
  torso.position.y = 0.02;
  hips.add(torso);
  rig.torso = torso;

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.36, 4, 10), uniformMat);
  chest.position.y = 0.33;
  chest.castShadow = true; chest.receiveShadow = true;
  torso.add(chest);

  const vest = buildVestGear();
  vest.position.y = 0.34;
  torso.add(vest);

  const neck = new THREE.Group();
  neck.position.y = 0.63;
  torso.add(neck);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.07, 10), soldierSkinMat);
  neckMesh.position.y = 0.03; neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = 0.1;
  neck.add(head);
  rig.head = head;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), soldierSkinMat);
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), soldierSkinMat);
  jaw.position.set(0, -0.055, 0.025); jaw.scale.set(1, 0.7, 0.85);
  head.add(jaw);
  head.add(buildHelmetGear());

  let weaponSocket = null;
  [-1, 1].forEach(side => {
    const key = side < 0 ? 'L' : 'R';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.22, 0.56, 0);
    torso.add(shoulder);
    const shoulderCap = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.09, 0.11, 3, 0.02), vestFabricMat);
    shoulderCap.castShadow = true;
    shoulder.add(shoulderCap);
    const upperArm = makeJointLimb(UPPER_ARM_R, UPPER_ARM_LEN, uniformMat);
    shoulder.add(upperArm);
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM_LEN;
    upperArm.add(elbow);
    const forearm = makeJointLimb(FOREARM_R, FOREARM_LEN, uniformDarkMat);
    elbow.add(forearm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), gloveMat);
    glove.position.y = -FOREARM_LEN - 0.04;
    glove.castShadow = true;
    forearm.add(glove);
    const hand = new THREE.Group();
    hand.position.y = -FOREARM_LEN - 0.05;
    forearm.add(hand);

    if (key === 'R') {
      // primary grip hand: rest pose is pure-X so the compensating socket rotation below exactly
      // cancels it, keeping the weapon pointed forward (-Z) regardless of the arm's own angle
      shoulder.rotation.x = RIGHT_SHOULDER_REST_X;
      elbow.rotation.x = RIGHT_ELBOW_REST_X;
      weaponSocket = new THREE.Object3D();
      weaponSocket.rotation.x = -(RIGHT_SHOULDER_REST_X + RIGHT_ELBOW_REST_X);
      hand.add(weaponSocket);
    } else {
      // support hand: reaches in toward the handguard, doesn't need to be exact since nothing
      // else attaches to it - same same-direction shoulder/elbow compounding as the gun arm
      shoulder.rotation.x = 1.0;
      shoulder.rotation.z = -0.35;
      elbow.rotation.x = 0.45;
    }
    rig.arms[key] = { shoulder, elbow, hand };
  });
  rig.weaponSocket = weaponSocket;

  return { root, rig };
}

function makeEnemySoldier(){
  const { root: g, rig } = createTacticalSoldier();
  g.userData.rig = rig;
  g.userData.animPhase = Math.random() * Math.PI * 2; // desync identical bots' walk cycles

  // invisible hit-detection proxies - independent of the visible rig so damage never depends on
  // raycasting the animated meshes themselves (which would test whatever pose happened to be
  // current, making hits feel disconnected from what's on screen)
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

  // rifle prop attached to the weapon socket on the right hand - it now inherits every joint
  // rotation the arm has, so it moves and turns with the body instead of floating at a fixed
  // offset from the root
  const gunProp = new THREE.Group();
  const gunBody = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.08, 0.5, 3, 0.014), enemyGunMat);
  const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 12), enemyGunMat);
  gunBarrel.rotation.x = Math.PI / 2;
  gunBarrel.position.z = -0.39;
  gunBody.castShadow = gunBarrel.castShadow = true;
  const gunStock = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.07, 0.2, 3, 0.014), enemyGunMat);
  gunStock.position.z = 0.27;
  const gunSight = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.025, 0.14, 3, 0.006), helmetMat);
  gunSight.position.set(0, 0.052, -0.08);
  const gunMag = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.16, 0.075, 2, 0.012), enemyGunMat);
  gunMag.position.set(0, -0.13, -0.15); gunMag.rotation.x = -0.2;
  gunMag.castShadow = true;
  gunProp.add(gunBody, gunBarrel, gunStock, gunSight, gunMag);
  gunProp.position.set(0.02, -0.02, -0.32); // small local grip adjustment relative to the hand socket
  rig.weaponSocket.add(gunProp);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.55); // barrel tip, local to gunProp so it tracks its orientation
  gunProp.add(muzzle);
  g.userData.muzzle = muzzle;

  return g;
}

// procedurally poses the rig every frame - idle breathing sway plus, when actually moving, a
// walk-cycle swing of the hips/knees driven by phase. The gun-holding arm keeps its steady
// "ready" pose (see createTacticalSoldier) rather than swinging like a free limb, which reads far
// more like a soldier carrying a weapon than a loose walking animation would.
function animateSoldierRig(mesh, dt, speed, crouching = false){
  const rig = mesh.userData.rig;
  if (!rig) return;
  const t = performance.now() * 0.001;
  mesh.userData.crouchBlend = THREE.MathUtils.lerp(mesh.userData.crouchBlend || 0, crouching ? 1 : 0, Math.min(1, dt * 12));
  const crouch = mesh.userData.crouchBlend;
  const moving = speed > 0.05;
  if (moving) mesh.userData.animPhase += dt * speed * 3.2;
  const phase = mesh.userData.animPhase;

  const strideAmp = moving ? Math.min(0.55, 0.18 + speed * 0.12) : 0;
  const leftHipWalk = Math.sin(phase) * strideAmp;
  const rightHipWalk = -Math.sin(phase) * strideAmp;
  const leftKneeWalk = Math.max(0, -Math.sin(phase + 0.6)) * strideAmp * 1.3;
  const rightKneeWalk = Math.max(0, Math.sin(phase - 0.6)) * strideAmp * 1.3;
  // A crouch is a joint pose, not a root translation: the feet stay planted while hips descend,
  // thighs angle forward and shins fold back. This prevents the old half-body-through-floor look.
  rig.legs.L.hip.rotation.x = THREE.MathUtils.lerp(leftHipWalk, -0.58, crouch);
  rig.legs.R.hip.rotation.x = THREE.MathUtils.lerp(rightHipWalk, -0.58, crouch);
  rig.legs.L.knee.rotation.x = THREE.MathUtils.lerp(leftKneeWalk, 1.12, crouch);
  rig.legs.R.knee.rotation.x = THREE.MathUtils.lerp(rightKneeWalk, 1.12, crouch);
  rig.hips.position.y = THREE.MathUtils.lerp(HIP_TO_GROUND, 0.62, crouch);

  // idle breathing (always) + a walking bob layered on top (only while moving)
  const breathe = Math.sin(t * 1.6) * 0.006;
  const stepBob = moving ? Math.abs(Math.sin(phase)) * 0.02 : 0;
  rig.torso.position.y = 0.02 + breathe + stepBob - crouch * 0.04;
  rig.torso.rotation.x = -crouch * 0.16;

  // a small counter-sway on the support arm only - the gun-holding arm stays put so the weapon
  // doesn't wobble around while walking
  rig.arms.L.shoulder.rotation.x = 1.0 + (moving ? Math.sin(phase) * 0.08 : 0) + crouch * 0.12;
}

const BOT_NAMES = ['Hani', 'Augusto', 'Tiago', 'Mathew', 'Sam', 'Marco', 'Shemeem', 'Aleef', 'Pablo', 'Chema'];

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
  if (!enemy.alive || (isFfa() && enemy.spawnProtected) || (gameMode === 'pvp' && roundState.phase === 'ended')) return false;
  if (isFfa() && netRole === 'host' && ffaState.bots.has(enemy.netId)) {
    trackDamageDealt(enemy.netId, dmg);
    return hitFfaBot({targetId:enemy.netId,fromId:netMyId,dmg,weaponName:meta?.weaponName,headshot:meta?.headshot,instantKill:meta?.instantKill});
  }
  spawnBlood(point);
  if (enemy.isRemote) {
    trackDamageDealt(enemy.netId, dmg);
    // don't own their health - tell their real client what happened and let their own broadcast update us.
    // netBroadcast reaches them directly if we're the host, or reaches the host if we're a client, which
    // then relays it onward (see the generic relay in handleNetMessage) - either way it arrives once.
    netBroadcast({ type: 'hit', roundNum: roundState.roundNum, weaponName: meta?.weaponName || 'Unknown', targetId: enemy.netId, fromId: netMyId, dmg, isHeadshot: !!(meta && meta.headshot), instantKill: meta?.instantKill === true });
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
    if (d.life <= 0) { scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); decals.splice(i, 1); }
  }
}

// ---------- Graffiti spray (T key) ----------
// sprayed onto whatever the crosshair is pointing at - a wall, the floor, or any collidable prop -
// oriented flush against that surface, fading in (rather than the blood decals' fade-out) up to a
// permanent 85% opacity cap, never fully opaque so it still reads as spray-painted rather than a
// hard sticker
const graffitiTextures = new Map();
for (const spray of SPRAYS) {
  const entry = { ready: false, texture: null };
  entry.texture = textureLoader.load(spray.file, () => { entry.ready = true; }, undefined,
    () => { entry.failed = true; console.warn('Spray could not load:', spray.id); });
  entry.texture.colorSpace = THREE.SRGBColorSpace;
  entry.texture.anisotropy = maxAnisotropy;
  graffitiTextures.set(spray.id, entry);
}
const GRAFFITI_MAX_OPACITY = 0.85;
const GRAFFITI_FADE_IN = 1.4;
const GRAFFITI_RANGE = SPRAY_RANGE;
const GRAFFITI_LIMIT = 48;
const graffitiDecals = [];
let lastLocalSpray = -Infinity;

function sprayGraffiti(sprayId){
  if (!gameStarted || !player.alive || shopOpen || pauseMenuOpen) return;
  const entry = graffitiTextures.get(sprayId);
  if (!entry?.ready) { socialUI.notice('Spray image is not ready. Try again shortly.'); return; }
  if (performance.now() - lastLocalSpray < SPRAY_COOLDOWN) {
    socialUI.notice('Wait a moment before spraying again.'); return;
  }
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = GRAFFITI_RANGE;
  const hits = raycaster.intersectObjects(envMeshes.concat(floorMeshes), false);
  if (hits.length === 0) { socialUI.notice('Aim at a wall or floor within 5 metres.'); return; }
  const hit = hits[0];
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();

  const message = { type: 'spray', sprayId, point: hit.point.toArray(), normal: normal.toArray() };
  if (gameMode === 'pvp') {
    if (netRole === 'host') acceptSocialMessage(message, netMyId);
    else if (netHostConn?.open) netSend(netHostConn, message);
    else { socialUI.notice('Room disconnected. Spray was not sent.'); return; }
  } else {
    createGraffitiDecal(message);
  }
  lastLocalSpray = performance.now();
  if (!audio.playSample('graffiti', 0.6, GRAFFITI_FADE_IN + 0.3)) audio.reloadThud(0.25, 200);
}

function createGraffitiDecal(message){
  if (!validSpray(message)) return;
  const entry = graffitiTextures.get(message.sprayId);
  if (!entry) return;
  const normal = new THREE.Vector3().fromArray(message.normal).normalize();
  const aspect = SPRAYS.find(s => s.id === message.sprayId).aspect || 1;
  const geo = new THREE.PlaneGeometry(1.5, 1.5 * aspect);
  const mat = new THREE.MeshBasicMaterial({ map: entry.texture, transparent: true, opacity: 0, alphaTest: 0.015,
    depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.fromArray(message.point).addScaledVector(normal, 0.012);

  // build the plane's basis directly (rather than aligning +Z then spinning randomly around it)
  // so the sprayed image always comes out upright - a random spin could land the graffiti
  // sideways or upside down on any wall it happened to be perpendicular-ish to
  const worldUp = new THREE.Vector3(0, 1, 0);
  const reference = Math.abs(normal.dot(worldUp)) > 0.999 ? new THREE.Vector3(0, 0, 1) : worldUp;
  const xAxis = reference.clone().cross(normal).normalize();
  const yAxis = normal.clone().cross(xAxis).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, normal));
  scene.add(mesh);
  graffitiDecals.push({ mesh, mat, t: 0 });
  while (graffitiDecals.length > GRAFFITI_LIMIT) {
    const oldest = graffitiDecals.shift();
    scene.remove(oldest.mesh);
    oldest.mesh.geometry.dispose();
    oldest.mat.dispose(); // The texture is shared and stays cached for subsequent sprays.
  }
}

function updateGraffitiDecals(dt){
  for (const g of graffitiDecals) {
    if (g.t >= GRAFFITI_FADE_IN) continue;
    g.t = Math.min(GRAFFITI_FADE_IN, g.t + dt);
    g.mat.opacity = (g.t / GRAFFITI_FADE_IN) * GRAFFITI_MAX_OPACITY;
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
    enemy.mesh.position.y = (currentMapMeta?.supportHeight ? currentMapMeta.supportHeight(enemy.mesh.position.x, enemy.mesh.position.z, enemy.mesh.position.y) : groundHeightAt(enemy.mesh.position.x, enemy.mesh.position.z)) + bounce;
    // Retain a remote corpse until respawn/next round. Removing it caused each
    // new dead snapshot to create another living avatar and replay its collapse.
    if (enemy.isRemote) continue;
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
  player.onGround = false;
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
  if (dist > site.radius * 0.5) {
    toSite.normalize();
    enemy.mesh.rotation.y = Math.atan2(toSite.x, toSite.z);
    ePos.x += toSite.x * enemy.speed * dt;
    ePos.z += toSite.z * enemy.speed * dt;
    ePos.y = groundHeightAt(ePos.x, ePos.z);
    animateSoldierRig(enemy.mesh, dt, enemy.speed);
    roundState.plantProgress = 0;
  } else {
    animateSoldierRig(enemy.mesh, dt, 0); // mostly still while planting, a little idle motion
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
    // updateCarrierEnemy can itself finish planting the bomb this same tick, moving phase to
    // 'planted' - don't then also treat this as a timeout for the round that just ended
    if (roundState.phase === 'live' && roundState.phaseT >= roundState.roundDuration) {
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
  if (!Number.isFinite(t)) return '∞';
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function endRound(winner, reason){
  // guards against ending the same round twice - e.g. the bomb finishing its plant (which sets
  // phase to 'planted') and the round timer expiring in that same frame both used to reach here,
  // each scheduling their own "advance to next round" timeout and silently skipping a round
  if (roundState.phase === 'ended') return;
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
let matchResultRecorded = false;
const PVP_WEAPON_ROTATION = ['glock', 'deagle', 'tec9', 'duals', 'ak47', 'm4a4', 'm4a1', 'awp', 'knife'];
let weaponBag = [], previousRoundWeapon = null;
let matchEpoch = 0;
function nextRoundWeapon(){
  if (!weaponBag.length) {
    weaponBag = [...PVP_WEAPON_ROTATION];
    for (let i = weaponBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weaponBag[i], weaponBag[j]] = [weaponBag[j], weaponBag[i]];
    }
    if (weaponBag.at(-1) === previousRoundWeapon) {
      [weaponBag[0], weaponBag[weaponBag.length - 1]] = [weaponBag.at(-1), weaponBag[0]];
    }
  }
  previousRoundWeapon = weaponBag.pop();
  return previousRoundWeapon;
}

function recordPvpResult(won){
  if (matchResultRecorded) return 0;
  matchResultRecorded = true;
  // Until authenticated opponent ratings exist on a server, use the provisional 1000 baseline.
  // The K-factor keeps the rating responsive for new players while remaining bounded over time.
  const opponentRating = 1000;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerProfile.rating) / 400));
  const score = won ? 1 : 0;
  const delta = Math.round(32 * (score - expected));
  playerProfile.rating = Math.max(0, playerProfile.rating + delta);
  playerProfile.matches += 1;
  if (won) playerProfile.wins += 1;
  else playerProfile.losses += 1;
  savePlayerProfile();
  renderProfileUI();
  return delta;
}

function netSend(conn, msg){
  if (conn && conn.open) conn.send({ ...msg, matchEpoch: msg.matchEpoch ?? matchEpoch });
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

// ---------- Free for all: host-owned bots, lifecycle and match clock ----------
// A map is usually either FFA-only (MAPS[id].ffa) or standard-only (everything else), but a
// "dual" map like Subway keeps its normal standard-mode slot and additionally opts into FFA.
const mapSupportsFfa = id => !!(MAPS[id]?.ffa || MAPS[id]?.dualFfa);
const mapSupportsStandard = id => !MAPS[id]?.ffa;
function selectFfaMaps(){
  if (gameStarted) return;
  // Practice has no ruleset of its own, but its maps aren't tied to isFfa() the way
  // pvp/knife/ffa are - it can freely offer the FFA maps alongside the regular ones.
  const showAllMaps = selectedMode === 'practice';
  const mapStillValid = id => isFfa() ? mapSupportsFfa(id) : mapSupportsStandard(id);
  if (!showAllMaps && !mapStillValid(selectedMap)) selectedMap = isFfa() ? 'dockyard' : 'arena';
  document.querySelectorAll('.mapCard').forEach(card => {
    card.hidden = showAllMaps ? false : !mapStillValid(card.dataset.map);
    card.classList.toggle('selected', card.dataset.map === selectedMap);
  });
  document.querySelectorAll('.teamSizeBtn').forEach(button => { button.hidden = isFfa(); });
  document.getElementById('ffaOptions').hidden = !isFfa();
  document.querySelectorAll('#rematchMap option').forEach(option => {
    option.disabled = !mapStillValid(option.value); option.hidden = option.disabled;
  });
  preloadMapTextures(selectedMap).then(updateStartButtonState);
}
function removeFfaAvatar(id){
  const index = enemies.findIndex(e => e.netId === id);
  if (index >= 0) { scene.remove(enemies[index].mesh); enemies.splice(index,1); }
  ffaState.bots.delete(id);
}
function pruneFfaAvatars(){
  for (const e of [...enemies]) if (e.isRemote && !netRoster.some(p => p.id === e.netId)) removeFfaAvatar(e.netId);
}
function ffaActors(exclude){
  const actors = enemies.filter(e => e.netId !== exclude && e.alive && !e.dying
    && netRoster.some(p => p.id === e.netId && p.ready))
    .map(e => ({id:e.netId, pos:e.mesh.position.clone().add(new THREE.Vector3(0,1.3,0)), protected:e.spawnProtected, avatar:e}));
  if (player.alive && netMyId !== exclude && netRoster.some(p => p.id === netMyId && p.ready))
    actors.push({id:netMyId,pos:player.pos.clone().add(new THREE.Vector3(0,-.4,0)),protected:ffaState.protection>0});
  return actors;
}
function ffaVisible(a,b){
  const direction = b.clone().sub(a), distance = direction.length();
  if (distance < .01) return true;
  const ray = new THREE.Raycaster(a,direction.normalize(),0,Math.max(.01,distance-.2));
  return ray.intersectObjects(envMeshes,false).length === 0 && !segmentCrossesSmoke(a.x,a.z,b.x,b.z);
}
function ffaSpawn(id){
  const layout = currentMapMeta.ffa;
  const actors = ffaActors(id).map(a=>a.pos);
  const spawn = chooseSpawn(layout.spawns,actors,(p,a)=>ffaVisible(new THREE.Vector3(p.x,(p.y ?? groundHeightAt(p.x,p.z))+1.4,p.z),a));
  return new THREE.Vector3(spawn.x,spawn.y ?? groundHeightAt(spawn.x,spawn.z),spawn.z);
}
function respawnFfaPlayer(){
  if (matchFinished) return;
  const p=ffaSpawn(netMyId);
  player.pos.copy(p); player.pos.y+=player.height;
  player.alive=true; player.health=player.maxHealth; player.crouching=false; player.ads=false;
  player.scopeLevel=0; player.pitch=0; player.yaw=Math.atan2(p.x,p.z); player.velY=0;
  player.onGround=false; // force a fresh multi-level support resolve instead of trusting a stale groundLevel from the previous life
  movementVelocity.set(0,0,0); camera.position.copy(player.pos);
  camera.fov=baseFov;camera.updateProjectionMatrix();
  ffaState.respawnT=0; ffaState.protection=FFA.protection;
  reloadGeneration++;reloadRuntime.reloading=false;fireCooldown=0; recoilKick=0; recoilYaw=0;
  document.getElementById('reloadLabel').style.opacity=0;
  playerFlashT=0; playerFlashMax=0; recentAttackers=[];lastDamageMeta={};
  resetKnifeSupply();
  if (!inventory.primary) inventory.primary='ak47';
  if (!inventory.secondary) inventory.secondary='glock';
  for (const slot of ['primary','secondary']) {
    const def=WEAPONS[inventory[slot]];ammoState[slot]={mag:def.mag,reserve:def.reserve};
  }
  equipSlot('primary',true);updateAmmoHUD();updateHealthHUD();netStateTimer=0;
}
function resetFfaBot(bot){
  const p=ffaSpawn(bot.netId);
  bot.mesh.position.copy(p);bot.targetPos.copy(p);bot.mesh.rotation.set(0,Math.atan2(-p.x,-p.z),0);
  bot.alive=true;bot.health=100;bot.dying=false;bot.deathT=0;bot.mesh.visible=true;
  bot.spawnProtected=true;bot.protection=FFA.protection;bot.respawnT=0;bot.targetId=null;
  bot.flashedT=0;bot.memory=0;bot.patrol=null;bot.lastSeen=null;bot.target=null;
  bot.thinkT=Math.random()*.2;bot.reaction=.35;bot.fireCooldown=.5;bot.burst=0;bot.path=[];bot.pathT=0;
}
function syncFfaBots(){
  if (netRole !== 'host' || !ffaState.active || ffaState.phase === 'ended') return;
  const humans=netRoster.filter(p=>!p.isBot), ready=humans.filter(p=>p.ready).length;
  const desired=Math.min(FFA.capacity-humans.length, ffaState.phase==='waiting'||ffaState.phase==='warmup'
    ? botCount(ready) : Math.max(0,FFA.minPlayers-humans.length));
  let changed=false;
  while(ffaState.bots.size>desired){
    const id=[...ffaState.bots.keys()].at(-1);removeFfaAvatar(id);netRoster=netRoster.filter(p=>p.id!==id);changed=true;
  }
  while(ffaState.bots.size<desired){
    const id=`ffa-bot-${++ffaState.serial}`;
    netRoster.push({id,team:id,isBot:true,ready:true,name:`BOT ${['Augusto','Hani','Mathew','Tiago','Shemeem','Luna'][ffaState.serial%6]}`});
    const bot=getOrCreateRemoteAvatar(id,id);bot.isBot=true;bot.speed=4.3;bot.weaponId='m4a1';
    ffaState.bots.set(id,bot);resetFfaBot(bot);changed=true;
  }
  if(changed)broadcastRoster();
}
function startFfa(rematch=false){
  if (!currentMapMeta.ffa) return;
  document.body.classList.add('ffaActive');
  matchFinished=false; ffaState.active=true; ffaState.resultShown=false; lastFfaKill=null; killcamHistory.clear(); killcamShots.length=0; killcamDeaths.length=0; killcamRecordT=0;
  ffaState.navigation=currentMapMeta.navigation ? currentMapMeta.navigation() : buildNavigation(currentMapMeta.ffa);
  if (netRole==='host'){
    ffaState.phase='waiting';ffaState.timer=FFA.warmup;ffaState.sendT=0;
    netStats={};receivedKills.clear();
    netRoster=netRoster.filter(p=>!p.isBot);ffaState.bots.clear();
    for(const p of netRoster){p.team=p.id;if(p.id===netMyId)p.ready=true;}
  }
  roundState.roundNum=1;roundState.phase='warmup';roundState.phaseT=0;
  money=0;updateMoneyHUD();
  respawnFfaPlayer();renderBuyMenu();
  document.querySelectorAll('#scoreboardBar .sbTeam, #scoreboardBar .sbScore').forEach(el=>{el.style.display='none';});
  document.getElementById('roundStats').style.display='none';
  document.querySelectorAll('#rematchMap option').forEach(o=>{o.disabled=!MAPS[o.value]?.ffa;o.hidden=o.disabled;});
  if(netRole==='host'){syncFfaBots();broadcastRoster();sendFfaSnapshot();}
  else netSend(netHostConn,{type:'ffaReady',rematch});
}
function sendFfaSnapshot(){
  netBroadcast({type:'ffaSnapshot',phase:ffaState.phase,timer:ffaState.timer,stats:netStats,
    bots:[...ffaState.bots.values()].map(b=>({id:b.netId,roundNum:1,
      pos:[b.mesh.position.x,b.mesh.position.y+player.height,b.mesh.position.z],yaw:b.mesh.rotation.y,
      health:b.health,alive:b.alive,protected:b.spawnProtected,crouching:false,weaponId:b.weaponId}))});
}
function handleFfaMessage(msg,fromId){
  if(msg.type==='roomFull'){
    if(netRole==='client'&&fromId==='host')document.getElementById('pvpStatus').textContent='ROOM FULL · 12 PLAYERS';
    return true;
  }
  if(msg.type==='ffaSmoke'){
    const valid=isFfa()&&Array.isArray(msg.point)&&msg.point.length===3&&msg.point.every(Number.isFinite)
      && Math.abs(msg.point[0])<40&&Math.abs(msg.point[2])<40&&msg.point[1]>=0&&msg.point[1]<20;
    if(valid&&((netRole==='client'&&fromId==='host')||(netRole==='host'&&netRoster.some(p=>p.id===fromId&&p.ready&&!p.isBot)))){
      if(netRole==='host')netRelayFromHost(msg,fromId);
      deploySmoke(new THREE.Vector3().fromArray(msg.point),true);
    }
    return true;
  }
  if(msg.type==='ffaReady'){
    if(isFfa()&&netRole==='host'){
      const entry=netRoster.find(p=>p.id===fromId&&!p.isBot);
      if(entry){entry.ready=true;entry.team=entry.id;syncFfaBots();broadcastRoster();if(ffaState.active)sendFfaSnapshot();}
    }
    return true;
  }
  if(msg.type==='ffaSnapshot'){
    if(!isFfa()||netRole!=='client'||fromId!=='host')return true;
    if(!gameStarted)return true; // ready sends another authoritative snapshot after the map exists
    const previous=ffaState.phase;
    ffaState.phase=msg.phase;ffaState.timer=msg.timer;netStats=msg.stats;
    roundState.phase=msg.phase==='live'?'live':msg.phase==='ended'?'ended':'warmup';
    if(previous!=='live'&&msg.phase==='live'){respawnFfaPlayer();showWaveBanner('FREE FOR ALL · FIRST TO 30');}
    for(const state of msg.bots||[])applyRemoteState(state);
    if(msg.phase==='ended')finishFfa();
    return true;
  }
  if(isFfa()&&netRole==='host'&&['hit','shot','kill','flash','knifeThrow'].includes(msg.type) && !netRoster.some(p=>p.id===fromId&&!p.isBot&&p.ready)) return true;
  if(isFfa()&&netRole==='host'&&msg.type==='state'){
    const p=netRoster.find(p=>p.id===fromId&&!p.isBot&&p.ready);
    if(!p||msg.id!==fromId)return true;
  }
  return false;
}
function hitFfaBot(msg){
  const bot=ffaState.bots.get(msg.targetId);
  if(!bot||!bot.alive||bot.protection>0||ffaState.phase==='ended'||!Number.isFinite(msg.dmg)||msg.dmg<=0)return false;
  if(!netRoster.some(p=>p.id===msg.fromId&&p.ready))return false;
  bot.health-=msg.instantKill?101:Math.min(msg.dmg,250);
  if(bot.health>0)return false;
  bot.alive=false;bot.health=0;bot.dying=true;bot.deathT=0;bot.fallDir=bot.mesh.rotation.y+Math.PI;
  bot.respawnT=FFA.respawn;spawnBloodDecal(bot.mesh.position.x,bot.mesh.position.z);
  const kill={type:'kill',roundNum:1,deathId:crypto.randomUUID(),victimId:bot.netId,killerId:msg.fromId,
    assistIds:[],scoring:ffaState.phase==='live',weaponName:msg.weaponName||'M4A1',headshot:!!(msg.headshot||msg.isHeadshot)};
  applyKillMessage(kill);netBroadcast(kill);return true;
}
function fireFfaBot(bot,target){
  bot.protection=0;bot.spawnProtected=false;
  const origin=bot.mesh.position.clone().add(new THREE.Vector3(0,1.4,0));
  const direction=target.pos.clone().sub(origin).normalize();
  // Angular error makes distant fire less accurate without a random damage lottery.
  direction.x+=(Math.random()-.5)*.04;direction.y+=(Math.random()-.5)*.035;direction.z+=(Math.random()-.5)*.04;direction.normalize();
  const ray=new THREE.Raycaster(origin,direction,0,60);
  const wall=ray.intersectObjects(envMeshes,false)[0];let distance=wall?.distance??60,victim=null;
  for(const actor of ffaActors(bot.netId)){
    if(actor.protected)continue;
    const hit=ray.ray.intersectSphere(new THREE.Sphere(actor.pos,.42),new THREE.Vector3());
    if(hit&&origin.distanceTo(hit)<distance){distance=origin.distanceTo(hit);victim=actor;}
  }
  const end=origin.clone().addScaledVector(direction,distance);
  const shot={type:'shot',id:bot.netId,roundNum:1,weaponId:bot.weaponId,end:end.toArray()};
  bot.targetPitch=Math.asin(Math.max(-1,Math.min(1,direction.y)));
  showRemoteShot(shot);netBroadcast(shot);
  if(!victim)return;
  const hit={type:'hit',roundNum:1,targetId:victim.id,fromId:bot.netId,dmg:22,weaponName:'M4A1'};
  if(victim.id===netMyId){lastDamageMeta={weaponName:'M4A1',headshot:false};damagePlayer(hit.dmg,bot.netId);}
  else if(ffaState.bots.has(victim.id))hitFfaBot(hit);
  else netSend(netClientConns[victim.id],hit);
}
function updateFfaBots(dt){
  for(const bot of ffaState.bots.values()){
    if(!bot.alive){bot.respawnT-=dt;if(bot.respawnT<=0)resetFfaBot(bot);continue;}
    bot.protection=Math.max(0,bot.protection-dt);bot.spawnProtected=bot.protection>0;
    bot.flashedT=Math.max(0,(bot.flashedT||0)-dt);bot.thinkT-=dt;bot.fireCooldown-=dt;bot.pathT-=dt;
    const pos=bot.mesh.position,eye=pos.clone().add(new THREE.Vector3(0,1.4,0));
    if(bot.thinkT<=0){
      bot.thinkT=.18;
      const visible=bot.flashedT>0?[]:ffaActors(bot.netId).filter(a=>{
        const delta=a.pos.clone().sub(eye),distance=delta.length();
        const forward=new THREE.Vector3(Math.sin(bot.mesh.rotation.y),0,Math.cos(bot.mesh.rotation.y));
        const inView=delta.clone().setY(0).normalize().dot(forward)>.12;
        return !a.protected&&distance<48&&(inView||distance<7||a.id===bot.targetId)&&ffaVisible(eye,a.pos);
      });
      visible.sort((a,b)=>eye.distanceToSquared(a.pos)-eye.distanceToSquared(b.pos));
      const target=visible.find(a=>a.id===bot.targetId)||visible[0];
      if(target){
        if(target.id!==bot.targetId)bot.reaction=.25+Math.random()*.25;
        bot.targetId=target.id;bot.target=target;bot.lastSeen=target.pos.clone();bot.memory=2.5;
      }else{bot.targetId=null;bot.target=null;}
    }
    bot.memory=(bot.memory||0)-dt;bot.reaction-=dt;
    const target=bot.target;
    let goal=target?.pos||(bot.memory>0?bot.lastSeen:null);
    if(!goal){
      if(!bot.patrol||pos.distanceTo(bot.patrol)<2){const n=ffaState.navigation.nodes[Math.floor(Math.random()*ffaState.navigation.nodes.length)];bot.patrol=new THREE.Vector3(n.x,n.y ?? groundHeightAt(n.x,n.z),n.z);}
      goal=bot.patrol;
    }
    let move=new THREE.Vector3();
    if(target&&eye.distanceTo(target.pos)<22&&Math.abs(target.pos.y-eye.y)<2){
      const aim=target.pos.clone().sub(eye);aim.y=0;aim.normalize();
      move.set(aim.z,0,-aim.x).multiplyScalar(Math.sin(performance.now()*.001+Number(bot.netId.split('-').at(-1)))>0?1:-1);
      move.multiplyScalar(1.8*dt);
    }else{
      if(bot.pathT<=0){bot.path=ffaState.navigation.path(pos,goal);bot.pathT=.9;}
      while(bot.path.length&&Math.hypot(bot.path[0].x-pos.x,bot.path[0].z-pos.z)<.5&&Math.abs((bot.path[0].y ?? pos.y)-pos.y)<.6)bot.path.shift();
      if(bot.path.length){const n=bot.path[0];move.set(n.x-pos.x,0,n.z-pos.z);move.normalize().multiplyScalar(Math.min(move.length(),bot.speed*dt));}
    }
    // Swept small steps plus inflated layout obstacles prevent clipping around cover.
    const old=pos.clone();
    if(selectedMap === 'mall'){
      const xY=mallWalk(pos.x+move.x,pos.z,pos.y);
      if(xY!==null){pos.x+=move.x;pos.y=xY;}
      const zY=mallWalk(pos.x,pos.z+move.z,pos.y);
      if(zY!==null){pos.z+=move.z;pos.y=zY;}
    }else{
      if(!blockedAt(currentMapMeta.ffa,pos.x+move.x,pos.z,.65))pos.x+=move.x;
      if(!blockedAt(currentMapMeta.ffa,pos.x,pos.z+move.z,.65))pos.z+=move.z;
      pos.y=groundHeightAt(pos.x,pos.z);
    }
    const look=(target?.pos||goal).clone().sub(pos),desired=Math.atan2(look.x,look.z);
    const delta=Math.atan2(Math.sin(desired-bot.mesh.rotation.y),Math.cos(desired-bot.mesh.rotation.y));
    bot.mesh.rotation.y+=delta*(1-Math.exp(-10*dt));bot.targetYaw=bot.mesh.rotation.y;bot.targetPos.copy(pos);
    animateSoldierRig(bot.mesh,dt,old.distanceTo(pos)/Math.max(dt,.001),false);
    if(target&&bot.reaction<=0&&bot.fireCooldown<=0&&Math.abs(delta)<.18&&!bot.flashedT&&ffaVisible(eye,target.pos)){
      fireFfaBot(bot,target);bot.burst++;
      bot.fireCooldown=bot.burst%3===0?.5+Math.random()*.35:.15;
    }
  }
}
// Final-kill replay uses locally observed actor tracks and discrete shot/death events.
// Remote actors remain limited by the network snapshots received by this client.
function weaponIdFromName(name){
  return Object.entries(WEAPONS).find(([, def]) => def.name === name)?.[0] || null;
}
function killcamName(id){ return id === netMyId ? 'YOU' : (netRoster.find(p => p.id === id)?.name || 'Player').toUpperCase(); }
// Replay owns camera and actor transforms until cleanup; live death animation is suspended.
const KILLCAM_WINDOW_MS = 5000, RANKING_DURATION = 5, KILLCAM_TAIL_MS = 900;
let killcamActive=false, killcamDone=null, killcamWeaponVisual=null, replay=null;
function meshPose(mesh){
  const nodes=[];mesh.traverse(node=>nodes.push(node));
  const pose=new Float32Array(nodes.length*10);
  nodes.forEach((node,i)=>{node.position.toArray(pose,i*10);node.quaternion.toArray(pose,i*10+3);node.scale.toArray(pose,i*10+7);});
  return pose;
}
function applyReplayPose(mesh,s){
  if(!s.a.pose)return;
  const nodes=[];mesh.traverse(node=>nodes.push(node));
  const a=s.a.pose,b=s.b.pose?.length===a.length?s.b.pose:a;
  const qa=new THREE.Quaternion(),qb=new THREE.Quaternion();
  nodes.forEach((node,i)=>{
    const k=i*10;if(k+9>=a.length)return;
    node.position.fromArray(a,k).lerp(new THREE.Vector3().fromArray(b,k),s.alpha);
    qa.fromArray(a,k+3);qb.fromArray(b,k+3);node.quaternion.copy(qa.slerp(qb,s.alpha));
    node.scale.fromArray(a,k+7).lerp(new THREE.Vector3().fromArray(b,k+7),s.alpha);
  });
}
function playKillcam(onDone){
  const kill=lastFfaKill,track=kill&&killcamHistory.get(kill.killerId);
  if(!track||track.length<2||kill.t<track[0].t){onDone();return;}
  const start=Math.max(track[0].t,kill.t-KILLCAM_WINDOW_MS);
  const shots=killcamShots.filter(e=>e.t>=start&&e.t<=kill.t+120);
  const fatalShot=shots.filter(e=>e.id===kill.killerId&&e.t<=kill.t+30).at(-1);
  const fatalTime=fatalShot&&kill.t-fatalShot.t<750?fatalShot.t:kill.t;
  replay={kill,start,time:start-.001,end:kill.t+KILLCAM_TAIL_MS,fatalTime,shots,
    cameraPosition:camera.position.clone(),cameraRotation:camera.rotation.clone(),fov:camera.fov,
    weaponPosition:weaponGroup.position.clone(),weaponRotation:weaponGroup.rotation.clone(),weaponVisible:weaponGroup.visible,
    muzzlePosition:flashLight.position.clone(),spritePosition:flashSprite.position.clone(),actors:[],kick:0,flash:0,weaponId:null};
  for(const avatar of enemies){
    replay.actors.push({mesh:avatar.mesh,id:avatar.netId,pose:meshPose(avatar.mesh),visible:avatar.mesh.visible});
    avatar.mesh.visible=false;
  }
  // The local player normally has no world avatar, but must be visible as a replay victim.
  if(kill.killerId!==netMyId&&killcamHistory.has(netMyId)){
    const mesh=makeEnemySoldier();scene.add(mesh);
    replay.actors.push({mesh,id:netMyId,temporary:true});
  }
  killcamActive=true;killcamDone=onDone;
  if(currentVisual)currentVisual.group.visible=false;
  weaponGroup.visible=true;weaponGroup.position.set(.015,-.015,.04);weaponGroup.rotation.set(0,0,0);
  document.getElementById('hud').style.display='none';
  document.getElementById('scopeOverlay').style.display='none';
  const label=document.getElementById('killcamLabel');
  label.textContent=`FINAL KILL · ${killcamName(kill.killerId)} → ${killcamName(kill.victimId)} · ${kill.weaponName.toUpperCase()}`;
  document.getElementById('killcamOverlay').classList.add('show');
}
function equipReplayWeapon(id){
  if(replay.weaponId===id)return;
  if(killcamWeaponVisual)weaponGroup.remove(killcamWeaponVisual.group);
  replay.weaponId=id;
  killcamWeaponVisual=WEAPONS[id]?buildWeaponVisual(id):null;
  if(killcamWeaponVisual)weaponGroup.add(killcamWeaponVisual.group);
}
function fireKillcamShot(shot){
  const firstPerson=shot.id===replay.kill.killerId;
  if(firstPerson){
    equipReplayWeapon(shot.weaponId);replay.kick=1;replay.flash=.065;
    flashLight.intensity=5;flashSpriteMat.opacity=1;
  }
  if(shot.origin&&shot.end){
    const origin=new THREE.Vector3().fromArray(shot.origin),direction=new THREE.Vector3().fromArray(shot.end).sub(origin);
    const length=direction.length();if(length>.001)drawTracer(origin,direction.normalize(),length);
    if(!firstPerson)spawnEnemyMuzzleFlash(origin);
  }
  const samples={tec9:'smg',duals:'smg'};
  if(!audio.playSample(samples[shot.weaponId]||shot.weaponId,firstPerson?.85:.25))audio.gunshot(GUNSHOT_PROFILES[shot.weaponId]||{});
}
function finishKillcam(){
  for(const actor of replay.actors){
    if(actor.temporary){scene.remove(actor.mesh);continue;}
    applyReplayPose(actor.mesh,{a:{pose:actor.pose},b:{pose:actor.pose},alpha:0});actor.mesh.visible=actor.visible;
  }
  if(killcamWeaponVisual)weaponGroup.remove(killcamWeaponVisual.group);
  killcamWeaponVisual=null;flashLight.intensity=0;flashSpriteMat.opacity=0;
  if(currentVisual){currentVisual.group.visible=true;currentVisual.group.add(flashLight,flashSprite);}
  flashLight.position.copy(replay.muzzlePosition);flashSprite.position.copy(replay.spritePosition);
  weaponGroup.position.copy(replay.weaponPosition);weaponGroup.rotation.copy(replay.weaponRotation);weaponGroup.visible=replay.weaponVisible;
  camera.position.copy(replay.cameraPosition);camera.rotation.copy(replay.cameraRotation);camera.fov=replay.fov;camera.updateProjectionMatrix();
  killcamActive=false;replay=null;
  document.getElementById('killcamOverlay').classList.remove('show');document.getElementById('hud').style.display='block';
  const done=killcamDone;killcamDone=null;done?.();
}
function updateKillcam(dt){
  const previous=replay.time;
  replay.time=Math.min(replay.end,advanceReplay(previous,dt*1000,replay.fatalTime));
  const simulationDt=(replay.time-previous)/1000;
  const pose=sampleReplay(killcamHistory.get(replay.kill.killerId),replay.time);
  camera.position.set(pose.x,pose.y,pose.z);camera.rotation.set(pose.pitch,pose.yaw,0,'YXZ');
  camera.fov=pose.fov||baseFov;camera.updateProjectionMatrix();
  equipReplayWeapon(pose.weaponId||weaponIdFromName(replay.kill.weaponName));
  for(const actor of replay.actors){
    const track=killcamHistory.get(actor.id),s=sampleReplay(track,replay.time);
    actor.mesh.visible=!!s&&actor.id!==replay.kill.killerId&&replay.time>=track[0].t;
    if(!actor.mesh.visible)continue;
    applyReplayPose(actor.mesh,s);
    if(actor.temporary){
      actor.mesh.position.set(s.x,s.feet,s.z);actor.mesh.rotation.set(0,s.yaw,0);
      animateSoldierRig(actor.mesh,simulationDt,0,s.crouching);
    }
    // Explicit death times, never the end of a position track, trigger the collapse.
    const death=killcamDeaths.filter(e=>e.id===actor.id&&e.t<=replay.time&&e.t>=s.t).at(-1);
    if(death){
      const p=Math.min(1,(replay.time-death.t)/700),ease=1-(1-p)**3;
      actor.mesh.rotation.x=ease*Math.PI/2.1*Math.sin(s.yaw+Math.PI);
      actor.mesh.rotation.z=ease*Math.PI/2.1*Math.cos(s.yaw+Math.PI);
    }
  }
  replay.kick*=Math.exp(-simulationDt*15);replay.flash=Math.max(0,replay.flash-simulationDt);
  if(killcamWeaponVisual){killcamWeaponVisual.group.position.z=replay.kick*.09;killcamWeaponVisual.group.rotation.x=replay.kick*.10;}
  if(!replay.flash){flashLight.intensity=0;flashSpriteMat.opacity=0;}
  for(const shot of replayEvents(replay.shots,previous,replay.time))fireKillcamShot(shot);
  if(replay.time>=replay.end)finishKillcam();
}
function renderFfaRanking(order){
  document.getElementById('ffaRankingList').innerHTML = order.map((p, i) => {
    const s = ensureStats(p.id);
    const tag = (p.founder ? '★ ' : '') + (p.country ? flagEmoji(p.country) + ' ' : '') + (p.clan ? `[${p.clan}] ` : '');
    return `<div class="rankRow${p.id === netMyId ? ' rankSelf' : ''}"><span class="rankPos">${i + 1}</span><span class="rankName">${tag}${p.name}${p.id === netMyId ? ' (YOU)' : ''}</span><span class="rankKD">${s.kills}-${s.deaths}</span></div>`;
  }).join('');
}
function playMatchEndSequence(order, onDone){
  renderFfaRanking(order);
  document.getElementById('ffaRankingOverlay').classList.add('show');
  renderer.domElement.style.filter = 'grayscale(1) contrast(1.05)';
  setTimeout(() => {
    document.getElementById('ffaRankingOverlay').classList.remove('show');
    renderer.domElement.style.filter = '';
    playKillcam(onDone);
  }, RANKING_DURATION * 1000);
}
function finishFfa(){
  if(ffaState.resultShown)return;
  ffaState.resultShown=true;ffaState.phase='ended';roundState.phase='ended';matchFinished=true;
  clearGameplayInput();shopOpen=false;document.getElementById('buyMenu').style.display='none';
  document.exitPointerLock();
  const order=rankPlayers(netRoster,netStats),winner=order[0],stats=ensureStats(netMyId);
  const top=winner?ensureStats(winner.id):{kills:0,deaths:0};
  const leaders=order.filter(p=>ensureStats(p.id).kills===top.kills&&ensureStats(p.id).deaths===top.deaths);
  const rank=1+order.filter(p=>{const s=ensureStats(p.id);return s.kills>stats.kills||(s.kills===stats.kills&&s.deaths<stats.deaths);}).length;
  const won=leaders.some(p=>p.id===netMyId);
  document.getElementById('resultTitle').textContent=won?(leaders.length>1?'JOINT FIRST':'VICTORY'):'FREE FOR ALL';
  document.getElementById('resultScore').textContent=winner?`${leaders.length>1?'SHARED LEAD':winner.name} · ${top.kills} KILLS`:'MATCH OVER';
  document.getElementById('resultDetail').textContent=`PLACE ${rank} / ${order.length} · ${stats.kills} KILLS · ${stats.deaths} DEATHS`;
  document.getElementById('resultRating').textContent='UNRANKED · FREE LOADOUTS';
  document.getElementById('rematchMap').value=selectedMap;
  document.getElementById('rematchControls').hidden=netRole!=='host';document.getElementById('rematchWaiting').hidden=netRole==='host';
  playMatchEndSequence(order, () => document.getElementById('matchResult').showModal());
}
function updateFfa(dt){
  if(!ffaState.active)return;
  killcamRecordT-=dt; if(killcamRecordT<=0){killcamRecordT=1/30;recordKillcamFrame();}
  ffaState.protection=Math.max(0,ffaState.protection-dt);
  if(!player.alive){ffaState.respawnT-=dt;if(ffaState.respawnT<=0)respawnFfaPlayer();}
  if(netRole==='host'){
    const humans=netRoster.filter(p=>!p.isBot&&p.ready).length;
    if(ffaState.phase==='waiting'||ffaState.phase==='warmup'){
      if(canStart(humans,ffaState.bots.size)){
        ffaState.phase='warmup';ffaState.timer-=dt;
        if(ffaState.timer<=0){
          ffaState.phase='live';ffaState.timer=ffaTimeLimit;netStats={};receivedKills.clear();roundState.phase='live';
          respawnFfaPlayer();for(const b of ffaState.bots.values())resetFfaBot(b);
          showWaveBanner('FREE FOR ALL · FIRST TO 30');
        }
      }else{ffaState.phase='waiting';ffaState.timer=FFA.warmup;}
    }else if(ffaState.phase==='live'){
      ffaState.timer=Math.max(0,ffaState.timer-dt);
      if(ffaState.timer<=0||Object.values(netStats).some(s=>s.kills>=ffaKillGoal)){finishFfa();sendFfaSnapshot();return;}
    }
    updateFfaBots(dt);ffaState.sendT-=dt;
    if(ffaState.sendT<=0){ffaState.sendT=.1;sendFfaSnapshot();}
  }else if(ffaState.phase==='live'||ffaState.phase==='warmup')ffaState.timer=Math.max(0,ffaState.timer-dt);
  const order=rankPlayers(netRoster,netStats),leader=order[0],humans=netRoster.filter(p=>!p.isBot&&p.ready).length;
  document.getElementById('roundPhaseLabel').textContent=ffaState.phase==='live'?'FREE FOR ALL':ffaState.phase==='waiting'?'WAITING':'WARMUP';
  document.getElementById('roundTimer').textContent=formatRoundTime(ffaState.timer);
  const hud=document.getElementById('ffaHud');hud.hidden=false;
  hud.textContent=`${netRoster.filter(p=>p.ready).length}/12 PLAYERS · YOU ${ensureStats(netMyId).kills}/${Number.isFinite(ffaKillGoal)?ffaKillGoal:'∞'} · LEADER ${leader?.name||'—'} ${leader?ensureStats(leader.id).kills:0}`;
  document.getElementById('centerMessage').textContent=ffaState.phase==='waiting'?`WAITING FOR PLAYERS · ${humans}/${FFA.minHumans} HUMANS · BOTS FILL TO 6`:
    !player.alive?`RESPAWNING IN ${Math.ceil(ffaState.respawnT)}`:ffaState.protection>0?'SPAWN PROTECTION · FIRING CANCELS IT':'';
}

async function hostRoom(teamSize){
  netTeamSize = teamSize;
  netRole = 'host';
  const config = await getIceConfig();
  netPeer = new Peer('lr-' + generateRoomCode(), { config });
  netPeer.on('open', id => {
    netMyId = id;
    const shortCode = id.replace('lr-', '');
    netRoster = [{ id, team: 'A', isBot: false, name: localPlayerName, country: playerProfile.country || '', clan: playerProfile.clan || '', founder: !!playerProfile.isFounder }];
    document.getElementById('pvpStatus').textContent = 'Waiting for players...';
    // a link is one click for whoever receives it - no code to mistype or copy/paste around
    const linkBox = document.getElementById('pvpRoomLink');
    const linkInput = document.getElementById('pvpRoomLinkInput');
    if (linkBox && linkInput) {
      linkInput.value = `${location.origin}${location.pathname}?room=${shortCode}`;
      linkBox.style.display = 'flex';
    }
    updateScoreboardNames();
    updateStartButtonState();
  });
  netPeer.on('connection', conn => {
    netClientConns[conn.peer] = conn;
    conn.on('data', data => handleNetMessage(data, conn.peer));
    conn.on('close', () => { delete netClientConns[conn.peer]; netRoster = netRoster.filter(p => p.id !== conn.peer); if (isFfa()) { removeFfaAvatar(conn.peer); syncFfaBots(); } broadcastRoster(); });
    conn.on('error', err => { document.getElementById('pvpStatus').textContent = 'A player failed to connect: ' + err.type; });
    conn.on('open', () => {
      if (isFfa() && netRoster.filter(p => !p.isBot).length >= FFA.capacity) {
        netSend(conn, {type:'roomFull'}); setTimeout(() => conn.close(), 100); return;
      }
      const team = netRoster.filter(p => p.team === 'A').length <= netRoster.filter(p => p.team === 'B').length ? 'A' : 'B';
      netRoster.push({ id: conn.peer, team: isFfa() ? conn.peer : team, isBot: false, ready: false, name: 'Player', country: '', clan: '', founder: false });
      if (isFfa()) syncFfaBots();
      document.getElementById('pvpStatus').textContent = `${netRoster.length} player(s) connected`;
      broadcastRoster();
      if (matchmakingActive) stopMatchmaking(); // someone actually joined - the search succeeded
      if (!isFfa() && roundState.phase === 'warmup' && !warmupDroppedToShort && netRoster.filter(p => !p.isBot).length >= 2) {
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
      netSend(netHostConn, { type: 'name', name: localPlayerName, country: playerProfile.country || '', clan: playerProfile.clan || '', founder: !!playerProfile.isFounder });
      updateStartButtonState();
    });
    netHostConn.on('data', data => handleNetMessage(data, 'host'));
    netHostConn.on('close', () => {
      if (isFfa() && gameStarted) {
        matchFinished = true; ffaState.active = false; roundState.phase = 'ended'; clearGameplayInput(); document.exitPointerLock();
        document.getElementById('resultTitle').textContent = 'HOST DISCONNECTED';
        document.getElementById('resultScore').textContent = 'CONNECTION LOST';
        document.getElementById('resultDetail').textContent = 'Return to HQ to join or create another room.';
        document.getElementById('resultRating').textContent = 'UNRANKED · NO RATING CHANGE';
        document.getElementById('rematchControls').hidden = true; document.getElementById('rematchWaiting').hidden = true;
        if (!document.getElementById('matchResult').open) document.getElementById('matchResult').showModal();
      }
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

// ---------- Global "Find Match" ----------
// Every searching player becomes a host (see hostRoom) so it has a real, connectable peer id to
// either advertise (if it ends up waiting) or hand over (if it immediately finds someone else
// already waiting). findOrQueue() (matchmaking.js) does the actual pairing server-side.
let matchmakingActive = false, matchmakingRetryTimer = null, matchmakingPeerId = null;
function waitForOwnPeerId(){
  return new Promise(resolve => {
    (function poll(){ netMyId ? resolve(netMyId) : setTimeout(poll, 50); })();
  });
}
async function attemptMatch(){
  let opponentId;
  try {
    opponentId = await findOrQueue(matchmakingPeerId, selectedRuleset, netTeamSize);
  } catch (err) {
    document.getElementById('pvpStatus').textContent = 'Matchmaking unavailable: ' + (err.message || err);
    stopMatchmaking();
    return;
  }
  if (!matchmakingActive) return; // cancelled while the request was in flight
  if (opponentId) {
    // someone was already waiting - abandon our own (never-advertised) host peer and join theirs
    // instead, through the exact same path a manual room-code join uses.
    const hostPeer = netPeer;
    matchmakingActive = false;
    netRole = null; netPeer = null; netMyId = null; netHostConn = null; netClientConns = {};
    hostPeer.destroy();
    document.getElementById('pvpStatus').textContent = 'Match found - connecting...';
    joinRoom(opponentId.replace(/^lr-/, ''));
    return;
  }
  document.getElementById('pvpStatus').textContent = 'Searching for an opponent... you\'ll connect automatically once matched.';
  matchmakingRetryTimer = setTimeout(attemptMatch, 20000); // re-check periodically in case of a rare double-miss, and to keep our queue row from expiring
}
async function startMatchmaking(){
  if (matchmakingActive) return;
  matchmakingActive = true;
  document.getElementById('pvpFindMatchBtn').disabled = true;
  document.getElementById('pvpFindMatchBtn').style.display = 'none';
  document.getElementById('pvpCancelMatchBtn').style.display = 'block';
  document.getElementById('pvpStatus').textContent = 'Setting up...';
  await hostRoom(netTeamSize);
  matchmakingPeerId = await waitForOwnPeerId();
  if (!matchmakingActive) return; // cancelled while waiting for the peer id
  document.getElementById('pvpRoomLink').style.display = 'none'; // matchmaking never shows a shareable link
  attemptMatch();
}
// called both on an explicit cancel and once a real opponent actually connects (see hostRoom) -
// the difference is only whether we tear down the host peer we've been advertising.
function stopMatchmaking(){
  matchmakingActive = false;
  clearTimeout(matchmakingRetryTimer);
  if (matchmakingPeerId) leaveQueue(matchmakingPeerId);
  matchmakingPeerId = null;
  document.getElementById('pvpFindMatchBtn').disabled = false;
  document.getElementById('pvpFindMatchBtn').style.display = 'block';
  document.getElementById('pvpCancelMatchBtn').style.display = 'none';
}
function cancelMatchmaking(){
  if (!matchmakingActive) return;
  const hostPeer = netPeer;
  stopMatchmaking();
  netRole = null; netPeer = null; netMyId = null; netHostConn = null; netClientConns = {};
  hostPeer?.destroy();
  document.getElementById('pvpStatus').textContent = '';
}

function broadcastRoster(){
  // carries the host's map choice too - a joining client used to always build its own locally
  // selected map (hardcoded to Desert back when that was the only option), which would silently
  // desync the two peers onto different geometry the moment a second map existed
  // killGoal/timeLimit: 0 stands in for Infinity ("unlimited") since Infinity doesn't survive
  // the PeerJS data channel's serialization - see ffaKillGoal/ffaTimeLimit's declaration comment.
  netBroadcast({ type: 'roster', roster: netRoster, teamSize: netTeamSize, map: selectedMap, ruleset: selectedRuleset,
    killGoal: Number.isFinite(ffaKillGoal) ? ffaKillGoal : 0, timeLimit: Number.isFinite(ffaTimeLimit) ? ffaTimeLimit : 0 });
  updateScoreboardNames();
}

// per-player kill/assist/death counts for the TAB scoreboard - PvP only, kept in sync across
// peers by applying every 'kill' message locally in addition to broadcasting it (broadcasting
// never loops a message back to its own sender, same as the roster/warmup broadcasts above)
let netStats = {};
const receivedKills = new Set();
const roundLives = new RoundLives();
// FFA killcam: always holds the most recent scoring kill (see applyKillMessage), so whatever it
// points to when the match ends is, by definition, the kill that ended it.
let lastFfaKill = null;
// Rolling six-second pose history, sampled at 30 Hz and at every recorded shot.
const killcamHistory = new Map();
let killcamRecordT = 0;
const KILLCAM_HISTORY_MS = 6000;
const killcamShots=[],killcamDeaths=[];
function recordKillcamShot(msg){
  if(!isFfa()||killcamActive||ffaState.phase!=='live')return;
  recordKillcamFrame();
  const avatar=enemies.find(e=>e.netId===msg.id);
  const origin=msg.origin||avatar?.mesh.position.clone().add(new THREE.Vector3(0,1.4,0)).toArray();
  killcamShots.push({...msg,t:performance.now(),origin:origin?.slice(),end:msg.end?.slice()});
  while(killcamShots.length&&performance.now()-killcamShots[0].t>KILLCAM_HISTORY_MS)killcamShots.shift();
}
function recordKillcamFrame(){
  if(killcamActive||matchFinished)return;
  const t=performance.now();
  const push=(id,s)=>{
    let arr=killcamHistory.get(id);if(!arr){arr=[];killcamHistory.set(id,arr);}
    arr.push({t,...s});while(arr.length>1&&t-arr[0].t>KILLCAM_HISTORY_MS)arr.shift();
  };
  push(netMyId,{x:player.pos.x,y:player.pos.y,z:player.pos.z,feet:player.pos.y-(player.crouching?player.crouchHeight:player.height),
    yaw:camera.rotation.y,pitch:camera.rotation.x,fov:camera.fov,alive:player.alive,crouching:player.crouching,
    weaponId:inventory[currentSlot]||'knife'});
  for(const e of enemies){
    if(!e.netId)continue;
    const h=e.targetCrouching?player.crouchHeight:player.height;
    push(e.netId,{x:e.mesh.position.x,y:e.mesh.position.y+h,z:e.mesh.position.z,feet:e.mesh.position.y,
      yaw:e.isBot?e.mesh.rotation.y:(e.targetYaw??e.mesh.rotation.y),pitch:e.targetPitch||0,fov:e.targetFov||baseFov,
      alive:e.alive,crouching:!!e.targetCrouching,weaponId:e.weaponId||e.mesh.userData.weaponId,pose:meshPose(e.mesh)});
  }
  while(killcamDeaths.length&&t-killcamDeaths[0].t>KILLCAM_HISTORY_MS)killcamDeaths.shift();
}
let lastDamageMeta = {};
// Per-life damage exchange with each opponent, from the local player's own perspective only -
// keyed by the OTHER party's id, cleared for that id once they die (a fresh life starts clean).
const damageDealt = {}, damageTaken = {};
function trackDamageDealt(id, dmg){ if (!id) return; const s = damageDealt[id] || (damageDealt[id] = {dmg: 0, hits: 0}); s.dmg += dmg; s.hits++; }
function trackDamageTaken(id, dmg){ if (!id) return; const s = damageTaken[id] || (damageTaken[id] = {dmg: 0, hits: 0}); s.dmg += dmg; s.hits++; }
let dmgExchangeTimer;
function showDamageExchange(opponentId){
  const name = (netRoster.find(p => p.id === opponentId)?.name || 'Player').toUpperCase();
  const dealt = damageDealt[opponentId] || {dmg: 0, hits: 0};
  const taken = damageTaken[opponentId] || {dmg: 0, hits: 0};
  const el = document.getElementById('dmgExchange');
  el.innerHTML = `vs ${name} &nbsp; DEALT <b>${dealt.dmg} in ${dealt.hits}</b> &nbsp; TAKEN <b>${taken.dmg} in ${taken.hits}</b>`;
  el.classList.add('show');
  clearTimeout(dmgExchangeTimer);
  dmgExchangeTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
function ensureStats(id){
  if (!netStats[id]) netStats[id] = { kills: 0, assists: 0, deaths: 0 };
  return netStats[id];
}
function applyKillMessage(msg){
  if (isFfa() && (ffaState.phase !== 'live' || msg.scoring !== true)) return;
  if (!isFfa() && roundState.phase === 'live') roundLives.eliminate(msg.victimId, msg.roundNum);
  if (msg.deathId && receivedKills.has(msg.deathId)) return;
  if (msg.deathId) receivedKills.add(msg.deathId);
  // Reaching this point in FFA already guarantees msg.scoring === true (see the early return
  // above), so every kill seen here while in FFA is a candidate - the last one standing when the
  // match ends is the one the killcam replays.
  if (isFfa()) { killcamDeaths.push({id:msg.victimId,t:performance.now()}); }
  if (isFfa()) lastFfaKill = { killerId: msg.killerId, victimId: msg.victimId, weaponName: msg.weaponName || 'Unknown', headshot: !!msg.headshot, t: performance.now() };
  const nameOf = id => id === netMyId ? 'YOU' : netRoster.find(p => p.id === id)?.name || 'Player';
  showKillFeed(msg.weaponName || 'Unknown', !!msg.headshot, nameOf(msg.victimId), msg.killerId ? nameOf(msg.killerId) : 'WORLD');
  if (msg.killerId === netMyId) { showHitMarker(!!msg.headshot, true); showDamageExchange(msg.victimId); }
  if (msg.victimId === netMyId && msg.killerId) {
    showDamageExchange(msg.killerId);
    delete damageDealt[msg.killerId]; delete damageTaken[msg.killerId];
  }
  delete damageDealt[msg.victimId]; delete damageTaken[msg.victimId];
  ensureStats(msg.victimId).deaths++;
  if (msg.killerId) ensureStats(msg.killerId).kills++;
  (msg.assistIds || []).forEach(id => ensureStats(id).assists++);
}

function updateScoreboardNames(){
  if (gameMode !== 'pvp' || isFfa()) return;
  const teamA = netRoster.filter(p => p.team === 'A').map(p => p.name);
  const teamB = netRoster.filter(p => p.team === 'B').map(p => p.name);
  document.getElementById('sbNameA').textContent = teamA.length ? teamA.join(' & ').toUpperCase() : 'TEAM A';
  document.getElementById('sbNameB').textContent = teamB.length ? teamB.join(' & ').toUpperCase() : 'TEAM B';
}

function handleNetMessage(msg, fromId){
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (msg.type === 'rematch') {
    if (netRole === 'client' && fromId === 'host' && Number.isInteger(msg.matchEpoch)
      && msg.matchEpoch > matchEpoch && Object.hasOwn(MAPS, msg.map)) {
      beginRematch(msg.map, msg.matchEpoch);
    }
    return;
  }
  if (netRole === 'client' && fromId === 'host' && msg.type === 'roster' && !gameStarted && Number.isInteger(msg.matchEpoch)) matchEpoch = msg.matchEpoch;
  if ((msg.matchEpoch ?? 0) !== matchEpoch) return;
  if (handleFfaMessage(msg, fromId)) return;
  if (['hit', 'shot', 'kill', 'roundEnd'].includes(msg.type) && msg.roundNum !== roundState.roundNum) return;
  if (netRole === 'host' && ['shot', 'state'].includes(msg.type) && msg.id !== fromId) return;
  if (netRole === 'host' && msg.type === 'kill' && msg.victimId !== fromId) return;
  if (netRole === 'host' && msg.type === 'hit' && msg.fromId !== fromId) return;
  if (['roundStart', 'roundEnd', 'warmup'].includes(msg.type)
    && (netRole !== 'client' || fromId !== 'host')) return;
  // Social messages use a separate validated route, before the legacy generic game relay.
  if (msg.type === 'chat' || msg.type === 'spray') {
    if (netRole === 'host') acceptSocialMessage(msg, fromId);
    else if (fromId === 'host') displaySocialMessage(msg);
    return;
  }
  if (netRole === 'host' && msg.type !== 'roster') netRelayFromHost(msg, fromId);
  switch (msg.type) {
    case 'roster':
      if (netRole !== 'client' || fromId !== 'host') return;
      netRoster = msg.roster; netTeamSize = msg.teamSize;
      if (netRole === 'client' && fromId === 'host' && !gameStarted) {
        selectedRuleset = ['knife','ffa'].includes(msg.ruleset) ? msg.ruleset : 'standard';
        document.getElementById('pvpStatus').textContent = isFfa() ? 'FREE FOR ALL · 6–12 PLAYERS' : selectedRuleset === 'knife' ? 'KNIFE THROWING · 5 KNIVES' : 'STANDARD PVP';
      }
      if (netRole === 'client' && msg.map && MAPS[msg.map]) {
        selectedMap = msg.map;
        preloadMapTextures(selectedMap).then(updateStartButtonState);
      }
      if (netRole === 'client' && !gameStarted && Number.isFinite(msg.killGoal) && Number.isFinite(msg.timeLimit)) {
        ffaKillGoal = msg.killGoal > 0 ? msg.killGoal : Infinity;
        ffaTimeLimit = msg.timeLimit > 0 ? msg.timeLimit : Infinity;
      }
      if (isFfa()) pruneFfaAvatars();
      updateScoreboardNames();
      break;
    case 'name':
      if (netRole === 'host') {
        const entry = netRoster.find(p => p.id === fromId);
        // country/clan/founder are self-reported by each client, same "unverified" trust model
        // as every other client-reported stat in this game - purely cosmetic (a flag/tag/star
        // next to a name), never used for scoring or matchmaking
        if (entry) {
          entry.name = msg.name || entry.name;
          entry.country = String(msg.country || '').slice(0, 2);
          entry.clan = String(msg.clan || '').slice(0, 4).toUpperCase();
          entry.founder = !!msg.founder;
          broadcastRoster();
        }
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
    case 'shot':
      showRemoteShot(msg);
      break;
    case 'hit':
      if (isFfa() && netRole === 'host' && ffaState.bots.has(msg.targetId)) { hitFfaBot(msg); break; }
      if (msg.targetId === netMyId && Number.isFinite(msg.dmg) && msg.dmg > 0 && roundState.phase !== 'ended') {
        lastDamageMeta = { weaponName: msg.weaponName, headshot: !!msg.isHeadshot };
        damagePlayer(msg.instantKill === true ? player.health + 1 : msg.dmg, msg.fromId);
      }
      break;
    case 'flash':
      if (isFfa() && netRole === 'host' && ffaState.bots.has(msg.targetId)) {
        const bot = ffaState.bots.get(msg.targetId);
        if (Number.isFinite(msg.intensity)) bot.flashedT = Math.max(bot.flashedT || 0, WEAPONS.flash.duration * Math.max(0, Math.min(1, msg.intensity)));
        break;
      }
      // the thrower already did our distance/line-of-sight check on their own client (same static
      // map geometry on both ends) - just apply the intensity they computed to our own screen
      if (msg.targetId === netMyId && Number.isFinite(msg.intensity) && msg.intensity > 0) {
        const dur = WEAPONS.flash.duration * msg.intensity;
        playerFlashMax = Math.max(playerFlashMax, dur);
        playerFlashT = Math.max(playerFlashT, dur);
      }
      break;
    case 'knifeThrow': {
      const validVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
      if (typeof msg.id === 'string' && msg.id.length <= 64 && validVector(msg.origin) && validVector(msg.direction) && thrownKnives.length < 32) {
        const direction = new THREE.Vector3().fromArray(msg.direction);
        if (direction.lengthSq() > 0.9 && direction.lengthSq() < 1.1)
          createThrownKnife(new THREE.Vector3().fromArray(msg.origin), direction.normalize(), false, msg.id);
      }
      break;
    }
    case 'knifeLanded': {
      const knife = thrownKnives.find(item => !item.damaging && item.id === msg.id);
      if (knife && Array.isArray(msg.point) && msg.point.length === 3 && msg.point.every(Number.isFinite)) {
        knife.mesh.position.fromArray(msg.point);
        knife.mesh.rotation.set(0, 0, 0.4);
        knife.landed = true;
      }
      break;
    }
    case 'knifePickup': {
      const index = thrownKnives.findIndex(item => !item.damaging && item.id === msg.id);
      if (index >= 0) { scene.remove(thrownKnives[index].mesh); thrownKnives.splice(index, 1); }
      break;
    }
    case 'kill':
      applyKillMessage(msg);
      break;
  }
}

const socialRateLimiter = new SocialRateLimiter();
let lastLocalChat = -Infinity;
function sendChatMessage(text){
  const message = { type: 'chat', text: cleanText(text) };
  if (!message.text) return true;
  if (performance.now() - lastLocalChat < CHAT_COOLDOWN) {
    socialUI.notice('Wait a moment before sending another message.'); return false;
  }
  if (gameMode !== 'pvp') {
    socialUI.showMessage('You · practice', message.text, true);
  } else if (netRole === 'host') {
    acceptSocialMessage(message, netMyId);
  } else if (netHostConn?.open) {
    netSend(netHostConn, message);
  } else {
    socialUI.notice('Room disconnected. Your message has not been sent.'); return false;
  }
  lastLocalChat = performance.now();
  return true;
}

function acceptSocialMessage(message, senderId){
  const sender = netRoster.find(p => p.id === senderId && !p.isBot);
  if (!sender) return;
  let canonical;
  if (message.type === 'chat') {
    const text = cleanText(message.text);
    if (!text) return;
    canonical = { type: 'chat', senderId, name: cleanText(sender.name, 24) || 'Player', text };
  } else {
    if (!gameStarted || !validSpray(message)) return;
    const avatar = senderId === netMyId ? null : enemies.find(e => e.isRemote && e.netId === senderId);
    const origin = senderId === netMyId ? player.pos.clone() : avatar?.mesh.position.clone().add(new THREE.Vector3(0, player.height, 0));
    if (!origin || (senderId === netMyId ? !player.alive : !avatar.alive) || !withinSprayRange(origin.toArray(), message.point)) return;
    // Confirm the location really lies on a map surface. Never accept arbitrary world-space art.
    const point = new THREE.Vector3().fromArray(message.point);
    const normal = new THREE.Vector3().fromArray(message.normal).normalize();
    const probe = new THREE.Raycaster(point.clone().addScaledVector(normal, 0.12), normal.clone().negate(), 0, 0.24);
    const hits = probe.intersectObjects(envMeshes.concat(floorMeshes), false);
    if (!hits.length || hits[0].point.distanceTo(point) > 0.08) return;
    const surfaceNormal = hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).normalize();
    if (surfaceNormal.dot(normal) < 0.95) return;
    canonical = { type: 'spray', senderId, sprayId: message.sprayId, point: point.toArray(), normal: surfaceNormal.toArray() };
  }
  if (!socialRateLimiter.accept(senderId, message.type)) return;
  displaySocialMessage(canonical);
  // Include the sender: clients display only the host's accepted echo, avoiding duplicates.
  netBroadcast(canonical);
}

function displaySocialMessage(message){
  if (message.type === 'chat') {
    const text = cleanText(message.text);
    if (text) socialUI.showMessage(cleanText(message.name, 24) || 'Player', text, message.senderId === netMyId);
  } else if (message.type === 'spray' && validSpray(message)) createGraffitiDecal(message);
}

let netStateTimer = 0;
function updateNetworking(dt){
  netStateTimer -= dt;
  if (netStateTimer > 0) return;
  netStateTimer = 0.05; // ~20Hz state broadcast
  const msg = {
    type: 'state', id: netMyId, roundNum: roundState.roundNum,
    pos: [player.pos.x, player.pos.y, player.pos.z],
    yaw: player.yaw, pitch: player.pitch, fov: player.alive ? camera.fov : baseFov,
    crouching: player.crouching,
    health: player.health, alive: player.alive, protected: isFfa() && ffaState.protection > 0,
    weaponId: currentSlot === 'melee' ? 'knife' : (inventory[currentSlot] || 'knife')
  };
  if (netRole === 'host') netBroadcast(msg);
  else if (netHostConn) netSend(netHostConn, msg);
}

function myTeam(){
  const me = netRoster.find(p => p.id === netMyId);
  return me ? me.team : 'A';
}

function showRemoteShot(msg){
  if(killcamActive)return;
  if (msg.id === netMyId || !netRoster.some(p => p.id === msg.id)) return;
  const def = WEAPONS[msg.weaponId];
  if (!def || !['primary', 'secondary'].includes(def.slot)) return;
  if (!Array.isArray(msg.end) || msg.end.length !== 3 || !msg.end.every(Number.isFinite)) return;
  const avatar = enemies.find(e => e.isRemote && e.netId === msg.id);
  if (!avatar) return;
  const now = performance.now();
  if (now - (avatar.lastShotAt ?? -Infinity) < 35) return;
  const muzzle = avatar.mesh.userData.muzzle;
  const origin = muzzle ? muzzle.getWorldPosition(new THREE.Vector3()) : avatar.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  const direction = new THREE.Vector3().fromArray(msg.end).sub(origin);
  const distance = direction.length();
  if (distance > def.range + 10 || distance < 0.001) return;
  recordKillcamShot({...msg,origin:origin.toArray()});
  avatar.lastShotAt = now;
  // Cosmetics only: the shot event never applies damage a second time.
  drawTracer(origin, direction.normalize(), distance);
  const material = flashSpriteMat.clone(); material.opacity = 1;
  const flash = new THREE.Sprite(material);
  flash.position.copy(origin); flash.scale.set(0.28, 0.28, 1);
  scene.add(flash);
  particles.push({ obj: flash, type: 'remoteFlash', life: 0.065, maxLife: 0.065, vel: new THREE.Vector3() });
  if (!audio.ctx) return;
  const samples = { tec9: 'smg', duals: 'smg' };
  const source = audio.ctx.createBufferSource();
  source.buffer = audio.samples[samples[msg.weaponId] || msg.weaponId] || audio.noiseBuffer(0.1);
  const gain = audio.ctx.createGain();
  const pan = audio.ctx.createStereoPanner();
  const offset = origin.clone().sub(camera.position);
  const volume = Math.max(0.025, 0.85 / (1 + offset.length() / 12));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  pan.pan.value = THREE.MathUtils.clamp(offset.normalize().dot(right), -1, 1);
  const t = audio.ctx.currentTime;
  const duration = Math.min(1.5, source.buffer.duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.setValueAtTime(volume, t + Math.max(0, duration - 0.05));
  gain.gain.linearRampToValueAtTime(0, t + duration);
  source.connect(gain); gain.connect(pan); pan.connect(audio.master);
  source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); };
  source.start(t); source.stop(t + duration);
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
    name: (rosterEntry && rosterEntry.name) || 'Player', isRemote: true, netId: id, team, targetCrouching: false,
    targetPos: new THREE.Vector3(), targetYaw: 0, interpStarted: false
  };
  mesh.traverse(o => { if (o.isMesh) o.userData.enemyRef = avatar; });
  enemies.push(avatar);
  return avatar;
}

function applyRemoteState(msg){
  if(typeof killcamActive!=='undefined'&&killcamActive)return;
  if (msg.id === netMyId) return;
  if (isFfa() && !netRoster.some(p => p.id === msg.id && p.ready)) return;
  // a state packet is broadcast every ~50ms regardless of round phase, so the losing player's
  // last "I'm dead" packet from the round that just ended can still be in flight when the new
  // round has already started locally - applying it would re-kill their freshly respawned avatar
  // and made checkPvpRoundEnd() think that team was already eliminated, instantly ending the new
  // round too and skipping straight to the round after it. Drop anything tagged with an older round.
  if (msg.roundNum !== roundState.roundNum) return;
  const rosterEntry = netRoster.find(p => p.id === msg.id);
  const team = rosterEntry ? rosterEntry.team : 'B';
  const avatar = getOrCreateRemoteAvatar(msg.id, team);
  if (rosterEntry) avatar.name = rosterEntry.name;
  // position/rotation snapshots only arrive ~20 times/sec over the network - snapping straight to
  // each one made remote players look jerky/stepped between updates. updateEnemies() now smoothly
  // interpolates the mesh toward this target every render frame instead of jumping to it directly.
  // Network position is the local eye position. Convert it back to feet using the sender's
  // stance; subtracting standing height while crouched was exactly what buried the remote model.
  const remoteHeight = msg.crouching ? player.crouchHeight : player.height;
  avatar.targetPos.set(msg.pos[0], msg.pos[1] - remoteHeight, msg.pos[2]);
  avatar.targetYaw = msg.yaw;
  avatar.targetPitch = Number.isFinite(msg.pitch) ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch)) : 0;
  avatar.targetFov = Number.isFinite(msg.fov) ? Math.max(10, Math.min(100, msg.fov)) : baseFov;
  avatar.weaponId = typeof WEAPONS!=='undefined'&&WEAPONS[msg.weaponId]?msg.weaponId:avatar.weaponId;
  avatar.targetCrouching = !!msg.crouching;
  if (!avatar.interpStarted) { avatar.mesh.position.copy(avatar.targetPos); avatar.mesh.rotation.y = avatar.targetYaw; avatar.interpStarted = true; }
  avatar.spawnProtected = !!msg.protected;
  if (!isFfa() && roundState.phase === 'live' && msg.alive === false) roundLives.eliminate(msg.id, msg.roundNum);
  const alive = !isFfa() && roundState.phase === 'live' ? roundLives.alive(msg.id) : msg.alive;
  avatar.health = alive ? msg.health : 0;
  avatar.alive = alive;
  if (!alive && !avatar.dying) {
    avatar.dying = true; avatar.deathT = 0; avatar.fallDir = msg.yaw;
  } else if (alive && avatar.dying) {
    // Warmup respawns must clear the death pose, not merely set alive=true.
    avatar.dying = false; avatar.deathT = 0;
    avatar.mesh.rotation.set(0, msg.yaw, 0);
    avatar.mesh.position.copy(avatar.targetPos);
  }
}

const WARMUP_FULL = 300; // 5 minutes while waiting for an opponent
const WARMUP_SHORT = 60; // dropped to 1 minute once a second real player has joined
let warmupTimer = WARMUP_FULL;
let warmupDroppedToShort = false;
let warmupBroadcastT = 0;

function beginRematch(map, epoch){
  matchEpoch = epoch;
  selectedMap = map;
  document.getElementById('matchResult').close();
  pauseMenuOpen = false; shopOpen = false;
  document.getElementById('pauseMenu').style.display = 'none';
  document.getElementById('buyMenu').style.display = 'none';
  socialUI.cancel();
  reloadGeneration++;
  reloadRuntime.reloading = false;
  clearGameplayInput();
  boltCyclingT = 0; boltRescopeLevel = 0; knifeSwingT = -1;
  recoilKick = 0; recoilYaw = 0; shakeIntensity = 0; regenDelayT = 0;
  player.crouching = false;
  inventory.primary = null; inventory.secondary = null;
  grenadeCount = 0; smokeCount = 0; flashCount = 0;
  Object.keys(ammoState).forEach(key => delete ammoState[key]);
  Object.assign(sessionMetrics, { shots: 0, hits: 0, headshots: 0 });
  document.getElementById('killfeed').replaceChildren();
  document.getElementById('smokeOverlay').style.opacity = 0;
  document.getElementById('flashOverlay').style.opacity = 0;
  playerFlashT = 0; playerFlashMax = 0;
  document.getElementById('waveBanner').style.opacity = 0;
  buildMap(map);
  if (isFfa()) { startFfa(true); restoreGameplayPointer(); return; }
  // Reuse round spawn/equipment setup, then enter warmup rather than live play.
  applyPvpRoundStart(1, selectedRuleset === 'knife' ? 'knife' : 'glock', 0, 0);
  startPvpMatch(15);
  if (netRole !== 'host') applyWarmup(15);
  document.getElementById('bombStatusLabel').textContent = '';
  updateGrenadeHUD(); updateScoreboardNames();
  restoreGameplayPointer();
}

function startPvpMatch(warmupSeconds = WARMUP_FULL){
  if (isFfa()) { startFfa(); return; }
  if (selectedRuleset === 'knife') {
    warmupSeconds = 15;
    inventory.primary = null; inventory.secondary = null;
    grenadeCount = 0; smokeCount = 0; flashCount = 0;
    resetKnifeSupply();
    equipSlot('melee', true);
  }
  matchFinished = false;
  weaponBag = []; previousRoundWeapon = null;
  roundState.roundNum = 1;
  roundState.ctWins = 0; // team A score
  roundState.tWins = 0;  // team B score
  netStats = {};
  recentAttackers = [];
  matchResultRecorded = false;
  warmupSpawnPlaced = false; // buildMap() always drops everyone at the map's generic (team A) spawn point - this needs correcting to the player's real team as soon as it's known, or a joining team B player stays stuck on team A's side for the whole warmup
  if (netRole === 'host') startWarmup(warmupSeconds);
}

function startWarmup(seconds = WARMUP_FULL){
  roundState.phase = 'warmup';
  warmupTimer = seconds;
  warmupDroppedToShort = seconds <= WARMUP_SHORT;
  warmupBroadcastT = 1;
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
    player.onGround = false;
    player.yaw = getSpawnYaw(team);
    player.pitch = 0;
    camera.position.copy(player.pos);
  }
}

function updateWarmup(dt){
  if (netRole !== 'host') return;
  if (['A','B'].some(team => netRoster.filter(p => p.team === team && !p.isBot).length < netTeamSize)) {
    warmupTimer = 15;
    warmupBroadcastT -= dt;
    if (warmupBroadcastT <= 0) { warmupBroadcastT = 1; broadcastWarmup(); }
    document.getElementById('centerMessage').textContent = `WAITING FOR PLAYERS · ${netRoster.filter(p => !p.isBot).length}/${netTeamSize * 2}`;
    return;
  }
  document.getElementById('centerMessage').textContent = '';
  warmupTimer -= dt;
  warmupBroadcastT -= dt;
  if (warmupBroadcastT <= 0) { warmupBroadcastT = 1; broadcastWarmup(); }
  else applyWarmup(warmupTimer); // local display still ticks smoothly between broadcasts
  if (warmupTimer <= 0) startPvpRoundAsHost();
}

// Unsynchronised host-only bots must never count as multiplayer teammates.
function removePvpBots(){
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (!enemies[i].isBot) continue;
    scene.remove(enemies[i].mesh);
    enemies.splice(i, 1);
  }
}

function startPvpRoundAsHost(){
  removePvpBots();
  const weapon = selectedRuleset === 'knife' ? 'knife' : nextRoundWeapon();
  const msg = { type: 'roundStart', roundNum: roundState.roundNum, weapon, scoreA: roundState.ctWins, scoreB: roundState.tWins };
  applyPvpRoundStart(msg.roundNum, msg.weapon, msg.scoreA, msg.scoreB);
  netBroadcast(msg);
}

function applyPvpRoundStart(roundNum, weaponId, scoreA, scoreB){
  roundLives.start(roundNum, netRoster);
  receivedKills.clear();
  damagePulse = 0;
  damageIndicatorTime = 0;
  lastDamageMeta = {};
  resetKnifeSupply();
  thrownKnives.forEach(knife => scene.remove(knife.mesh));
  thrownKnives.length = 0;
  reloadGeneration++;
  reloadRuntime.reloading = false;
  document.getElementById('reloadLabel').style.opacity = 0;
  clearGameplayInput();
  recoilKick = 0;
  recoilYaw = 0;
  fireCooldown = 0;
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
    bot.mesh.rotation.x = 0; bot.mesh.rotation.z = 0;
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
  player.onGround = false;
  player.yaw = getSpawnYaw(team);
  player.pitch = 0;
  camera.position.copy(player.pos);
  updateHealthHUD();

  if (weaponId === 'knife') {
    equipSlot('melee', true);
  } else {
    const def = WEAPONS[weaponId];
    inventory[def.slot] = weaponId;
    ammoState[def.slot] = { mag: def.mag, reserve: def.reserve };
    equipSlot(def.slot, true);
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
  if (!player.alive) roundLives.eliminate(netMyId, roundState.roundNum);
  const winner = roundOutcome(countAliveOnTeam('A'), countAliveOnTeam('B'));
  if (winner !== undefined) endPvpRoundAsHost(winner, winner === null ? 'Both teams eliminated' : 'Team eliminated');
}
function isNetPlayerAlive(id){
  if (roundState.phase === 'live' || roundState.phase === 'ended') return roundLives.alive(id);
  const avatar = enemies.find(e => e.isRemote && e.netId === id);
  return avatar ? avatar.alive : true;
}

function endPvpRoundAsHost(winnerTeam, reason){
  if (roundState.phase !== 'live') return; // already ending/ended this round - don't score or broadcast it twice
  if (winnerTeam === 'A') roundState.ctWins++;
  else if (winnerTeam === 'B') roundState.tWins++;
  const msg = { type: 'roundEnd', roundNum: roundState.roundNum, winnerTeam, reason, scoreA: roundState.ctWins, scoreB: roundState.tWins };
  applyPvpRoundEnd(winnerTeam, reason, roundState.ctWins, roundState.tWins);
  netBroadcast(msg);
}

function applyPvpRoundEnd(winnerTeam, reason, scoreA, scoreB){
  if (roundState.phase === 'ended') return;
  roundState.phase = 'ended';
  clearGameplayInput();
  roundState.ctWins = scoreA; roundState.tWins = scoreB;
  document.getElementById('tWins').textContent = scoreA;
  document.getElementById('ctWins').textContent = scoreB;
  const youWon = winnerTeam === myTeam();
  showWaveBanner(`${winnerTeam === null ? 'ROUND DRAW' : youWon ? 'ROUND WON' : 'ROUND LOST'} — ${reason}`);
  document.getElementById('bombStatusLabel').textContent = `${player.alive ? 'SURVIVED' : 'ELIMINATED'} · ${winnerTeam === null ? 'DRAW — NO POINT AWARDED' : `TEAM ${winnerTeam} WINS`}`;
  document.getElementById('roundPhaseLabel').textContent = 'ROUND OVER';
  if (scoreA >= roundState.roundsToWin || scoreB >= roundState.roundsToWin) {
    matchFinished = true;
    clearGameplayInput();
    const eloDelta = recordPvpResult(youWon);
    const finishedEpoch = matchEpoch;
    setTimeout(() => {
      if (finishedEpoch !== matchEpoch || !matchFinished) return;
      const el = document.getElementById('waveBanner');
      const sign = eloDelta >= 0 ? '+' : '';
      el.textContent = `${(winnerTeam === myTeam()) ? 'VICTORY' : 'DEFEAT'} · ELO ${sign}${eloDelta}`;
      el.style.opacity = 1;
      document.exitPointerLock();
      document.getElementById('resultTitle').textContent = youWon ? 'VICTORY' : 'DEFEAT';
      document.getElementById('resultScore').textContent = `${scoreA} : ${scoreB}`;
      const stats = ensureStats(netMyId);
      document.getElementById('resultDetail').textContent = `${stats.kills} KILLS / ${stats.assists} ASSISTS / ${stats.deaths} DEATHS`;
      document.getElementById('resultRating').textContent = `PROVISIONAL RATING ${sign}${eloDelta} · ${playerProfile.rating}`;
      document.getElementById('matchResult').showModal();
      document.getElementById('rematchMap').value = selectedMap;
      document.getElementById('rematchControls').hidden = netRole !== 'host';
      document.getElementById('rematchWaiting').hidden = netRole === 'host';
    }, 2200);
    return;
  }
  if (netRole === 'host') {
    setTimeout(() => { roundState.roundNum++; startPvpRoundAsHost(); }, 3000);
  }
}

const PVP_ROUND_DURATION = 90; // 1:30 max per round

function countAliveOnTeam(team){
  return roundLives.count(team, netRoster);
}

function updatePvpRound(dt){
  updateNetworking(dt);
  if (isFfa()) { updateFfa(dt); return; }
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
      endPvpRoundAsHost(roundOutcome(aliveA, aliveB, true), 'Time expired');
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
    if (isFfa() && netRole === 'host' && ffaState.bots.has(enemy.netId)) return;
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
      let animSpeed = enemy.speed;
      if (enemy.isRemote) {
        const ePos = enemy.mesh.position;
        const last = enemy._lastAnimPos || ePos.clone();
        animSpeed = dt > 0 ? last.distanceTo(ePos) / dt : 0;
        enemy._lastAnimPos = ePos.clone();
      }
      animateSoldierRig(enemy.mesh, dt, animSpeed, enemy.targetCrouching);
    }
    if (enemy.isRemote) return; // driven entirely by network state in applyRemoteState, not local AI
    if (enemy.isStatic) return; // practice-mode target dummy - doesn't move, aim, or shoot back
    if (gameMode === 'bomb' && enemy.isCarrier && roundState.phase === 'live') return; // handled by updateCarrierEnemy instead
    if (enemy.flashedT > 0) enemy.flashedT = Math.max(0, enemy.flashedT - dt); // blinded - can still move, can't shoot (see below)
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
      if (enemy.fireCooldown <= 0 && dist < 45 && !(enemy.flashedT > 0)) {
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
let damageBearing = 0;
let damageIndicatorTime = 0;
let damagePulse = 0;
let recentAttackers = []; // [{id, t}], most recent last
function damagePlayer(dmg, fromId){
  if (!player.alive || (gameMode === 'pvp' && (roundState.phase === 'ended' || matchFinished))) return;
  if (isFfa() && ffaState.protection > 0) return;
  trackDamageTaken(fromId, dmg);
  player.health -= dmg;
  regenDelayT = REGEN_DELAY;
  audio.playerHurt();
  shakeIntensity = Math.min(shakeIntensity + 0.5, 1.5);
  damagePulse = Math.min(1, damagePulse + 0.7);
  const source = enemies.find(enemy => enemy.netId === fromId && fromId);
  if (source) {
    damageBearing = Math.atan2(source.mesh.position.x - player.pos.x, -(source.mesh.position.z - player.pos.z));
    damageIndicatorTime = 0.8;
  }
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
  if (gameMode === 'pvp' && !isFfa() && roundState.phase === 'live') roundLives.eliminate(netMyId, roundState.roundNum);
  if (socialUI.wheelOpen) socialUI.closeWheel(false);
  clearGameplayInput();
  if (gameMode === 'bomb') return; // round loss is handled by the round system, not the horde game-over screen
  if (gameMode === 'pvp') {
    // credit whoever landed the finishing blow with a kill, and anyone else who hit us in the
    // last few seconds with an assist, then tell every peer (see applyKillMessage/'kill' case)
    const killerId = recentAttackers.length ? recentAttackers[recentAttackers.length - 1].id : null;
    const assistIds = recentAttackers.slice(0, -1).map(a => a.id);
    const killMsg = { type: 'kill', roundNum: roundState.roundNum, deathId: crypto.randomUUID(),
      victimId: netMyId, killerId, assistIds, scoring: isFfa() && ffaState.phase === 'live', ...lastDamageMeta };
    // Publish death immediately, before the host can finish/freeze this match.
    netStateTimer = 0;
    updateNetworking(0);
    netBroadcast(killMsg);
    applyKillMessage(killMsg);
    recentAttackers = [];
    if (isFfa()) {
      ffaState.respawnT = FFA.respawn;
    } else if (roundState.phase === 'warmup') {
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
  player.onGround = false;
  player.yaw = getSpawnYaw(team);
  player.pitch = 0;
  camera.position.copy(player.pos);
}

// ============================================================
// MOVEMENT / COLLISION
// ============================================================
// feetYOverride lets live gameplay movement test against where the player's feet actually are
// right now (so jumping up onto a crate and walking around on top of it doesn't get blocked by
// the crate itself) - callers that just need "is this spot clear at ground level" (spawn checks)
// omit it and get the old terrain-based assumption.
function checkCollision(newPos, feetYOverride){
  // player.pos.y is eye height (ground + height/crouchHeight), not feet height - the box has to
  // span feet-to-head or it floats above anything shorter than the player and never touches it
  const radius = 0.5;
  const feetY = feetYOverride ?? groundHeightAt(newPos.x, newPos.z);
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
  if (shopOpen || pauseMenuOpen || matchFinished) return;

  // recoil / shake decay
  recoilKick = Math.max(0, recoilKick - dt * 0.08);
  recoilYaw += (0 - recoilYaw) * Math.min(1, dt * 3);
  shakeIntensity = Math.max(0, shakeIntensity - dt * 2.5);
  const shakeX = settings.reducedMotion ? 0 : (Math.random() - 0.5) * shakeIntensity * 0.01;
  const shakeY = settings.reducedMotion ? 0 : (Math.random() - 0.5) * shakeIntensity * 0.01;

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
  document.getElementById('adsDot').style.display = (player.ads && !weaponDef.scope && !currentVisual.sight) ? 'block' : 'none';
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
  // toggle, not hold - press once to crouch, press again to stand back up
  const crouchDown = !!keys[settings.binds.crouch];
  if (crouchDown && !crouchWasDown) player.crouching = !player.crouching;
  crouchWasDown = crouchDown;
  if (player.crouching) speed *= player.crouchMul;
  if (player.ads) speed *= 0.6;

  // Acceleration and friction remove the weightless start/stop feel while preserving responsive
  // counter-strafing. Air control is intentionally weaker than ground control.
  const desiredVelocity = move.multiplyScalar(speed);
  const response = player.onGround ? (move.lengthSq() > 0 ? 16 : 22) : 4.5;
  const blend = 1 - Math.exp(-response * dt);
  movementVelocity.x = THREE.MathUtils.lerp(movementVelocity.x, desiredVelocity.x, blend);
  movementVelocity.z = THREE.MathUtils.lerp(movementVelocity.z, desiredVelocity.z, blend);
  const horizontalSpeed = Math.hypot(movementVelocity.x, movementVelocity.z);
  const crosshairGap = 4 + combatMotion.bloom + THREE.MathUtils.clamp(horizontalSpeed / player.speed, 0, 1.7) * 5 + (player.onGround ? 0 : 5);
  document.documentElement.style.setProperty('--crosshair-gap', `${crosshairGap.toFixed(1)}px`);
  // use where the player's feet actually are right now, not the terrain's default assumption -
  // otherwise standing on top of a crate you jumped onto would immediately collide with that
  // same crate the instant you tried to take a step. The +0.05 keeps the collision box from
  // exactly touching whatever's directly underfoot - resting exactly on a box's top face
  // otherwise reads as an intersection (shared boundary) and freezes all horizontal movement.
  const liveFeetY = player.pos.y - (player.crouching ? player.crouchHeight : player.height) + 0.05;
  const newPos = player.pos.clone().addScaledVector(movementVelocity, dt);
  if(player.onGround&&currentMapMeta?.conveyor)newPos.z+=currentMapMeta.conveyor(player.pos.x,player.pos.z,liveFeetY-.05)*dt;
  const movementFeet = pos => {
    if(!player.onGround||!currentMapMeta?.supportHeight)return liveFeetY;
    // Sample the capsule footprint at a ramp landing, not just its centre.
    // Otherwise its front edge collides with the upper slab before its centre reaches it.
    let height=liveFeetY;
    for(const [dx,dz] of [[0,0],[-.5,0],[.5,0],[0,-.5],[0,.5]]){
      const surface=currentMapMeta.supportHeight(pos.x+dx,pos.z+dz,liveFeetY);
      if(surface-liveFeetY<=.35)height=Math.max(height,surface+.05);
    }
    return height;
  };
  if (!checkCollision(newPos, movementFeet(newPos))) {
    player.pos.x = newPos.x; player.pos.z = newPos.z;
  } else {
    const tryX = player.pos.clone(); tryX.x = newPos.x;
    if (!checkCollision(tryX, movementFeet(tryX))) player.pos.x = newPos.x;
    else movementVelocity.x = 0;
    const tryZ = player.pos.clone(); tryZ.z = newPos.z;
    if (!checkCollision(tryZ, movementFeet(tryZ))) player.pos.z = newPos.z;
    else movementVelocity.z = 0;
  }

  const half = WORLD_SIZE / 2 - 3;
  player.pos.x = Math.max(-half, Math.min(half, player.pos.x));
  player.pos.z = Math.max(-half, Math.min(half, player.pos.z));

  // While already grounded, anchor the multi-level support check (Mall) to the last confirmed
  // floor instead of re-deriving "feet" from eye height every frame: crouching changes the
  // eye-to-feet offset instantly but pos.y only catches up over a few frames of gravity, so a
  // second crouch toggle mid-transition could read a transient feet estimate that falls outside
  // the level's hysteresis band and drop the player a whole level (the escalators/open upper
  // shops "fall through the floor on double-crouch" bug).
  const feetRef = player.onGround ? player.groundLevel : player.pos.y - (player.crouching ? player.crouchHeight : player.height);
  const groundY = currentMapMeta?.supportHeight ? currentMapMeta.supportHeight(player.pos.x, player.pos.z, feetRef) : groundHeightAt(player.pos.x, player.pos.z);
  player.groundLevel = groundY;
  const targetHeight = player.crouching ? player.crouchHeight : player.height;

  const jumpDown = !!keys[settings.binds.jump];
  // Raising velY alone (keeping the old gravity) made the jump reach the same height but hang in
  // the air far longer, which read as low-gravity/floaty. Scaling gravity up together with velY
  // keeps roughly the original snappy up-and-down timing while still clearing a typical
  // ~1.6-1.7-tall crate/barrel (max height ~1.74) with a little room to spare.
  const GRAVITY = 26;
  if (jumpDown && !jumpWasDown && player.onGround && !player.crouching) { player.velY = 9.5; player.onGround = false; }
  jumpWasDown = jumpDown;
  player.velY -= GRAVITY * dt;
  player.pos.y += player.velY * dt;

  // landing on top of a crate/barrel works the same way as landing on terrain: take whichever is
  // higher, terrain or the top of any collider under the player's feet - but only a collider
  // whose top is at or just below our own feet, so this never snaps the player up onto the side
  // of something they're merely walking into
  let standY = groundY;
  const radius = 0.5;
  const feetAfterFall = player.pos.y - targetHeight;
  for (const c of colliders) {
    if (player.pos.x < c.min.x - radius || player.pos.x > c.max.x + radius) continue;
    if (player.pos.z < c.min.z - radius || player.pos.z > c.max.z + radius) continue;
    if (c.max.y > standY && c.max.y <= feetAfterFall + 0.35) standY = c.max.y;
  }

  const floorY = standY + targetHeight;
  if (player.pos.y <= floorY) { player.pos.y = floorY; player.velY = 0; player.onGround = true; }

  camera.position.set(player.pos.x + shakeX, player.pos.y + shakeY, player.pos.z);

  // footstep audio
  const moving = move.lengthSq() > 0 && player.onGround;
  if (moving) {
    player.footstepTimer -= dt;
    if (player.footstepTimer <= 0) {
      if (selectedMap === 'ski') { if (!audio.playSample('snowStep', 0.28)) audio.footstep(); } else audio.footstep();
      player.footstepTimer = sprinting ? 0.28 : (player.crouching ? 0.55 : 0.4);
    }
  } else {
    player.footstepTimer = 0;
  }

  // Smooth transitions and bounded inertia affect the model only, never camera aim.
  const motion = combatMotion.update(dt, player.onGround ? horizontalSpeed : 0, player.ads, settings.reducedMotion);
  const targetPos = player.ads ? (currentVisual.aimOffset || adsPos) : hipPos;
  // Procedural sway must disappear at full ADS or the physical sights drift
  // away from the camera ray even while the player's aim remains stationary.
  const sightMotion = currentVisual.sight ? Math.pow(1 - player.adsT, 2) : 1;
  motion.x *= sightMotion;
  motion.y *= sightMotion;
  motion.roll *= sightMotion;
  const poseBlend = 1 - Math.exp(-18 * dt);
  weaponGroup.position.x += (targetPos.x + motion.x - weaponGroup.position.x) * poseBlend;
  weaponGroup.position.y += (targetPos.y + motion.y - weaponGroup.position.y) * poseBlend;
  weaponGroup.position.z += (targetPos.z - weaponGroup.position.z) * (1 - Math.exp(-15 * dt));
  weaponGroup.rotation.z = motion.roll;
  if (!reloadRuntime.reloading) weaponGroup.rotation.x += (0 - weaponGroup.rotation.x) * Math.min(1, dt * 10);

  fireCooldown -= dt;
  if (mouseLocked && mouseDown && fireCooldown <= 0) fireWeapon();

  updateReloadAnimation(dt);
  updateWeaponRecoil(dt);
  updateBoltCycle(dt);
  updateWeaponInspect(dt);
  updateKnifeFlip(dt);
  updateKnifeSwing(dt);
}

// ============================================================
// HUD
// ============================================================
function updateAmmoHUD(){
  const def = currentWeaponDef();
  const remaining = currentSlot === 'melee' ? knifeCount : currentSlot === 'grenade' ? grenadeCount : currentSlot === 'smoke' ? smokeCount : currentSlot === 'flash' ? flashCount : ammoState[currentSlot]?.mag;
  const capacity = currentSlot === 'melee' ? knifeCapacity() : def.mag || 1;
  const ammoPanel = document.getElementById('ammo');
  ammoPanel.dataset.empty = String(remaining === 0);
  ammoPanel.dataset.low = String(remaining <= Math.max(1, Math.floor(capacity * 0.2)));
  document.getElementById('ammoLabel').textContent = def.name.toUpperCase();
  if (currentSlot === 'melee') {
    document.getElementById('ammoLabel').textContent = knifeAvailable ? 'KNIFE · RMB THROW' : 'EMPTY HAND · RECOVER KNIFE';
    document.getElementById('ammoCount').textContent = knifeCount;
    document.getElementById('ammoReserve').textContent = knifeCapacity() === 5 ? '5' : '';
  } else if (currentSlot === 'grenade') {
    document.getElementById('ammoCount').textContent = grenadeCount;
    document.getElementById('ammoReserve').textContent = '';
  } else if (currentSlot === 'smoke') {
    document.getElementById('ammoCount').textContent = smokeCount;
    document.getElementById('ammoReserve').textContent = '';
  } else if (currentSlot === 'flash') {
    document.getElementById('ammoCount').textContent = flashCount;
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
  document.getElementById('flashCount').textContent = flashCount;
  if (currentSlot === 'grenade' || currentSlot === 'smoke' || currentSlot === 'flash') updateAmmoHUD();
}
function updateMoneyHUD(){
  document.getElementById('moneyDisplay').textContent = '$' + money;
  document.getElementById('buyMoney').textContent = 'Available money: $' + money;
}
function updateHealthHUD(){
  const pct = Math.max(0, player.health / player.maxHealth * 100);
  document.getElementById('healthInner').style.width = pct + '%';
  document.getElementById('healthbar').classList.toggle('lowHealth', pct <= 25);
  document.getElementById('healthValue').textContent = `${Math.ceil(Math.max(0, player.health))}`;
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
function showKillFeed(weaponName, isHeadshot, victimName, killerName = 'YOU'){
  const feed = document.getElementById('killfeed');
  const entry = document.createElement('div');
  entry.className = 'killEntry';
  for (const [className, text] of [['kfKiller', killerName], ['kfWeapon', `${weaponName}${isHeadshot ? ' · HEADSHOT' : ''}`], ['kfVictim', victimName]]) {
    const span = document.createElement('span'); span.className = className;
    span.textContent = text; entry.appendChild(span);
  }
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
  if (gameMode === 'pvp' && selectedRuleset === 'knife') { socialUI.notice('Knife Throwing: recover your knives on the map.'); return; }
  if (!player.alive) return;
  // once a PvP round is actually live the weapon is forced and buying is off the table entirely -
  // the shop is only for spending the unlimited warmup money before the match starts
  if (gameMode === 'pvp' && !isFfa() && roundState.phase !== 'warmup') return;
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
  if (!gameStarted || shopOpen || matchFinished) return;
  document.getElementById('practiceTools').hidden = gameMode !== 'practice';
  socialUI.cancel();
  pauseMenuOpen = !pauseMenuOpen;
  document.getElementById('pauseMenu').style.display = pauseMenuOpen ? 'flex' : 'none';
  if (pauseMenuOpen) { document.exitPointerLock(); clearGameplayInput(); listeningForBind = null; renderBindList(); }
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
  if (['KeyT', 'Enter', 'NumpadEnter', 'Tab'].includes(e.code)) {
    socialUI.notice('T, Enter and Tab are reserved for sprays, chat and scoreboard.');
    return;
  }
  settings.binds[listeningForBind] = e.code;
  listeningForBind = null;
  saveSettings();
  renderBindList();
  refreshControlHints();
});

function refreshControlHints(){
  const hints = document.querySelectorAll('#buyHint .hudKey');
  if (hints[0]) hints[0].textContent = keyLabel(settings.binds.shop);
  if (hints[2]) hints[2].textContent = keyLabel(settings.binds.inspect);
}
refreshControlHints();

document.getElementById('sensSlider').addEventListener('input', e => {
  settings.sensitivity = parseFloat(e.target.value);
  document.getElementById('sensValue').textContent = settings.sensitivity.toFixed(1);
  saveSettings();
});
document.getElementById('sensSlider').value = settings.sensitivity;
document.getElementById('sensValue').textContent = settings.sensitivity.toFixed(1);
document.getElementById('graphicsPreset').value = settings.graphics;
document.getElementById('fovSlider').value = settings.fov;
document.getElementById('fovValue').textContent = settings.fov;
document.getElementById('graphicsPreset').addEventListener('change', event => {
  settings.graphics = event.target.value;
  applyGraphicsSettings(); saveSettings();
});
document.getElementById('fovSlider').addEventListener('input', event => {
  settings.fov = Number(event.target.value);
  baseFov = settings.fov;
  document.getElementById('fovValue').textContent = settings.fov;
  saveSettings();
});

document.getElementById('resumeBtn').addEventListener('click', togglePauseMenu);
document.getElementById('resultReturn').addEventListener('click', () => location.reload());
document.getElementById('rematchStart').addEventListener('click', () => {
  if (netRole !== 'host' || !matchFinished) return;
  const map = document.getElementById('rematchMap').value;
  if (!Object.hasOwn(MAPS, map) || !!MAPS[map].ffa !== isFfa()) return;
  const epoch = matchEpoch + 1;
  // Reliable ordered PeerJS channels deliver this before the new warmup packets.
  netBroadcast({ type: 'rematch', map, matchEpoch: epoch });
  beginRematch(map, epoch);
});
const trainingWeaponPicker = document.getElementById('practiceWeapon');
Object.entries(WEAPONS).filter(([, def]) => ['primary', 'secondary'].includes(def.slot)).forEach(([id, def]) => {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = def.name;
  trainingWeaponPicker.appendChild(option);
});
trainingWeaponPicker.addEventListener('change', () => {
  if (gameMode !== 'practice') return;
  const id = trainingWeaponPicker.value, def = WEAPONS[id];
  if (!def) return;
  inventory[def.slot] = id;
  ammoState[def.slot] = { mag: def.mag, reserve: def.reserve };
  equipSlot(def.slot, true);
});
document.getElementById('resetTraining').addEventListener('click', () => {
  if (gameMode === 'practice') Object.assign(sessionMetrics, { shots: 0, hits: 0, headshots: 0 });
});
document.getElementById('matchResult').addEventListener('cancel', event => event.preventDefault());
document.getElementById('reducedMotion').checked = settings.reducedMotion;
document.getElementById('reducedMotion').addEventListener('change', event => {
  settings.reducedMotion = event.target.checked;
  saveSettings();
});
window.addEventListener('blur', () => { if (gameStarted) clearGameplayInput(); });
document.getElementById('mainMenuBtn').addEventListener('click', () => location.reload());

// ============================================================
// TAB SCOREBOARD (hold to view kills/assists/deaths)
// ============================================================
function renderTabScoreboard(){
  const body = document.getElementById('tabScoreboardBody');
  body.innerHTML = '';
  const addRow = (name, team, k, a, d) => {
    const tr = document.createElement('tr');
    [name, team, k, a, d].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      if (index > 1) cell.className = 'num';
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  };
  if (gameMode === 'pvp') {
    (isFfa() ? rankPlayers(netRoster, netStats) : netRoster.filter(p => !p.isBot)).forEach(p => {
      const s = ensureStats(p.id);
      const tag = (p.founder ? '★ ' : '') + (p.country ? flagEmoji(p.country) + ' ' : '') + (p.clan ? `[${p.clan}] ` : '');
      addRow(tag + p.name + (p.id === netMyId ? ' (you)' : ''), isFfa() ? (p.isBot ? 'BOT' : 'FFA') : p.team, s.kills, s.assists, s.deaths);
    });
  } else {
    addRow('You', '-', kills, 0, localDeaths);
  }
}
document.addEventListener('keydown', e => {
  if (e.code !== 'Tab' || !gameStarted || shopOpen || pauseMenuOpen || socialUI.blocked) return;
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
  if (gameMode === 'pvp' && selectedRuleset === 'knife') return;
  const def = WEAPONS[id];
  if (money < weaponPrice(def)) return;
  money -= weaponPrice(def);
  inventory[def.slot] = id;
  ammoState[def.slot] = { mag: def.mag, reserve: def.reserve };
  updateMoneyHUD();
  equipSlot(def.slot, true);
  renderBuyMenu();
}

function buyGrenade(){
  if (gameMode === 'pvp' && selectedRuleset === 'knife') return;
  const def = WEAPONS.grenade;
  if (money < weaponPrice(def) || grenadeCount >= MAX_GRENADES) return;
  money -= weaponPrice(def);
  grenadeCount++;
  updateMoneyHUD();
  updateGrenadeHUD();
  renderBuyMenu();
}

function buySmoke(){
  if (gameMode === 'pvp' && selectedRuleset === 'knife') return;
  const def = WEAPONS.smoke;
  if (money < weaponPrice(def) || smokeCount >= MAX_SMOKES) return;
  money -= weaponPrice(def);
  smokeCount++;
  updateMoneyHUD();
  updateGrenadeHUD();
  renderBuyMenu();
}

function buyFlash(){
  if (gameMode === 'pvp' && selectedRuleset === 'knife') return;
  const def = WEAPONS.flash;
  if (money < weaponPrice(def) || flashCount >= MAX_FLASHES) return;
  money -= weaponPrice(def);
  flashCount++;
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
    card.innerHTML = `<div class="wName">${def.name}</div><div class="wPrice">${owned ? 'EQUIPPED' : '$' + weaponPrice(def)}</div>`;
    if (!owned) card.addEventListener('click', () => buyWeapon(id));
    (def.slot === 'primary' ? primaryList : secondaryList).appendChild(card);
  });

  const grenadeList = document.getElementById('grenadeList');
  grenadeList.innerHTML = '';
  const gdef = WEAPONS.grenade;
  const gmaxed = grenadeCount >= MAX_GRENADES;
  const gcard = document.createElement('div');
  gcard.className = 'weaponCard' + (gmaxed ? ' owned' : '');
  gcard.innerHTML = `<div class="wName">${gdef.name} (${grenadeCount}/${MAX_GRENADES})</div><div class="wPrice">${gmaxed ? 'MAX' : '$' + weaponPrice(gdef)}</div>`;
  if (!gmaxed) gcard.addEventListener('click', buyGrenade);
  grenadeList.appendChild(gcard);

  const sdef = WEAPONS.smoke;
  const smaxed = smokeCount >= MAX_SMOKES;
  const scard = document.createElement('div');
  scard.className = 'weaponCard' + (smaxed ? ' owned' : '');
  scard.innerHTML = `<div class="wName">${sdef.name} (${smokeCount}/${MAX_SMOKES})</div><div class="wPrice">${smaxed ? 'MAX' : '$' + weaponPrice(sdef)}</div>`;
  if (!smaxed) scard.addEventListener('click', buySmoke);
  grenadeList.appendChild(scard);

  const fdef = WEAPONS.flash;
  const fmaxed = flashCount >= MAX_FLASHES;
  const fcard = document.createElement('div');
  fcard.className = 'weaponCard' + (fmaxed ? ' owned' : '');
  fcard.innerHTML = `<div class="wName">${fdef.name} (${flashCount}/${MAX_FLASHES})</div><div class="wPrice">${fmaxed ? 'MAX' : '$' + weaponPrice(fdef)}</div>`;
  if (!fmaxed) fcard.addEventListener('click', buyFlash);
  grenadeList.appendChild(fcard);
}

document.getElementById('closeBuyMenu').addEventListener('click', toggleBuyMenu);

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (killcamActive) updateKillcam(dt);

  if (gameStarted && !matchFinished && (gameMode === 'pvp' || (!shopOpen && !pauseMenuOpen))) {
    currentMapMeta?.update?.(dt);
    updatePlayer(dt);
    updatePlayerRegen(dt);
    updateEnemies(dt);
    updateHealthHUD();
    impactMarks.update(dt);
    updateThrownKnives(dt);
    updateDecals(dt);
    updateGraffitiDecals(dt);
    updateGrenades(dt);
    updateSmokes(dt);
    document.getElementById('smokeOverlay').style.opacity = pointInAnySmoke(player.pos.x, player.pos.z) ? 1 : 0;
    if (playerFlashT > 0) playerFlashT = Math.max(0, playerFlashT - dt);
    document.getElementById('flashOverlay').style.opacity = playerFlashMax > 0 ? playerFlashT / playerFlashMax : 0;
    if (gameMode === 'bomb') updateRound(dt);
    if (gameMode === 'pvp') updatePvpRound(dt);
    if (gameMode === 'practice') {
      updatePractice(dt);
      document.getElementById('trainingStats').hidden = false;
      document.getElementById('trainingStats').textContent = `ACCURACY ${sessionMetrics.shots ? Math.round(sessionMetrics.hits / sessionMetrics.shots * 100) : 0}% · ${sessionMetrics.hits} HITS · ${sessionMetrics.headshots} HEADSHOTS`;
    }

    // drifting clouds
    clouds.forEach((c, i) => { c.position.x += dt * (2 + (i % 3)); if (c.position.x > 300) c.position.x = -300; });

    drawMinimap();
  }

  if(!killcamActive) spectator.update({ dead: gameStarted && gameMode === 'pvp' && !player.alive,
    enemies, team: myTeam(), roster: netRoster, phase: isFfa() ? 'warmup' : roundState.phase, baseFov, dt,
    standingHeight: player.height, crouchingHeight: player.crouchHeight });

  // Finish cosmetic death/shot effects even when the final round freezes gameplay.
  if (gameStarted) {
    if(!killcamActive)updateDyingEnemies(dt);
    playerLabels.update(enemies, camera, envMeshes, myTeam(), dt);
    const effectsDt=killcamActive&&replay.time>=replay.fatalTime-180&&replay.time<=replay.fatalTime+450?dt*.25:dt;
    updateParticles(effectsDt);
    for (let i = bulletTracers.length - 1; i >= 0; i--) {
      bulletTracers[i].life -= effectsDt;
      if (bulletTracers[i].life <= 0) { const line = bulletTracers[i].line; scene.remove(line); line.geometry.dispose(); line.material.dispose(); bulletTracers.splice(i, 1); }
    }
  }
  damagePulse = Math.max(0, damagePulse - dt * 1.5);
  const lowHealthPulse = gameStarted && player.alive && player.health < 30 && !matchFinished
    ? (1 - player.health / 30) * (0.14 + 0.10 * Math.sin(performance.now() * 0.008)) : 0;
  const bloodOpacity = gameStarted ? Math.min(0.7, damagePulse * 0.6 + lowHealthPulse) : 0;
  document.getElementById('hitFlash').style.background = `radial-gradient(ellipse, transparent 38%, rgba(150,12,8,${bloodOpacity}))`;
  damageIndicatorTime = Math.max(0, damageIndicatorTime - dt);
  const damageIndicator = document.getElementById('damageDirection');
  damageIndicator.style.opacity = gameStarted && player.alive && !matchFinished ? Math.min(1, damageIndicatorTime * 3) : 0;
  damageIndicator.style.transform = `rotate(${damageBearing + player.yaw}rad)`;
  updateRenderQuality(dt);

  composer.render();
}
animate();

// ============================================================
// START / RESTART
// ============================================================
let mapChosen = true; // only one map exists now (Desert), pre-selected - no click needed
function updateStartButtonState(){
  let ready = mapChosen && soldierAssetsReady && texturePreloadState.get(selectedMap) === 'ready';
  if (selectedMode === 'pvp') ready = ready && !!netPeer && !!netMyId;
  document.getElementById('startBtn').disabled = !ready;
}
document.getElementById('loadingNote').textContent = 'Loading soldier model...';
soldierReadyPromise.then(() => {
  document.getElementById('loadingNote').textContent = "";
  updateStartButtonState();
});

let selectedMode = 'pvp';

function nameTag(profile){
  const star = profile.isFounder ? '★ ' : '';
  const flag = profile.country ? flagEmoji(profile.country) + ' ' : '';
  const clan = profile.clan ? `[${profile.clan}] ` : '';
  return star + flag + clan;
}
function renderProfileUI(){
  const name = (playerProfile.name || 'Player').trim() || 'Player';
  const nameEl = document.getElementById('profileName');
  const rankEl = document.getElementById('profileRank');
  const ratingEl = document.getElementById('profileRating');
  const recordEl = document.getElementById('profileRecord');
  if (nameEl) nameEl.textContent = nameTag(playerProfile) + name;
  if (rankEl) rankEl.firstChild.textContent = profileRank(playerProfile.rating) + ' ';
  if (ratingEl) ratingEl.textContent = playerProfile.rating;
  if (recordEl) recordEl.textContent = `${playerProfile.wins}W — ${playerProfile.losses}L · ${playerProfile.matches} MATCHES`;
  // read-only echo in the room-control card - editing your name there was removed on purpose
  // (retyping a gametag right before creating a match read as unpolished); it's now account-only
  const pvpIdentityEl = document.getElementById('pvpIdentityDisplay');
  if (pvpIdentityEl) pvpIdentityEl.textContent = nameTag(playerProfile) + name;
}

// populates the account dialog's flag/country select - it only ever applies when the form is
// actually submitted (see account.js's applyLocalFields call), never live
function populateCountrySelect(id){
  const select = document.getElementById(id);
  if (!select || select.dataset.populated) return;
  select.dataset.populated = '1';
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '🏳 Country';
  select.appendChild(blank);
  COUNTRY_LIST.forEach(([code, countryName]) => {
    const opt = document.createElement('option');
    opt.value = code; opt.textContent = `${flagEmoji(code)} ${countryName}`;
    select.appendChild(opt);
  });
  select.value = playerProfile.country || '';
}
populateCountrySelect('accountCountry');

async function openLadderDialog(){
  const dialog = document.getElementById('ladderDialog');
  const status = document.getElementById('ladderStatus');
  const windowEl = document.getElementById('ladderWindow');
  const tbody = document.querySelector('#ladderTable tbody');
  dialog.showModal();
  status.textContent = 'Loading…';
  tbody.innerHTML = '';
  if (!cloudAccount) { status.textContent = 'Cloud accounts are not configured yet.'; return; }
  try {
    const { entries, window: seasonRange, selfId } = await cloudAccount.fetchLadder();
    const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    windowEl.textContent = `This week: ${fmt(seasonRange.start)} – ${fmt(seasonRange.end)} (resets automatically every 7 days)`;
    status.textContent = entries.length ? 'Unverified, client-reported statistics.' : 'No one has played this week yet.';
    tbody.innerHTML = entries.map((row, i) => `
      <tr class="${row.user_id === selfId ? 'ladderSelf' : ''}">
        <td>${i + 1}</td>
        <td>${row.country ? flagEmoji(row.country) : '🏳'}</td>
        <td>${row.clan ? '[' + row.clan.replace(/</g, '&lt;') + '] ' : ''}${(row.name || 'Player').replace(/</g, '&lt;')}</td>
        <td>${row.rating}</td>
        <td>${row.wins}-${row.losses}</td>
      </tr>`).join('');
  } catch (error) { status.textContent = 'Ladder unavailable: ' + error.message; }
}
document.getElementById('ladderButton').addEventListener('click', openLadderDialog);
document.getElementById('ladderClose').addEventListener('click', () => document.getElementById('ladderDialog').close());

let inventoryActiveWeapon = WEAPON_SKIN_IDS[0];
function renderInventory(){
  const grid = document.getElementById('inventoryGrid');
  const tabs = document.getElementById('weaponTabs');
  if (!grid || !tabs) return;
  let status = document.getElementById('founderAccessStatus');
  if (!status) { status = document.createElement('p'); status.id = 'founderAccessStatus'; tabs.before(status); }
  status.textContent = `BUILD FOUNDER-002 · ${founderStatus}`;
  tabs.innerHTML = WEAPON_SKIN_IDS.map(id => `<button class="weaponTab ${id === inventoryActiveWeapon ? 'active' : ''}" type="button" data-weapon="${id}">${WEAPONS[id].name}</button>`).join('');
  tabs.querySelectorAll('[data-weapon]').forEach(tab => tab.addEventListener('click', () => {
    inventoryActiveWeapon = tab.dataset.weapon;
    renderInventory();
  }));
  const equipped = playerProfile.equippedSkins[inventoryActiveWeapon];
  grid.innerHTML = Object.entries(SKIN_CATALOG).filter(([id]) => id !== 'founder' || founderEntitled).map(([id, skin]) => `
    <button class="skinCard ${equipped === id ? 'equipped' : ''}" type="button" data-skin="${id}">
      <span class="skinPreview ${skin.preview}"></span>
      <span class="skinName">${skin.name}</span>
      <span class="skinMeta">${skin.meta}</span>
      <span class="skinState">${equipped === id ? 'EQUIPPED' : 'EQUIP'}</span>
    </button>`).join('');
  grid.querySelectorAll('[data-skin]').forEach(card => card.addEventListener('click', () => {
    if (card.dataset.skin === 'founder' && !founderEntitled) return;
    playerProfile.equippedSkins[inventoryActiveWeapon] = card.dataset.skin;
    applyEquippedSkin(inventoryActiveWeapon);
    savePlayerProfile();
    renderInventory();
  }));
}

function setInventoryOpen(open){
  const modal = document.getElementById('inventoryModal');
  if (!modal) return;
  modal.classList.toggle('open', open);
  if (open) renderInventory();
}

renderProfileUI();
localPlayerName = playerProfile.name || 'Player';
document.getElementById('inventoryBtn').addEventListener('click', () => setInventoryOpen(true));
document.getElementById('closeInventory').addEventListener('click', () => setInventoryOpen(false));
document.getElementById('inventoryModal').addEventListener('click', e => {
  if (e.target.id === 'inventoryModal') setInventoryOpen(false);
});
document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && document.getElementById('inventoryModal').classList.contains('open')) setInventoryOpen(false);
});

document.querySelectorAll('.mapCard').forEach(card => {
  card.addEventListener('mouseenter', () => preloadMapTextures(card.dataset.map), { once: true });
  card.addEventListener('click', () => {
    if (netPeer) { socialUI.notice('Choose maps before creating a room, or between matches.'); return; }
    document.querySelectorAll('.mapCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedMap = card.dataset.map;
    mapChosen = true;
    preloadMapTextures(selectedMap).then(updateStartButtonState);
    updateStartButtonState();
  });
});

preloadMapTextures(selectedMap).then(updateStartButtonState);

// top-down layout thumbnails for the map picker - both maps share the exact same crate/spawn
// layout (see buildWarehouseMap's comment), so this draws that one real layout in each map's own
// color theme rather than needing an actual in-game screenshot of each
function renderMapThumbnail(theme){
  const size = 200;
  const cvs = document.createElement('canvas'); cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, size, size);
  const toX = wx => (wx + 22) / 50 * size;
  const toZ = wz => (wz + 28) / 56 * size;
  // elevated strip
  ctx.fillStyle = theme.elevated;
  ctx.fillRect(toX(-20.5), toZ(-26), toX(-13.5) - toX(-20.5), toZ(26) - toZ(-26));
  // spawn zone tint
  ctx.fillStyle = theme.spawn;
  ctx.fillRect(toX(-11), toZ(-26), toX(18) - toX(-11), toZ(-20) - toZ(-26));
  ctx.fillRect(toX(-11), toZ(20), toX(18) - toX(-11), toZ(26) - toZ(20));
  // boundary walls
  ctx.strokeStyle = theme.wall; ctx.lineWidth = 5;
  ctx.strokeRect(toX(-21), toZ(-27), toX(27) - toX(-21), toZ(27) - toZ(-27));
  // crates/props
  ctx.fillStyle = theme.crate;
  const box = (x, z, s = 5) => ctx.fillRect(toX(x) - s / 2, toZ(z) - s / 2, s, s);
  [-11, -7.55, -4.1, -0.65].forEach(x => { box(x, -15); box(x, 15); });
  [-9, -5, -1, 3, 7, 11].forEach(x => { box(x, -18.5); box(x, 18.5); });
  box(-3, -4); box(7, 3); box(-17, -10); box(-17, 3);
  return cvs.toDataURL();
}
document.querySelector('.mapCard[data-map="arena"] .swatch').style.backgroundImage =
  `url(${renderMapThumbnail({ bg: '#c9ac7a', elevated: '#a9884f', wall: '#5a3d20', crate: '#5a3d24', spawn: 'rgba(229,71,60,0.18)' })})`;
document.querySelector('.mapCard[data-map="warehouse"] .swatch').style.backgroundImage =
  `url(${renderMapThumbnail({ bg: '#26262a', elevated: '#38383e', wall: '#0d0d0d', crate: '#5c4428', spawn: 'rgba(229,71,60,0.22)' })})`;
// stylized (not to-scale) thumbnail for Subway's long-platform-plus-track-pit layout, since it
// doesn't share the square footprint the shared renderMapThumbnail() draws for the other two maps
function renderSubwayThumbnail(theme){
  const size = 200;
  const cvs = document.createElement('canvas'); cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = theme.platform; ctx.fillRect(20, 10, 120, 180);
  ctx.fillStyle = theme.pit; ctx.fillRect(140, 10, 40, 180);
  ctx.fillStyle = theme.train; ctx.fillRect(148, 70, 26, 60);
  ctx.fillStyle = theme.wall;
  for (let y = 22; y <= 178; y += 24) ctx.fillRect(75, y, 10, 10);
  ctx.fillStyle = theme.spawn;
  ctx.fillRect(20, 10, 120, 26);
  ctx.fillRect(20, 164, 120, 26);
  ctx.strokeStyle = theme.wallLine; ctx.lineWidth = 4;
  ctx.strokeRect(20, 10, 160, 180);
  return cvs.toDataURL();
}
document.querySelector('.mapCard[data-map="subway"] .swatch').style.backgroundImage =
  `url(${renderSubwayThumbnail({ bg: '#1c1e22', platform: '#cfc9ba', pit: '#2b2f33', train: '#3a4650', wall: '#7a6a3a', wallLine: '#0d0d0d', spawn: 'rgba(229,71,60,0.25)' })})`;
function renderSkylineThumbnail(){
  const size = 200;
  const cvs = document.createElement('canvas'); cvs.width = size; cvs.height = size;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, size, size); grad.addColorStop(0, '#607080'); grad.addColorStop(1, '#1b242d');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#899295'; ctx.fillRect(12, 12, 176, 176);
  ctx.strokeStyle = '#d44b3e'; ctx.lineWidth = 5; ctx.strokeRect(12, 12, 176, 176);
  ctx.fillStyle = '#4f595e'; ctx.fillRect(59, 59, 82, 82);
  ctx.fillStyle = '#252c30'; ctx.fillRect(52, 52, 96, 9); ctx.fillRect(52, 139, 96, 9);
  ctx.fillRect(52, 61, 9, 87); ctx.fillRect(139, 61, 9, 87);
  ctx.fillStyle = '#30383c';
  [[35,35],[165,35],[35,165],[165,165],[28,100],[172,100]].forEach(([x,y]) => ctx.fillRect(x - 7, y - 7, 14, 14));
  ctx.fillStyle = 'rgba(229,71,60,.28)'; ctx.fillRect(18, 15, 164, 25); ctx.fillRect(18, 160, 164, 25);
  return cvs.toDataURL();
}
document.querySelector('.mapCard[data-map="skyline"] .swatch').style.backgroundImage = `url(${renderSkylineThumbnail()})`;
function renderOfficeThumbnail(){
  const c=document.createElement('canvas'); c.width=320; c.height=180; const ctx=c.getContext('2d');
  ctx.fillStyle='#d8d8d2'; ctx.fillRect(0,0,320,180);
  ctx.strokeStyle='#8ed8e8'; ctx.lineWidth=3; ctx.strokeRect(4,4,312,172);
  ctx.fillStyle='#8bc59a'; ctx.fillRect(132,64,56,52);
  ctx.fillStyle='#4f5558'; ctx.fillRect(55,72,14,40); ctx.fillRect(251,72,14,40);
  ctx.strokeStyle='#72c8dc'; ctx.lineWidth=2;
  [[4,4,56,42],[60,4,100,42],[160,4,105,42],[285,4,31,42],[4,134,56,42],[60,134,100,42],[160,134,100,42],[260,134,56,42]].forEach(r=>ctx.strokeRect(...r));
  ctx.fillStyle='#76563c'; ctx.fillRect(16,80,30,18); ctx.fillRect(274,80,30,18);
  return c.toDataURL();
}
const officeSwatch=document.querySelector('.mapCard[data-map="office"] .swatch');
if(officeSwatch) officeSwatch.style.backgroundImage=`url(${renderOfficeThumbnail()})`;

function renderFoundryThumbnail(){
  const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 260;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#17272d'; ctx.fillRect(0, 0, 220, 260);
  ctx.fillStyle = '#6e7976'; ctx.fillRect(8, 8, 204, 244);
  for (const cover of FOUNDRY.cover) {
    ctx.fillStyle = cover.kind === 'reactor' ? '#e89b53' : cover.x < 0 ? '#287d7b' : '#bc6b40';
    ctx.fillRect((cover.x - cover.w / 2 + 22) * 5, (cover.z - cover.d / 2 + 26) * 5, cover.w * 5, cover.d * 5);
  }
  ctx.fillStyle = '#a8e1d7'; ctx.fillRect(95, 14, 30, 10);
  ctx.fillStyle = '#ffb786'; ctx.fillRect(95, 236, 30, 10);
  return canvas.toDataURL();
}
document.querySelector('.mapCard[data-map="foundry"] .swatch').style.backgroundImage = `url(${renderFoundryThumbnail()})`;

for (const id of Object.keys(FFA_MAPS)) document.querySelector(`.mapCard[data-map="${id}"] .swatch`).style.backgroundImage = `url(${ffaThumbnail(id)})`;

document.querySelectorAll('.modeCard').forEach(card => {
  card.addEventListener('click', () => {
    if (netPeer) { socialUI.notice('Return to HQ to create a room with a different mode.'); return; }
    document.querySelectorAll('.modeCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedMode = ['knife','ffa'].includes(card.dataset.mode) ? 'pvp' : card.dataset.mode;
    selectedRuleset = ['knife','ffa'].includes(card.dataset.mode) ? card.dataset.mode : 'standard';
    selectFfaMaps();
    if (netRole === 'host' && !gameStarted) broadcastRoster();
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
document.getElementById('ffaKillGoalSelect').addEventListener('change', e => {
  ffaKillGoal = Number(e.target.value) || Infinity;
  if (netRole === 'host' && !gameStarted) broadcastRoster();
});
document.getElementById('ffaTimeLimitSelect').addEventListener('change', e => {
  ffaTimeLimit = Number(e.target.value) || Infinity;
  if (netRole === 'host' && !gameStarted) broadcastRoster();
});

document.querySelectorAll('.pvpChoiceBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (matchmakingActive) cancelMatchmaking();
    document.querySelectorAll('.pvpChoiceBtn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const choice = btn.dataset.choice; // 'matchmaking' | 'host' | 'join'
    const joining = choice === 'join';
    document.getElementById('pvpMatchmakingSection').style.display = choice === 'matchmaking' ? 'flex' : 'none';
    document.getElementById('pvpHostSection').style.display = choice === 'host' ? 'flex' : 'none';
    document.getElementById('pvpJoinSection').style.display = joining ? 'flex' : 'none';
    document.getElementById('pvpTeamSize').style.display = joining ? 'none' : 'flex';
    document.getElementById('ffaOptions').hidden = joining || !isFfa();
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

// name/clan/flag are no longer editable from the room-control card (retyping a gametag right
// before creating a match read as unpolished) - the account dialog's SAVE PROFILE/SIGN IN/REGISTER
// buttons are now the only way to change them, for both guests and cloud accounts alike
localPlayerName = playerProfile.name;
const CLOUD_ACCOUNTS_ENABLED = true;
if (CLOUD_ACCOUNTS_ENABLED) mountAccount({
  readProfile: () => playerProfile,
  isPlaying: () => gameStarted,
  applyProfile: profile => {
    cloudProfileActive = true;
    const { email, founderAccess, founderStatus: accessStatus, ...cloudFields } = profile;
    founderStatus = accessStatus || 'FOUNDER ACCESS: CHECK UNAVAILABLE';
    founderEntitled = founderAccess === true;
    playerProfile = { ...defaultProfile(), ...cloudFields };
    // account.js's fields() whitelist may still be sending the old singular `equippedSkin`
    // column (pre-migration schema) instead of/alongside the new per-weapon `equippedSkins` -
    // sanitize rather than trust the cloud payload's shape blindly.
    playerProfile.equippedSkins = sanitizeEquippedSkins(cloudFields.equippedSkins, cloudFields.equippedSkin);
    delete playerProfile.equippedSkin;
    // The server checks the confirmed Auth identity before granting this entitlement.
    playerProfile.isFounder = founderEntitled;
    localPlayerName = playerProfile.name;
    document.querySelector('#profileDock .profileEyebrow').textContent = 'CLOUD PROFILE · PROVISIONAL';
    applyEquippedSkin();
    renderProfileUI();
    renderInventory();
  },
  // called on every signup/signin submit from the dialog's own gametag/clan/flag fields - lets
  // registration seed those straight into the brand-new cloud row instead of leaving it blank
  applyLocalFields: patch => {
    playerProfile.name = (patch.name || '').trim() || playerProfile.name || 'Player';
    playerProfile.clan = (patch.clan || '').slice(0, 4).toUpperCase();
    playerProfile.country = patch.country || '';
    localPlayerName = playerProfile.name;
    savePlayerProfile();
    renderProfileUI();
  }
}).then(account => { cloudAccount = account; });

document.getElementById('pvpHostBtn').addEventListener('click', () => {
  document.getElementById('pvpStatus').textContent = 'Setting up...';
  hostRoom(netTeamSize);
});
document.getElementById('pvpJoinBtn').addEventListener('click', () => {
  const code = document.getElementById('pvpJoinCode').value;
  if (code.trim()) { document.getElementById('pvpStatus').textContent = 'Setting up...'; joinRoom(code); }
});
document.getElementById('pvpFindMatchBtn').addEventListener('click', startMatchmaking);
document.getElementById('pvpCancelMatchBtn').addEventListener('click', cancelMatchmaking);
document.getElementById('pvpIdentityAccountBtn').addEventListener('click', () => {
  document.getElementById('accountButton').click();
});
document.getElementById('pvpCopyLinkBtn').addEventListener('click', async () => {
  const input = document.getElementById('pvpRoomLinkInput');
  const btn = document.getElementById('pvpCopyLinkBtn');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (err) {
    input.select(); // clipboard API unavailable/blocked - fall back to a manual copy
  }
  btn.textContent = 'COPIED!';
  setTimeout(() => { btn.textContent = 'COPY LINK'; }, 1500);
});

// a room link is one click for whoever receives it instead of typing/pasting a code - land on
// ?room=CODE, switch straight to the join view with the code prefilled, and connect immediately
(function autoJoinFromRoomLink(){
  const room = new URLSearchParams(location.search).get('room');
  if (!room) return;
  history.replaceState(null, '', location.pathname); // don't re-trigger this on a later refresh
  document.querySelectorAll('.pvpChoiceBtn').forEach(b => b.classList.toggle('selected', b.dataset.choice === 'join'));
  document.getElementById('pvpMatchmakingSection').style.display = 'none';
  document.getElementById('pvpHostSection').style.display = 'none';
  document.getElementById('pvpJoinSection').style.display = 'flex';
  document.getElementById('pvpTeamSize').style.display = 'none';
  document.getElementById('ffaOptions').hidden = true;
  document.getElementById('mapSelect').style.display = 'none';
  document.getElementById('modeSelect').style.display = 'none';
  selectedMap = 'arena'; selectedMode = 'pvp'; mapChosen = true;
  document.getElementById('pvpJoinCode').value = room.toUpperCase();
  document.getElementById('pvpStatus').textContent = 'Joining room from link...';
  joinRoom(room);
})();

document.getElementById('startBtn').addEventListener('click', () => {
  if (document.getElementById('startBtn').disabled) return;
  audio.init();
  audio.resume();
  audio.startAmbience(selectedMap);
  buildMap(selectedMap);
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  gameStarted = true;
  document.getElementById('matchChat').hidden = false;
  document.getElementById('socialHint').hidden = false;
  updateAmmoHUD();
  updateGrenadeHUD();
  updateHealthHUD();
  updateEnemyHUD();
  updateMoneyHUD();
  gameMode = selectedMode;
  renderBuyMenu();
  document.getElementById('hordeStats').style.display = gameMode === 'horde' ? 'block' : 'none';
  document.getElementById('roundStats').style.display = (gameMode === 'bomb' || gameMode === 'pvp') ? 'block' : 'none';
  document.getElementById('scoreboardBar').style.display = (gameMode === 'bomb' || gameMode === 'pvp' || gameMode === 'practice') ? 'flex' : 'none';
  // practice has no teams - just the centered timer, same look as the 1v1 scoreboard's clock
  document.querySelectorAll('#scoreboardBar .sbTeam, #scoreboardBar .sbScore').forEach(el => { el.style.display = (gameMode === 'practice' || isFfa()) ? 'none' : 'flex'; });
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
  // the rig's rest pose is already a natural standing pose (not a T-pose), so a static target
  // just needs one idle-pose update rather than any special mid-stride handling
  animateSoldierRig(enemy.mesh, 0, 0);
  return enemy;
}

function startPractice(){
  money = 9999999;
  updateMoneyHUD();
  practiceTimer = PRACTICE_DURATION;
  (selectedMap === 'foundry' ? FOUNDRY.practiceTargets : PRACTICE_TARGET_POS).forEach(([x, z]) => {
    const point = findClearSpawn({ xMin: x - 2, xMax: x + 2, zMin: z - 2, zMax: z + 2 },
      (px, pz) => checkCollision(new THREE.Vector3(px, 2, pz)), () => 0.5);
    if (point) spawnPracticeTarget(new THREE.Vector3(point.x, 2, point.z));
  });
}

function updatePractice(dt){
  if (practiceTimer > 0) {
    practiceTimer = Math.max(0, practiceTimer - dt);
    if (practiceTimer === 0) showWaveBanner('Practice time is up');
  }
  document.getElementById('roundPhaseLabel').textContent = 'PRACTICE';
  document.getElementById('roundTimer').textContent = formatRoundTime(practiceTimer);
}
