// MORIS // ARENA — wave-based FPS, three.js r160, sin dependencias externas.
// E3: recursos estilo Doom — vida sin regen, armadura con absorción 60%, pools de
// munición por tipo con caps, pickups billboard y drops por kill (ver PICKUPS/AMMO).
// E4a: sistema de armas multipool — tabla WEAPONS declarativa, 6 armas (0-5) con viewmodel
// pixelado propio en escena separada, cambio con teclas/rueda/mando/touch (ver WEAPONS).
import * as THREE from 'three';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';
import { makeEnemySprite, makePickupSprite, makeWeaponSprite } from './sprites.js'; // E2: arte enemigo · E3: pickups · E4a: viewmodels

/* ============================================================ utils */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);

// Color HDR para materiales emisivos: convierte hex sRGB a lineal y lo empuja
// por encima del threshold del bloom (0.75) para que el neón genere glow real.
const neon = (hex, k = 2) => new THREE.Color(hex).multiplyScalar(k);

// rect redondeado compatible (sin depender de ctx.roundRect)
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ============================================================ audio (WebAudio procedural, sin assets) */
const Sfx = {
  ctx: null, noiseBuf: null, master: null,
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.25;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  env(node, t0, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g); g.connect(this.master);
    return g;
  },
  noise(dur, peak, freq, q = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); this.env(f, t0, peak, dur);
    src.start(t0); src.stop(t0 + dur + 0.02);
  },
  tone(type, f0, f1, dur, peak) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    this.env(o, t0, peak, dur);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  // E4a — disparo distintivo por arma (WebAudio corto, retro). `shoot` era el crack
  // genérico del rifle: pasa a llamarse shootVecinal y cada arma suma el suyo.
  shootVecinal(){ this.noise(0.09, 0.5, 1900, 0.8); this.tone('sine', 120, 40, 0.07, 0.4); },
  shootShotgun(){ this.noise(0.2, 0.62, 480, 0.5); this.noise(0.08, 0.4, 1500, 0.7);
                  this.tone('sawtooth', 95, 32, 0.22, 0.5); },                    // boom grave
  shootSmg()    { this.noise(0.05, 0.4, 2400, 1.1); this.tone('square', 240, 90, 0.045, 0.3); }, // staccato
  shootFist()   { this.noise(0.07, 0.3, 700, 0.6); this.tone('triangle', 200, 70, 0.06, 0.25); }, // soplo
  meleeHit()    { this.noise(0.04, 0.35, 900, 1); this.tone('square', 320, 120, 0.04, 0.2); },    // caricia
  flame()       { this.noise(0.13, 0.2, 260 + Math.random() * 200, 0.5);
                  this.tone('sine', 60, 40, 0.1, 0.12); },                          // ruido marrón filtrado (tic a tic)
  rocketFire()  { this.noise(0.3, 0.4, 900, 0.6); this.tone('sine', 700, 140, 0.28, 0.35); },     // whoosh
  explosion()   { this.noise(0.45, 0.7, 180, 0.4); this.tone('sawtooth', 110, 28, 0.4, 0.5);
                  this.noise(0.15, 0.4, 600, 0.6); },                               // boom
  hitmark(){ this.tone('square', 950, 700, 0.05, 0.12); },
  kill()   { this.tone('sawtooth', 520, 90, 0.28, 0.22); this.noise(0.15, 0.2, 800, 0.6); },
  hurt()   { this.tone('sine', 160, 50, 0.3, 0.35); this.noise(0.1, 0.25, 300, 0.7); },
  reload() { this.tone('triangle', 300, 300, 0.03, 0.2); setTimeout(() => this.tone('triangle', 480, 480, 0.03, 0.2), 160); },
  // E4a — troque de arma: clac retro de dos tiempos (cerrojo). deny: slot vacío/no owned.
  switchSnd(){ this.noise(0.02, 0.25, 2200, 2.5);
               setTimeout(() => this.tone('square', 520, 660, 0.035, 0.18), 45); },
  deny()   { this.tone('square', 190, 150, 0.09, 0.22); },                          // beep breve
  overheat(){ this.noise(0.5, 0.3, 2400, 0.8); this.tone('sine', 220, 60, 0.4, 0.22); }, // siseo de caldera
  // E3 — un blip por categoría de pickup (cortos, estilo retro, se distinguen con la música off):
  pickupLife()  { this.tone('sine', 523, 523, 0.06, 0.22); setTimeout(() => this.tone('sine', 784, 830, 0.1, 0.2), 70); },
  pickupArmor() { this.noise(0.03, 0.16, 2600, 3); this.tone('square', 196, 196, 0.04, 0.14); setTimeout(() => this.tone('square', 392, 392, 0.07, 0.14), 60); },
  pickupAmmo()  { this.noise(0.025, 0.18, 1500, 2); setTimeout(() => { this.noise(0.025, 0.15, 2000, 2); this.tone('triangle', 660, 660, 0.05, 0.18); }, 70); },
  dry()         { this.noise(0.02, 0.14, 2800, 3); this.tone('square', 150, 70, 0.03, 0.1); }, // aguja percutida: pool vacío
  wave()   { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.tone('triangle', f, f, 0.16, 0.18), i * 110)); },
  death()  { this.tone('sawtooth', 300, 30, 1.1, 0.3); this.noise(0.8, 0.25, 220, 0.5); },
};

/* ============================================================ modo táctil
   Se activa con dedo real (ontouchstart / pointer:coarse) o forzando ?touch=1 para probar
   en desktop. Debe definirse ANTES del renderer: en táctil el pixel ratio se capa a 1.5
   (las GPUs móviles se ahogan con el bloom a HiDPI); el auto-degrade de bloom sigue igual. */
const TOUCH_MODE = 'ontouchstart' in window ||
  (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
  new URLSearchParams(location.search).get('touch') === '1';
const MAX_DPR = TOUCH_MODE ? 1.5 : 2;
const maxDpr = () => Math.min(devicePixelRatio, MAX_DPR);

/* ============================================================ renderer / scene */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(maxDpr());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
// niebla azulada: los objetos lejanos se funden con el horizonte del cielo
scene.fog = new THREE.FogExp2(0x081327, 0.016);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);

/* ============================================================ cielo procedural
   esfera BackSide con gradiente vertical (negro cenital -> azul profundo en el
   horizonte) + campo de ~1500 estrellas Points con titilación global por opacity. */
function canvasTex(size, draw, repX = 1, repY = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repX, repY);
  tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tx;
}

// gradiente vertical: fila 0 del canvas = cenit (v=1), última fila = bajo horizonte
const skyTex = canvasTex(64, (c, S) => {
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0.00, '#000104');
  g.addColorStop(0.34, '#020715');
  g.addColorStop(0.62, '#082142');
  g.addColorStop(0.86, '#114374');
  g.addColorStop(0.955, '#1d5d94'); // azul profundo del horizonte
  g.addColorStop(1.00, '#0a1a30');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  // ruido tipo banding: líneas horizontales sutiles que el mip-mapping promedia
  for (let i = 0; i < 60; i++) {
    c.fillStyle = `rgba(150,190,255,${rand(0.006, 0.02).toFixed(3)})`;
    c.fillRect(0, rand(0, S), S, 1);
  }
});
skyTex.wrapS = THREE.ClampToEdgeWrapping;
skyTex.wrapT = THREE.ClampToEdgeWrapping;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(150, 32, 20),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
scene.add(sky);

// estrellas: cascarón esférico entre 72 y 138 m (dentro del cielo, bajo el far plane)
const STAR_N = 1500;
const starGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(STAR_N * 3), col = new Float32Array(STAR_N * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < STAR_N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const rad = rand(72, 138), r = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(th) * r * rad;
    pos[i * 3 + 1] = u * rad;
    pos[i * 3 + 2] = Math.sin(th) * r * rad;
    const k = Math.random();
    if (k > 0.86) tmp.setRGB(1.7, 1.15, 0.75);          // cálidas
    else if (k > 0.55) tmp.setRGB(0.95, 1.3, 1.9);      // azules
    else tmp.setRGB(1.35, 1.5, 1.65);                   // blancas
    tmp.multiplyScalar(rand(0.4, 1.15)); // parte queda bajo el threshold: no todo titila en HDR
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const starTex = canvasTex(64, (c, S) => {
  const g = c.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
});
const starMat = new THREE.PointsMaterial({
  size: 0.42, sizeAttenuation: true, map: starTex, vertexColors: true,
  transparent: true, opacity: 0.92, depthWrite: false,
  blending: THREE.AdditiveBlending, fog: false });
const stars = new THREE.Points(starGeo, starMat);
stars.renderOrder = -1;
scene.add(stars);

// entorno PMREM a partir del propio gradiente: reflejos azules sutiles en PBR
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(skyTex).texture;
  pmrem.dispose();
}

/* ============================================================ post-processing
   RenderPass (HDR) -> UnrealBloomPass -> OutputPass (tonemap + sRGB).
   Con composer el tonemap/sRGB del renderer NO se aplica en los pases intermedios
   (solo OutputPass al screen), por eso el neón HDR atraviesa el umbral 0.75 y hace
   bloom real.

   PIPELINE RETRO E1 (toggle T): el composer renderiza la escena a un framebuffer
   interno de altura fija ~270 px y el último pase lo estira al canvas con filtrado
   NEAREST: poniendo NearestFilter en los RT del composer, el quad de OutputPass es en
   sí el upscale — pixelación Doom/Boltgun sin pases ni shaders extra.
   - Resolución interna = px de dispositivo / divisor ENTERO (retroSize): pixeles siempre
     cuadrados (sin shimmer al moverse) y ~270p sin importar devicePixelRatio.
   - Retro baja además el MSAA (samples 0): bordes duros crunchy, que es el look; el
     modo normal (T off) vuelve a dpr ≤ MAX_DPR + MSAA x4, idéntico a pre-E1.
   - samples es inmutable en un WebGLRenderTarget: el toggle intercambia los targets
     internos con composer.reset() (en r160 clone()/reset() preservan samples y
     filtros de la textura). */
let retroOn = true;   // default: retro ON (nueva estética); T la alterna
const RETRO_H = 270;  // altura objetivo del buffer interno (~270p, crunch más agresivo)

// un RT para cada ping-pong del composer: HalfFloat (el HDR debe llegar intacto
// al bloom). Filtros y MSAA según el modo: retro Nearest/sin MSAA, normal Linear/x4.
function makeComposerTarget() {
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType, samples: retroOn ? 0 : 4,
  });
  const f = retroOn ? THREE.NearestFilter : THREE.LinearFilter;
  rt.texture.magFilter = f; rt.texture.minFilter = f; rt.texture.generateMipmaps = false;
  return rt;
}

// canvas en px de dispositivo dividido por un factor ENTERO que deja la altura en
// ~RETRO_H (270p). Preferencia: f = k·dpr con k entero → cada pixel interno cubre k px
// CSS exactos en ambos ejes (upscale nearest parejo, sin filas/columnas de grosor
// irregular). Si el dpr es fraccional y k·dpr no sale entero ("no entra"), se hace
// floor(devH/RETRO_H): el entero más cercano SIN pasar la altura objetivo.
function retroSize() {
  const dpr = maxDpr();
  const devW = Math.max(2, Math.round(innerWidth * dpr));
  const devH = Math.max(2, Math.round(innerHeight * dpr));
  let f = Math.round(dpr * clamp(Math.round(devH / (RETRO_H * dpr)), 1, 16));
  if (!Number.isInteger(f) || f < 1) f = clamp(Math.floor(devH / RETRO_H), 1, 16);
  return [Math.max(2, Math.round(devW / f)), Math.max(2, Math.round(devH / f))];
}

const composer = new EffectComposer(renderer, makeComposerTarget());
composer.addPass(new RenderPass(scene, camera));
// bloom a MEDIA resolución: la pirámide de mip de UnrealBloomPass arranca en 1/2 del
// buffer efectivo -> cada uno de sus ~11 fullscreen passes cuesta 1/4. Clave para PCs
// flojos / SwiftShader, donde el composer a resolución completa hundía el FPS.
// Con retro activo la pirámide arranca de los ~270p: bloom muy barato.
const BLOOM_SCALE = 0.5;
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth * BLOOM_SCALE, innerHeight * BLOOM_SCALE), 0.55, 0.6, 0.75);
// addPass y composer.setSize siempre llaman pass.setSize(effectiveW, effectiveH) a
// tamaño completo; se intercepta para que la pirámide quede siempre a media resolución.
const bloomSetSizeFull = bloomPass.setSize.bind(bloomPass);
bloomPass.setSize = (w, h) =>
  bloomSetSizeFull(Math.max(1, Math.round(w * BLOOM_SCALE)), Math.max(1, Math.round(h * BLOOM_SCALE)));
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// tamaños: retro → pixelRatio 1 y tamaño lógico = resolución baja (el buffer interno
// queda exactamente en low-res; el canvas conserva sus px nativos y OutputPass estira
// con nearest). Normal → el pixelRatio del renderer (dpr cap MAX_DPR) y tamaño CSS,
// como antes del E1. setPixelRatio internamente re-sizea; el setSize que sigue fija
// el tamaño lógico definitivo en ambos modos.
function applyComposerSize() {
  if (retroOn) {
    const [w, h] = retroSize();
    composer.setPixelRatio(1);
    composer.setSize(w, h);
  } else {
    composer.setPixelRatio(maxDpr());
    composer.setSize(innerWidth, innerHeight);
  }
}
function setRetro(on) {
  if (on === retroOn) return;
  retroOn = on;
  composer.reset(makeComposerTarget()); // swap de targets: samples/filtros del nuevo modo
  applyComposerSize();
}
applyComposerSize(); // normaliza los tamaños iniciales (arranca en retro)

/* bloom on/off: off desactiva el pase de bloom (bloomPass.enabled en el loop). Con
   retro sigue haciendo falta el composer (el upscale nearest vive en su último pase);
   sin retro Y sin bloom se va directo por renderer.render (en screen el renderer
   aplica ACES + sRGB, misma terminación que OutputPass). */
let bloomOn = true;
function setBloom(on) { bloomOn = on; applyGunGlow(); }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  vmCam.aspect = innerWidth / innerHeight; // E4a: la cámara del viewmodel también
  vmCam.updateProjectionMatrix();
  const pr = maxDpr(); // mismo cap de dpr para renderer y composer (modo normal)
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  applyComposerSize(); // retro: re-deriva el buffer interno con el aspect/dpr nuevo
});

/* lights */
scene.add(new THREE.HemisphereLight(0x4a6ea8, 0x0e1424, 1.7));
const sun = new THREE.DirectionalLight(0xbfd8ff, 2.6);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 90;
scene.add(sun);

/* ============================================================ arena */
const ARENA = 32;              // semi-lado del piso jugable
const WALL_H = 5;
const solids = [];             // mallas que bloquean balas
const boxes = [];              // AABBs para colisión {min:Vec3, max:Vec3}

function addSolid(mesh, collide = true) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh); solids.push(mesh);
  if (collide) {
    mesh.updateWorldMatrix(true, false);
    const bb = new THREE.Box3().setFromObject(mesh);
    boxes.push({ min: bb.min.clone(), max: bb.max.clone() });
  }
}

/* ---------------- texturas procedurales del arena (canvas, sin assets) ------- */
function specks(c, S, n, pick) {
  for (let i = 0; i < n; i++) { c.fillStyle = pick(); c.fillRect(rand(0, S), rand(0, S), 1, 1); }
}
function rivet(c, x, y, r = 6) {
  c.fillStyle = '#050810'; c.beginPath(); c.arc(x, y, r * 1.25, 0, 7); c.fill();
  c.fillStyle = '#22304e'; c.beginPath(); c.arc(x, y, r * 0.9, 0, 7); c.fill();
  c.fillStyle = '#43597f'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.38, 0, 7); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(x + r * 0.35, y + r * 0.4, r * 0.24, 0, 7); c.fill();
}

