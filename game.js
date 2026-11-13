// MORIS // ARENA — wave-based FPS, three.js r160, sin dependencias externas.
import * as THREE from 'three';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';
import { makeEnemySprite } from './sprites.js'; // E2: arte pixel-art de los enemigos (billboard)

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
  shoot()  { this.noise(0.09, 0.5, 1900, 0.8); this.tone('sine', 120, 40, 0.07, 0.4); },
  hitmark(){ this.tone('square', 950, 700, 0.05, 0.12); },
  kill()   { this.tone('sawtooth', 520, 90, 0.28, 0.22); this.noise(0.15, 0.2, 800, 0.6); },
  hurt()   { this.tone('sine', 160, 50, 0.3, 0.35); this.noise(0.1, 0.25, 300, 0.7); },
  reload() { this.tone('triangle', 300, 300, 0.03, 0.2); setTimeout(() => this.tone('triangle', 480, 480, 0.03, 0.2), 160); },
  pickup() { this.tone('sine', 620, 990, 0.14, 0.2); },
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
function setBloom(on) { bloomOn = on; }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
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

/* ============================================================ player */
const EYE = 1.7;
const player = {
  pos: new THREE.Vector3(0, EYE, 28),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  onGround: true,
  hp: 100, maxHp: 100,
  lastHitT: -99,
  sprintCd: 0, sprintT: 0,
  recoilPitch: 0, roll: 0,
  fireCd: 0, heat: 0,
  mag: 30, magSize: 30, reloading: 0,
  jumpQueued: false,             // tap JUMP táctil (el espacio de desktop sigue usando keys)
};
const GRAVITY = 24, SPEED = 6.4, SPRINT = 1.55, JUMP_V = 8;
// cámara suavizada: en desktop copia yaw/pitch 1:1; en táctil los sigue con un low-pass
// para que el arrastre del dedo no se sienta a saltos (ver update)
let viewYaw = 0, viewPitch = 0;

/* ============================================================ weapon viewmodel */
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.4, metalness: 0.8 });
const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.62), gunMat);
barrel.position.set(0, 0, -0.28);
const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.34), gunMat);
body.position.set(0, -0.06, 0.05);
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.09), gunMat);
grip.position.set(0, -0.2, 0.14); grip.rotation.x = 0.3;
const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.4),
  new THREE.MeshBasicMaterial({ color: neon(0x54f0ff, 1.7) })); // riel HDR: línea de bloom
rail.position.set(0, 0.045, -0.2);
gun.add(barrel, body, grip, rail);
gun.position.set(0.26, -0.22, -0.48);
camera.add(gun);
scene.add(camera);

const MUZZLE = new THREE.Vector3(0, 0, -0.62); // local a gun
function muzzleWorld(out) {
  out.copy(MUZZLE);
  gun.localToWorld(out);
  return out;
}

// fogonazo: sprite + luz (más grande y en HDR; el bloom lo estira)
const flashCv = document.createElement('canvas');
flashCv.width = flashCv.height = 64;
const fc = flashCv.getContext('2d');
const grad = fc.createRadialGradient(32, 32, 2, 32, 32, 30);
grad.addColorStop(0, 'rgba(255,240,180,1)');
grad.addColorStop(0.4, 'rgba(255,170,60,0.7)');
grad.addColorStop(1, 'rgba(255,120,30,0)');
fc.fillStyle = grad; fc.fillRect(0, 0, 64, 64);
const flashTex = new THREE.CanvasTexture(flashCv);
const flash = new THREE.Sprite(new THREE.SpriteMaterial({
  map: flashTex, color: neon(0xffffff, 2.6), blending: THREE.AdditiveBlending,
  depthWrite: false, transparent: true }));