// Piso: paneles metálicos sci-fi — placa con bisel, remaches, junta cian en la
// costura, ranura de ventilación, código de barras y ruido sutil. 1 tile = 4 m.
const floorTex = canvasTex(512, (c, S) => {
  c.fillStyle = '#0d1424'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 240; i++) { // rayado vertical tipo chapa
    c.fillStyle = `rgba(${(120 + rand(0, 90)) | 0},${(160 + rand(0, 75)) | 0},255,${rand(0.012, 0.04).toFixed(3)})`;
    c.fillRect(rand(0, S), 0, rand(0.6, 2.4), S);
  }
  // costura del tile (biselada, con junta emisiva tenue que al repetir forma la grilla)
  c.strokeStyle = '#060a13'; c.lineWidth = 26; c.strokeRect(14, 14, S - 28, S - 28);
  c.strokeStyle = 'rgba(84,240,255,0.30)'; c.lineWidth = 3; c.strokeRect(14, 14, S - 28, S - 28);
  c.strokeStyle = 'rgba(84,240,255,0.09)'; c.lineWidth = 9; c.strokeRect(14, 14, S - 28, S - 28);
  // placa interior con bisel (luz arriba/izq, sombra abajo/der)
  c.fillStyle = '#121a2e'; c.fillRect(30, 30, S - 60, S - 60);
  c.strokeStyle = '#28375a'; c.lineWidth = 5;
  c.beginPath(); c.moveTo(30, 484); c.lineTo(30, 30); c.lineTo(484, 30); c.stroke();
  c.strokeStyle = '#05080f';
  c.beginPath(); c.moveTo(484, 32); c.lineTo(484, 484); c.lineTo(32, 484); c.stroke();
  for (let i = 0; i < 150; i++) { // ruido fino sobre la placa
    c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
    c.fillRect(rand(34, 476), rand(34, 476), rand(1, 3), 1);
  }
  // sub-panel interior rebajado
  c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 3; c.strokeRect(150, 150, 212, 212);
  c.strokeStyle = 'rgba(160,200,255,0.05)'; c.lineWidth = 1; c.strokeRect(153, 153, 206, 206);
  [58, 454].forEach(x => [58, 454].forEach(y => rivet(c, x, y)));
  // ranura de ventilación
  c.fillStyle = '#060a12'; rr(c, 330, 340, 128, 40, 8); c.fill();
  c.strokeStyle = 'rgba(160,200,255,0.08)'; c.lineWidth = 1; rr(c, 330, 340, 128, 40, 8); c.stroke();
  c.fillStyle = '#1c2942';
  for (let i = 0; i < 5; i++) c.fillRect(338, 346 + i * 7, 112, 2);
  // código de barras + marcas de stencil cian
  let bx = 66;
  while (bx < 170) { const w = rand(1, 3.4); c.fillStyle = `rgba(150,190,220,${rand(0.07, 0.18).toFixed(2)})`; c.fillRect(bx, 344, w, 34); bx += w + rand(1.5, 4); }
  c.fillStyle = 'rgba(84,240,255,0.28)'; c.fillRect(66, 300, 46, 5); c.fillRect(66, 311, 22, 5);
  c.fillStyle = 'rgba(84,240,255,0.16)'; c.fillRect(404, 96, 5, 30); c.fillRect(415, 96, 5, 18);
  specks(c, S, 220, () => Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)');
}, 16, 16);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
  new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7, metalness: 0.32, envMapIntensity: 0.35 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Muros: paneles verticales con rejilla de detalle, franja de chevrons naranjas
// de advertición abajo y zócalo oscuro. 1 tile ≈ 6 × 5 m (repeat 11 × 1).
const wallTex = canvasTex(256, (c, S) => {
  c.fillStyle = '#101a30'; c.fillRect(0, 0, S, S);
  // rejilla sutil en toda la cara
  c.strokeStyle = 'rgba(120,180,255,0.035)'; c.lineWidth = 1;
  c.beginPath();
  for (let x = 16; x < S; x += 16) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, S); }
  for (let y = 16; y < S; y += 16) { c.moveTo(0, y + 0.5); c.lineTo(S, y + 0.5); }
  c.stroke();
  // juntas verticales de panel (cada 64 px = ~1.5 m) con filo iluminado
  [0, 64, 128, 192].forEach(x => {
    c.fillStyle = '#070b15'; c.fillRect(x - 2, 0, 5, S);
    c.fillStyle = 'rgba(150,190,255,0.10)'; c.fillRect(x + 3, 0, 1, S);
  });
  // pernos a media altura
  [32, 96, 160, 224].forEach(x => rivet(c, x, 108, 3));
  // sombra del borde superior
  const g = c.createLinearGradient(0, 0, 0, 68);
  g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, 68);
  // ---- franja de chevrons naranjas (paso 32 → envuelve sin costura) ----
  const BY = S - 88, BH = 54;
  c.save();
  c.beginPath(); c.rect(0, BY, S, BH); c.clip();
  c.fillStyle = '#1a1206'; c.fillRect(0, BY, S, BH);
  c.lineCap = 'square';
  for (let x = -S; x < S * 2; x += 32) {
    c.strokeStyle = '#c96a1c'; c.lineWidth = 15;
    c.beginPath(); c.moveTo(x, BY + BH + 20); c.lineTo(x + BH + 40, BY - 20); c.stroke();
    c.strokeStyle = 'rgba(255,196,96,0.5)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x, BY + BH + 20); c.lineTo(x + BH + 40, BY - 20); c.stroke();
  }
  c.restore();
  c.fillStyle = '#05070c'; c.fillRect(0, BY - 5, S, 5); c.fillRect(0, BY + BH, S, 4);
  c.fillStyle = 'rgba(255,154,61,0.55)'; c.fillRect(0, BY - 8, S, 2);
  // zócalo inferior
  const g2 = c.createLinearGradient(0, S - 34, 0, S);
  g2.addColorStop(0, 'rgba(2,4,9,0.15)'); g2.addColorStop(1, 'rgba(2,4,9,0.85)');
  c.fillStyle = g2; c.fillRect(0, S - 34, S, 34);
  // rayones y mugre
  for (let i = 0; i < 26; i++) {
    c.strokeStyle = `rgba(0,0,0,${rand(0.12, 0.3).toFixed(2)})`; c.lineWidth = rand(1, 2.4);
    const x = rand(0, S), y = rand(0, S - 96), l = rand(6, 34);
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + rand(-l, l), y + rand(-l * 0.3, l * 0.3)); c.stroke();
  }
  specks(c, S, 160, () => Math.random() < 0.6 ? 'rgba(0,0,0,0.10)' : 'rgba(160,200,255,0.04)');
}, 11, 1);

const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.35, envMapIntensity: 0.3 });
const trimMat = new THREE.MeshBasicMaterial({ color: neon(0x54f0ff, 1.55) }); // filo superior: bloom suave
[[0, -ARENA - 0.5, ARENA * 2 + 2, 1], [0, ARENA + 0.5, ARENA * 2 + 2, 1],
 [-ARENA - 0.5, 0, 1, ARENA * 2 + 2], [ARENA + 0.5, 0, 1, ARENA * 2 + 2]].forEach(([x, z, w, d]) => {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
  wall.position.set(x, WALL_H / 2, z);
  addSolid(wall, false); // colisión con límites se hace por clamp
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.995, 0.07, d * 0.995), trimMat);
  trim.position.set(x, WALL_H - 0.35, z);
  scene.add(trim);
});

// Obstáculos: metal cepillado con bordes achaflanados gastados y esquinas
// desportilladas (el desgaste vive en los bordes del UV de cada cara).
const obTex = canvasTex(256, (c, S) => {
  c.fillStyle = '#202c48'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 340; i++) { // cepillado horizontal
    c.fillStyle = Math.random() < 0.55
      ? `rgba(190,215,255,${rand(0.015, 0.055).toFixed(3)})`
      : `rgba(0,0,0,${rand(0.02, 0.06).toFixed(3)})`;
    c.fillRect(0, rand(0, S), S, rand(0.6, 2));
  }
  // bisel de aristas: gradientes interior + hilo brillante del chaflán
  const gl = [c.createLinearGradient(0, 0, 0, 26), c.createLinearGradient(0, S - 26, 0, S),
              c.createLinearGradient(0, 0, 26, 0), c.createLinearGradient(S - 26, 0, S, 0)];
  const fills = ['rgba(200,222,255,0.10)', 'rgba(0,0,0,0.38)', 'rgba(160,190,240,0.06)', 'rgba(0,0,0,0.20)'];
  gl[0].addColorStop(0, fills[0]); gl[0].addColorStop(1, 'rgba(0,0,0,0)');
  gl[1].addColorStop(0, 'rgba(0,0,0,0)'); gl[1].addColorStop(1, fills[1]);
  gl[2].addColorStop(0, fills[2]); gl[2].addColorStop(1, 'rgba(0,0,0,0)');
  gl[3].addColorStop(0, 'rgba(0,0,0,0)'); gl[3].addColorStop(1, fills[3]);
  c.fillStyle = gl[0]; c.fillRect(0, 0, S, 26);
  c.fillStyle = gl[1]; c.fillRect(0, S - 26, S, 26);
  c.fillStyle = gl[2]; c.fillRect(0, 0, 26, S);
  c.fillStyle = gl[3]; c.fillRect(S - 26, 0, 26, S);
  c.strokeStyle = 'rgba(205,225,255,0.30)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, S - 1, S - 1);
  // desgaste de esquinas: manchas claras + picaduras oscuras + rasguños radiales
  [[14, 14, 1, 1], [S - 14, 14, -1, 1], [14, S - 14, 1, -1], [S - 14, S - 14, -1, -1]].forEach(([cx, cy, sx, sy]) => {
    for (let i = 0; i < 24; i++) {
      c.fillStyle = `rgba(208,226,250,${rand(0.05, 0.24).toFixed(2)})`;
      c.beginPath(); c.ellipse(cx + sx * rand(0, 32), cy + sy * rand(0, 32), rand(0.5, 2.6), rand(0.5, 2.2), rand(0, 3.14), 0, 7); c.fill();
    }
    for (let i = 0; i < 10; i++) {
      c.fillStyle = `rgba(8,12,22,${rand(0.15, 0.38).toFixed(2)})`;
      c.beginPath(); c.arc(cx + sx * rand(0, 28), cy + sy * rand(0, 28), rand(0.4, 1.8), 0, 7); c.fill();
    }
    for (let i = 0; i < 5; i++) {
      c.strokeStyle = `rgba(220,235,255,${rand(0.06, 0.16).toFixed(2)})`; c.lineWidth = rand(0.5, 1.2);
      const a = rand(0.6, 2.2);
      c.beginPath(); c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * sx * rand(10, 36), cy + Math.sin(a) * sy * rand(10, 36)); c.stroke();
    }
    rivet(c, cx + sx * 8, cy + sy * 8, 3);
  });
  // marca de plantilla central
  c.fillStyle = 'rgba(255,154,61,0.16)'; c.fillRect(104, 116, 48, 8); c.fillRect(104, 130, 26, 8);
  let bx = 158; while (bx < 186) { const w = rand(1, 2.6); c.fillStyle = `rgba(200,220,250,${rand(0.08, 0.16).toFixed(2)})`; c.fillRect(bx, 116, w, 22); bx += w + rand(1.5, 3); }
  specks(c, S, 180, () => Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.09)');
}, 2, 2);
const obMat = new THREE.MeshStandardMaterial({ map: obTex, roughness: 0.55, metalness: 0.45, envMapIntensity: 0.55 });
const OBSTACLES = [
  [-14, -10, 5, 3, 5], [13, 11, 6, 2, 4], [-11, 14, 4, 4, 8], [16, -14, 4, 5, 4],
  [0, -18, 8, 1.6, 3], [-20, 2, 3, 6, 3], [20, 4, 3, 2.5, 9], [4, 8, 3.5, 3, 3.5],
  [-4, -4, 3, 2, 3], [8, -4, 2.5, 4.5, 2.5], [-22, -20, 5, 3, 5], [22, 22, 5, 2, 5],
  [-16, 18, 6, 4, 3], [22, 22, 5, 2, 5],
];
OBSTACLES.forEach(([x, z, w, h, d], i) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), obMat);
  b.position.set(x, h / 2, z);
  addSolid(b);
  if (i % 3 === 0) { // franja neón HDR encima de algunos bloques: canal oscuro + núcleo bloom
    const ch = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, 0.1, d * 0.88),
      new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.4, metalness: 0.6 }));
    ch.position.set(x, h - 0.01, z);
    addSolid(ch, false);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.06, d * 0.8),
      new THREE.MeshBasicMaterial({ color: neon(i % 2 ? 0xff4d5e : 0x54f0ff, 2.1) }));
    glow.position.set(x, h + 0.05, z);
    scene.add(glow);
  }
});
// pilones de luz en las esquinas
[[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, WALL_H + 1.5, 8), obMat);
  p.position.set(sx * (ARENA - 2), (WALL_H + 1.5) / 2, sz * (ARENA - 2));
  addSolid(p);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12),
    new THREE.MeshBasicMaterial({ color: neon(0xffd166, 2.1) }));
  bulb.position.set(sx * (ARENA - 2), WALL_H + 1.7, sz * (ARENA - 2));
  scene.add(bulb);
  const pl = new THREE.PointLight(0xffd166, 30, 26, 2);
  pl.position.copy(bulb.position);
  scene.add(pl);
});

// rim lights: cian y magenta en esquinas opuestas, decay 2, sin sombras.
// Altos y sobre la altura de muros: bañan de color los bordes sin quemar cerca.
const rimCyan = new THREE.PointLight(0x2ad4ff, 95, 0, 2);
rimCyan.castShadow = false;
rimCyan.position.set(-ARENA + 6, 12, -ARENA + 6);
const rimMagenta = new THREE.PointLight(0xff3bd8, 80, 0, 2);
rimMagenta.castShadow = false;
rimMagenta.position.set(ARENA - 6, 12, ARENA - 6);
scene.add(rimCyan, rimMagenta);

/* ============================================================ banded fog (E1)
   Profundidad por pasos estilo Doom/Boltgun: en vez del gradiente suave de FogExp2,
   el factor de niebla del material se cuantiza a FOG_BANDS bandas. onBeforeCompile
   reemplaza el chunk fog_fragment por la misma fórmula de three r160 (sigue usando
   los uniforms fogColor/fogDensity que provienen de scene.fog: la atmósfera y el
   color NO cambian) más un floor(f·niveles)/niveles.
   Se aplica a todo el material de entorno construido hasta acá —piso, muros, trims,
   obstáculos, franjas y bulbos—: en este punto de la escena solo viven cielo+estrellas
   (con fog:false, se saltan) y la arena. Arma, FX, pickups y enemigos sprite (E2) NO
   se parchan. Ojo r160: el cache de programas NO distingue materiales por su
   onBeforeCompile, así que customProgramCacheKey aísla esta variante de cualquier
   material sin parchar que comparta defines. */
const FOG_BANDS = 8; // 8 bandas en todo el rango de la niebla: pasos visibles, aún legible
function bandedFog(mat) {
  if (!mat || mat.fog === false || mat.userData.bandedFog) return mat;
  mat.userData.bandedFog = true; // materiales compartidos (wallMat/obMat/trimMat): 1 parche
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        #endif
        fogFactor = floor( fogFactor * ${FOG_BANDS.toFixed(1)} ) / ${FOG_BANDS.toFixed(1)};
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      #endif`);
  };
  mat.customProgramCacheKey = () => 'bandfog' + FOG_BANDS;
  return mat;
}
scene.traverse(o => {
  if (!o.isMesh) return;
  (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => bandedFog(m));
});

/* ============================================================ recursos (E3) — spec DESIGN_ARSENAL.md
   Arquitectura pensada para que E4 enchufe las 10 armas sin tocar el sistema:
   - AMMO: tabla de pools por TIPO de munición (cap + etiqueta). Un arma nueva que use
     un tipo nuevo = una fila acá y nada más.
   - PICKUPS: definición por kind de pickup (categoría + cuánto otorga). El arte vive en
     sprites.js:makePickupSprite — el kind debe existir allí también. */
const AMMO = {
  balas:     { cap: 200, label: 'BALAS' },
  cartuchos: { cap: 60,  label: 'CARTUCHOS' },
  celulas:   { cap: 150, label: 'CÉLULAS' },
  cohetes:   { cap: 12,  label: 'COHETES' },
  argents:   { cap: 20,  label: 'ARGENTS' },
};
/* ============================================================ E4a — tabla de armas
   UNA FILA POR ARMA = spec de balance (DESIGN_ARSENAL.md). Tipos de disparo:
     melee      → ray corto sin mag ni pool, empujón (fists SIEMPRE andá: fallback Doom)
     hitscan    → un rayo con W.dmg (refactor del rifle de siempre: el id "rifle" ES la
                  vecinal — alias interno para no romper HUD/pools/mags de E3)
     shotgun    → W.pellets hitscan con dirección rotada en cono W.spread (cono TOTAL)
     flow       → dispara ticks de W.tick mientras firing y pool>0, consumiendo
                  W.flowRate células/s DEL POOL (sin cargador, sin tryReload)
     projectile → cohete con pooling (W.projVel m/s, explota en contacto/suelo/caja/muro,
                  splash W.dmg decaído linealmente en W.splash; auto-daño al jugador <3 m)
   Campos: slot (tecla 1..0 = slot 0..9), cross (clase del crosshair DOM, por arma),
   ammo (pool o null=infinito), magSize (0 = sin cargador), dmg/cad (segundos entre disparos), pellets/spread (shotgun), projVel/splash
   (cohete), heatMax (ráfagas seguidas antes del bloqueo), kick (retroceso del viewmodel,
   m) / recoil (patada de cámara, rad), sfx (método de Sfx del disparo), silhouette y
   accent para el viewmodel pixelado (sprites.js:makeWeaponSprite). */
const WEAPONS = {
  fists:  { slot: 0, name: 'PUÑOS',          hud: 'PUÑO', cross: 'melee',   ammo: null,      magSize: 0,  dmg: 30, cad: 0.5,
            type: 'melee',      range: 2.4, knock: 1.15, kick: 0.10, recoil: 0.006, sfx: 'shootFist',
            silhouette: 'fists' },
  rifle:  { slot: 1, name: 'VECINAL',        hud: 'VECI', cross: 'pistol',  ammo: 'balas',   magSize: 30, dmg: 22, cad: 0.22,
            type: 'hitscan',    spread: 0.006, kick: 0.05, recoil: 0.012, sfx: 'shootVecinal',
            silhouette: 'pistol',  accent: '#54f0ff' },
  moris12:{ slot: 2, name: 'MORIS-12',       hud: 'M12',  cross: 'shotgun', ammo: 'cartuchos', magSize: 6, dmg: 8, cad: 0.85, pellets: 8,
            type: 'shotgun',    spread: 0.157 /* cono total ~9° */, kick: 0.11, recoil: 0.045, sfx: 'shootShotgun',
            silhouette: 'shotgun', accent: '#ffb057' },
  ametralladora: { slot: 3, name: 'AMETRALLADORA', hud: 'AMET', cross: 'smg', ammo: 'balas', magSize: 60, dmg: 15, cad: 0.09,
            type: 'hitscan',    spread: 0.016, heatSpread: 0.014, heatMax: 40, /* 40 seguidas → bloqueo 1.2 s */
            kick: 0.035, recoil: 0.008, sfx: 'shootSmg',
            silhouette: 'smg',   accent: '#b6ff5e' },
  asador: { slot: 4, name: 'ASADOR',         hud: 'ASAN', cross: 'flamer',  ammo: 'celulas', magSize: 0,  dmg: 9,  cad: 0,
            type: 'flow',       tick: 0.1, flowRate: 2, cone: 0.349 /* ±10° (20° total) */, range: 7,
            burnT: 4, burnDps: 2.25, kick: 0.02, recoil: 0, sfx: 'flame',
            silhouette: 'flamer', accent: '#ff5e3a' },
  kira:   { slot: 5, name: 'KIRA',           hud: 'KIRA', cross: 'rocket',  ammo: 'cohetes', magSize: 4,  dmg: 95, cad: 1.1,
            type: 'projectile', projVel: 20, splash: 3, spread: 0.01, kick: 0.12, recoil: 0.05, sfx: 'rocketFire',
            silhouette: 'rocket', accent: '#ff2d55' },
  // ---- E4b (slots 6-9, filas que faltan; DESIGN_ARSENAL.md):
  // chango:     slot 6, cartuchos, 14×10 pellets, 1.2 s (o doble disparo 0.25)  → silhouette 'twin'
  // mate:       slot 7 — OJO: el plasma quiere 'celulas', el MISMO pool del asador:
  //             E4b decide si le da pool propio antes de enchufarlo (riesgo documentado)
  // riel:       slot 8, 160 perforante, carga 0.35 s, celdas especiales          → silhouette 'rail'
  // compilador: slot 9, argents, 300 onda, 2.0 s                                 → silhouette 'orb'
};
// slot → id (teclas 1..0 = slot 0..9). A E4b le basta agregar filas arriba: esto se solo.
const SLOT = Array(10).fill(null);
for (const id in WEAPONS) SLOT[WEAPONS[id].slot] = id;
// crosshair DOM por ARMA (clases wcross-* en index.html; `cross` distingue las que
// comparten type, p.ej. vecinal y ametralladora son ambas hitscan)
const applyCrosshair = id => $('crosshair').className = 'wcross-' + (WEAPONS[id].cross || WEAPONS[id].type);
const PICKUPS = {
  medkit:      { cat: 'hp',    amount: 25 },
  medbox:      { cat: 'hp',    amount: 50 },
  medkitSmall: { cat: 'hp',    amount: 10 },
  armorShard:  { cat: 'armor', amount: 15 },
  armorHelm:   { cat: 'armor', amount: 35 },
  ammoBalas:     { cat: 'ammo', ammo: 'balas',     amount: 18 },
  ammoCartuchos: { cat: 'ammo', ammo: 'cartuchos', amount: 8 },
  ammoCelulas:   { cat: 'ammo', ammo: 'celulas',   amount: 15 },
  ammoCohetes:   { cat: 'ammo', ammo: 'cohetes',   amount: 2 },
  ammoArgents:   { cat: 'ammo', ammo: 'argents',   amount: 2 },
  ammoGrande:    { cat: 'ammo', ammo: 'balas',     amount: 40 }, // drop garantizado de BRUTE
};
// estado inicial de recursos por partida/retry (hp100/armor0/120 balas vive acá).
// E4a: owned arranca fists+vecinal (id interno "rifle"); el mag solo se crea para las
// owned con cargador (las flow como el asador se crean al desbloquearse, vacías: E5
// las llena con el pickup de arma). El pickup de arma de E5 llama unlockWeapon(id).
const START_OWNED = ['fists', 'rifle']; // arranque fijo (E5 mueve el desbloqueo al pickup)
const startResources = () => ({
  hp: 100, armor: 0,
  owned: new Set(START_OWNED),
  mags: Object.fromEntries(START_OWNED
    .filter(id => WEAPONS[id].magSize > 0)
    .map(id => [id, WEAPONS[id].magSize])),
  weaponId: 'rifle',
  pools: { balas: { n: 120 }, cartuchos: { n: 0 }, celulas: { n: 0 }, cohetes: { n: 0 }, argents: { n: 0 } },
});

/* ============================================================ player */
const EYE = 1.7;
const player = {
  pos: new THREE.Vector3(0, EYE, 28),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: true,
  ...startResources(),      // hp / armor / owned / mags / weaponId / pools (resetGame los restaura igual)
  maxHp: 100, maxArmor: 100,
  lastHitT: -99,
  sprintCd: 0, sprintT: 0,
  recoilPitch: 0, roll: 0,
  fireCd: 0, heat: 0,       // heat: SOLO armas con W.heatMax (ametralladora) — ya no es del rifle
  cooling: 0,               // E4a: bloqueo por sobrecalentamiento (HUD "CALOR")
  vmKick: 0,                // E4a: kick del viewmodel (decae en 0.12 s)
  lastShotT: -9,            // E4a: para el enfriamiento de heat ("ráfagas SEGUIDAS")
  reloading: 0, dryT: 0,    // reloading: temporizador de recarga · dryT: anti-spam click vacío
  jumpQueued: false,             // tap JUMP táctil (el espacio de desktop sigue usando keys)
};
const curWeapon = () => WEAPONS[player.weaponId];
const curMag = () => player.mags[player.weaponId] ?? -1; // -1: arma sin cargador (fists/asador)
const GRAVITY = 24, SPEED = 6.4, SPRINT = 1.55, JUMP_V = 8;
// cámara suavizada: en desktop copia yaw/pitch 1:1; en táctil los sigue con un low-pass
// para que el arrastre del dedo no se sienta a saltos (ver update)
let viewYaw = 0, viewPitch = 0;

/* ============================================================ E4a — weapon viewmodel
   El rifle 3D de cubos sale del juego: el viewmodel ahora es PIXELADO con
   sprites.js:makeWeaponSprite (una silueta por arma, ver WEAPONS.silhouette/accent) y
   vive en una ESCENA SEPARADA (vmScene) con cámara propia (vmCam), NO en la escena
   principal:
   - Render: vmPass entra al composer DESPUÉS de RenderPass con clear=false (por dentro
     three hace renderer.autoClear=false) + clearDepth=true (renderer.clearDepth() antes
     de pintar): el viewmodel se dibuja ENCIMA de la geometría, con el depth buffer del
     mundo borrado → riesgo E2 de "que no lo tape la geometría" resuelto por diseño.
     Como entra al MISMO render target: hereda la pixelación retro (~270p) y el bloom
     (el fogonazo suma glow) — unified look Boltgun. Sin retro Y sin bloom (path directo
     renderer.render) el loop hace el mismo truco a mano: autoClear=false + clearDepth.
   - La cámara NO es padre de nada: el arma no se "pega" a camera; vmCam queda quieta y
     el sway/kick se aplican a vmRoot (más determinista y a cero costo de matrices).
   - MUZZLE (world, para el origen del tracer) y flashLight (luz que sí ilumina el mundo)
     siguen colgando de un ancla invisible bajo la cámara. */
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
const VM = { root: new THREE.Group(), baseX: 0.16, baseY: -0.15, baseZ: -0.34, mesh: null };
vmScene.add(VM.root);

// fogonazo del viewmodel: quad ADITIVO que vive 1 frame por disparo (flashT). Se
// reposiciona en cada disparo sobre la boca de la silueta activa (frame `muzzle` de
// sprites.js: px de canvas → unidades del viewmodel con la misma regla de VM_VH).
const flashCv = document.createElement('canvas');
flashCv.width = flashCv.height = 64;
{
  const fc = flashCv.getContext('2d');
  const grad = fc.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,170,60,0.7)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  fc.fillStyle = grad; fc.fillRect(0, 0, 64, 64);
}
const flashTex = new THREE.CanvasTexture(flashCv);
const vmFlash = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false }));
vmFlash.visible = false; vmFlash.renderOrder = 2;
vmScene.add(vmFlash);

// luz de fogonazo del MUNDO (baña de luz la arena un instante; no es del viewmodel)
const flashLight = new THREE.PointLight(0xffc36b, 0, 18, 2);
const muzzleAnchor = new THREE.Object3D(); // local a la cámara: boca de disparo "world"
muzzleAnchor.position.set(0.18, -0.12, -0.6);
muzzleAnchor.add(flashLight);
camera.add(muzzleAnchor);
scene.add(camera);
function muzzleWorld(out) {
  return out.setFromMatrixPosition(muzzleAnchor.matrixWorld);
}

// E8-polish(b) (adaptado E4a): con bloom APAGADO no hay umbral 0.75 que se "coma" el
// HDR: el quad del fogonazo y la luz bajan a ≤1 (mismo matiz, sin glow → sin quema).
// El riel 3D del rifle ya no existe (el acento del viewmodel es parte del pixel-art).
const FLASH_BASE = new THREE.Color(0xffffff);
function applyGunGlow() {
  vmFlash.material.color.copy(FLASH_BASE).multiplyScalar(bloomOn ? 2.4 : 1.4);
  flashLight.color.set(0xffc36b);
  flashLight.intensity = Math.min(flashLight.intensity, bloomOn ? 46 : 26);
}
applyGunGlow(); // estado inicial acorde al bloom (on por default)

// un viewmodel por arma: texture Nearest (crunch) + quad con alphaTest 0.5 (el arte es
// 100% opaco → bordes duros sin halo) + boca de fogonazo en celdas lógicas de la silueta
const VM_VH = 0.34; // alto del viewmodel en unidades de vmCam
const VM_MODELS = {};
function vmModel(id) {
  if (!VM_MODELS[id]) {
    const W = WEAPONS[id];
    const art = makeWeaponSprite(W.silhouette || 'pistol', W.accent || '#54f0ff');
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const vh = VM_VH, vw = vh * art.canvas.width / art.canvas.height;
    VM_MODELS[id] = {
      mesh: new THREE.Mesh(new THREE.PlaneGeometry(vw, vh),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: false, fog: false })),
      // canvas → unidades: con vh para H celdas lógicas, cada celda mide vh/H
      muzzle: [vh * art.muzzle[0] / (art.canvas.width / 3) - vw / 2,
               vh / 2 - vh * art.muzzle[1] / (art.canvas.height / 3)],
      flashS: vh * 0.22,
    };
  }
  return VM_MODELS[id];
}
// troca: el mesh cambia AL INSTANTE (misma raíz → el sway/kick no se reinician)
function applyViewModel(id) {
  const m = vmModel(id).mesh;
  if (VM.mesh !== m) { VM.root.remove(VM.mesh); VM.root.add(m); VM.mesh = m; }
}
applyViewModel(player.weaponId); // vecinal al arrancar
applyCrosshair(player.weaponId); // crosshair inicial acorde al arma

// sway idle con la velocidad + retorno al centro (bobT lo maneja update()) + kick por
// disparo (retroceso pos/rot que decae en 0.12 s — player.vmKick). player.vel se lee
// acá (se declara arriba); vmCam es fija: TODO el movimiento vive en VM.root.
function updateViewmodel(dt, moving) {
  const W = curWeapon();
  bobT += dt * (moving ? 9 + player.vel.length() : 2); // reloj del idle (antes en update)
  const speed = player.vel.length();
  const bobAmp = 0.006 + Math.min(speed / SPEED, 1) * 0.011;
  const bobX = Math.cos(bobT * 0.5) * bobAmp * (moving ? 1 : 0.25);
  const bobY = Math.sin(bobT) * bobAmp * (moving ? 1 : 0.25);
  const k = Math.min(1, dt * 10);
  VM.root.position.x += (VM.baseX + bobX - VM.root.position.x) * k;
  VM.root.position.y += (VM.baseY + bobY - VM.root.position.y) * k;
  const kick = (W.kick || 0.04) * player.vmKick;
  VM.root.position.z += (VM.baseZ + kick - VM.root.position.z) * Math.min(1, dt * 18);
  VM.root.rotation.z += (bobX * 0.4 - VM.root.rotation.z) * k; // lean strafe
  VM.root.rotation.x = -kick * 3.2 + player.recoilPitch * 1.6; // rot del kick + patada
  if (player.vmKick > 0) player.vmKick = Math.max(0, player.vmKick - dt / 0.12);
}

// El pase del viewmodel entra al composer DESPUÉS del RenderPass de la escena (index 1,
// antes de bloom/output — el fogonazo suma glow y el todo se pixela junto).
// clear=false: RenderPass pone renderer.autoClear=false por dentro y pinta sin limpiar.
// clearDepth=true: renderer.clearDepth() antes → el depth del mundo se borra y el
// viewmodel NUNCA es tapado por geometría (riesgo conocido del E2, resuelto acá).
const vmPass = new RenderPass(vmScene, vmCam);
vmPass.clear = false;
vmPass.clearDepth = true;
composer.insertPass(vmPass, 1);

/* ============================================================ FX: tracers + partículas + decals + luces de muerte */
// temporales de módulo: cero allocations por frame en los hot loops
const _pf = new THREE.Vector3(), _pr = new THREE.Vector3(), _pw = new THREE.Vector3();       // jugador
const _eDir = new THREE.Vector3(), _eSep = new THREE.Vector3(),
      _eTmp = new THREE.Vector3(), _eMove = new THREE.Vector3();                              // enemigos
const _hitN = new THREE.Vector3(), _scrR = new THREE.Vector3(), _scrU = new THREE.Vector3();  // impactos
const _nMat = new THREE.Matrix3();

const tracerGeo = new THREE.BufferGeometry();
const tracers = [];
for (let i = 0; i < 40; i++) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({
    color: neon(0x9fe8ff, 1.6), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
function shootTracer(from, to) {
  const t = tracers.find(t => t.life <= 0) || tracers[0];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.life = 0.07;
  t.line.material.opacity = 0.9;
}

const P_MAX = 220;
const pGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
const particles = [];
for (let i = 0; i < P_MAX; i++) {
  const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1 });
}
function burst(pos, color, n, speed = 7, scale = 1, hdr = 1) {
  let made = 0;
  for (const p of particles) {
    if (p.life > 0) continue;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(scale * rand(0.6, 1.4));
    p.mesh.visible = true;
    p.mesh.material.color.set(color).multiplyScalar(hdr);
    p.vel.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(speed * 0.4, speed));
    p.life = p.max = rand(0.35, 0.8);
    if (++made >= n) break;
  }
}

/* decals de impacto: pool de 20 sprites con marca radial oscura dibujada en canvas
   (barrillos de quemado arriba → material.rotation los orienta según la normal del hit).
   Fade de 4 s. Reemplaza el más viejo si el pool está lleno. */
const decalTex = canvasTex(64, (c, S) => {
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(2,4,9,0.95)');
  g.addColorStop(0.45, 'rgba(2,4,9,0.55)');
  g.addColorStop(0.8, 'rgba(2,4,9,0.16)');
  g.addColorStop(1, 'rgba(2,4,9,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 7; i++) { // lenguas de quemadura hacia el borde superior (v+)
    c.fillStyle = `rgba(1,3,7,${rand(0.14, 0.3).toFixed(2)})`;
    c.beginPath();
    c.ellipse(32 + rand(-13, 13), rand(4, 20), rand(1.4, 3.4), rand(4, 11), rand(-0.3, 0.3), 0, 7);
    c.fill();
  }
  for (let i = 0; i < 10; i++) { // salpicaduras dispersas
    c.fillStyle = `rgba(2,4,9,${rand(0.1, 0.25).toFixed(2)})`;
    c.beginPath(); c.arc(rand(6, 58), rand(6, 58), rand(0.6, 2.2), 0, 7); c.fill();
  }
});
const decals = [];
for (let i = 0; i < 20; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: decalTex, transparent: true, opacity: 0, depthWrite: false }));
  sp.visible = false;
  sp.renderOrder = 1;
  scene.add(sp);
  decals.push({ sp, life: 0, max: 4 });
}
// point: punto de impacto (world); normal: normal de la cara (world)
function spawnDecal(point, normal) {
  const d = decals.find(d => d.life <= 0) || decals[0];
  d.sp.position.copy(point).addScaledVector(normal, 0.045);
  // orientar el barrillo a lo largo de la normal proyectada en el plano de pantalla
  const e = camera.matrixWorld.elements;
  _scrR.set(e[0], e[1], e[2]); _scrU.set(e[4], e[5], e[6]);
  d.sp.material.rotation = Math.atan2(normal.dot(_scrR), normal.dot(_scrU));
  const s = rand(0.36, 0.62);
  d.sp.scale.set(s, s, 1);
  d.life = d.max = 4;
  d.sp.visible = true;
  d.sp.material.opacity = 0.9;
}
function wallImpact(point, normal) {
  burst(point, 0xffc884, 5, 4.5, 0.5, 1.8); // chispas calientes (HDR → bloom)
  burst(point, 0x9fd8ff, 3, 3, 0.5);        // chispas frías
  spawnDecal(point, normal);                // orificio oscuro temporal
}