flash.scale.setScalar(0.5); flash.visible = false;
gun.add(flash); flash.position.copy(MUZZLE);
const flashLight = new THREE.PointLight(0xffc36b, 0, 18, 2);
flashLight.position.copy(MUZZLE);
gun.add(flashLight);

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
const ENEMY_TYPES = {
  droner:  { hp: 40,  speed: 3.4, scale: 1.0,  dmg: 12, score: 100, color: 0xff4d5e, drop: 0.10 },
  sprinter:{ hp: 24,  speed: 6.6, scale: 0.72, dmg: 8,  score: 150, color: 0xb465ff, drop: 0.08 },
  brute:   { hp: 170, speed: 2.3, scale: 1.75, dmg: 26, score: 400, color: 0xff9a3d, drop: 0.60 },
};
const enemies = [];
const enemyHitboxes = []; // mallas invisibles para raycast
const medkits = [];

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
  // sprite blanco HDR); decae a 1 en update(). Antes era emissiveIntensity del modelo 3D.
  flash() { this.spr.material.color.setScalar(2.2); }
  takeDamage(d, point) {
    this.hp -= d;
    this.flash();
    burst(point, this.T.color, 4, 4, 0.6, 1.6);
    if (this.hp <= 0) this.die();
  }
  die() {
    Sfx.kill();
    game.score += this.T.score; game.kills++;
    feed(`+${this.T.score} ${this.type.toUpperCase()}`);
    burst(this.g.position, this.T.color, 22, 9, 1.2, 1.7);
    popFxLight(this.g.position, this.T.color, 150, 0.38); // flash momentáneo desde el pool
    if (Math.random() < this.T.drop) spawnMedkit(this.g.position);
    this.remove();
  }
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
    // flash: decaimiento del tinte blanco a 1
    if (this.spr.material.color.r > 1)
      this.spr.material.color.setScalar(Math.max(1, this.spr.material.color.r - dt * 5));

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

    // daño por contacto
    this.hitCd -= dt;
    if (dist < 1.1 * T.scale + 0.6 && this.hitCd <= 0 && this.spawnT >= 1) {
      this.hitCd = 0.9;
      damagePlayer(T.dmg);
    }
  }
}

function spawnMedkit(pos) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x0e6b4a, emissive: 0x0ee6a0, emissiveIntensity: 1.3 }));
  const cm = new THREE.MeshBasicMaterial({ color: neon(0xd6ffe9, 1.8) }); // cruz HDR
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.4), cm);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.4), cm);
  c1.position.z = 0.005; c2.position.z = 0.005;
  g.add(box, c1, c2);
  g.position.set(pos.x, 0.4, pos.z);
  scene.add(g);
  medkits.push({ g, t: rand(0, 6) });
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
  game.spawnQueue = buildWave(n);
  game.spawnT = 0;
  $('wave').textContent = n;
  const msg = $('wavemsg');
  msg.textContent = `OLEADA ${n}`;
  msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
  Sfx.wave();
}

function resetGame() {
  while (enemies.length) enemies[0].remove();
  for (const m of medkits) scene.remove(m.g);
  medkits.length = 0;
  Object.assign(player, {
    hp: 100, yaw: 0, pitch: 0, mag: 30, reloading: 0,
    recoilPitch: 0, heat: 0, fireCd: 0, lastHitT: -99, sprintCd: 0, sprintT: 0,
    jumpQueued: false,
  });
  viewYaw = viewPitch = 0; // sin barrido de cámara al reaparecer
  player.pos.set(0, EYE, 28);
  player.vel.set(0, 0, 0);
  Object.assign(game, { score: 0, kills: 0, wave: 0, spawnQueue: [], intermission: 1.2, time: 0 });
  updateHud();
}