/* pool de 4 PointLights para el flash de muerte de enemigos */
const fxFlashes = [];
for (let i = 0; i < 4; i++) {
  const light = new THREE.PointLight(0xffffff, 0, 16, 2);
  light.castShadow = false;
  scene.add(light);
  fxFlashes.push({ light, life: 0, max: 1, peak: 0 });
}
function popFxLight(pos, color, peak = 150, dur = 0.38) {
  const f = fxFlashes.find(f => f.life <= 0) || fxFlashes[0];
  f.light.position.set(pos.x, pos.y + 0.5, pos.z);
  f.light.color.set(color);
  f.peak = peak; f.life = f.max = dur;
  f.light.intensity = peak;
}

/* ============================================================ enemies */
// drop: E3 — los drops ya no son una chance por tipo (el viejo campo `drop` salió):
// rollKillDrop() centraliza las chances (35/40/15/10) + guarantee de BRUTE.
const ENEMY_TYPES = {
  droner:  { hp: 40,  speed: 3.4, scale: 1.0,  dmg: 12, score: 100, color: 0xff4d5e },
  sprinter:{ hp: 24,  speed: 6.6, scale: 0.72, dmg: 8,  score: 150, color: 0xb465ff },
  brute:   { hp: 170, speed: 2.3, scale: 1.75, dmg: 26, score: 400, color: 0xff9a3d },
};
const enemies = [];
const enemyHitboxes = []; // mallas invisibles para raycast

// E4a — tinte por ESTADO del sprite (riesgo documentado de "pisarse tintes" del E2):
// el color del material ya lo usa el flash blanco HDR; la solución es UN solo punto de
// control: `tintBase` (blanco normal / naranja quemado) y `tintCur` (escalar del flash).
// El color final es tintCur mezclado HACIA tintBase por frame (lerp):
//   flash()  → tintCur=2.2 blanco (pisa el tinte un instante, como siempre)
//   update() → decae a 1 sobre tintBase: quemado = flash blanco → naranja → naranja
// Así nunca dos dueños escriben `material.color` peleando (el único escritor es update).
const TINT_NORMAL = new THREE.Color(1, 1, 1);
const TINT_BURN   = new THREE.Color(1.5, 0.55, 0.22); // naranja HDR: el bloom lo hace lucir

// hitbox caja compartida (raycast): invisibles y DoubleSide para que el disparo las
// agarre desde cualquier ángulo, igual que antes de los sprites.
const hitGeo = new THREE.BoxGeometry(1.15, 1.9, 1.15);
const SPRITE_H = 2.3; // alto del plano en unidades de grupo ≈ altura del viejo modelo
                      // (cápsula+antena); T.scale lo escala por tipo (spawn grow incluido)

/* E2 — enemigo SPRITE BILLBOARD (Doom/Boltgun): un plano con el sprite-sheet pixel-art
   de sprites.js reemplaza al Group 3D (cuerpo/cabeza/ojos/anillo/núcleo/antena).
   - UN CanvasTexture + UN PlaneGeometry por tipo (cacheados). Cada enemigo clona la
     texture para tener offset de frame PROPIO: los clones comparten `source`, así que
     el pixel-data del sprite se sube al GPU una sola vez por tipo (el clone solo añade
     transformaciones de UV por material).
   - NearestFilter + sin mipmaps + alphaTest 0.5 → bordes duros del pixel-art sin halo.
   - El color >1 del flash de daño pasa cru por el shader de MeshBasicMaterial →
     sprite blanco HDR que el bloom se come (equivalente al emissiveIntensity del 3D). */
const enemyMatCache = {};
function enemySprite(type) {
  if (!enemyMatCache[type]) {
    const art = makeEnemySprite(type);
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(SPRITE_H * (art.frameW / art.frameH), SPRITE_H);
    enemyMatCache[type] = { tex, geo };
  }
  return enemyMatCache[type];
}

class Enemy {
  constructor(type, pos) {
    const T = ENEMY_TYPES[type];
    this.type = type; this.T = T;
    this.hp = T.hp * (1 + 0.14 * (game.wave - 1));
    this.speed = T.speed * (1 + 0.03 * (game.wave - 1)) * rand(0.9, 1.1);
    this.hitCd = 0; this.phase = rand(0, 6.28); this.spawnT = 0;
    this.lastScr = null; // E8-polish(a): última posición en pantalla con el enemigo visible
    this.burnT = 0;      // E4a: segundos de estado QUEMADO (asador); DoT fraccional
    this.burnDps = 0;    // 2.25 lo fija la fila WEAPONS.asador en burn() (única fuente)
    this.tintBase = TINT_NORMAL;

    const A = enemySprite(type);
    this.tex = A.tex.clone();
    this.tex.repeat.set(0.5, 1); // hoja horizontal de 2 frames
    this.spr = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, alphaTest: 0.5, depthWrite: true,
      side: THREE.DoubleSide,
    }));
    this.spr.position.y = 0.1; // el plano cubre local -1.05..1.25 ⊃ hitbox (-0.75..1.15)
    this.g = new THREE.Group();
    this.g.scale.setScalar(0.01);
    this.baseY = (0.95 + T.scale * 0.25) * T.scale;
    this.g.add(this.spr);

    this.hitbox = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this.hitbox.userData.enemy = this;
    this.g.add(this.hitbox);
    this.hitbox.position.y = 0.2;
    this.g.position.copy(pos);
    this.g.position.y = this.baseY;
    scene.add(this.g);
    enemies.push(this);
    enemyHitboxes.push(this.hitbox);
    burst(pos, T.color, 14, 5, 0.8);
  }
  // flash de daño: tinte blanco SUPERRADIANTE (Basic multiplica el map con color >1 →
  // sprite blanco HDR); en update() decae HACIA tintBase (blanco o naranja quemado).
  flash() { this.spr.material.color.setScalar(2.2); }
  // E4a — estado quemado (asador): renueva/extends el tinte naranja + DoT burnDps.
  burn(sec, dps) {
    if (this.burnT <= 0) burst(this.g.position, 0xff7f2f, 5, 3.5, 0.6, 1.7); // primera ignición
    this.burnT = Math.max(this.burnT, sec);
    this.burnDps = dps;
    this.tintBase = TINT_BURN;
  }
  takeDamage(d, point) {
    this.hp -= d;
    this.flash();
    burst(point, this.T.color, 4, 4, 0.6, 1.6);
    if (this.hp <= 0) this.die();
  }
  // E4a — empujón (puños): desplazamiento inmediato lejos del jugador, con los mismos
  // clamps de arena/cajas que update(). El steering enemigo vuelve a acercar al tipo:
  // es el "knockback" Doom, no un stun.
  knockback(dist) {
    const p = this.g.position;
    let dx = p.x - player.pos.x, dz = p.z - player.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    p.x += dx / l * dist; p.z += dz / l * dist;
    p.x = clamp(p.x, -ARENA + 1.2, ARENA - 1.2);
    p.z = clamp(p.z, -ARENA + 1.2, ARENA - 1.2);
    pushOutOfBoxes(p, 0.55 * this.T.scale);
  }
  die() {
    Sfx.kill();
    game.score += this.T.score; game.kills++;
    // E8-polish(a): el "+100 DRONER" ya NO sube al killfeed arriba a la derecha — es un
    // popup anclado a la proyección en pantalla del pecho del enemigo (o a su última
    // posición visible si murió de espaldas). El killfeed queda para oleadas/avisos.
    killPopup(`+${this.T.score} ${this.type.toUpperCase()}`,
      this.chest(_popV), this.lastScr, this.T.color);
    rollKillDrop(this.g.position, this.type); // E3: drops por kill (brute garantiza)
    burst(this.g.position, this.T.color, 22, 9, 1.2, 1.7);
    popFxLight(this.g.position, this.T.color, 150, 0.38); // flash momentáneo desde el pool
    this.remove();
  }
  // punto "pecho" para el popup de score (centro alto del billboard)
  chest(out) { return out.set(this.g.position.x, this.g.position.y + 0.8, this.g.position.z); }
  remove() {
    scene.remove(this.g);
    const i = enemies.indexOf(this); if (i >= 0) enemies.splice(i, 1);
    const j = enemyHitboxes.indexOf(this.hitbox); if (j >= 0) enemyHitboxes.splice(j, 1);
  }
  update(dt, t) {
    const T = this.T;
    // spawn grow
    if (this.spawnT < 1) { this.spawnT = Math.min(1, this.spawnT + dt / 0.35);
      this.g.scale.setScalar(T.scale * this.spawnT); }
    else if (this.g.scale.x !== T.scale) this.g.scale.setScalar(T.scale);

    // idle: alterna los 2 frames del sheet a ~2.5 Hz, desfasado por enemigo
    this.tex.offset.x = ((t * 2.5 + this.phase * 0.4) % 1 < 0.5) ? 0 : 0.5;
    // scale-bob sutil (reemplaza el pulso emisivo del viejo núcleo)
    this.spr.scale.setScalar(1 + Math.sin(t * 3 + this.phase) * 0.03);
    // E4a — DoT de quemado: hp baja fraccional (burnDps/s, valor de la tabla WEAPONS);
    // la muerte por fuego cuenta score/drops igual que un tiro (die() único camino).
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.hp -= this.burnDps * dt;
      if (this.hp <= 0) { this.die(); return; }
      if (this.burnT <= 0) this.tintBase = TINT_NORMAL;
    }
    // tinte: el flash (setScalar 2.2 en flash()) decae HACIA tintBase; en estado normal
    // tintBase es blanco y esto es idéntico al viejo "decay to 1" del E2.
    this.spr.material.color.lerp(this.tintBase, Math.min(1, dt * 5));

    const p = this.g.position;
    _eDir.set(player.pos.x - p.x, 0, player.pos.z - p.z);
    const dist = _eDir.length();
    if (dist > 0.001) _eDir.normalize();

    // separación entre enemigos
    _eSep.set(0, 0, 0);
    for (const o of enemies) {
      if (o === this) continue;
      const d = p.distanceTo(o.g.position);
      const r = 1.5 * (T.scale + o.T.scale) * 0.5;
      if (d < r && d > 0.001) {
        _eTmp.set(p.x - o.g.position.x, 0, p.z - o.g.position.z).normalize();
        _eSep.addScaledVector(_eTmp, (r - d) / r * 4);
      }
    }

    _eMove.copy(_eDir).multiplyScalar(this.speed).add(_eSep);
    p.x += _eMove.x * dt; p.z += _eMove.z * dt;
    p.x = clamp(p.x, -ARENA + 1.2, ARENA - 1.2);
    p.z = clamp(p.z, -ARENA + 1.2, ARENA - 1.2);
    pushOutOfBoxes(p, 0.55 * T.scale);

    // levitación + billboard SOLO yaw alineado a la cámara (estilo Doom): el sprite
    // siempre da de frente, sin flip → nunca se ve la "espalda" y no deforma con el
    // pitch (por eso un plano rotado en Y y no un Sprite de three, que hace billboard
    // total contra el plano de imagen y estira con la mirada arriba/abajo).
    p.y = this.baseY + Math.sin(t * 3 + this.phase) * 0.14;
    this.spr.rotation.y = camera.rotation.y;

    // E8-polish(a): recordar dónde se ve al enemigo (px CSS) — si muere fuera de la
    // vista, su popup de score se ancla a esta última posición conocida
    this.lastScr = screenOf(this.chest(_popV), this.lastScr);

    // daño por contacto
    this.hitCd -= dt;
    if (dist < 1.1 * T.scale + 0.6 && this.hitCd <= 0 && this.spawnT >= 1) {
      this.hitCd = 0.9;
      damagePlayer(T.dmg);
    }
  }
}

/* ============================================================ E3 — pickups, drops y popups
   Reemplaza al viejo medkit 3D hardcoded (fuera de juego: el sistema nuevo cubre vida,
   armadura y munición; nada de drops duplicados). Pickups = billboards pixelados chiquitos
   con el MISMO patrón del E2: atlas propio de sprites.js (4 vistas), CanvasTexture con
   NearestFilter + sin mipmaps, alphaTest 0.5, textura clonada por ítem (offsets de vista
   propios, pixel-data compartido 1× por kind en el GPU). */
const PICKUP_ART = {};
function pickupArt(kind) {
  if (!PICKUP_ART[kind]) {
    const art = makePickupSprite(kind);
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const h = 0.6, w = h * art.cellW / art.cellH; // 0.6 m de alto: "chiquito" vs 2.3 del enemigo
    PICKUP_ART[kind] = { tex, geo: new THREE.PlaneGeometry(w, h) };
  }
  return PICKUP_ART[kind];
}

const pickups = [];
const DROP_TTL = 20;   // los drops por kill viven 20 s (parpadean los últimos 5)
const DROP_MAX = 40;   // exceso de drops en escena → muere el más viejo
let bruteKills = 0;    // contador de brutos muertos (alterna ammoGrande/armorHelm cada 2)

// ttl = 0 → caja de arena permanente (spawn de oleada); ttl > 0 → drop con expiración
function spawnPickup(kind, pos, ttl = 0) {
  const A = pickupArt(kind);
  const tex = A.tex.clone(); // clon barato: UV offset propio, source compartido
  tex.repeat.set(0.25, 1);   // recorte de vista del atlas 4×1 (offset.x = view/4 en update)
  const mesh = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide,
  }));
  const baseY = A.geo.parameters.height / 2 + 0.02; // apoyado al piso (plano centrado)
  mesh.position.set(pos.x, baseY, pos.z);
  scene.add(mesh);
  pickups.push({
    kind, mesh, tex, baseY, drop: ttl > 0, ttl, born: game.time,
    t: rand(0, 6), phase: rand(0, 6.28), view: -1,
  });
}

function clearPickups() {
  for (const p of pickups) { scene.remove(p.mesh); p.tex.dispose(); }
  pickups.length = 0;
}

// (a) spawn de oleada: cajas repartidas por la arena (spec E3).
function spawnWavePickups(n) {
  const list = ['ammoBalas', 'ammoBalas', 'ammoBalas', 'medkit']; // base toda oleada
  if (n % 2 === 0) list.push('armorShard');
  if (n >= 3) list.push('medbox');
  if (n >= 5) list.push('ammoCohetes');
  for (const kind of list) spawnPickup(kind, pickupPoint(), 0);
}

// Punto de arena despejado: lejos del jugador, afuera de AABBs, sin solapar pickups.
function pickupPoint() {
  for (let tries = 0; tries < 40; tries++) {
    const x = rand(-ARENA + 4, ARENA - 4), z = rand(-ARENA + 4, ARENA - 4);
    if (Math.hypot(x - player.pos.x, z - player.pos.z) < 5) continue;
    let ok = true;
    for (const b of boxes)
      if (x > b.min.x - 1 && x < b.max.x + 1 && z > b.min.z - 1 && z < b.max.z + 1) { ok = false; break; }
    if (ok) for (const p of pickups)
      if (Math.hypot(x - p.mesh.position.x, z - p.mesh.position.z) < 1.6) { ok = false; break; }
    if (ok) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(rand(-ARENA + 4, ARENA - 4), 0, rand(-ARENA + 4, ARENA - 4));
}

// (b) drops por kill (spec E3 / DESIGN_ARSENAL): 35% nada · 40% pool al gasto (simple:
// 70% balas / 20% células / 10% cartuchos — E4 re-pondera por arma realmente usada) ·
// 15% botiquín chico +10 · 10% shard de armadura. BRUTE garantiza y alterna cada 2.
function rollKillDrop(pos, type) {
  let kind;
  if (type === 'brute') {
    bruteKills++;
    kind = (bruteKills + 1) % 4 < 2 ? 'ammoGrande' : 'armorHelm'; // 1-2 ammo · 3-4 armor…
  } else {
    const r = Math.random();
    if (r < 0.35) return;
    if (r < 0.75) {
      const a = Math.random();
      kind = a < 0.7 ? 'ammoBalas' : a < 0.9 ? 'ammoCelulas' : 'ammoCartuchos';
    } else if (r < 0.90) kind = 'medkitSmall';
    else kind = 'armorShard';
  }
  spawnPickup(kind, pos, DROP_TTL);
  trimDrops();
}
function trimDrops() {
  let drops = pickups.filter(p => p.drop);
  while (drops.length > DROP_MAX) {
    const oldest = drops.reduce((a, b) => (a.born < b.born ? a : b));
    scene.remove(oldest.mesh); oldest.tex.dispose();
    pickups.splice(pickups.indexOf(oldest), 1);
    drops = pickups.filter(p => p.drop);
  }
}

/* ---- aplicación del pickup: pools caps por tipo + helpers HUD ---------------- */
function addAmmo(type, amount) {
  const pool = player.pools[type], before = pool.n;
  pool.n = Math.min(AMMO[type].cap, pool.n + amount);
  return pool.n - before; // lo que REALMENTE entró (el toast no muestra lo que el cap mordió)
}
// un pickup full no se levanta (queda en el piso para más tarde — evita gastar cajas)
function pickupUsable(kind) {
  const d = PICKUPS[kind];
  if (d.cat === 'hp') return player.hp < player.maxHp;
  if (d.cat === 'armor') return player.armor < player.maxArmor;
  return player.pools[d.ammo].n < AMMO[d.ammo].cap;
}
const PICKUP_FX = { hp: 0x0ee6a0, armor: 0x4da3ff, ammo: 0xffd166 }; // color de partícula

function collectPickup(p) {
  const d = PICKUPS[p.kind];
  let gained = 0, text = '', cls = '', sfx;
  if (d.cat === 'hp') {
    gained = Math.min(d.amount, player.maxHp - player.hp);
    player.hp += gained;
    text = `+${gained} VITALIDAD`; cls = 'life'; sfx = 'pickupLife';
  } else if (d.cat === 'armor') {
    gained = Math.min(d.amount, player.maxArmor - player.armor);
    player.armor += gained;
    text = `+${gained} ARMADURA`; cls = 'armor'; sfx = 'pickupArmor';
  } else {
    gained = addAmmo(d.ammo, d.amount);
    text = `+${gained} ${AMMO[d.ammo].label}`; cls = 'ammo'; sfx = 'pickupAmmo';
  }
  if (gained <= 0) return; // paranoia: pickupUsable ya filtra
  Sfx[sfx]();
  toast(text, cls);
  burst(p.mesh.position, PICKUP_FX[d.cat], 10, 5, 0.7);
  scene.remove(p.mesh); p.tex.dispose();
  const i = pickups.indexOf(p); if (i >= 0) pickups.splice(i, 1);
  updateHud();
}

/* ---- toast de pickup: pool de 3 mensajes, el viejo se va antes de spamear -------- */
const toastWrap = $('toasts');
function toast(text, cls) {
  while (toastWrap.childElementCount >= 3) toastWrap.removeChild(toastWrap.firstChild);
  const d = document.createElement('div');
  d.className = 'toast ' + cls;
  d.textContent = text;
  toastWrap.appendChild(d);
  setTimeout(() => d.classList.add('out'), 1250);
  setTimeout(() => d.remove(), 1650);
}

/* ---- hint "SIN MUNICIÓN": 2 s, una vez por oleada (flag reset en startWave) ---- */
let ammoHintTimer = null;
function showAmmoHint() {
  if (game.ammoHint) return;
  game.ammoHint = true;
  const el = $('ammoHint');
  el.classList.add('show');
  clearTimeout(ammoHintTimer);
  ammoHintTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---- E8-polish(a): popup de score anclado a la pantalla -------------------------
   screenOf proyecta un punto world → px CSS (con margen-clamp para que el texto nunca
   se salga). Si el punto está detrás de la cámara devuelve la última posición visible
   (fallback) ya clampeada; sin fallback conocido, centro. Temporales de módulo: se
   llama por enemigo por frame, cero alloc. */
const _popV = new THREE.Vector3(), _popV2 = new THREE.Vector3();
function screenOf(p, fallback) {
  const out = fallback || { x: 0, y: 0 };
  const v = _popV2.copy(p).applyMatrix4(camera.matrixWorldInverse);
  if (v.z < 0) { // frente a la cámara (mira por -Z): → NDC → px
    v.applyMatrix4(camera.projectionMatrix); // applyMatrix4 divide por w
    out.x = clamp((v.x * 0.5 + 0.5) * innerWidth, 24, innerWidth - 24);
    out.y = clamp((-v.y * 0.5 + 0.5) * innerHeight, 34, innerHeight - 130);
  } else if (!fallback) {
    out.x = innerWidth / 2; out.y = innerHeight / 2;
  }
  return out;
}
const cssColor = {};
const toCss = hex => cssColor[hex] || (cssColor[hex] = '#' + hex.toString(16).padStart(6, '0'));
const popupsEl = $('popups');
const popPool = []; // pool de <div> (los kills en oleada tardía llueven: sin churn de DOM)
let popSeq = 0;
function killPopup(text, worldPos, prevScr, colorHex) {
  while (popupsEl.childElementCount > 12) popupsEl.removeChild(popupsEl.firstChild);
  let el = popPool.find(o => !o._use);
  if (!el) {
    el = document.createElement('div');
    el.className = 'killpop';
    popPool.push(el);
  }
  if (el.parentNode !== popupsEl) popupsEl.appendChild(el); // el trim (>12) pudo sacarlo del DOM
  el._use = true; // ocupado hasta que el timeout del keyframe lo devuelva
  el.textContent = text;
  el.style.color = toCss(colorHex);
  const scr = screenOf(worldPos, prevScr); // proyección actual; si no, la última visible
  el.style.left = scr.x.toFixed(0) + 'px';
  el.style.top = scr.y.toFixed(0) + 'px';
  const seq = ++popSeq;
  el.dataset.seq = seq; // mata el timeout de una reutilización anterior
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; // reinicia el keyframe
  setTimeout(() => { if (+el.dataset.seq === seq) el._use = false; }, 1050);
}

/* ============================================================ colisión jugador/enemigos contra AABBs */
function pushOutOfBoxes(p, radius) {
  for (const b of boxes) {
    if (p.x > b.min.x - radius && p.x < b.max.x + radius &&
        p.z > b.min.z - radius && p.z < b.max.z + radius) {
      const dxMin = p.x - (b.min.x - radius), dxMax = (b.max.x + radius) - p.x;
      const dzMin = p.z - (b.min.z - radius), dzMax = (b.max.z + radius) - p.z;
      const m = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (m === dxMin) p.x = b.min.x - radius;
      else if (m === dxMax) p.x = b.max.x + radius;
      else if (m === dzMin) p.z = b.min.z - radius;
      else p.z = b.max.z + radius;
    }
  }
}

/* ============================================================ game state */
const game = {
  state: 'menu',           // menu | play | pause | dead
  wave: 1, score: 0, kills: 0,
  spawnQueue: [], spawnT: 0,
  intermission: 0,
  ammoHint: false,         // E3: hint "SIN MUNICIÓN" ya mostrado en esta oleada
  time: 0,
};
let best = parseInt(localStorage.getItem('moris-shooter-best') || '0', 10);
$('bestmenu').textContent = best;

function buildWave(n) {
  const total = Math.min(5 + 2 * n, 26);
  const brutes = n >= 3 ? Math.min(Math.floor((n - 1) / 2), 4) : 0;
  const sprinters = n >= 2 ? Math.min(Math.floor(n * 0.9), total - 2 - brutes) : 0;
  const drones = total - brutes - sprinters;
  const q = [];
  for (let i = 0; i < drones; i++) q.push('droner');
  for (let i = 0; i < sprinters; i++) q.push('sprinter');
  for (let i = 0; i < brutes; i++) q.push('brute');
  return q.sort(() => Math.random() - 0.5);
}

function spawnPoint() {
  for (let tries = 0; tries < 24; tries++) {
    const side = Math.floor(rand(0, 4));
    const m = ARENA - 3;
    let x, z;
    if (side === 0) { x = rand(-m, m); z = -m; }
    else if (side === 1) { x = rand(-m, m); z = m; }
    else if (side === 2) { x = -m; z = rand(-m, m); }
    else { x = m; z = rand(-m, m); }
    if (Math.hypot(x - player.pos.x, z - player.pos.z) > 14) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(rand(-ARENA + 4, ARENA - 4), 0, rand(-ARENA + 4, ARENA - 4));
}

function startWave(n) {
  game.wave = n;
  game.intermission = 0;
  game.ammoHint = false; // el hint de munición vuelve a poder aparecer una vez
  game.spawnQueue = buildWave(n);
  game.spawnT = 0;
  spawnWavePickups(n); // E3: cajas de recurso repartidas por la arena al arrancar
  $('wave').textContent = n;
  const msg = $('wavemsg');
  msg.textContent = `OLEADA ${n}`;
  msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
  Sfx.wave();
}

function resetGame() {
  while (enemies.length) enemies[0].remove();
  clearPickups();          // E3: nada de cajas de la partida anterior en la arena
  bruteKills = 0;
  Object.assign(player, startResources(), { // hp100 / armor0 / owned / mags / pools iniciales
    yaw: 0, pitch: 0,
    reloading: 0, dryT: 0,
    recoilPitch: 0, heat: 0, fireCd: 0, lastHitT: -99, sprintCd: 0, sprintT: 0,
    cooling: 0, vmKick: 0, lastShotT: -9, // E4a: estado de arsenal/calor a cero
    jumpQueued: false,
  });
  // E4a: la troca volvió al arranque (fists+vecinal) → cohetes fuera del aire, slot
  // bar y crosshair se reconstruyen (lastOwnedN=-1 fuerza rebuild en updateHud) y el
  // viewmodel salta a la vecinal.
  clearRockets();
  lastOwnedN = -1;
  applyCrosshair(player.weaponId);
  applyViewModel(player.weaponId);
  updateTouchSwap();
  viewYaw = viewPitch = 0; // sin barrido de cámara al reaparecer
  player.pos.set(0, EYE, 28);
  player.vel.set(0, 0, 0);
  Object.assign(game, { score: 0, kills: 0, wave: 0, spawnQueue: [], intermission: 1.2, time: 0, ammoHint: false });
  $('ammo').classList.remove('reloading');
  updateHud();
}

// Punto único de daño al jugador (E3): todo lo que hoy restaba hp pasa por acá.
// Absorción estilo Doom: la armadura se come el 60% del incoming hasta agotarse y el
// resto (lo que no pudo absorber + el 40% reglamentario) va a la vida. SIN regen: la
// única recuperación son los pickups (ver el bloque de pickups en update).
function damagePlayer(d) {
  if (game.state !== 'play') return;
  const soak = Math.min(player.armor, d * 0.6);
  player.armor = Math.max(0, player.armor - soak);
  player.hp -= d - soak;
  player.lastHitT = game.time;
  Sfx.hurt();
  dmgFlash = Math.min(0.85, dmgFlash + 0.45);
  if (player.hp <= 0) {
    player.hp = 0;
    die();
  }
  updateHud();
}
let dmgFlash = 0, hitmarkT = 0;

function die() {
  game.state = 'dead';
  Sfx.death();
  clearRockets(); // E4a: cohetes en vuelo no sobreviven a la partida (no explotan en el menú)
  document.exitPointerLock();
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state })); // suelta input táctil
  if (game.score > best) { best = game.score; localStorage.setItem('moris-shooter-best', best); }
  $('finalscore').textContent = game.score;
  $('finalwave').textContent = game.wave;
  $('finalkills').textContent = game.kills;
  $('bestdead').textContent = best; $('bestmenu').textContent = best;
  $('hud').classList.add('hidden');
  $('touchhud').classList.add('hidden');
  $('dead').classList.remove('hidden');
}

function feed(text) {
  const kf = $('killfeed');
  const d = document.createElement('div');
  d.textContent = text;
  kf.appendChild(d);
  while (kf.children.length > 4) kf.removeChild(kf.firstChild);
  setTimeout(() => { d.classList.add('dying'); setTimeout(() => d.remove(), 1100); }, 2200);
}

/* ---- E4a: nombre del arma y "CALOR" (sobrecalentamiento): el DOM solo se toca cuando
   el texto cambia (update() corre a 60 fps y el cooling es continuo). ---- */
let lastWname = '';
function updateWname() {
  const txt = player.cooling > 0 ? 'CALOR' : curWeapon().name;
  if (txt === lastWname) return;
  lastWname = txt;
  const el = $('wname');
  el.textContent = txt;
  el.classList.toggle('hot', player.cooling > 0);
}

function updateHud() {
  const pct = clamp(player.hp / player.maxHp, 0, 1);
  const bar = $('hpbar');
  bar.style.width = (pct * 100) + '%';
  bar.classList.toggle('low', pct < 0.35);
  // barra de ARMADURA azul (E3): mismo estilo que VITALIDAD, especular abajo
  const apct = clamp(player.armor / player.maxArmor, 0, 1);
  $('armorbar').style.width = (apct * 100) + '%';
  // Munición (E4a): "30 / 124 balas" = cargador / pool del tipo que consume el arma.
  // Armas sin cargador ni pool (fists) → "∞"; flow (asador) sin cargador → muestra el
  // pool directo: lo que consume en combate ES el pool.
  const W = curWeapon();
  const magEl = $('mag');
  if (!W.ammo) { magEl.textContent = '∞'; $('reserve').textContent = ''; }
  else if (W.magSize > 0) {
    magEl.textContent = curMag();
    $('reserve').textContent = ` / ${player.pools[W.ammo].n} ${AMMO[W.ammo].label.toLowerCase()}`;
  } else {
    magEl.textContent = player.pools[W.ammo].n;
    $('reserve').textContent = ` ${AMMO[W.ammo].label.toLowerCase()}`;
  }
  updateWname();
  updateSlotBar();
  $('score').textContent = game.score;
  $('enemies').textContent = enemies.length + game.spawnQueue.length;
}

/* ============================================================ E4a — cambio de arma
   Entrada única: selectSlot(i) (teclas 1..0 / gamepad) y cycleWeapon(dir) (rueda / RB/LB /
   botones táctiles). Slot sin arma (E4b) o arma no owned → beep breve, NO cambia.
   Trocar cancela TODO lo en curso: recarga (con su clase de HUD), heat/cooling y una
   cadencia corta (0.12 s) para que spamear rueda no intercale dos disparos. */
function switchWeapon(id) {
  if (id === player.weaponId) return;
  player.weaponId = id;
  player.fireCd = Math.max(player.fireCd, 0.12);
  player.heat = 0; player.cooling = 0; player.vmKick = 0;
  if (player.reloading > 0) { player.reloading = 0; $('ammo').classList.remove('reloading'); }
  applyViewModel(id);                                    // viewmodel al instante
  applyCrosshair(id);                                    // crosshair al instante
  Sfx.switchSnd();
  updateHud();                                           // nombre HUD al instante
}
function selectSlot(i) {
  const id = SLOT[i];
  if (!id || !player.owned.has(id)) { Sfx.deny(); return; } // slot vacío / no comprada
  switchWeapon(id);
}
function cycleWeapon(dir) {
  const list = SLOT.filter(id => id && player.owned.has(id)); // owned en orden de slot
  if (list.length < 2) return;
  const i = list.indexOf(player.weaponId);
  switchWeapon(list[(i + dir + list.length) % list.length]);
}
// Desbloqueo (lo que va a enchufar el pickup de arma de E5): una vez tomada es PARA
// SIEMPRE (DESIGN_ARSENAL). El mag arranca lleno, salvo flow (sin cargador): arrives vacía
// de células y el piso las pone. updateTouchSwap: los botones ◀▶ solo tienen sentido con 2+.
function unlockWeapon(id, giveAmmo = 0) {
  const W = WEAPONS[id];
  if (!W || player.owned.has(id)) return false;
  player.owned.add(id);
  if (W.magSize > 0) player.mags[id] = W.magSize;
  else if (W.ammo && giveAmmo > 0) addAmmo(W.ammo, giveAmmo);
  updateTouchSwap();
  toast(`ARSENAL + ${W.name}`, 'ammo');
  feed(`ARSENAL: ${W.name}`);
  updateHud();
  return true;
}

// E4a: en desktop no hay botones de troca táctiles; el bloque TOUCH_MODE reasigna esta
// función con la implementación real (unlockWeapon la llama sin saber de modo).
let updateTouchSwap = () => {};

/* ---- slot bar (HUD): una ficha por arma owned con pool: "2 M12 34" (slot, nombre corto,
   resto del pool). La activa resaltada. Se reconstruye solo cuando cambia owned; los
   números se refrescan desde updateHud (barato: ≤10 fichas). */
let slotEls = [], lastOwnedN = -1;
function updateSlotBar() {
  const ids = SLOT.filter(id => id && player.owned.has(id));
  if (ids.length !== lastOwnedN) {
    lastOwnedN = ids.length;
    const wrap = $('slotbar');
    wrap.innerHTML = ''; // rebuild = reconstruir de verdad (si no, retry duplicaría fichas)
    slotEls = ids.map(id => {
      const d = document.createElement('div');
      d.className = 'slot';
      d.dataset.id = id;
      const W = WEAPONS[id];
      d.innerHTML = `<b>${W.slot + 1}</b> ${W.hud}<i></i>`;
      wrap.appendChild(d);
      return d;
    });
  }
  for (const el of slotEls) {
    const id = el.dataset.id, W = WEAPONS[id];
    el.classList.toggle('active', id === player.weaponId);
    el.querySelector('i').textContent = W.ammo ? String(player.pools[W.ammo].n) : '∞';
  }
}

/* ============================================================ input */
const keys = {};
let firing = false;