function damagePlayer(d) {
  if (game.state !== 'play') return;
  player.hp -= d;
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

function updateHud() {
  const pct = clamp(player.hp / player.maxHp, 0, 1);
  const bar = $('hpbar');
  bar.style.width = (pct * 100) + '%';
  bar.classList.toggle('low', pct < 0.35);
  $('score').textContent = game.score;
  $('enemies').textContent = enemies.length + game.spawnQueue.length;
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
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
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
     Botón 4  (LB) ó 10 (L3) → sprint: mismo efecto que ShiftLeft (respeta el cooldown)
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
  gp.sprint = gpDown(pad, 4) || gpDown(pad, 10); // LB o L3

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

  if (game.state === 'play') {
    if (eA) player.jumpQueued = true; // A
    if (eX) tryReload();              // X
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

/* ============================================================ shooting */
const raycaster = new THREE.Raycaster();
raycaster.far = 150;
const _mv = new THREE.Vector3(), _dir = new THREE.Vector3(), _end = new THREE.Vector3(),
      _origin = new THREE.Vector3();

function tryReload() {
  if (game.state !== 'play' || player.reloading > 0 || player.mag >= player.magSize) return;
  player.reloading = 1.4;
  Sfx.reload();
  $('ammo').classList.add('reloading');
}

function shoot(dt) {
  if (player.reloading > 0) return;
  if (player.mag <= 0) { tryReload(); return; }
  player.mag--;
  player.fireCd = 0.11;
  player.heat = Math.min(1, player.heat + 0.16);
  Sfx.shoot();

  // spread: base + calor + movimiento
  const spread = 0.004 + player.heat * 0.018 +
    Math.min(player.vel.length() / SPEED, 1.4) * 0.008;
  camera.getWorldDirection(_dir);
  _dir.x += rand(-spread, spread); _dir.y += rand(-spread, spread); _dir.z += rand(-spread, spread);
  _dir.normalize();

  camera.getWorldPosition(_origin);
  raycaster.set(_origin, _dir);
  _nMat.getNormalMatrix(camera.matrixWorld); // para pasar normales de hit a world
  const hitsEnemy = raycaster.intersectObjects(enemyHitboxes, false);
  const hitsWorld = raycaster.intersectObjects(solids, false);
  const eHit = hitsEnemy[0], wHit = hitsWorld[0];

  let end;
  if (eHit && (!wHit || eHit.distance < wHit.distance)) {
    end = eHit.point;
    const en = eHit.object.userData.enemy;
    if (en && en.spawnT > 0.3) {
      en.takeDamage(22, eHit.point);
      hitmarkT = 0.12;
      Sfx.hitmark();
    }
  } else if (wHit) {
    end = wHit.point;
    _hitN.copy(wHit.normal).applyMatrix3(_nMat).normalize(); // normal object -> world
    wallImpact(wHit.point, _hitN);
  } else {
    end = _end.copy(_origin).addScaledVector(_dir, 120);
  }

  muzzleWorld(_mv);
  shootTracer(_mv, end);

  // feedback visual del disparo
  flash.visible = true; flashT = 0.045;
  flashLight.intensity = 46;
  flash.rotation.z = rand(0, 6.28);
  flash.scale.setScalar(0.8 + player.heat * 0.45); // fogonazo grande: el bloom lo come
  gun.position.z += 0.09;               // retroceso del modelo
  player.recoilPitch += 0.012 + player.heat * 0.008;
  updateHud();
}
let flashT = 0;

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

  // bob + retorno del arma
  bobT += dt * (moving ? 9 + player.vel.length() : 2);
  const bobY = Math.sin(bobT) * (moving ? 0.014 : 0.004);
  const bobX = Math.cos(bobT * 0.5) * (moving ? 0.008 : 0.002);
  gun.position.x += (0.26 + bobX - gun.position.x) * Math.min(1, dt * 12);
  gun.position.y += (-0.22 + bobY - gun.position.y) * Math.min(1, dt * 12);
  gun.position.z += (-0.48 - gun.position.z) * Math.min(1, dt * 10);
  gun.rotation.x = player.recoilPitch * 2.2;

  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.visible = false; }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 400);

  /* --- disparo / recarga */
  player.heat = Math.max(0, player.heat - dt * 1.4);
  player.fireCd -= dt;
  if (firing && player.fireCd <= 0) shoot(dt);
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      player.mag = player.magSize;
      $('ammo').classList.remove('reloading');
      updateHud();
    }
  }
  $('mag').textContent = player.mag;

  /* --- regen */
  if (game.time - player.lastHitT > 4.5 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + 8 * dt);
    updateHud();
  }

  /* --- enemigos */
  for (const e of enemies) e.update(dt, t);

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

  /* --- medkits */
  for (let i = medkits.length - 1; i >= 0; i--) {
    const mk = medkits[i];
    mk.t += dt;
    mk.g.rotation.y = mk.t * 1.6;
    mk.g.position.y = 0.4 + Math.sin(mk.t * 2.4) * 0.08;
    if (mk.g.position.distanceTo(player.pos) < 1.4) {
      player.hp = Math.min(player.maxHp, player.hp + 25);
      Sfx.pickup();
      feed('+25 BOTIQUÍN');
      burst(mk.g.position, 0x0ee6a0, 10, 5, 0.7);
      scene.remove(mk.g);
      medkits.splice(i, 1);
      updateHud();
    }
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
  if (retroOn || bloomOn) {
    bloomPass.enabled = bloomOn;
    composer.render();
  } else {
    renderer.render(scene, camera); // path directo: cero costo de composer
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
  inter: +game.intermission.toFixed(2), t: +game.time.toFixed(1), bloom: bloomOn, retro: retroOn,
  spriteMode: true, // E2: enemigos = sprite billboard (constante: no hay fallback 3D)
  touchMode: TOUCH_MODE, firing, gamepad: gp.connected,
  x: Math.round(player.pos.x * 10) / 10, z: Math.round(player.pos.z * 10) / 10,
  yaw: Math.round(player.yaw * 100) / 100, pitch: Math.round(player.pitch * 100) / 100 });
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
/* Vista de arte (?sprite=1): los 3 billboards estáticos frente a la cámara en el título,
   para iterar sprites.js sin spawnear enemigos (útil también en E6). Se ocultan al entrar
   en play; nada más del gameplay los toca. */
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
  addEventListener('gamestate', e => { if (e.detail === 'play') for (const o of pre) o.visible = false; }, { once: true });
}
loop();