// disparo continuo compartido desktop/táctil (auto-fire por cadencia en update)
function toggleFiring(on) { firing = on; }

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'KeyB') setBloom(!bloomOn); // toggle manual de bloom (anula/rehace el auto-off)
  if (e.code === 'KeyT') setRetro(!retroOn); // toggle pixelación retro (R es recargar: retro vive en T)
  // E4a: teclas 1..0 = slots 0..9 (Digit0 = slot 9, el 0 del "10"; las 7-0 quedan para
  // las armas de E4b: mientras no existan, beep y listo)
  if (game.state === 'play' && /^Digit[0-9]$/.test(e.code)) {
    const n = +e.code.slice(5);
    selectSlot(n === 0 ? 9 : n - 1);
  }
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
// E4a: rueda = ciclar armas owned (arriba = slot anterior)
addEventListener('wheel', e => {
  if (game.state === 'play') cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
addEventListener('mousedown', e => {
  if (TOUCH_MODE || e.button !== 0 || game.state !== 'play') return;
  toggleFiring(true);
});
addEventListener('mouseup', e => { if (!TOUCH_MODE && e.button === 0) toggleFiring(false); });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0023;
  player.pitch = clamp(player.pitch - e.movementY * 0.0023, -1.5, 1.5);
});

// pausa única para las dos rutas: ESC/pérdida de pointer lock y Start del mando.
// Despacha 'gamestate' para que dropTouch() suelte cualquier input táctil pegado.
function enterPause() {
  if (game.state !== 'play') return;
  game.state = 'pause';
  toggleFiring(false);
  $('hud').classList.add('hidden');
  $('pause').classList.remove('hidden');
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state }));
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && game.state === 'play') {
    enterPause();
  }
});

// En táctil NUNCA se pide pointer lock (ni start, ni retry, ni resume): la mira se mueve
// con arrastre (sección touch). En desktop es idéntico a antes.
function lockAndPlay() {
  Sfx.init();
  if (!TOUCH_MODE) {
    // resume desde el mando (poll fuera de gesto): Chrome permite re-lockear poco después
    // de un exitPointerLock propio; si no, la promesa rechaza → catch y seguimos con el
    // look de mando igual (un reject sin catch ensuciaría la consola).
    const pl = renderer.domElement.requestPointerLock();
    if (pl && pl.catch) pl.catch(() => {});
  }
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('dead').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('touchhud').classList.remove('hidden');
  game.state = 'play';
}

// tap-to-start: en táctil responde al touchstart (el click sintético posterior se ignora
// ~500 ms para no disparar dos veces); en desktop solo click, como siempre.
function onTapStart(el, fn) {
  let lastTouchAt = -1e9;
  el.addEventListener('touchstart', e => {
    e.preventDefault(); // mata el click sintético y el scroll del overlay
    lastTouchAt = performance.now();
    fn();
  }, { passive: false });
  el.addEventListener('click', () => {
    if (performance.now() - lastTouchAt < 500) return;
    fn();
  });
}
const playFromMenu = () => { resetGame(); startWave(1); lockAndPlay(); };
onTapStart($('menu'), playFromMenu);
onTapStart($('pause'), () => lockAndPlay());
onTapStart($('dead'), playFromMenu);

/* scope de módulo (no dentro del if): update() lo lee siempre; en desktop queda todo en 0 */
const touch = {
  stickId: -1, baseX: 0, baseY: 0,        // id del dedo y base dinámica (px de pantalla)
  mag: 0, wishF: 0, wishR: 0,             // empuje 0..1 y componentes del wish (-1..1)
  lookId: -1, lookX: 0, lookY: 0,         // look: id y último punto procesado (px)
};

/* ============================================================ touch controls (móvil)
   Un solo sistema de Pointer Events: pointerdown en el tercio izquierdo de la pantalla
   → joystick dinámico (base fantasma donde pisa el dedo); en el resto del canvas → look;
   FIRE/RECARGAR/SALTAR son botones DOM con pointer-events:auto — el puntero "nace" en el
   botón y queda capturado implícitamente ahí, así que sus eventos jamás llegan al canvas:
   arrastrar sobre FIRE dispara pero NUNCA rota la cámara (para apuntar, otro dedo afuera).
   Pointer Events unifican dedo y mouse: con ?touch=1 se puede probar en desktop con mouse.
   En táctil no se usa mousedown/mousemove (pointer lock off), así que no hay dobles rutas. */
if (TOUCH_MODE) {
  const STICK_R = 52;        // radio del joystick en px CSS
  const LOOK_SENS = 0.0045;  // rad/px (desktop 0.0023: el dedo recorre mucho menos que la mouse)
  const cv = renderer.domElement;
  const stickEl = $('stick'), thumbEl = stickEl.firstElementChild;
  const tfire = $('tfire'), treload = $('treload'), tjump = $('tjump');

  // .on habilita el overlay (vence el display:none del CSS); .hidden lo mantiene oculto
  // hasta entrar en play (lockAndPlay lo quita, die lo devuelve): en el menú no se ve nada.
  $('touchhud').classList.add('on', 'hidden');
  document.body.classList.add('touch'); // hooks de layout táctil en CSS (HUD, overlays)
  $('controlsDesktop').style.display = 'none';
  $('controlsTouch').style.display = '';
  $('rec').textContent = 'Modo táctil activo.';
  document.querySelectorAll('.cta').forEach(el => el.textContent = el.textContent.replace('CLIC', 'TOCA'));

  const setPressed = (el, on) => el.classList.toggle('pressed', on);
  let fireId = -1;
  // limpia todo el input táctil (fin de partida / pausa): nadie queda "apretado"
  const dropTouch = () => {
    touch.stickId = touch.lookId = fireId = -1;
    touch.mag = 0; touch.wishF = touch.wishR = 0;
    player.jumpQueued = false;
    setPressed(tfire, false); setPressed(treload, false); setPressed(tjump, false);
    stickEl.classList.remove('active');
    thumbEl.style.transform = '';
    if (firing) toggleFiring(false);
  };
  addEventListener('gamestate', e => { if (e.detail !== 'play') dropTouch(); });

  /* ---- joystick: empuje normalizado alimenta el wish vector (mismo accel/sprint que WASD;
          fondo del recorrido > 0.92 dispara el sprint con el cooldown ya existente) ---- */
  const drawStick = (dx, dy) => {
    thumbEl.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  };
  const startStick = e => {
    touch.stickId = e.pointerId;
    touch.baseX = e.clientX; touch.baseY = e.clientY;
    touch.mag = 0; touch.wishF = touch.wishR = 0; // dedo quieto = cero empuje → cero giro de cámara
    drawStick(0, 0);
    stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    stickEl.classList.add('active');
  };
  const moveStick = e => {
    let dx = e.clientX - touch.baseX, dy = e.clientY - touch.baseY;
    const len = Math.hypot(dx, dy);
    const m = Math.min(len / STICK_R, 1);
    if (len > 1e-3) { dx /= len; dy /= len; } // dirección unitaria (0,0 con len≈0)
    touch.mag = m;
    touch.wishF = -dy * m;   // arrastrar arriba = adelante
    touch.wishR = dx * m;    // arrastrar derecha = strafe derecha
    drawStick(dx * m * STICK_R, dy * m * STICK_R);
  };

  /* ---- look: delta del arrastre → yaw/pitch (yaw -dx equivale a movementX de desktop:
          arrastrar der/arriba mira der/arriba, sin inversión). LookId único: otros dedos
          no registrados se ignoran para que no giren la cámara al pulsar botones. ---- */
  const startLook = e => {
    touch.lookId = e.pointerId;
    touch.lookX = e.clientX; touch.lookY = e.clientY;
  };
  const moveLook = e => {
    // eventos coalescidos: el navegador los entrega una vez por frame; aplicando solo el
    // último punto se conserva el delta total sin saltos (el low-pass de la cámara termina de alisar)
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const p = (evs && evs.length) ? evs[evs.length - 1] : e;
    player.yaw -= (p.clientX - touch.lookX) * LOOK_SENS;
    player.pitch = clamp(player.pitch - (p.clientY - touch.lookY) * LOOK_SENS, -1.5, 1.5);
    touch.lookX = p.clientX; touch.lookY = p.clientY;
  };

  cv.addEventListener('pointerdown', e => {
    if (game.state !== 'play') return;
    e.preventDefault(); // sin gestos del navegador ni mouse sintético
    if (e.clientX < innerWidth / 3) {
      if (touch.stickId === -1) startStick(e);
    } else if (touch.lookId === -1) startLook(e);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId === touch.stickId) moveStick(e);
    else if (e.pointerId === touch.lookId) moveLook(e);
  });
  const endPointer = e => {
    if (e.pointerId === touch.stickId) { // soltar = stop suave: wish a 0 y el accel existente frena
      touch.stickId = -1; touch.mag = 0; touch.wishF = touch.wishR = 0;
      stickEl.classList.remove('active');
      thumbEl.style.transform = '';
    } else if (e.pointerId === touch.lookId) touch.lookId = -1;
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  /* ---- botones: pointer capture implícito (el evento sigue al dedo aunque salga del
          botón) → mantener presionado funciona; pointerleave NUNCA suelta la mira. ---- */
  const bindBtn = (el, onDown, onUp) => {
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      if (game.state !== 'play') return;
      e.preventDefault();
      setPressed(el, true);
      onDown(e);
    });
    el.addEventListener('pointerup', e => { setPressed(el, false); onUp(e); });
    el.addEventListener('pointercancel', e => { setPressed(el, false); onUp(e); });
  };
  // fireId se declaró junto a dropTouch, más arriba
  bindBtn(tfire,
    e => { if (fireId === -1) { fireId = e.pointerId; toggleFiring(true); } }, // auto-fire con cadencia desktop
    // suelta solo si era ESE puntero el disparador: un segundo dedo tocando FIRE al
    // levantarse no debe cortar el hold del primero
    e => { if (e && e.pointerId === fireId) { fireId = -1; toggleFiring(false); } });
  bindBtn(treload, () => tryReload(), () => {});
  bindBtn(tjump, () => { player.jumpQueued = true; }, () => {});

  /* ---- E4a: troca de arma táctil ◀ ▶ — dos botones de 56 px (estilo FIRE) junto al
         gatillo, visibles SOLO con ≥2 armas owned (updateTouchSwap los muestra/esconde
         en cada unlock; con 1 arma no tienen sentido y no estorban). CSS: #tswapL/R. ---- */
  const mkSwap = (id, label, dir) => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'tbtn tswap'; b.textContent = label;
    b.setAttribute('aria-label', dir < 0 ? 'Arma anterior' : 'Arma siguiente');
    $('touchhud').appendChild(b);
    bindBtn(b, () => cycleWeapon(dir), () => {});
    return b;
  };
  const swapEls = [mkSwap('tswapL', '◀', -1), mkSwap('tswapR', '▶', 1)];
  updateTouchSwap = () => {
    const show = player.owned.size > 1 ? 'flex' : 'none';
    for (const b of swapEls) b.style.display = show;
  };
  updateTouchSwap(); // arranca con fists+vecinal → a la vista desde el minuto 0
}

/* ============================================================ gamepad (Gamepad API)
   Mapeo (estándar W3C / "standard" layout):
     Eje 0 stick izq X   → strafe        ┐ deadzone 0.18 con curva suave renormalizada
     Eje 1 stick izq Y   → atrás/adelante┘ sign·t²; pisa al teclado SOLO si supera la
                          deadzone: con el stick quieto WASD sigue funcionando.
     Eje 2 stick der X   → yaw  (~2.6 rad/s a full deflection, misma curva muerta)
     Eje 3 stick der Y   → pitch (~2.0 rad/s, clamp ±1.5). Suma deltas por frame sobre
                           player.yaw/pitch: convive con mouse (movementX), pointer lock
                           y arrastre táctil sin pelearse.
     Botón 7  (RT analógico) → fuego: value > 0.35 u oprimido; integra con el flag
                                `firing` de desktop/touch vía toggleFiring.
     Botón 0  (A)     → salto (jumpQueued, igual que el botón táctil)
     Botón 2  (X)     → tryReload()
     Botón 4  (LB)    → arma anterior (cycleWeapon −1)   } E4a: hombros para trocar el
     Botón 5  (RB)    → arma siguiente (cycleWeapon +1)  }     arma, como todo boomer
     Botón 10 (L3)    → sprint: mismo efecto que ShiftLeft (respeta el cooldown).
                        OJO E4a: LB salió del sprint — era (LB ó L3); L3 queda solo.
     Botón 9  (Start) → pausa/reanudar (sale de pointer lock si estaba lockeado; el tap
                        en el overlay o B/1 reanudan). En menú arranca; en muerte reintenta.
     D-pad (12–15) y cualquier botón/dead de más: ignorados a propósito.
   REQUIERE HTTPS: la Gamepad API solo existe en secure context. Por http:// en una IP
   de la red local no hay navigator.getGamepads → usar serve_https.py (cert self-signed).
   Detección: eventos gamepadconnected/disconnected mueven el chip HUD (#gpadchip) y el
   índice preferido, pero el estado se pollea CADA FRAME desde loop() (el objeto puede
   aparecer sin evento; en pausa hay que seguir polleando para que Start reanude). Sin
   mando el coste es un early return; sin API (http), ni eso. */
const GP_API = !!(navigator.getGamepads || navigator.webkitGetGamepads);
const GP_DZ = 0.18, GP_YAW = 2.6, GP_PITCH = 2.0, GP_TRIG = 0.35;
const gp = {
  connected: false, index: -1,
  mf: 0, mr: 0,      // stick izq curvado (+ adelante / + der); 0 = quieto → no pisa a WASD
  lookX: 0, lookY: 0, // stick der curvado
  sprint: false,
  wasFire: false,    // flanco del gatillo: toggleFiring solo se escribe en el cambio
  prev: {},          // flancos de los botones "de acción" (A/B/X/Start)
};
// curva muerta renormalizada: 0 bajo la deadzone, luego sign·t² (arranque suave, tope 1)
const gpCurve = v => {
  const a = Math.abs(v);
  if (a <= GP_DZ) return 0;
  const t = (a - GP_DZ) / (1 - GP_DZ);
  return (v < 0 ? -1 : 1) * t * t;
};
const gpPad = () => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : navigator.webkitGetGamepads();
  if (!pads) return null;
  const p = pads[gp.index];
  if (p && p.connected) return p;
  for (const q of pads) if (q && q.connected) return q; // el evento puede no haber llegado
  return null;
};
const gpDown = (pad, i) => { const b = pad.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
const gpEdge = (pad, i) => { // true solo en el frame del flanco de presión
  const now = gpDown(pad, i), was = gp.prev[i] === true;
  gp.prev[i] = now;
  return now && !was;
};

const gchip = $('gpadchip');
if (gchip && !GP_API) gchip.style.display = 'none'; // navegador sin API: chip fuera
function gpSetConnected(on, index = -1) {
  if (gp.connected === on && !on) { gp.index = -1; return; }
  const changed = gp.connected !== on;
  gp.connected = on; gp.index = index;
  if (changed) {
    if (gchip) {
      gchip.textContent = on ? '🎮 CONECTADO' : '🎮 SIN MANDO';
      gchip.classList.toggle('on', on);
    }
    // un mando real manda: con mando conectado el overlay táctil se oculta aunque
    // TOUCH_MODE sea true (de dispositivo o forzado con ?touch=1). Sin mando, todo
    // como antes: ?touch=1 sigue forzando el overlay manual.
    if (TOUCH_MODE) $('touchhud').classList.toggle('gpadhide', on);
  }
}
addEventListener('gamepadconnected', e => gpSetConnected(true, e.gamepad.index));
addEventListener('gamepaddisconnected', () => { // revalidamos por poll: el index del
  const pad = gpPad();                            // evento no siempre coincide con el real
  if (pad) gpSetConnected(true, pad.index);
  else gpSetConnected(false);
});

function pollGamepad(dt) {
  if (!GP_API) return;                    // http:// (no secure): cero overhead
  const pad = gpPad();
  if (!pad) {
    if (gp.connected) {                   // desconectado en frío (a veces sin evento)
      gpSetConnected(false);
      if (gp.wasFire) { toggleFiring(false); gp.wasFire = false; }
      gp.mf = gp.mr = gp.lookX = gp.lookY = 0; gp.sprint = false;
    }
    return;
  }
  if (!gp.connected) gpSetConnected(true, pad.index); // apareció sin evento

  const ax = pad.axes || [];
  gp.mf = -gpCurve(ax[1] || 0); gp.mr = gpCurve(ax[0] || 0);
  gp.lookX = gpCurve(ax[2] || 0); gp.lookY = gpCurve(ax[3] || 0);
  gp.sprint = gpDown(pad, 10); // L3 (E4a: LB pasó a trocar arma, ver mapeo arriba)

  // Look: suma deltas por frame; el mouse (movementX) y el drag táctil siguen iguales.
  if (game.state === 'play') {
    if (gp.lookX) player.yaw -= gp.lookX * GP_YAW * dt;
    if (gp.lookY) player.pitch = clamp(player.pitch - gp.lookY * GP_PITCH * dt, -1.5, 1.5);
  }

  // RT (7): analógico > 0.35 u oprimido digital; escribe `firing` solo en los flancos.
  const fire = gpDown(pad, 7) || (pad.buttons[7] && pad.buttons[7].value > GP_TRIG);
  if (fire !== gp.wasFire) {
    if (game.state === 'play') toggleFiring(fire);
    gp.wasFire = fire;
  }
  // Flancos: se calculan SIEMPRE (los botones no usados se descartan) para que gp.prev
  // quede sincronizado en cualquier estado; sostener un botón a través de una transición
  // de estado no dispara una segunda acción.
  const eA = gpEdge(pad, 0), eX = gpEdge(pad, 2);
  const eStart = gpEdge(pad, 9), eB = gpEdge(pad, 1);
  const eLB = gpEdge(pad, 4), eRB = gpEdge(pad, 5); // E4a: hombros = troca

  if (game.state === 'play') {
    if (eA) player.jumpQueued = true; // A
    if (eX) tryReload();              // X
    if (eLB) cycleWeapon(-1);         // LB: arma anterior
    if (eRB) cycleWeapon(1);          // RB: arma siguiente
  }

  // Start (9): pausa con los dos caminos del flujo existente (pointer lock → el evento
  // pointerlockchange hace el resto; táctil o sin lock → enterPause directo).
  if (eStart) {
    if (game.state === 'play') {
      if (!TOUCH_MODE && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      else enterPause();
    } else if (game.state === 'pause') lockAndPlay();
    else playFromMenu(); // menú arranca / muerte reintenta (Start único mando posible)
  }
  if (game.state === 'pause' && eB) lockAndPlay(); // B reanuda
}

/* ============================================================ E4a — shooting (fireWeapon)
   Punto único de disparo para TODOS los tipos (el viejo shoot(dt) del rifle se generó):
   cooldown en update() por W.cad, consumo del mag (y recarga genérica desde el pool
   W.ammo), y dispatch por W.type: melee / hitscan / shotgun / projectile. El flow
   (asador) no dispara por cadencia: update() llama al tick de llama mientras firing y
   pool > 0. Comunes a todo disparo: fogonazo del viewmodel (quad aditivo ~1 frame) +
   luz puntual en el mundo + kick del viewmodel (decae 0.12 s) + patada de cámara. */
const raycaster = new THREE.Raycaster();
raycaster.far = 150;
const _mv = new THREE.Vector3(), _dir = new THREE.Vector3(), _end = new THREE.Vector3(),
      _origin = new THREE.Vector3();

/* E3 — recarga con pool por tipo (genérica E4a): la reserva infinita se acabó. Con el
   pool del arma actual vacío NO hay recarga: click vacío (anti-spam 0.5 s) + hint
   "SIN MUNICIÓN" una vez por oleada. Con pool a medias la recarga es parcial.
   Armas sin cargador (fists: sin pool · asador: flow, consume el pool directo) no
   recargan nunca: la función sale sin efectos — R/RECARGAR/X se ignoran con ellas. */
function tryReload() {
  if (game.state !== 'play' || player.reloading > 0) return;
  const W = curWeapon();
  if (!W.ammo || W.magSize <= 0) {
    // fists (sin munición jamás): silencio total. Flow (asador) SIN pool: sí hay click
    // vacío + hint — se quedó sin células y la única salida es el piso.
    if (W.ammo && player.pools[W.ammo].n <= 0 && game.time >= player.dryT) {
      player.dryT = game.time + 0.5;
      Sfx.dry();
      showAmmoHint();
    }
    return;
  }
  const mag = curMag(), pool = player.pools[W.ammo];
  if (mag >= W.magSize) return;
  if (pool.n <= 0) {
    if (game.time >= player.dryT) {
      player.dryT = game.time + 0.5;
      Sfx.dry();
      if (mag <= 0) showAmmoHint();
    }
    return;
  }
  player.reloading = 1.4;
  Sfx.reload();
  $('ammo').classList.add('reloading');
}

/* --- FX de disparo comunes: quad aditivo en vmScene (vida ~1 frame) + luz del mundo
   + kick del viewmodel + patada de cámara. Sin alloc. --- */
let flashT = 0;
function placeVmFlash(scaleMul) {
  const M = vmModel(player.weaponId);
  vmFlash.position.set(M.muzzle[0], M.muzzle[1], -0.02);
  vmFlash.scale.setScalar(M.flashS * scaleMul);
  vmFlash.material.rotation = rand(0, 6.28);
  vmFlash.visible = true;
}
function vmFireFx(W) {
  placeVmFlash(1);
  flashT = 0.045;
  flashLight.intensity = bloomOn ? 46 : 26;
  player.vmKick = 1;
  if (W.recoil) player.recoilPitch += W.recoil;
}
function flashTick(dt) {
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) vmFlash.visible = false; }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 400);
}

/* --- cono: vector unitario aleatorio alrededor de `_fwd` con apertura TOTAL `rad`.
   Para conos chicos (~9°) basta con un offset perpendicular proporcional al radio
   (r = √u·tan(rad/2) → uniforme en el disco) + normalize. _fwd debe salir de
   camera.getWorldDirection. --- */
const _fwd = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
function randomInCone(out, rad) {
  _s1.set(-_fwd.z, 0, _fwd.x);
  if (_s1.lengthSq() < 1e-6) _s1.set(1, 0, 0); else _s1.normalize();
  _s2.crossVectors(_fwd, _s1);
  const a = rand(0, 6.28318), r = Math.sqrt(Math.random()) * Math.tan(rad * 0.5);
  return out.copy(_fwd).addScaledVector(_s1, Math.cos(a) * r)
                       .addScaledVector(_s2, Math.sin(a) * r).normalize();
}

/* --- hitscan: el raycast del viejo rifle, ahora helper COMPARTIDO por vecinal (1 rayo),
   ametralladora (1 rayo) y moris12 (pellets). fx=false silencia el feedback (chispas/
   decals/tracer) para los pellets 4+ : todos hacen daño, el FX se limita a los 3
   primeros aciertos. Retorna 2 enemigo · 1 muro · 0 aire. --- */
function rayShot(ox, oy, oz, dx, dy, dz, dmg, fx) {
  _dir.set(dx, dy, dz);
  raycaster.set(_origin.set(ox, oy, oz), _dir);
  _nMat.getNormalMatrix(camera.matrixWorld); // para pasar normales de hit a world
  const hitsEnemy = raycaster.intersectObjects(enemyHitboxes, false);
  const hitsWorld = raycaster.intersectObjects(solids, false);
  const eHit = hitsEnemy[0], wHit = hitsWorld[0];
  if (eHit && (!wHit || eHit.distance < wHit.distance)) {
    const en = eHit.object.userData.enemy;
    if (en && en.spawnT > 0.3) {
      en.takeDamage(dmg, eHit.point);
      hitmarkT = 0.12;
      Sfx.hitmark();
      if (fx) shootTracer(muzzleWorld(_mv), eHit.point);
      return 2;
    }
    return 0;
  } else if (wHit) {
    if (fx) {
      _hitN.copy(wHit.normal).applyMatrix3(_nMat).normalize(); // normal object -> world
      wallImpact(wHit.point, _hitN);
      shootTracer(muzzleWorld(_mv), wHit.point);
    }
    return 1;
  }
  if (fx) shootTracer(muzzleWorld(_mv), _end.copy(_origin).addScaledVector(_dir, 120));
  return 0;
}

/* --- puños: ray corto + empujón (Doom). No consume nada: si no hay balas, se pega. --- */
function meleeStrike(W) {
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_dir);
  _nMat.getNormalMatrix(camera.matrixWorld);
  raycaster.set(_origin, _dir);
  raycaster.far = W.range;
  const hitsEnemy = raycaster.intersectObjects(enemyHitboxes, false);
  const hitsWorld = raycaster.intersectObjects(solids, false);
  const eHit = hitsEnemy[0], wHit = hitsWorld[0];
  if (eHit && (!wHit || eHit.distance < wHit.distance)) {
    const en = eHit.object.userData.enemy;
    if (en && en.spawnT > 0.3) {
      en.takeDamage(W.dmg, eHit.point);
      en.knockback(W.knock);
      hitmarkT = 0.12;
      Sfx.meleeHit();
    }
  } else if (wHit) {
    _hitN.copy(wHit.normal).applyMatrix3(_nMat).normalize();
    wallImpact(wHit.point, _hitN); // el puño también sangra contra la pared
  }
  raycaster.far = 150;
}

/* --- asador (flow): un tick de llama. Consume flowRate·tick células DEL POOL (acá),
   9 de daño a cada enemigo en cono de 20° total a <7 m con línea de visión libre (los
   muros bloquean la llama: un raycast por candidato, candidatos = ≤26 en rango) y lo
   ENCIENDE: estado quemado 4 s de DoT. El sfx es un soplo corto por tick (frecuencia
   random = ruido marrón filtrado). El fogonazo del viewmodel se mantiene vivo arriba,
   en update(), mientras dure el chorro. --- */
const _flP = new THREE.Vector3(), _flD = new THREE.Vector3();
function flamerTick(W) {
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_fwd); // eje del cono = hacia donde se MIRA (camera final)
  let any = false;
  for (let i = enemies.length - 1; i >= 0; i--) { // inverso: el tick puede matar (splice)
    const en = enemies[i];
    if (en.spawnT < 0.3) continue;
    _flP.set(en.g.position.x, en.baseY, en.g.position.z);
    _flD.subVectors(_flP, _origin);
    const dist = _flD.length();
    if (dist > W.range || dist < 1e-4) continue;
    _flD.multiplyScalar(1 / dist);
    if (_flD.dot(_fwd) < Math.cos(W.cone)) continue; // fuera del cono de 20°
    raycaster.set(_origin, _flD);
    const hw = raycaster.intersectObjects(solids, false)[0];
    if (hw && hw.distance < dist - 0.15) continue;  // hay pared en el medio
    en.takeDamage(W.dmg, _flP);
    en.burn(W.burnT, W.burnDps);
    any = true;
  }
  Sfx.flame();
  player.vmKick = Math.max(player.vmKick, 0.5);
  flashLight.intensity = Math.max(flashLight.intensity, bloomOn ? 18 : 10);
  if (any) hitmarkT = Math.max(hitmarkT, 0.08);
}

/* --- kira: pool de 24 cohetes SIN alloc por disparo. Vuelven a la vida solo cuando
   explotan: contacto con enemigo, AABB de obstáculo, muros de arena o piso. --- */
const rockets = [];
{
  const rGeo = new THREE.BoxGeometry(0.16, 0.16, 0.44);
  const rMat = new THREE.MeshBasicMaterial({ color: neon(0xffb057, 1.8) });
  for (let i = 0; i < 24; i++) {
    const mesh = new THREE.Mesh(rGeo, rMat);
    mesh.visible = false;
    scene.add(mesh);
    rockets.push({ mesh, vel: new THREE.Vector3(), life: 0, trailT: 0 });
  }
}
function fireRocket() {
  const r = rockets.find(r => r.life <= 0) || rockets[0]; // saturado: se recicla el viejo
  camera.getWorldPosition(_origin);
  r.mesh.position.copy(_origin);
  r.mesh.position.y -= 0.12; // sale del hombro, no de los ojos
  randomInCone(r.vel, curWeapon().spread).multiplyScalar(curWeapon().projVel);
  r.life = 4; // seguridad: nada vuela más de 4 s
  r.trailT = 0;
  r.mesh.visible = true;
}
function rocketsUpdate(dt) {
  const W = WEAPONS.kira;
  for (const r of rockets) {
    if (r.life <= 0) continue;
    r.life -= dt;
    const p = r.mesh.position;
    p.addScaledVector(r.vel, dt);
    r.trailT -= dt;
    if (r.trailT <= 0) { r.trailT = 0.05; burst(p, 0xffb057, 1, 0.6, 0.5, 1.6); } // estela (pool de partículas)
    let boom = r.life <= 0;
    if (Math.abs(p.x) >= ARENA - 0.15 || Math.abs(p.z) >= ARENA - 0.15 || p.y <= 0.06) boom = true;
    for (const b of boxes) // obstáculos: punto vs AABB
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) { boom = true; break; }
    if (!boom) for (let i = enemies.length - 1; i >= 0; i--) { // inverso: el estallido splicea
      const en = enemies[i];
      const rr = 0.85 * en.T.scale + 0.25; // mitad de hitbox + margen de cohete
      const dx = en.g.position.x - p.x, dy = en.baseY - p.y, dz = en.g.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < rr * rr) { boom = true; break; }
    }
    if (boom) {
      r.life = 0;
      r.mesh.visible = false;
      explode(p, W.dmg, W.splash);
    }
  }
}

/* --- estallido COMPARTIDO kira (y en E4b, el orbe del compilador): FX pleno + splash
   con decaimiento lineal a enemigos Y al jugador. El score por muertes del splash sale
   solo: die() lo suma siempre — sin concepto de "dueño" en single player, todo cuenta.
   Auto-daño estilo Doom: si estás a <3 m de tu propio cohete la pagas (con decaimiento
   y ×0.5: duele, rocket-jump sin skill no es suicidio limpio; la armadura se come el
   60% vía damagePlayer como a cualquier bicho). --- */
function explode(pos, dmg, radius) {
  Sfx.explosion();
  burst(pos, 0xffb057, 16, 8, 1.6, 2.2);
  burst(pos, 0xff5a1e, 10, 5, 1.1, 1.4);
  popFxLight(pos, 0xff9a3d, 220, 0.45);
  for (let i = enemies.length - 1; i >= 0; i--) { // inverso: takeDamage puede matar (splice)
    const en = enemies[i];
    const d = Math.hypot(en.g.position.x - pos.x, en.baseY + 0.4 - pos.y, en.g.position.z - pos.z);
    if (d > radius + 0.6 * en.T.scale) continue;
    en.chest(_flP);
    en.takeDamage(dmg * clamp(1 - d / radius, 0.15, 1), _flP);
  }
  const pd = Math.hypot(player.pos.x - pos.x, player.pos.y - pos.y, player.pos.z - pos.z);
  if (pd < radius) damagePlayer(dmg * (1 - pd / radius) * 0.5);
}
function clearRockets() {
  for (const r of rockets) { r.life = 0; r.mesh.visible = false; }
}

/* --- fireWeapon: UN disparo del arma actual (lo llama update() cuando firing y el
   cooldown llegó a 0). Consume el mag, dispara según W.type y dispara el FX común. --- */
function fireWeapon() {
  const W = curWeapon();
  if (W.magSize > 0) {
    if (player.mags[player.weaponId] <= 0) { tryReload(); return; } // seco: recarga o click vacío
    player.mags[player.weaponId]--;
  }
  player.fireCd = W.cad;
  player.lastShotT = game.time;
  Sfx[W.sfx]();
  vmFireFx(W);
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_fwd); // eje de referencia: cono de hitscan/shotgun y cohete

  if (W.type === 'melee') {
    meleeStrike(W);
  } else if (W.type === 'hitscan') {
    // spread: base del arma + calor (ametralladora) + movimiento — la vieja fórmula
    // del rifle, ahora parametrizada por fila de WEAPONS
    const spread = W.spread +
      (W.heatSpread ? W.heatSpread * (player.heat / W.heatMax) : 0) +
      Math.min(player.vel.length() / SPEED, 1.4) * 0.008;
    const d = randomInCone(_dir, spread * 2);
    rayShot(_origin.x, _origin.y, _origin.z, d.x, d.y, d.z, W.dmg, true);
    if (W.heatMax) { // ametralladora: 40 ráfagas SEGUIDAS sobrecalientan → 1.2 s de "CALOR"
      player.heat++;
      if (player.heat >= W.heatMax) {
        player.heat = 0;
        player.cooling = 1.2;
        if (player.reloading > 0) { player.reloading = 0; $('ammo').classList.remove('reloading'); }
        Sfx.overheat();
        updateHud(); // "CALOR" en el HUD al instante
      }
    }
  } else if (W.type === 'shotgun') {
    // pellets: N hitscan con dirección rotada en el cono. FX de impacto SOLO en los
    // 3 primeros aciertos (damage van todos; chispas/decals/tracer no se amontonan).
    let fxLeft = 3;
    for (let i = 0; i < W.pellets; i++) {
      const d = randomInCone(_dir, W.spread);
      if (rayShot(_origin.x, _origin.y, _origin.z, d.x, d.y, d.z, W.dmg, fxLeft > 0)) fxLeft--;
    }
  } else if (W.type === 'projectile') {
    fireRocket();
  }
  // flow (asador) llega acá solo si alguien lo llama por cadencia: update() maneja el
  // chorro por tick; ninguna fila de la tabla le pone cad>0 a un flow.
  updateHud();
}

/* ============================================================ update */
const clock = new THREE.Clock();
let bobT = 0;

function update(dt) {
  game.time += dt;
  const t = game.time;

  /* --- movimiento del jugador (temps de módulo: sin alloc por frame) */
  const f = _pf.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const r = _pr.set(-f.z, 0, f.x);
  const wish = _pw.set(0, 0, 0);
  // stick izq de mando (mf/mr vienen curvados del poll; 0 = quieto): pisa al teclado por
  // eje solo cuando supera la deadzone → WASD intacto con el mando en reposo
  const kbF = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const kbR = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const mf = gp.mf || kbF, mr = gp.mr || kbR;
  if (mf) wish.addScaledVector(f, mf);
  if (mr) wish.addScaledVector(r, mr);
  // joystick táctil: empuje analógico (|wish| = mag ≤ 1). WASD normaliza a 1 abajo igual que antes.
  if (touch.stickId !== -1 && touch.mag > 0.02) {
    wish.x += f.x * touch.wishF + r.x * touch.wishR;
    wish.z += f.z * touch.wishF + r.z * touch.wishR;
  }
  const moving = wish.lengthSq() > 0;
  if (moving) {
    const wl = wish.length();
    if (wl > 1) wish.multiplyScalar(1 / wl); // WASD puro: idéntico al normalize() de antes
  }

  player.sprintCd -= dt; player.sprintT -= dt;
  let speed = SPEED;
  // sprint: Shift de desktop, LB/L3 del mando o joystick clavado al fondo (>0.92 del
  // radio), mismo cooldown
  if ((keys['ShiftLeft'] || gp.sprint || (touch.stickId !== -1 && touch.mag > 0.92)) &&
      moving && player.sprintCd <= 0 && player.sprintT <= 0) {
    player.sprintT = 0.3; player.sprintCd = 1.3;
  }
  if (player.sprintT > 0) speed *= SPRINT;

  const accel = player.onGround ? 60 : 14;
  player.vel.x += (wish.x * speed - player.vel.x) * Math.min(1, accel * dt / speed || 0.3);
  player.vel.z += (wish.z * speed - player.vel.z) * Math.min(1, accel * dt / speed || 0.3);

  if ((keys['Space'] || player.jumpQueued) && player.onGround) {
    player.vel.y = JUMP_V; player.onGround = false;
  }
  player.jumpQueued = false;
  player.vel.y -= GRAVITY * dt;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= EYE) { player.pos.y = EYE; player.vel.y = 0; player.onGround = true; }

  player.pos.x = clamp(player.pos.x, -ARENA + 1, ARENA - 1);
  player.pos.z = clamp(player.pos.z, -ARENA + 1, ARENA - 1);
  pushOutOfBoxes(player.pos, 0.55);

  /* --- cámara */
  player.recoilPitch = Math.max(0, player.recoilPitch - dt * 0.08);
  camera.position.copy(player.pos);
  camera.rotation.order = 'YXZ';
  if (TOUCH_MODE) {
    // low-pass ~40 ms: los deltas del arrastre (arribados a ritmo de frame) se interpolan
    // → giro suave sin snaps; dispara siempre hacia donde se ve (el ray usa la cámara renderizada)
    const k = 1 - Math.exp(-dt * 24);
    viewYaw += (player.yaw - viewYaw) * k;
    viewPitch += (player.pitch - viewPitch) * k;
  } else { viewYaw = player.yaw; viewPitch = player.pitch; }
  camera.rotation.y = viewYaw;
  camera.rotation.x = clamp(viewPitch + player.recoilPitch, -1.55, 1.55);
  const strafeAmt = moving ? wish.dot(r) : 0;
  player.roll += (-strafeAmt * 0.025 - player.roll) * Math.min(1, dt * 8);
  camera.rotation.z = player.roll;

  // E4a — viewmodel pixelado: sway idle con la velocidad + retorno + kick (ver el
  // bloque del viewmodel; el viejo gun 3D de cubos salió del juego).
  updateViewmodel(dt, moving);
  flashTick(dt);

  /* --- disparo / recarga (E4a) ---
     heat: solo armas con heatMax (ametralladora). "40 ráfagas SEGUIDAS": el heat NO
     decae mientras se mantiene el gatillo (cada shot suma 1); en cuanto se suelta el
     ritmo (>0.3 s sin disparar) se enfría a 22/s. cooling = bloqueo post-overheat que
     muestra "CALOR" en el HUD (updateWname). */
  const Wc = curWeapon();
  if (Wc.heatMax && player.heat > 0 && game.time - player.lastShotT > 0.3)
    player.heat = Math.max(0, player.heat - dt * 22);
  if (player.cooling > 0) {
    player.cooling = Math.max(0, player.cooling - dt);
    if (player.cooling === 0) updateWname(); // sale de "CALOR"
  }
  player.fireCd -= dt;
  const flowOn = Wc.type === 'flow' && firing && player.reloading <= 0 && player.pools[Wc.ammo].n > 0;
  if (flowOn) {
    // chorro del asador: tic cada W.tick (0.1 s) mientras se mantiene el gatillo y
    // quedan células; el consumo (2/s) sale DEL POOL directo — sin cargador
    if (player.fireCd <= 0) {
      player.fireCd = Wc.tick;
      player.pools[Wc.ammo].n = Math.max(0, player.pools[Wc.ammo].n - Wc.flowRate * Wc.tick);
      flamerTick(Wc);
      updateHud(); // el contador de células baja a la vista
    }
    // llama permanente en el viewmodel mientras sale (quad aditivo + luz): no es un
    // destello de 1 frame como el de los cañones, es un chorro
    placeVmFlash(1.25);
    flashT = 0.06;
  } else if (firing && Wc.type !== 'flow' && player.fireCd <= 0 &&
             player.cooling <= 0 && player.reloading <= 0) {
    fireWeapon();
  }
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      // recarga desde el pool (parcial si el pool no llega al cargador completo)
      const W = curWeapon(), pool = player.pools[W.ammo];
      const take = Math.min(W.magSize - curMag(), pool.n);
      pool.n -= take;
      player.mags[player.weaponId] += take;
      $('ammo').classList.remove('reloading');
      updateHud();
    }
  }
  rocketsUpdate(dt); // cohetes de Kira en vuelo (pool 24, sin alloc)

  /* --- enemigos (E4a: loop inverso — el DoT de quemado puede matar al enemigo desde su
         propio update() y splicea `enemies` a mitad de recorrido; yendo al revés el
         splice del actual nunca salta un vecino) */
  for (let i = enemies.length - 1; i >= 0; i--) enemies[i].update(dt, t);

  /* --- spawn / oleadas */
  if (game.intermission > 0) {
    game.intermission -= dt;
    if (game.intermission <= 0) startWave(game.wave + 1);
  } else if (game.spawnQueue.length > 0) {
    game.spawnT -= dt;
    if (game.spawnT <= 0) {
      game.spawnT = 0.55;
      new Enemy(game.spawnQueue.pop(), spawnPoint());
      updateHud();
    }
  } else if (enemies.length === 0 && game.state === 'play') {
    const bonus = 200 * game.wave;
    game.score += bonus;
    feed(`OLEADA COMPLETA +${bonus}`);
    updateHud();
    game.intermission = 3.2;
  }

  /* --- pickups (E3): giro lento + bob + idle 2 vistas; drop parpadea los últimos 5 s;
         auto-levante a <1.2 m horizontales del jugador (solo si aún sirve: un botiquín
         con vida llena queda en el piso para más tarde) */
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    if (p.drop) {
      p.ttl -= dt;
      if (p.ttl <= 0) { // expiró: se va sin dejar ruido
        scene.remove(p.mesh); p.tex.dispose(); pickups.splice(i, 1);
        continue;
      }
    }
    const view = ((p.t * 2) | 0) & 3; // ciclo 2 Hz: idle0 → idle1 → idle1' → idle0'
    if (view !== p.view) { p.view = view; p.tex.offset.x = view * 0.25; }
    p.mesh.rotation.y = p.t * 1.15 + p.phase;                     // rotación lenta
    p.mesh.position.y = p.baseY + Math.sin(p.t * 2.6 + p.phase) * 0.05; // bob vertical
    p.mesh.visible = p.ttl <= 0 || p.ttl > 5 || ((p.ttl * 5) | 0) % 2 === 0;
    const dx = p.mesh.position.x - player.pos.x, dz = p.mesh.position.z - player.pos.z;
    if (dx * dx + dz * dz < 1.44 && pickupUsable(p.kind)) collectPickup(p);
  }

  /* --- partículas */
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vel.y -= 12 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.04) { p.mesh.position.y = 0.04; p.vel.multiplyScalar(0.4); }
    p.mesh.material.opacity = p.life / p.max;
  }

  /* --- tracers */
  for (const tr of tracers) {
    if (tr.life <= 0) continue;
    tr.life -= dt;
    if (tr.life <= 0) tr.line.material.opacity = 0;
    else tr.line.material.opacity = 0.9 * (tr.life / 0.07);
  }

  /* --- overlays de daño / hitmarker */
  dmgFlash = Math.max(0, dmgFlash - dt * 1.6);
  $('dmg').style.opacity = dmgFlash;
  hitmarkT = Math.max(0, hitmarkT - dt);
  $('hitmark').style.opacity = hitmarkT > 0 ? 1 : 0;
}

/* ============================================================ loop */
// FX ambientales: corren siempre (menú/pausa incluidos), cero alloc por frame
function updateWorldFx(dt, t) {
  // titilación global sutil de las estrellas (dos senos desfasados)
  starMat.opacity = 0.82 + Math.sin(t * 0.9) * 0.07 + Math.sin(t * 2.7 + 1.3) * 0.05;

  // decaimiento de los flashes de muerte (pool de luces)
  for (const f of fxFlashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) { f.light.intensity = 0; continue; }
    const k = f.life / f.max;
    f.light.intensity = f.peak * k * k;
  }

  // fade de decals (4 s, curva suave al final)
  for (const d of decals) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.sp.visible = false; d.sp.material.opacity = 0; continue; }
    d.sp.material.opacity = 0.9 * Math.pow(d.life / d.max, 0.7);
  }
}

const fpsEl = $('fps');
let fpsN = 0, fpsLast = performance.now();

/* auto-degrade (PCs flojos / phones / SwiftShader): fps promediado en ventanas de 2 s
   solo en modo play; dos ventanas seguidas por debajo de 28 apagan el bloom UNA vez.
   Nunca se re-enciende solo; B lo puede reactivar manualmente. El retro NO se toca
   acá: retro ON es el modo barato (render a ~360p); apagarlo subiría el costo de
   render — dirección equivocada bajo problema de rendimiento. */
const FPS_WINDOW_MS = 2000, FPS_FLOOR = 28;
let winFrames = 0, winT0 = performance.now(), lowWindows = 0;
function autoDegrade(now) {
  if (game.state !== 'play') { winFrames = 0; winT0 = now; return; } // no degradar en menú/pausa
  winFrames++;
  const el = now - winT0;
  if (el < FPS_WINDOW_MS) return;
  const avg = winFrames * 1000 / el;
  winFrames = 0; winT0 = now;
  lowWindows = avg < FPS_FLOOR ? lowWindows + 1 : 0;
  if (lowWindows < 2) return;
  lowWindows = 0;
  if (bloomOn) { setBloom(false); feed('bloom auto-off (rendimiento)'); }
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  pollGamepad(dt); // cada frame, play o pausa (Start tiene que poder reanudar)
  const prev = game.state;
  if (game.state === 'play') update(dt);
  if (game.state !== prev) dispatchEvent(new CustomEvent('gamestate', { detail: game.state })); // ex: muerte dentro de update → soltar input táctil
  updateWorldFx(dt, clock.elapsedTime);
  // retro necesita el composer SIEMPRE (el upscale nearest es su último pase); el bloom
  // solo añade el UnrealBloomPass. Sin retro y sin bloom: renderer directo, costo cero.
  // E4a: el viewmodel viaja DENTRO del composer (vmPass: RenderPass clear=false +
  // clearDepth=true agregado tras el RenderPass de la escena) → se pinta encima de la
  // geometría (depth limpiado: riesgo E2 resuelto) y comparte pixelación + bloom. En el
  // path directo el mismo truco se hace a mano con renderer.autoClear=false ANTES del
  // render del viewmodel (que corre DESPUÉS de la escena principal, como dicta el plan).
  if (retroOn || bloomOn) {
    bloomPass.enabled = bloomOn;
    composer.render();
  } else {
    renderer.render(scene, camera); // path directo: cero costo de composer
    renderer.autoClear = false;     // no limpiar lo que acaba de pintar la escena...
    renderer.clearDepth();          // ...pero sí el depth: el viewmodel gana siempre
    renderer.render(vmScene, vmCam);
    renderer.autoClear = true;
  }
  fpsN++;
  const now = performance.now();
  autoDegrade(now);
  if (now - fpsLast >= 1000) { // FPS discreto, 1 actualización por segundo
    fpsEl.textContent = `${Math.round(fpsN * 1000 / (now - fpsLast))} FPS · bloom ${bloomOn ? 'on' : 'off'} · retro ${retroOn ? 'on' : 'off'}`;
    fpsN = 0; fpsLast = now;
  }
}
camera.position.copy(player.pos);
camera.rotation.order = 'YXZ';
window.__dbg = () => ({ state: game.state, wave: game.wave, en: enemies.length,
  q: game.spawnQueue.length, hp: Math.round(player.hp), score: game.score,
  armor: Math.round(player.armor), // E3: recursos
  pools: Object.fromEntries(Object.entries(player.pools).map(([k, v]) => [k, v.n])),
  mag: curMag(), weapon: player.weaponId, pickups: pickups.length,
  owned: [...player.owned], cooling: +player.cooling.toFixed(2), // E4a: arsenal
  pk: pickups.map(p => [Math.round(p.mesh.position.x), Math.round(p.mesh.position.z)]), // test E3
  inter: +game.intermission.toFixed(2), t: +game.time.toFixed(1), bloom: bloomOn, retro: retroOn,
  spriteMode: true, // E2: enemigos = sprite billboard (constante: no hay fallback 3D)
  touchMode: TOUCH_MODE, firing, gamepad: gp.connected,
  x: Math.round(player.pos.x * 10) / 10, z: Math.round(player.pos.z * 10) / 10,
  yaw: Math.round(player.yaw * 100) / 100, pitch: Math.round(player.pitch * 100) / 100 });
// Helper de pruebas (E4a): simula el pickup de arma que E5 va a enchufar — desbloquea
// (unlockWeapon real) y opcionalmente carga munición del pool para poder disparar.
window.__dbgGive = (id, ammo = 999) => {
  const ok = unlockWeapon(id);
  const W = WEAPONS[id];
  if (W && W.ammo) addAmmo(W.ammo, ammo);
  updateHud();
  return { ok, owned: [...player.owned] };
};
window.__probe = () => {
  if (!enemies.length) return 'no enemies';
  const o = camera.getWorldPosition(new THREE.Vector3());
  return enemies.map(e => {
  const d = new THREE.Vector3().subVectors(e.g.position, o).normalize();
  const rc = new THREE.Raycaster(o, d, 0, 150);
  const he = rc.intersectObjects(enemyHitboxes, false);
  const hw = rc.intersectObjects(solids, false);
  return {    eDist: Math.round(e.g.position.distanceTo(o) * 10) / 10,
    eScale: Math.round(e.g.scale.x * 100) / 100,
    spawnT: Math.round(e.spawnT * 100) / 100,
    hitEnemy: he[0] ? Math.round(he[0].distance * 10) / 10 : -1,
    enemyType: he[0] ? he[0].object.userData.enemy.type : null,
    hitWorld: hw[0] ? Math.round(hw[0].distance * 10) / 10 : -1,
    hitWorldPos: hw[0] ? hw[0].point.toArray().map(round2) : null,
    hitWorldType: hw[0] ? hw[0].object.type : null,
    camPos: camera.getWorldPosition(new THREE.Vector3()).toArray().map(round2),
    eType: e.type };
  });
  function round2(v) { return Math.round(v * 100) / 100; }
};
/* Vista de arte (?sprite=1): los 3 billboards de enemigo + la fila de 11 pickups (E3)
   estáticos frente a la cámara en el título, para iterar sprites.js sin spawnear nada
   (útil también en E6). Se ocultan al entrar en play; nada más del gameplay los toca. */
if (new URLSearchParams(location.search).has('sprite') || localStorage.getItem('moris-sprites') === '1') {
  const pre = ['droner', 'sprinter', 'brute'].map((type, i) => {
    const A = enemySprite(type);
    const tex = A.tex.clone();
    tex.repeat.set(0.5, 1);
    const m = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set((i - 1) * 2.6, player.pos.y + 0.15, -4.2);
    scene.add(m);
    return m;
  });
  // pickups: grilla 6+5, vista 0 del atlas (idle sin girar) para leer el dibujo entero
  Object.keys(PICKUPS).forEach((kind, i) => {
    const A = pickupArt(kind);
    const tex = A.tex.clone();
    tex.repeat.set(0.25, 1);
    const m = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set(((i % 6) - 2.5) * 0.85, player.pos.y - 0.55 - ((i / 6) | 0) * 0.62, -4.0);
    scene.add(m);
    pre.push(m);
  });
  // E4a: las 6 siluetas del viewmodel (grilla 3×2 arriba) — iterar sprites.js sin jugar
  Object.keys(WEAPONS).forEach((id, i) => {
    const art = makeWeaponSprite(WEAPONS[id].silhouette || 'pistol', WEAPONS[id].accent || '#54f0ff');
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.02), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set(((i % 3) - 1) * 1.5, player.pos.y + 1.75 - ((i / 3) | 0) * 1.15, -4.2);
    scene.add(m);
    pre.push(m);
  });
  addEventListener('gamestate', e => { if (e.detail === 'play') for (const o of pre) o.visible = false; }, { once: true });
}
loop();
