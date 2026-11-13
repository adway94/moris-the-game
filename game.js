// MORIS // ARENA — campaña FPS por niveles, three.js r160, sin dependencias externas.
// E3: recursos estilo Doom — vida sin regen, armadura con absorción 60%, pools de
// munición por tipo con caps, pickups billboard y drops por kill (ver PICKUPS/AMMO).
// E4a: sistema de armas multipool — tabla WEAPONS declarativa, 6 armas (0-5) con viewmodel
// pixelado propio en escena separada, cambio con teclas/rueda/mando/touch (ver WEAPONS).
// E4b: arsenal completo (10/10) — Mate/plasma, Changó/doble (twin), Riel/perforante con
// carga de gatillo y Compilador/orbe BFG (scorched + screen shake) + pickup de arma
// (spawnWeaponPickup, listo para E5) + puerta trasera ?weapons=all (ver WEAPONS).
// E5: CAMPAÑA "EL ÚLTIMO SECTOR" — tabla LEVELS (5 niveles con paleta/niebla/cielo/props
// propios), buildArena(levelDef) regenera la escena con dispose limpio, oleadas por nivel
// + mini-jefe elite, portal a la antesala, terminal entre niveles (guion pleno = E7),
// 3 vidas con respawn suave y save "moris-campaign" (nivel/armas/pools/score).
import * as THREE from 'three';
import { EffectComposer } from './vendor/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/examples/jsm/postprocessing/OutputPass.js';
import { makeEnemySprite, makePickupSprite, makeWeaponSprite, makePropSprite } from './sprites.js'; // E2: arte enemigo · E3: pickups · E4a: viewmodels · E5: props

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
  // E4b — sonidos propios de los slots 6-9. railCharge dura lo mismo que W.chargeT: la
  // barra que se ve en el crosshair (#railring) es la misma barra AUDIBLE; sueltas antes
  // de la subida y no hay crack. shootTwin se dispara una vez POR CAÑÓN: el "doble boom"
  // del changó sale del burst real de dos escopetazos a 0.25 s.
  shootPlasma() { this.tone('sine', 1250, 260, 0.09, 0.28); this.noise(0.03, 0.12, 2600, 2); }, // bleep "pew"
  shootTwin()   { this.noise(0.18, 0.6, 430, 0.5); this.tone('sawtooth', 88, 30, 0.2, 0.48); }, // boom corto por cañón
  railCharge()  { this.tone('sawtooth', 90, 820, 0.35, 0.18);
                  this.noise(0.35, 0.1, 1200, 1.5); },                              // turbina que sube
  railFire()    { this.noise(0.12, 0.7, 3400, 1.8); this.tone('sawtooth', 1600, 70, 0.22, 0.5);
                  this.noise(0.25, 0.35, 500, 0.7); },                              // crack eléctrico
  bfgFire()     { this.noise(0.35, 0.22, 240, 0.5); this.tone('sine', 180, 40, 0.3, 0.14); }, // exhalación de humo
  bfgBoom()     { this.noise(0.8, 0.7, 110, 0.35); this.tone('sawtooth', 70, 16, 0.85, 0.55);
                  this.tone('sine', 44, 14, 0.95, 0.5); },                          // detonación grave
  weaponGet()   { [523, 659, 784, 1046].forEach((f, i) =>                           // OBTENIDA: fanfarria
                  setTimeout(() => this.tone('triangle', f, f, 0.12, 0.2), i * 70)); },
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
  // E5 — campaña: el lamento grave del mini-jefe y la apertura del portal (barrido
  // ascendente + soplo, se distingue del pickup de arma).
  bossSpawn(){ this.tone('sawtooth', 70, 46, 1.2, 0.4); this.noise(1.0, 0.2, 160, 0.5);
               setTimeout(() => this.tone('sawtooth', 58, 40, 1.0, 0.32), 240); },
  portal() { this.tone('triangle', 90, 460, 0.55, 0.3); this.noise(0.5, 0.22, 900, 1.2); },
  // E5 — respawn por vidas: "reinicio sectorial" (barrido corto de subida + clac).
  respawn() { this.tone('square', 140, 620, 0.22, 0.2); this.noise(0.18, 0.2, 1400, 1.5); },
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

/* ============================================================ cielo procedural (E5: por nivel)
   La esfera BackSide + campo de estrellas se construye en buildSky(def) con el gradiente,
   las estrellas y el "código" que declare la fila LEVELS.sky — ver más abajo. canvasTex
   queda acá porque también lo usan las texturas de la arena. */
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

/* cielo POR NIVEL (E5): todo lo de acá abajo vive en `world` (grupo que buildArena
   destruye/rearma) con gradiente + estrellas + "código" parametrizados por la fila
   LEVELS.sky {kind, stops, stars, code}. Los temporales de módulo (starGeo/starTex)
   se crean UNA vez; por nivel solo se crean el Points/geo de estrellas y los materiales
   del domo, que se registran en levelRes para el dispose del rebuild. */
function mkGradientTex(stops, noiseCol) {
  const tx = canvasTex(64, (c, S) => {
    const g = c.createLinearGradient(0, 0, 0, S);
    for (const [k, v] of stops) g.addColorStop(k, v);
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) { // ruido tipo banding (como el cielo original)
      c.fillStyle = `rgba(${noiseCol},${rand(0.006, 0.02).toFixed(3)})`;
      c.fillRect(0, rand(0, S), S, 1);
    }
  });
  tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
  return tx;
}

// N5 "código": filas de pixels cian sobre negro. Canvas chico (128) estirado con
// NEAREST a un domo de 150 m: pixeles gigantes retro. game.js lo re-dibuja throttleado
// (levelFx) para el parpadeo — cada redibujado sube 16 KB al GPU, costo irrisorio.
function codeCanvasDraw(c, S, tt) {
  c.fillStyle = '#000305'; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(84,240,255,0.75)';
  for (let y = 0; y < S; y += 8) {
    const row = (Math.sin(tt * 0.7 + y * 1.7) * 43758.5453) % 1;
    const on = ((tt * 3 + y) | 0) % 3 !== 0; // la mitad de las filas parpadea por frames
    if (!on) continue;
    for (let x = ((row * 17) | 0); x < S; x += 4)
      if (Math.random() < 0.34) c.fillRect(x, y, 2, 2);
  }
}

const STAR_N = 1500;
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

// construye domo + estrellas + PMREM del nivel actual (llamar con `world` ya limpio)
function buildSky(def) {
  const SKY = def.sky;
  let tex;
  if (SKY.code) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const cc = cv.getContext('2d');
    codeCanvasDraw(cc, 128, 0);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    levelFx.push((dt, t) => { // parpadeo throttle 0.14 s (~9 frames a 60)
      levelFx._t = (levelFx._t || 0) + 1;
      if (levelFx._t % 9 === 0) {
        codeCanvasDraw(cc, 128, t); // clock del loop (avanza también en pausa/menú)
        tex.needsUpdate = true;
      }
    });
  } else {
    tex = mkGradientTex(SKY.stops, def.pal.noise);
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  world.add(sky);

  if (SKY.stars) { // cascarón esférico 72-138 m (bajo el far plane), como el cielo madre
    const geo = new THREE.BufferGeometry();
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
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const st = new THREE.Points(geo, starMat); // starMat es compartido y sobrevive al dispose
    st.renderOrder = -1;
    world.add(st);
  }

  // entorno PMREM a partir del propio gradiente: reflejos sutiles en PBR. La textura
  // PMREM es del nivel → se disposea en el rebuild (era leak silencioso si no).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  levelRes.push(scene.environment);
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
  vmFit(); // E4b: el ancla abajo-derecha se re-deriva con el aspect nuevo
  const pr = maxDpr(); // mismo cap de dpr para renderer y composer (modo normal)
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  applyComposerSize(); // retro: re-deriva el buffer interno con el aspect/dpr nuevo
});

/* lights: EL RIG es fijo (no se recrea entre niveles — sin leak de shadow maps), pero
   colores/intensidades los fija configureLights(def) por paleta (N4 baja la ambiental y
   sube los emisivos: "casi sin luz"). Se declaran acá porque buildArena los configura. */
const hemi = new THREE.HemisphereLight(0x4a6ea8, 0x0e1424, 1.7);
scene.add(hemi);
let sun, rimCyan, rimMagenta;
function configureLights(def) {
  const L = def.light; // [hemi[cielo, suelo, int]] [sun[color, int]] [rim cian, rim magenta, int, int]
  hemi.color.set(L[0][0]); hemi.groundColor.set(L[0][1]); hemi.intensity = L[0][2];
  sun.color.set(L[1][0]); sun.intensity = L[1][1];
  rimCyan.color.set(L[2][0]); rimCyan.intensity = L[2][2];
  rimMagenta.color.set(L[2][1]); rimMagenta.intensity = L[2][3];
}

/* ============================================================ campaña: LEVELS + arena (E5)
   El viejo buildArena hardcodeado pasa a ser buildArena(levelDef): UNA FILA POR NIVEL =
   spec de mapa (geometría procedural con semilla + set de props + paleta + niebla + cielo
   + luces). Layout de cajas: mismo motor del arena madre pero con semilla por nivel
   (mulberry32 → el mismo mapa en cada visita, clave para el retry del save) y las dos
   zonas libres de siempre: spawn del jugador (sur) y antesala del portal (norte).
   Presupuesto de rendimiento (E2/E3): ≤40 props por nivel, geometría/materiales
   COMPARTIDOS por tipo de prop, y TODO lo del nivel vive en el grupo `world` con sus
   recursos registrados en `levelRes` → buildArena hace dispose limpio del nivel anterior
   (geos, mats, texturas, PMREM) antes de construir el siguiente. */
const ARENA = 32;              // semi-lado del piso jugable
const WALL_H = 5;
const solids = [];             // mallas que bloquean balas (se vacía en cada build)
const boxes = [];              // AABBs para colisión {min:Vec3, max:Vec3} (idem)
const world = new THREE.Group(); // grupo de TODO el contenido del nivel (cielo incluido)
scene.add(world);
let levelRes = [];             // recursos del nivel actual con .dispose() (geos/mats/textos)
let levelFx = [];              // callbacks ambientales del nivel (lava, cubos, chispas, portal)

function addSolid(mesh, collide = true) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  world.add(mesh); solids.push(mesh);
  if (collide) {
    mesh.updateWorldMatrix(true, false);
    const bb = new THREE.Box3().setFromObject(mesh);
    boxes.push({ min: bb.min.clone(), max: bb.max.clone() });
  }
}

// PRNG determinista (mulberry32): layouts reproducibles por nivel
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// paleta del nivel: colores SÓLO en hex strings (los niveles viven en la tabla de abajo)
const PALETTES = {
  criopods:   { floor: '#0e1523', lite: '#243754', dark: '#050910', seam: '84,240,255',  wall: '#101a30', wallLite: '150,190,255', chevron: '#c96a1c', chevronLite: 'rgba(255,196,96,0.5)', chevronBack: '#1a1206', ob: '#202c48', obLite: '190,215,255', neon: 0x54f0ff, noise: '150,190,255' },
  invernadero:{ floor: '#0c1a10', lite: '#1e3a24', dark: '#040b06', seam: '77,220,110',  wall: '#12241a', wallLite: '140,220,160', chevron: '#3fae54', chevronLite: 'rgba(140,255,160,0.5)', chevronBack: '#0b1a0e', ob: '#1f3a26', obLite: '170,240,190', neon: 0x5eff8a, noise: '150,255,190' },
  reactor:    { floor: '#1b120a', lite: '#43301c', dark: '#0b0704', seam: '255,154,61',  wall: '#2a1a0e', wallLite: '255,180,120', chevron: '#ff6a2a', chevronLite: 'rgba(255,220,150,0.5)', chevronBack: '#26100a', ob: '#3a2718', obLite: '255,200,150', neon: 0xff9a3d, noise: '255,180,120' },
  cripta:     { floor: '#14101f', lite: '#2c2440', dark: '#070510', seam: '170,92,255',  wall: '#1c1630', wallLite: '190,160,255', chevron: '#7a4dbf', chevronLite: 'rgba(200,150,255,0.5)', chevronBack: '#150e24', ob: '#262040', obLite: '200,180,255', neon: 0xaa5cff, noise: '190,160,255' },
  nucleo:     { floor: '#020409', lite: '#0a1626', dark: '#000104', seam: '84,240,255',  wall: '#05090f', wallLite: '120,240,255', chevron: '#2ad4ff', chevronLite: 'rgba(160,255,255,0.6)', chevronBack: '#041420', ob: '#0a1420', obLite: '150,230,255', neon: 0x54f0ff, noise: '120,240,255' },
};

/* Las 5 de DESIGN_ARSENAL.md/PLAN_ITERACION.md. Campos:
   · waves + boss.type (elite scale×2.2 hp×6) y weapons {early, exit, mid} = colocación
     de armas del guion (early: al iniciar · exit: ANTES del portal en la antesala, no te
     lo podés perder · mid: tras completar las waves, "te lo da MORIS").
   · sky {kind:'stars'|'dome'|'void', stops, stars, code} · fog {color, density}
   · light: [hemi sky, ground, int] [sun col, int] [rim cian, rim magenta, int, int]
   · set: constructor de geometría propia + props (≤40) — ver funciones setXxx abajo. */
const LEVELS = [
  { id: 1, name: 'CRIOPODS', subtitle: 'el frío despierta a todo, incluso a lo que no debería',
    waves: 3, seed: 1337, pal: PALETTES.criopods,
    weapons: { exit: 'moris12' },                              // "escopeta al final N1": antesala del portal
    sky: { kind: 'stars', stops: [[0, '#000104'], [0.34, '#020715'], [0.62, '#082142'], [0.86, '#114374'], [0.955, '#1d5d94'], [1, '#0a1a30']], stars: true },
    bg: 0x05070d, fog: { color: 0x081327, density: 0.021 },        // niebla azul densa
    light: [[0x4a6ea8, 0x0e1424, 1.5], [0xbfd8ff, 2.4], [0x2ad4ff, 0xff3bd8, 95, 80]],
    set: setCriopods },
  { id: 2, name: 'INVERNADERO', subtitle: 'el jardín de MORIS-9, regado con tripulación',
    waves: 4, seed: 552, pal: PALETTES.invernadero,
    weapons: { early: 'ametralladora', exit: 'asador' },       // N2 early / N2 final (guion DESIGN_ARSENAL)
    sky: { kind: 'dome', stops: [[0, '#02150c'], [0.3, '#06351d'], [0.6, '#0d5a2c'], [0.85, '#1d8a45'], [0.95, '#2fb35c'], [1, '#0a2f1a']], stars: false },
    bg: 0x04120a, fog: { color: 0x0d3a1e, density: 0.023 },        // niebla verde
    light: [[0x4ac07a, 0x0a1c10, 1.8], [0xaaffc4, 2.2], [0x3ddc84, 0xff3bd8, 90, 70]],
    set: setInvernadero },
  { id: 3, name: 'REACTOR', subtitle: 'el naranja NO es suelo',
    waves: 4, seed: 9081, pal: PALETTES.reactor,
    weapons: { early: 'kira', exit: 'mate' },
    sky: { kind: 'dome', stops: [[0, '#0a0503'], [0.45, '#1e0b04'], [0.72, '#59210a'], [0.9, '#9c4413'], [1, '#2a0f06']], stars: false },
    bg: 0x120803, fog: { color: 0x3a1608, density: 0.02 },         // fog naranja
    light: [[0x9a5a2a, 0x1c0c04, 1.6], [0xffc890, 2.0], [0xff7a2a, 0xffd166, 110, 60]],
    set: setReactor },
  { id: 4, name: 'CRIPTA', subtitle: 'arte anterior a la inteligencia. o a la mía',
    waves: 5, seed: 4242, pal: PALETTES.cripta, trimK: 2.4, // filo de muros más HDR (ambiental casi muerta)
    weapons: { early: 'chango', exit: 'riel' },
    sky: { kind: 'void', stops: [[0, '#020107'], [0.55, '#0a0618'], [0.85, '#160c2e'], [1, '#070410']], stars: false },
    bg: 0x060309, fog: { color: 0x160c2e, density: 0.028 },        // casi a ciegas
    light: [[0x3a2c58, 0x070410, 0.55], [0x9a7ad0, 0.5], [0xaa5cff, 0x5450ff, 130, 90]], // ambient al piso: los emisivos cargan la escena
    set: setCripta },
  { id: 5, name: 'NÚCLEO: MORIS-9', subtitle: 'todo ascensor termina donde empezó todo',
    waves: 1, seed: 777, pal: PALETTES.nucleo, seamK: 2.2, // grilla cian tipo Tron (junta del piso al doble)
    weapons: { mid: 'compilador' },                           // "N5 medio: tras las oleadas, te lo da MORIS"
    sky: { kind: 'void', code: true },                             // vacío negro con código cian
    bg: 0x000205, fog: { color: 0x03141f, density: 0.013 },        // niebla cian fina
    light: [[0x14344a, 0x02060a, 1.0], [0x88d0ff, 1.3], [0x2ad4ff, 0x1150ff, 120, 70]],
    set: setNucleo },
];
// waves globales acumuladas antes del nivel i (para el número global de game.wave): [0,3,7,11,16]
const waveBaseFor = i => LEVELS.slice(0, i).reduce((s, l) => s + l.waves, 0);
const levelDef = () => LEVELS[game.level - 1];
const diffMult = () => 1 + 0.25 * (game.level - 1); // recalibración de dificultad por sector

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

// Piso (E5 parametrizado por paleta): paneles metálicos sci-fi — placa con bisel,
// remaches, junta emisiva en la costura (pal.seam; en N5 sube de brillo: grilla Tron),
// ranura de ventilación, código de barras y ruido sutil. 1 tile = 4 m.
function makeFloorTex(pal, seamK = 1) {
  return canvasTex(512, (c, S) => {
    c.fillStyle = pal.floor; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 240; i++) { // rayado vertical tipo chapa
      c.fillStyle = `rgba(${pal.noise},${rand(0.012, 0.04).toFixed(3)})`;
      c.fillRect(rand(0, S), 0, rand(0.6, 2.4), S);
    }
    // costura del tile (biselada, con junta emisiva tenue que al repetir forma la grilla)
    c.strokeStyle = pal.dark; c.lineWidth = 26; c.strokeRect(14, 14, S - 28, S - 28);
    c.strokeStyle = `rgba(${pal.seam},${Math.min(0.9, 0.30 * seamK).toFixed(2)})`; c.lineWidth = 3; c.strokeRect(14, 14, S - 28, S - 28);
    c.strokeStyle = `rgba(${pal.seam},${Math.min(0.4, 0.09 * seamK).toFixed(2)})`; c.lineWidth = 9; c.strokeRect(14, 14, S - 28, S - 28);
    // placa interior con bisel (luz arriba/izq, sombra abajo/der)
    c.fillStyle = pal.lite; c.fillRect(30, 30, S - 60, S - 60);
    c.strokeStyle = pal.floor; c.lineWidth = 5;
    c.beginPath(); c.moveTo(30, 484); c.lineTo(30, 30); c.lineTo(484, 30); c.stroke();
    c.strokeStyle = pal.dark;
    c.beginPath(); c.moveTo(484, 32); c.lineTo(484, 484); c.lineTo(32, 484); c.stroke();
    for (let i = 0; i < 150; i++) { // ruido fino sobre la placa
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
      c.fillRect(rand(34, 476), rand(34, 476), rand(1, 3), 1);
    }
    // sub-panel interior rebajado
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 3; c.strokeRect(150, 150, 212, 212);
    c.strokeStyle = `rgba(${pal.noise},0.05)`; c.lineWidth = 1; c.strokeRect(153, 153, 206, 206);
    [58, 454].forEach(x => [58, 454].forEach(y => rivet(c, x, y)));
    // ranura de ventilación
    c.fillStyle = pal.dark; rr(c, 330, 340, 128, 40, 8); c.fill();
    c.strokeStyle = `rgba(${pal.noise},0.08)`; c.lineWidth = 1; rr(c, 330, 340, 128, 40, 8); c.stroke();
    c.fillStyle = pal.lite;
    for (let i = 0; i < 5; i++) c.fillRect(338, 346 + i * 7, 112, 2);
    // código de barras + marcas de stencil en el neón del nivel
    let bx = 66;
    while (bx < 170) { const w = rand(1, 3.4); c.fillStyle = `rgba(${pal.noise},${rand(0.07, 0.18).toFixed(2)})`; c.fillRect(bx, 344, w, 34); bx += w + rand(1.5, 4); }
    c.fillStyle = `rgba(${pal.seam},0.28)`; c.fillRect(66, 300, 46, 5); c.fillRect(66, 311, 22, 5);
    c.fillStyle = `rgba(${pal.seam},0.16)`; c.fillRect(404, 96, 5, 30); c.fillRect(415, 96, 5, 18);
    specks(c, S, 220, () => Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)');
  }, 16, 16);
}

// Muros (E5 parametrizado): paneles verticales con rejilla de detalle, franja de
// chevrons de advertición abajo (el color viene de la paleta) y zócalo oscuro.
// 1 tile ≈ 6 × 5 m (repeat 11 × 1).
function makeWallTex(pal) {
  return canvasTex(256, (c, S) => {
    c.fillStyle = pal.wall; c.fillRect(0, 0, S, S);
    // rejilla sutil en toda la cara
    c.strokeStyle = `rgba(${pal.wallLite},0.035)`; c.lineWidth = 1;
    c.beginPath();
    for (let x = 16; x < S; x += 16) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, S); }
    for (let y = 16; y < S; y += 16) { c.moveTo(0, y + 0.5); c.lineTo(S, y + 0.5); }
    c.stroke();
    // juntas verticales de panel (cada 64 px = ~1.5 m) con filo iluminado
    [0, 64, 128, 192].forEach(x => {
      c.fillStyle = pal.dark; c.fillRect(x - 2, 0, 5, S);
      c.fillStyle = `rgba(${pal.wallLite},0.10)`; c.fillRect(x + 3, 0, 1, S);
    });
    // pernos a media altura
    [32, 96, 160, 224].forEach(x => rivet(c, x, 108, 3));
    // sombra del borde superior
    const g = c.createLinearGradient(0, 0, 0, 68);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, 68);
    // ---- franja de chevrons (paso 32 → envuelve sin costura) ----
    const BY = S - 88, BH = 54;
    c.save();
    c.beginPath(); c.rect(0, BY, S, BH); c.clip();
    c.fillStyle = pal.chevronBack; c.fillRect(0, BY, S, BH);
    c.lineCap = 'square';
    for (let x = -S; x < S * 2; x += 32) {
      c.strokeStyle = pal.chevron; c.lineWidth = 15;
      c.beginPath(); c.moveTo(x, BY + BH + 20); c.lineTo(x + BH + 40, BY - 20); c.stroke();
      c.strokeStyle = pal.chevronLite; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x, BY + BH + 20); c.lineTo(x + BH + 40, BY - 20); c.stroke();
    }
    c.restore();
    c.fillStyle = pal.dark; c.fillRect(0, BY - 5, S, 5); c.fillRect(0, BY + BH, S, 4);
    c.fillStyle = pal.chevronLite; c.fillRect(0, BY - 8, S, 2);
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
    specks(c, S, 160, () => Math.random() < 0.6 ? 'rgba(0,0,0,0.10)' : `rgba(${pal.wallLite},0.04)`);
  }, 11, 1);
}

// Obstáculos (E5 parametrizado): metal cepillado con bordes achaflanados gastados y
// esquinas desportilladas (el desgaste vive en los bordes del UV de cada cara).
function makeObTex(pal) {
  return canvasTex(256, (c, S) => {
    c.fillStyle = pal.ob; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 340; i++) { // cepillado horizontal
      c.fillStyle = Math.random() < 0.55
        ? `rgba(${pal.obLite},${rand(0.015, 0.055).toFixed(3)})`
        : `rgba(0,0,0,${rand(0.02, 0.06).toFixed(3)})`;
      c.fillRect(0, rand(0, S), S, rand(0.6, 2));
    }
    // bisel de aristas: gradientes interior + hilo brillante del chaflán
    const gl = [c.createLinearGradient(0, 0, 0, 26), c.createLinearGradient(0, S - 26, 0, S),
                c.createLinearGradient(0, 0, 26, 0), c.createLinearGradient(S - 26, 0, S, 0)];
    const fills = [`rgba(${pal.obLite},0.10)`, 'rgba(0,0,0,0.38)', `rgba(${pal.noise},0.06)`, 'rgba(0,0,0,0.20)'];
    gl[0].addColorStop(0, fills[0]); gl[0].addColorStop(1, 'rgba(0,0,0,0)');
    gl[1].addColorStop(0, 'rgba(0,0,0,0)'); gl[1].addColorStop(1, fills[1]);
    gl[2].addColorStop(0, fills[2]); gl[2].addColorStop(1, 'rgba(0,0,0,0)');
    gl[3].addColorStop(0, 'rgba(0,0,0,0)'); gl[3].addColorStop(1, fills[3]);
    c.fillStyle = gl[0]; c.fillRect(0, 0, S, 26);
    c.fillStyle = gl[1]; c.fillRect(0, S - 26, S, 26);
    c.fillStyle = gl[2]; c.fillRect(0, 0, 26, S);
    c.fillStyle = gl[3]; c.fillRect(S - 26, 0, 26, S);
    c.strokeStyle = `rgba(${pal.obLite},0.30)`; c.lineWidth = 1; c.strokeRect(0.5, 0.5, S - 1, S - 1);
    // desgaste de esquinas: manchas claras + picaduras oscuras + rasguños radiales
    [[14, 14, 1, 1], [S - 14, 14, -1, 1], [14, S - 14, 1, -1], [S - 14, S - 14, -1, -1]].forEach(([cx, cy, sx, sy]) => {
      for (let i = 0; i < 24; i++) {
        c.fillStyle = `rgba(${pal.obLite},${rand(0.05, 0.24).toFixed(2)})`;
        c.beginPath(); c.ellipse(cx + sx * rand(0, 32), cy + sy * rand(0, 32), rand(0.5, 2.6), rand(0.5, 2.2), rand(0, 3.14), 0, 7); c.fill();
      }
      for (let i = 0; i < 10; i++) {
        c.fillStyle = `rgba(8,12,22,${rand(0.15, 0.38).toFixed(2)})`;
        c.beginPath(); c.arc(cx + sx * rand(0, 28), cy + sy * rand(0, 28), rand(0.4, 1.8), 0, 7); c.fill();
      }
      for (let i = 0; i < 5; i++) {
        c.strokeStyle = `rgba(${pal.obLite},${rand(0.06, 0.16).toFixed(2)})`; c.lineWidth = rand(0.5, 1.2);
        const a = rand(0.6, 2.2);
        c.beginPath(); c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * sx * rand(10, 36), cy + Math.sin(a) * sy * rand(10, 36)); c.stroke();
      }
      rivet(c, cx + sx * 8, cy + sy * 8, 3);
    });
    // marca de plantilla central en el neón del nivel
    c.fillStyle = `rgba(${pal.seam},0.16)`; c.fillRect(104, 116, 48, 8); c.fillRect(104, 130, 26, 8);
    let bx = 158; while (bx < 186) { const w = rand(1, 2.6); c.fillStyle = `rgba(${pal.noise},${rand(0.08, 0.16).toFixed(2)})`; c.fillRect(bx, 116, w, 22); bx += w + rand(1.5, 3); }
    specks(c, S, 180, () => Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.09)');
  }, 2, 2);
}

// rim lights: crecen ACÁ (el rig lo configura configureLights por paleta), decay 2,
// sin sombras. Altos y sobre la altura de muros: bañan de color los bordes sin quemar.
sun = new THREE.DirectionalLight(0xbfd8ff, 2.6);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 90;
scene.add(sun);
rimCyan = new THREE.PointLight(0x2ad4ff, 95, 0, 2);
rimCyan.castShadow = false;
rimCyan.position.set(-ARENA + 6, 12, -ARENA + 6);
rimMagenta = new THREE.PointLight(0xff3bd8, 80, 0, 2);
rimMagenta.castShadow = false;
rimMagenta.position.set(ARENA - 6, 12, ARENA - 6);
scene.add(rimCyan, rimMagenta);

/* ============================================================ banded fog (E1)
   Profundidad por pasos estilo Doom/Boltgun: en vez del gradiente suave de FogExp2,
   el factor de niebla del material se cuantiza a FOG_BANDS bandas. onBeforeCompile
   reemplaza el chunk fog_fragment por la misma fórmula de three r160 (sigue usando
   los uniforms fogColor/fogDensity que provienen de scene.fog: la atmósfera y el
   color NO cambian — y en E5, scene.fog se retoca POR NIVEL en buildArena).
   E5: ya no se aplica con un scene.traverse de módulo — buildArena parcha el mundo
   recién construido al final (cielo+estrellas viven con fog:false y se saltan).
   Arma, FX, pickups y enemigos sprite (E2) NO se parchan. Ojo r160: el cache de
   programas NO distingue materiales por su onBeforeCompile, así que
   customProgramCacheKey aísla esta variante de cualquier material sin parchar que
   comparta defines. */
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

/* ============================================================ E5 — sets de geometría por nivel
   Cada nivel suma SUS props sobre la base común (piso/muros/pilones que arma buildArena).
   Presupuesto: ≤40 props, geometría/material COMPARTIDO por tipo (patrón E2/E3), y todo
   recurso del nivel pasa por ownRes() → lo libera el dispose del rebuild. */
const ownRes = r => (levelRes.push(r), r);

// arte de props billboard (cache PERSISTENTE entre niveles: el tex/geo compartido NO
// se registra en levelRes — los materiales por nivel sí)
const PROP_ART = {};
function propSprite(kind) {
  if (!PROP_ART[kind]) {
    const art = makePropSprite(kind);
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    PROP_ART[kind] = { tex, geo: new THREE.PlaneGeometry(art.cellW / art.cellH, 1) };
  }
  return PROP_ART[kind];
}

// N1 — pasillo-losa gris+cian: crio-cápsulas como pilares (base metálica + cristal
// emisivo) y una lámpara que titila (hangar roto).
function setCriopods(def, obMat) {
  const baseGeo = ownRes(new THREE.BoxGeometry(1.7, 1.1, 2.7));
  const glassGeo = ownRes(new THREE.BoxGeometry(1.1, 2.1, 1.9));
  const capMat = ownRes(new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.5, metalness: 0.6 }));
  const glassMat = ownRes(new THREE.MeshStandardMaterial({
    color: 0x0a1420, emissive: 0x54f0ff, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.2,
    transparent: true, opacity: 0.85 }));
  for (let i = 0; i < 9; i++) {
    const x = -21 + (i % 3) * 21 + rand(-2, 2), z = -13 + ((i / 3) | 0) * 13 + rand(-2, 2);
    if (Math.abs(x) < 9 && z > 16) continue; // pasillo del spawn libre
    const base = new THREE.Mesh(baseGeo, capMat);
    base.position.set(x, 0.55, z); base.rotation.y = rand(-0.2, 0.2);
    addSolid(base);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(x, 2.2, z); glass.rotation.y = base.rotation.y;
    addSolid(glass); // el cristal también frena balas
  }
  const fl = new THREE.PointLight(0xdff0ff, 26, 30, 2);
  fl.position.set(2, 6, -4);
  world.add(fl);
  let flick = 1;
  levelFx.push((dt) => { // lámpara titilante: picos de corte cada tanto, retorno suave
    if (Math.random() < dt * 2.2) flick = 0.15 + Math.random() * 0.85;
    fl.intensity += (26 * flick - fl.intensity) * Math.min(1, dt * 14);
  });
}

// N2 — invernadero: enredaderas billboard (makePropSprite 'vine') + charcos magenta
// emisivos pegados al piso (decals a 0.02 m: sin z-fighting).
function setInvernadero() {
  const A = propSprite('vine');
  const mat = ownRes(new THREE.MeshBasicMaterial({ map: A.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  let n = 0;
  for (let i = 0; i < 24 && n < 22; i++, n++) {
    let x, z;
    if (i % 3 === 0) { // hileras contra los muros norte/sur
      x = -26 + i * 2.4 + rand(-1, 1);
      z = (i % 6 === 0 ? -1 : 1) * (ARENA - 2 - rand(0, 1.5));
    } else { x = rand(-ARENA + 3, ARENA - 3); z = rand(-ARENA + 3, ARENA - 3); }
    if (Math.abs(x) < 8 && z > 17) continue;          // spawn
    if (Math.abs(x) < 11 && z < -ARENA + 15) { i--; continue; } // antesala
    const v = new THREE.Mesh(A.geo, mat);
    const s = rand(0.8, 1.7);
    v.scale.setScalar(s);
    v.position.set(x, s / 2, z);
    v.rotation.y = rand(-0.5, 0.5);
    world.add(v);
  }
  const pudMat = ownRes(new THREE.MeshBasicMaterial({ color: neon(0xff3bd8, 1.5), transparent: true, opacity: 0.85, depthWrite: false }));
  const pudGeo = ownRes(new THREE.CircleGeometry(1, 10));
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(pudGeo, pudMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(rand(-24, 24), 0.02, rand(-22, 20));
    const s = rand(1.4, 3.2);
    p.scale.set(s, s, 1);
    world.add(p);
  }
}

// N3 — reactor: lagunas de "lava" emisivas con UV-scroll entre pasarelas metálicas +
// chispas ambientales (Points propio, lento, NO el pool de combate). OJO: el daño por
// pisar naranja queda para E6/E8 — acá la lava es visual.
function setReactor(def, obMat) {
  const lavaTex = canvasTex(256, (c, S) => {
    c.fillStyle = '#7c2a07'; c.fillRect(0, 0, S, S);
    const veins = ['#3f1403', '#b34a10', '#ff7a2a', '#ffc36b', '#2a0c02'];
    for (let i = 0; i < 30; i++) {
      c.fillStyle = veins[i % 5];
      c.globalAlpha = 0.28 + Math.random() * 0.5;
      c.fillRect(0, rand(0, S), S, rand(2, 9));
    }
    c.globalAlpha = 1;
  }, 3, 6);
  const lavaMat = ownRes(new THREE.MeshBasicMaterial({ map: lavaTex, color: neon(0xff7a2a, 1.15) }));
  const lavaGeo = ownRes(new THREE.PlaneGeometry(11, 54));
  [-19, 0.5, 19.5].forEach(x => {
    const p = new THREE.Mesh(lavaGeo, lavaMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.05, 0);
    world.add(p);
  });
  levelFx.push(dt => { lavaTex.offset.y -= dt * 0.05; }); // magma reptando (UV scroll)
  const walkGeo = ownRes(new THREE.BoxGeometry(10.5, 0.9, 6)); // pasarelas sobre la lava
  [[-19, -16], [-19, 14], [0.5, -2], [19.5, -18], [19.5, 10]].forEach(([x, z]) => {
    const w = new THREE.Mesh(walkGeo, obMat);
    w.position.set(x, 0.45, z);
    addSolid(w);
  });
  const N = 90;
  const geo = ownRes(new THREE.BufferGeometry());
  const pos = new Float32Array(N * 3);
  const vy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = [-19, 0.5, 19.5][i % 3] + rand(-5, 5);
    pos[i * 3 + 1] = rand(0, 6);
    pos[i * 3 + 2] = rand(-26, 26);
    vy[i] = rand(0.4, 1.6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = ownRes(new THREE.PointsMaterial({ color: neon(0xffb057, 1.8), size: 0.16,
    transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pts = new THREE.Points(geo, mat);
  world.add(pts);
  levelFx.push(dt => {
    const a = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) + vy[i] * dt;
      if (y > 6.5) y = 0.05;
      a.setY(i, y);
    }
    a.needsUpdate = true;
  });
}

// N4 — cripta: columnas de piedra low-poly + estatuas billboard ('statue') + brasas
// violetas. La ambiental va al piso (config de luces) y ESTOS emisivos cargan el mapa.
function setCripta() {
  const stoneMat = ownRes(new THREE.MeshStandardMaterial({ color: 0x241f36, roughness: 0.9, metalness: 0.1 }));
  const colGeo = ownRes(new THREE.CylinderGeometry(0.7, 0.85, 6, 6));
  const capGeo = ownRes(new THREE.BoxGeometry(2.1, 0.5, 2.1));
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.283 + 0.39;
    const x = Math.cos(a) * 13.5, z = Math.sin(a) * 13.5;
    const c = new THREE.Mesh(colGeo, stoneMat);
    c.position.set(x, 3, z);
    addSolid(c);
    const cap = new THREE.Mesh(capGeo, stoneMat);
    cap.position.set(x, 6.2, z);
    addSolid(cap, false);
  }
  const A = propSprite('statue');
  const mat = ownRes(new THREE.MeshBasicMaterial({ map: A.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  [[-8, -6], [8, -6], [-8, 6], [8, 6], [-21, 0], [21, 0]].forEach(([x, z]) => {
    const st = new THREE.Mesh(A.geo, mat);
    st.scale.setScalar(3.6); // el geo cache mide 1 m de alto
    st.position.set(x, 1.8, z);
    st.rotation.y = Math.atan2(-x, -z); // mirando al centro del templo
    world.add(st);
  });
  const flGeo = ownRes(new THREE.BoxGeometry(0.7, 1.5, 0.7));
  [[-13, -13], [13, -13], [-13, 13], [13, 13]].forEach(([x, z]) => {
    const fl = new THREE.Mesh(flGeo, ownRes(new THREE.MeshBasicMaterial({ color: neon(0xaa5cff, 2.6) })));
    fl.position.set(x, 0.75, z);
    world.add(fl);
    const pl = new THREE.PointLight(0xaa5cff, 26, 20, 2);
    pl.position.set(x, 2.2, z);
    world.add(pl);
    levelFx.push((dt, t) => { pl.intensity = 26 + Math.sin(t * 5.3 + x) * 7; }); // brasa oscilante
  });
}

// N5 — núcleo: cubos flotantes que rotan (props animados por levelFx) sobre la losa
// Tron; el cielo "código" lo arma buildSky (def.sky.code).
function setNucleo() {
  const cubeMat = ownRes(new THREE.MeshStandardMaterial({
    color: 0x071426, emissive: 0x1899cc, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.7 }));
  const cubes = [];
  for (let i = 0; i < 12; i++) {
    const s = rand(1.2, 2.8);
    const m = new THREE.Mesh(ownRes(new THREE.BoxGeometry(s, s, s)), cubeMat);
    m.position.set(rand(-25, 25), rand(3.5, 9), rand(-25, 20));
    m.castShadow = false;
    world.add(m);
    cubes.push({ m, spin: rand(0.15, 0.5) * (Math.random() < 0.5 ? -1 : 1), bob: rand(0, 6.28), y0: m.position.y });
  }
  levelFx.push((dt, t) => {
    for (const c of cubes) {
      c.m.rotation.y += c.spin * dt;
      c.m.rotation.x += c.spin * 0.35 * dt;
      c.m.position.y = c.y0 + Math.sin(t * 0.7 + c.bob) * 0.5;
    }
  });
}

// layout de cajas procedural CON SEMILLA (el del arena madre, ahora por nivel):
// rejilla 5×5 con jitter; libre el pasillo del spawn (sur) y la antesala del portal (norte)
function makeLayout(rng, n) {
  const out = [];
  for (let tries = 0; tries < n * 8 && out.length < n; tries++) {
    const gx = ((rng() * 5) | 0) * 12 - 24, gz = ((rng() * 5) | 0) * 12 - 24;
    const x = gx + (rng() * 6 - 3), z = gz + (rng() * 6 - 3);
    const w = 2.5 + rng() * 5, d = 2.5 + rng() * 5, h = 1.6 + rng() * 4.4;
    if (Math.abs(x) + w / 2 < 9 && z > 17) continue;
    if (Math.abs(x) + w / 2 < 11 && z < -ARENA + 15) continue;
    if (out.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 2 && Math.abs(o.z - z) < (o.d + d) / 2 + 2)) continue;
    out.push({ x, z, w, h, d });
  }
  return out;
}

// antesala del portal (norte): dos pilares haciendo de puertas + guía emisiva al piso
function buildAntechamber(def, obMat) {
  const g = ownRes(new THREE.BoxGeometry(2.2, WALL_H + 1, 2.2));
  [[-7, -ARENA + 6], [7, -ARENA + 6]].forEach(([x, z]) => {
    const p = new THREE.Mesh(g, obMat);
    p.position.set(x, (WALL_H + 1) / 2, z);
    addSolid(p);
  });
  const strip = new THREE.Mesh(ownRes(new THREE.BoxGeometry(12, 0.12, 0.5)),
    ownRes(new THREE.MeshBasicMaterial({ color: neon(def.pal.neon, 2.2) })));
  strip.position.set(0, 0.03, -ARENA + 3);
  world.add(strip);
}

// destructor del nivel anterior: libera TODO lo registrado (geos, mats, texturas, PMREM).
// Los caches compartidos (starMat, PROP_ART, arte de enemigos/pickups/viewmodel) NO están
// en levelRes: sobreviven al rebuild a propósito, como en E2/E3.
function disposeWorld() {
  for (const r of levelRes) { try { r.dispose(); } catch (e) { /* ya liberado */ } }
  levelRes = [];
  levelFx = [];
  portalMesh = null;
  world.clear(); // los meshes/luces del nivel salen de la escena (FX y viewmodel no viven acá)
  solids.length = 0;
  boxes.length = 0;
}

// EL constructor de mapa: se llama en cada arranque de nivel (y en el boot). Con
// disposeWorld() primero, la escena se regenera sin leak entre sectores.
function buildArena(def) {
  disposeWorld();
  const pal = def.pal;
  scene.background = new THREE.Color(def.bg);
  scene.fog.color.set(def.fog.color);
  scene.fog.density = def.fog.density;
  configureLights(def);
  buildSky(def);

  const floorMat = ownRes(new THREE.MeshStandardMaterial({ map: makeFloorTex(pal, def.seamK || 1), roughness: 0.7, metalness: 0.32, envMapIntensity: 0.35 }));
  const floor = new THREE.Mesh(ownRes(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  world.add(floor);

  const wallMat = ownRes(new THREE.MeshStandardMaterial({ map: makeWallTex(pal), roughness: 0.8, metalness: 0.35, envMapIntensity: 0.3 }));
  const trimMat = ownRes(new THREE.MeshBasicMaterial({ color: neon(pal.neon, def.trimK || 1.55) })); // N4 sube trimK: filo más HDR con la ambiental muerta
  const wallGeo = ownRes(new THREE.BoxGeometry(1, WALL_H, 1)); // caja unitaria escalada: 1 geo para los 4 muros
  [[0, -ARENA - 0.5, ARENA * 2 + 2, 1], [0, ARENA + 0.5, ARENA * 2 + 2, 1],
   [-ARENA - 0.5, 0, 1, ARENA * 2 + 2], [ARENA + 0.5, 0, 1, ARENA * 2 + 2]].forEach(([x, z, w, d]) => {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.scale.set(w, 1, d);
    wall.position.set(x, WALL_H / 2, z);
    addSolid(wall, false); // colisión con límites se hace por clamp (setFromObject respeta el scale)
    const trim = new THREE.Mesh(wallGeo, trimMat);
    trim.scale.set(w * 0.995, 0.07, d * 0.995);
    trim.position.set(x, WALL_H - 0.35, z);
    world.add(trim);
  });

  const rng = mulberry32(def.seed);
  const obMat = ownRes(new THREE.MeshStandardMaterial({ map: makeObTex(pal), roughness: 0.55, metalness: 0.45, envMapIntensity: 0.55 }));
  makeLayout(rng, 12).forEach(({ x, z, w, h, d }, i) => {
    const b = new THREE.Mesh(ownRes(new THREE.BoxGeometry(w, h, d)), obMat);
    b.position.set(x, h / 2, z);
    addSolid(b);
    if (i % 3 === 0) { // franja neón HDR encima de algunos bloques: canal oscuro + núcleo bloom
      const ch = new THREE.Mesh(ownRes(new THREE.BoxGeometry(w * 0.88, 0.1, d * 0.88)),
        ownRes(new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.4, metalness: 0.6 })));
      ch.position.set(x, h - 0.01, z);
      addSolid(ch, false);
      const glow = new THREE.Mesh(ownRes(new THREE.BoxGeometry(w * 0.8, 0.06, d * 0.8)),
        ownRes(new THREE.MeshBasicMaterial({ color: neon(i % 2 ? 0xff4d5e : pal.neon, 2.1) })));
      glow.position.set(x, h + 0.05, z);
      world.add(glow);
    }
  });

  const pylonGeo = ownRes(new THREE.CylinderGeometry(0.25, 0.35, WALL_H + 1.5, 8));
  const bulbGeo = ownRes(new THREE.SphereGeometry(0.42, 12, 12));
  const bulbMat = ownRes(new THREE.MeshBasicMaterial({ color: neon(pal.neon, 2.1) }));
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const p = new THREE.Mesh(pylonGeo, obMat);
    p.position.set(sx * (ARENA - 2), (WALL_H + 1.5) / 2, sz * (ARENA - 2));
    addSolid(p);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(sx * (ARENA - 2), WALL_H + 1.7, sz * (ARENA - 2));
    world.add(bulb);
    const pl = new THREE.PointLight(pal.neon, 30, 26, 2);
    pl.position.copy(bulb.position);
    world.add(pl);
  });

  def.set(def, obMat, rng); // props característicos del sector (≤40)
  buildAntechamber(def, obMat);

  world.traverse(o => { // banded fog del E1 sobre TODO el entorno recién construido
    if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => bandedFog(m));
  });
}

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
/* ============================================================ E4a/E4b — tabla de armas (10/10)
   UNA FILA POR ARMA = spec de balance (DESIGN_ARSENAL.md). Tipos de disparo:
     melee      → ray corto sin mag ni pool, empujón (fists SIEMPRE andá: fallback Doom)
     hitscan    → un rayo con W.dmg (refactor del rifle de siempre: el id "rifle" ES la
                  vecinal — alias interno para no romper HUD/pools/mags de E3)
     shotgun    → W.pellets hitscan con dirección rotada en cono W.spread (cono TOTAL)
     twin       → escopeta doble (changó): UN clic dispara W.bullets cañones. El primero
                  consume W.ammoCost cartuchos DEL POOL y dispara; el segundo sale a los
                  W.burst s SOLO si queda pool (consumo sobre la marcha: el último cartucho
                  no se hipoteca). magSize 0 = sin cargador, el pool va directo a la vista
     flow       → dispara ticks de W.tick mientras firing y pool>0, consumiendo
                  W.flowRate células/s DEL POOL (sin cargador, sin tryReload)
     projectile → proyectil con pooling (W.projVel m/s, sale bajo los ojos). Con splash>0
                  es el cohete de Kira: bola de fuego con decaimiento lineal y auto-daño
                  al jugador <3 m. Con splash:0 es la célula de Mate: W.dmg DIRECTO al
                  enemigo que toca y pop contra muro/caja/suelo (sin área). Con orb:true
                  es el orbe del Compilador (pool propio): detona al impactar enemigo o
                  geometría, o a los W.life s → BFG_DMG a TODO enemigo a <BFG_RADIUS m,
                  screen shake y enemigos "scorched" (ver updateOrbs/bfgBlast)
     rail       → gatillo de carga (riel): mantener W.chargeT s el gatillo (el anillo DOM
                  #railring del crosshair se llena) y AL SOLTAR sale un hitscan PERFORANTE
                  de W.dmg a TODOS los enemigos del rayo (lista completa de
                  intersectObjects, cortada por la primera pared). Consume W.ammoCost (5)
                  células al soltar: si el pool no llega, no carga (click seco + hint).
                  W.cad = cooldown DESPUÉS del disparo. El riel no quema ni scorcha
   Campos: slot (teclas 1..0 = slot 0..9), cross (clase del crosshair DOM, por arma),
   shortName (abreviatura limpia de la slot bar — ≤4 letras, nada de "VECI" a medias),
   ammo (pool o null=infinito), magSize (0 = sin cargador: flow/twin/rail/orbe consumen el
   pool directo), dmg/cad (segundos entre disparos), pellets/spread (shotgun y twin),
   bullets/burst/ammoCost (twin; ammoCost también riel), chargeT (rail), projVel/splash/
   life/orb (proyectil), heatMax (ráfagas seguidas antes del bloqueo), kick (retroceso del
   viewmodel, m) / recoil (patada de cámara, rad), sfx (método de Sfx del disparo),
   silhouette y accent para el viewmodel pixelado (sprites.js:makeWeaponSprite). */
const WEAPONS = {
  fists:  { slot: 0, name: 'PUÑOS',          shortName: 'PUÑO', cross: 'melee',   ammo: null,      magSize: 0,  dmg: 30, cad: 0.5,
            type: 'melee',      range: 2.4, knock: 1.15, kick: 0.10, recoil: 0.006, sfx: 'shootFist',
            silhouette: 'fists' },
  rifle:  { slot: 1, name: 'VECINAL',        shortName: 'VEC',  cross: 'pistol',  ammo: 'balas',   magSize: 30, dmg: 22, cad: 0.22,
            type: 'hitscan',    spread: 0.006, kick: 0.05, recoil: 0.012, sfx: 'shootVecinal',
            silhouette: 'pistol',  accent: '#54f0ff' },
  moris12:{ slot: 2, name: 'MORIS-12',       shortName: 'M12',  cross: 'shotgun', ammo: 'cartuchos', magSize: 6, dmg: 8, cad: 0.85, pellets: 8,
            type: 'shotgun',    spread: 0.157 /* cono total ~9° */, kick: 0.11, recoil: 0.045, sfx: 'shootShotgun',
            silhouette: 'shotgun', accent: '#ffb057' },
  ametralladora: { slot: 3, name: 'AMETRALLADORA', shortName: 'AMET', cross: 'smg', ammo: 'balas', magSize: 60, dmg: 15, cad: 0.09,
            type: 'hitscan',    spread: 0.016, heatSpread: 0.014, heatMax: 40, /* 40 seguidas → bloqueo 1.2 s */
            kick: 0.035, recoil: 0.008, sfx: 'shootSmg',
            silhouette: 'smg',   accent: '#b6ff5e' },
  asador: { slot: 4, name: 'ASADOR',         shortName: 'ASAN', cross: 'flamer',  ammo: 'celulas', magSize: 0,  dmg: 9,  cad: 0,
            type: 'flow',       tick: 0.1, flowRate: 2, cone: 0.349 /* ±10° (20° total) */, range: 7,
            burnT: 4, burnDps: 2.25, kick: 0.02, recoil: 0, sfx: 'flame',
            silhouette: 'flamer', accent: '#ff5e3a' },
  kira:   { slot: 5, name: 'KIRA',           shortName: 'KIRA', cross: 'rocket',  ammo: 'cohetes', magSize: 4,  dmg: 95, cad: 1.1,
            type: 'projectile', projVel: 20, splash: 3, spread: 0.01, kick: 0.12, recoil: 0.05, sfx: 'rocketFire',
            silhouette: 'rocket', accent: '#ff2d55' },
  // ---- E4b (slots 6-9; siluetas 'plasma'/'twin'/'rail'/'orb' en sprites.js). OJOS E5:
  //  · MATE y ASADOR comiven el pool 'celulas' (decisión E4b, el riesgo que E4a anotó:
  //    pool compartido como la energía del plasma Doom — el riel cobra 5 células de ahí).
  //    La goma son los drops ammoCelulas y las cajas de arena (spawnWavePickups n≥4).
  //  · CHANGÓ comparte 'cartuchos' con MORIS-12 (dos escopetas, un solo lenguaje Doom).
  //  · COMPILADOR: 10 argents por orbe y cap 20 → el arma vive "a dos orbes"; la caja
  //    ammoArgents (+2) es escasa a propósito y el drop normal NO suelta argents.
  mate:   { slot: 6, name: 'MATE',           shortName: 'PLAS', cross: 'plasma',  ammo: 'celulas', magSize: 40, dmg: 30, cad: 0.16,
            type: 'projectile', projVel: 28, splash: 0 /* daño directo en el impacto, sin splash */, spread: 0.008,
            kick: 0.04, recoil: 0.008, sfx: 'shootPlasma',
            silhouette: 'plasma', accent: '#5ee6ff' },
  chango: { slot: 7, name: 'CHANGÓ',         shortName: 'DBLE', cross: 'twin',    ammo: 'cartuchos', magSize: 0 /* dos cañones al pool: sin recarga */, dmg: 10, cad: 1.2, pellets: 14,
            type: 'twin',       bullets: 2, ammoCost: 1, burst: 0.25, spread: 0.157 /* mismo cono del MORIS-12: la furia va en 14×10 */,
            kick: 0.13, recoil: 0.05, sfx: 'shootTwin',
            silhouette: 'twin',  accent: '#ffb057' },
  riel:   { slot: 8, name: 'RIEL',           shortName: 'RIEL', cross: 'rail',    ammo: 'celulas', magSize: 0 /* 5 células por disparo, directo al pool */, dmg: 160, cad: 1.4,
            type: 'rail',       chargeT: 0.35, ammoCost: 5,
            kick: 0.09, recoil: 0.03, sfx: 'railFire',
            silhouette: 'rail',  accent: '#b6ff5e' },
  compilador: { slot: 9, name: 'COMPILADOR', shortName: 'BFG',  cross: 'bfg',     ammo: 'argents', magSize: 0 /* 10 argents por orbe: el pool manda */, dmg: 300, cad: 2.0,
            type: 'projectile', orb: true, ammoCost: 10 /* 10 argents por orbe */, projVel: 12, life: 3 /* orbe: 12 m/s, detona al impactar o a los 3 s */,
            kick: 0.10, recoil: 0.04, sfx: 'bfgFire',
            silhouette: 'orb',   accent: '#6dff5e' },
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
// las llena con el pickup de arma). El pickup de arma (spawnWeaponPickup, E4b) llama
// unlockWeapon(id) y suma START_AMMO del pool.
const START_OWNED = ['fists', 'rifle']; // arranque fijo (E5 mueve el desbloqueo al pickup)
// E4b — puerta trasera de QA: ?weapons=all arranca con el arsenal completo + ammo inicial
// por pool para testear los 10 slots HOY. No reemplaza a E5: solo siembra startResources;
// los pickups de arma del piso siguen usando START_AMMO al pisarse.
const ALL_WEAPONS = new URLSearchParams(location.search).get('weapons') === 'all';
// Munición que trae un pickup de arma al pisarse (spec E4b: cartuchos 24, células 40,
// argents 10). balas/cohetes las completa E4b para que ningún pickup llegue pelado a E5.
const START_AMMO = { balas: 40, cartuchos: 24, celulas: 40, cohetes: 3, argents: 10 };
const startResources = () => ({
  hp: 100, armor: 0,
  owned: new Set(ALL_WEAPONS ? Object.keys(WEAPONS) : START_OWNED),
  mags: Object.fromEntries((ALL_WEAPONS ? Object.keys(WEAPONS) : START_OWNED)
    .filter(id => WEAPONS[id].magSize > 0)
    .map(id => [id, WEAPONS[id].magSize])),
  weaponId: 'rifle',
  pools: { balas: { n: 120 + (ALL_WEAPONS ? START_AMMO.balas : 0) },
           cartuchos: { n: ALL_WEAPONS ? START_AMMO.cartuchos : 0 },
           celulas: { n: ALL_WEAPONS ? START_AMMO.celulas : 0 },
           cohetes: { n: ALL_WEAPONS ? START_AMMO.cohetes : 0 },
           argents: { n: ALL_WEAPONS ? START_AMMO.argents : 0 } },
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
  chargeT: 0,               // E4b riel: segundos de carga del gatillo (0 = nada en curso)
  twinNext: 0, twinT: 0,    // E4b changó: cañones que faltan del doble + temporizador
  shakeT: 0,                // E4b compilador: screen shake restante (roll/offset de cámara)
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
// QA E4b (polish 4a): baseX/baseY ya no son mágicos fijos — vmFit() los deriva del aspect
// real de vmCam (se llama al arrancar y en cada resize). Los valores acá son solo el
// punto de partida del primer frame (16:9).
const VM = { root: new THREE.Group(), baseX: 0.164, baseY: -0.056, baseZ: -0.34, mesh: null };
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
// QA E4b (polish 4a): 12% más chico (0.34 → 0.30). Con el alto viejo el sprite ocupaba
// ~87% del alto de vmCam y el baseY fijo lo colgaba del centro: a 270p se veía "centrado
// y cortado abajo". vmFit() ancla el cuadro abajo-derecha según el aspect de vmCam.
const VM_VH = 0.30; // alto del viewmodel en unidades de vmCam
function vmFit() { // se llama al arrancar y en resize (vmCam.updateProjectionMatrix dixit)
  const halfH = Math.tan(THREE.MathUtils.degToRad(vmCam.fov / 2)) * Math.abs(VM.baseZ);
  const vw = VM_VH * 96 / 72; // todas las siluetas comparten la grilla lógica 96×72
  VM.baseY = -(halfH - VM_VH / 2) - 0.010; // sentado al borde inferior (sangrado ~3%: roza, no se corta)
  VM.baseX = Math.max(0.08, halfH * vmCam.aspect - vw / 2 + 0.015); // idem contra el borde derecho
}
vmFit();
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
// VERIFICADO E4b (riesgo anotado en E4a): el toggle T hace composer.reset(nuevoTarget),
// y en r160 reset() SOLO re-asigna renderTarget1/2 y read/writeBuffer — la lista `passes`
// no se toca, así que vmPass (insertPass index 1) sobrevive el swap de targets; resize
// re-sizea todos los passes por igual. Además RenderPass.render restituye autoClear al
// salir (fuente en vendor/) → el RenderPass de la escena sigue limpiando el RT cada frame
// y no hay acumulación. Si algo de esto se rompe en una upgrade de three: la arena deja
// de limpiar y el viewmodel desaparece al tocar T — dos síntomas imposibles de pasar por alto.
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
// control: el estado (burn > scorch > normal) y el flash. El color final decae por frame
// (lerp) HACIA el tinte del estado vigente:
//   flash()  → color=2.2 blanco (pisa el tinte un instante, como siempre)
//   update() → decae al tinte del estado: quemado = flash blanco → naranja → naranja
// E4b sumaron un estado más (scorched del compilador) y sigue habiendo UN solo escritor
// de `material.color`: el lerp de update(), que elige TINT_* por prioridad de timers.
const TINT_NORMAL = new THREE.Color(1, 1, 1);
const TINT_BURN   = new THREE.Color(1.5, 0.55, 0.22); // naranja HDR: el bloom lo hace lucir
const TINT_SCORCH = new THREE.Color(0.40, 0.36, 0.42); // E4b "scorched" (compilador): tinte
// E5: el mini-jefe NUNCA vuelve a 1.0 — su "normal" es un HDR suave (1.45) que el bloom
// lee como glow permanente; el anillo del piso completa el aura.
const TINT_BOSS   = new THREE.Color(1.45, 1.45, 1.45);
// oscuro SUB-1 — el sprite se apaga y el bloom lo suelta. A diferencia del quemado no
// hace DoT y el fuego manda: update() elige el tinte por prioridad burn > scorch > normal.

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
  // E5 — boss=true: MINI-JEFE elite sobre un tipo existente (scale ×2.2, hp ×6, aura
  // emisiva anillo en el piso que late, sprite levemente HDR). score ×12. E6 va a
  // reemplazar los tipos por jefes con conducta propia: la firma (type,pos,boss) queda.
  constructor(type, pos, boss = false) {
    this.boss = boss;
    let T = ENEMY_TYPES[type];
    if (boss) T = Object.assign({}, T, { hp: T.hp * 6, scale: T.scale * 2.2, speed: T.speed * 0.85, score: T.score * 12, dmg: Math.round(T.dmg * 1.35) });
    this.type = type; this.T = T;
    const mult = diffMult(); // 1 + 0.25·(nivel-1): todo el mapa sube de dificultad por sector
    this.hp = T.hp * (1 + 0.14 * (game.wave - 1)) * mult;
    this.speed = T.speed * (1 + 0.03 * (game.wave - 1)) * (1 + 0.08 * (game.level - 1)) * rand(0.9, 1.1);
    this.hitCd = 0; this.phase = rand(0, 6.28); this.spawnT = 0;
    this.lastScr = null; // E8-polish(a): última posición en pantalla con el enemigo visible
    this.burnT = 0;      // E4a: segundos de estado QUEMADO (asador); DoT fraccional
    this.burnDps = 0;    // 2.25 lo fija la fila WEAPONS.asador en burn() (única fuente)
    this.scorchT = 0;    // E4b: segundos de tinte oscuro por detonación del compilador

    const A = enemySprite(type);
    this.tex = A.tex.clone();
    this.tex.repeat.set(0.5, 1); // hoja horizontal de 2 frames
    this.spr = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, alphaTest: 0.5, depthWrite: true,
      side: THREE.DoubleSide,
    }));
    if (boss) this.spr.material.color.setScalar(1.45); // aura ALSO tiñe el sprite (HDR suave: glow por bloom)
    this.spr.position.y = 0.1; // el plano cubre local -1.05..1.25 ⊃ hitbox (-0.75..1.15)
    this.g = new THREE.Group();
    this.g.scale.setScalar(0.01);
    this.baseY = (0.95 + T.scale * 0.25) * T.scale;
    this.g.add(this.spr);
    if (boss) { // anillo base: la firma visual del elite (late en update)
      this.aura = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.15, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: neon(T.color, 2.4), transparent: true,
          opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      this.aura.position.y = -this.baseY / T.scale + 0.08; // pispa el suelo real del grupo
      this.g.add(this.aura);
    }

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
  // sprite blanco HDR); en update() decae HACIA el tinte del estado (blanco / quemado /
  // scorched).
  flash() { this.spr.material.color.setScalar(2.2); }
  // E4a — estado quemado (asador): renueva/extends el tinte naranja + DoT burnDps.
  burn(sec, dps) {
    if (this.burnT <= 0) burst(this.g.position, 0xff7f2f, 5, 3.5, 0.6, 1.7); // primera ignición
    this.burnT = Math.max(this.burnT, sec);
    this.burnDps = dps;
  }
  // E4b — estado scorched (detonación del compilador): tinte oscuro persistente SIN DoT.
  // El riel, a propósito, no deja marca: solo el orbe verde fríe el piso.
  scorch(sec) { this.scorchT = Math.max(this.scorchT, sec); }
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
    if (this.boss) Sfx.explosion(); // el elite se apaga con boom, no con el blip normal
    game.score += this.T.score; game.kills++;
    // E8-polish(a): el "+100 DRONER" ya NO sube al killfeed arriba a la derecha — es un
    // popup anclado a la proyección en pantalla del pecho del enemigo (o a su última
    // posición visible si murió de espaldas). El killfeed queda para oleadas/avisos.
    killPopup(`+${this.T.score} ${this.type.toUpperCase()}`,
      this.chest(_popV), this.lastScr, this.T.color);
    rollKillDrop(this.g.position, this.type, this.boss); // E3: drops (el boss garantiza casco)
    burst(this.g.position, this.T.color, this.boss ? 44 : 22, this.boss ? 12 : 9, this.boss ? 2 : 1.2, 1.7);
    popFxLight(this.g.position, this.T.color, this.boss ? 320 : 150, 0.38); // flash momentáneo desde el pool
    this.remove();
    if (this.boss) onBossKilled(this); // E5: abre el portal (guardado por game.portalOpen)
  }
  // punto "pecho" para el popup de score (centro alto del billboard)
  chest(out) { return out.set(this.g.position.x, this.g.position.y + 0.8, this.g.position.z); }
  remove() {
    scene.remove(this.g);
    if (this.aura) { this.aura.geometry.dispose(); this.aura.material.dispose(); } // geo/mat del elite son propios
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
    }
    if (this.scorchT > 0) this.scorchT -= dt; // E4b: el tinte oscuro del compilador se apaga solo
    // tinte: el flash (setScalar 2.2 en flash()) decae HACIA el tinte de estado vigente
    // (E4b: prioridad burn > scorch > normal — un quemado-scorcheado sale naranja mientras
    // hierve y queda oscuro al apagarse el fuego). Sin burn ni scorch esto es idéntico al
    // "decay to 1" del E2: el único escritor del color sigue siendo este lerp.
    this.spr.material.color.lerp(
      this.burnT > 0 ? TINT_BURN : this.scorchT > 0 ? TINT_SCORCH : (this.boss ? TINT_BOSS : TINT_NORMAL),
      Math.min(1, dt * 5));
    if (this.aura) this.aura.scale.setScalar(1 + Math.sin(t * 4 + this.phase) * 0.12); // E5: aura latiendo

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

/* ---- E4b — PICKUP DE ARMA (la entrada que E5 coloca por nivel) ---------------------
   Sin sprite nuevo, como pidió el pedido: el cuadro es makeWeaponSprite — el MISMO arte
   del viewmodel, "reducido" a escala de pickup (0.8 m de alto) en game.js. Viaja en el
   pool `pickups` con campo `weapon` (kind = null): el update de pickups lo hace girar e
   izar MÁS ALTO que las cajas (0.95 m, respiración lenta) y el collect tiene su rama.
   Pisarlo = unlockWeapon(id) (es tuya para siempre) + START_AMMO del pool + toast grande
   "OBTENIDA: X" + fanfarria. Si el arma ya era tuya, degrada a caja de su munición.
   Las oleadas NO la spawnan (E5 la coloca con script); ?weapons=all cubre el QA de hoy. */
const WPNPICK_ART = {};
function spawnWeaponPickup(weaponId, pos) {
  const W = WEAPONS[weaponId];
  if (!W || !W.ammo) return; // fists no se pickupéa (no tiene pool ni silueta con acento)
  if (!WPNPICK_ART[weaponId]) {
    const art = makeWeaponSprite(W.silhouette || 'pistol', W.accent || '#54f0ff', 2);
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const h = 0.8; // escala 0.8: más grande que una caja (0.6), legible de lejos
    WPNPICK_ART[weaponId] = { tex, geo: new THREE.PlaneGeometry(h * art.canvas.width / art.canvas.height, h) };
  }
  const A = WPNPICK_ART[weaponId];
  const tex = A.tex.clone(); // source compartido, como los billboards de enemigo/pickup
  const mesh = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide }));
  const baseY = 0.95; // levitación ALTA: el arma flota por encima de las cajas del piso
  mesh.position.set(pos.x, baseY, pos.z);
  scene.add(mesh);
  pickups.push({ kind: null, weapon: weaponId, mesh, tex, baseY, drop: false, ttl: 0,
                 born: game.time, t: rand(0, 6), phase: rand(0, 6.28), view: -1 });
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

// (b) drops por kill (spec E3 / DESIGN_ARSENAL): 35% nada · 40% pool al gasto ·
// 15% botiquín chico +10 · 10% shard de armadura. BRUTE garantiza y alterna cada 2.
// E4b rebalance (DESIGN_ARSENAL): el 40% de munición reparte balas 50 / cartuchos 20 /
// células 20 y le cede un 10% a la botiquín chico — así cartuchos (changó/MORIS-12) y
// células (asador/mate/riel) son alcanzables SIN el debug ?weapons=all: E5 puede colocar
// armas desde el nivel 1 y la economía de drops ya tiene de dónde responder.
// E5: MINI-JEFE (boss=true) garantiza CASCO (+35, spec DESIGN_ARSENAL), un crate y un
// botiquín — y NUNCA el arma: esa va en la antesala del portal (no te la podés perder).
function rollKillDrop(pos, type, boss = false) {
  if (boss) {
    spawnPickup('armorHelm', pos, 0);
    spawnPickup('ammoGrande', pickupPoint(), 0);
    spawnPickup('medbox', pickupPoint(), 0);
    trimDrops();
    return;
  }
  let kind;
  if (type === 'brute') {
    // BRUTE garantiza y alterna cada 2: crate de BALAS (se mantiene simple, como pide el
    // pedido — no "el pool del arma más usada") o casco de armadura.
    bruteKills++;
    kind = (bruteKills + 1) % 4 < 2 ? 'ammoGrande' : 'armorHelm'; // 1-2 ammo · 3-4 armor…
  } else {
    const r = Math.random();
    if (r < 0.35) return;
    if (r < 0.75) {
      const a = Math.random();
      kind = a < 0.50 ? 'ammoBalas' : a < 0.70 ? 'ammoCartuchos' : a < 0.90 ? 'ammoCelulas' : 'medkitSmall';
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
// un pickup full no se levanta (queda en el piso para más tarde — evita gastar cajas).
// E4b: el pickup de ARMA (weaponId no null) se levanta si el arma falta, o si siendo
// tuya al pool de su munición todavía le cabe algo (degrada a caja de ammo).
function pickupUsable(kind, weaponId) {
  if (weaponId) {
    if (!player.owned.has(weaponId)) return true;
    const poolId = WEAPONS[weaponId].ammo;
    return !!poolId && player.pools[poolId].n < AMMO[poolId].cap;
  }
  const d = PICKUPS[kind];
  if (d.cat === 'hp') return player.hp < player.maxHp;
  if (d.cat === 'armor') return player.armor < player.maxArmor;
  return player.pools[d.ammo].n < AMMO[d.ammo].cap;
}
const PICKUP_FX = { hp: 0x0ee6a0, armor: 0x4da3ff, ammo: 0xffd166 }; // color de partícula

function collectPickup(p) {
  if (p.weapon) {
    // pickup de arma (E4b): para siempre + ammo inicial por pool + aviso grande. Con el
    // arma ya en el bolsillo, el pickup sirve de caja de munición de su tipo.
    const W = WEAPONS[p.weapon];
    const fresh = unlockWeapon(p.weapon); // updateHud/updateTouchSwap + toast corto incl.
    const gained = W.ammo ? addAmmo(W.ammo, START_AMMO[W.ammo] || 0) : 0;
    if (fresh) {
      toast(`OBTENIDA: ${W.name}`, 'weapon big'); // aviso grande (CSS .toast.big)
      Sfx.weaponGet();
      burst(p.mesh.position, 0x5ee6ff, 18, 6, 0.9, 1.9);
    } else {
      if (gained <= 0) return; // paranoia: pickupUsable ya filtra (pool full + owned)
      Sfx.pickupAmmo();
      toast(`+${gained} ${AMMO[W.ammo].label}`, 'ammo');
      burst(p.mesh.position, PICKUP_FX.ammo, 10, 5, 0.7);
    }
    scene.remove(p.mesh); p.tex.dispose();
    const wi = pickups.indexOf(p); if (wi >= 0) pickups.splice(wi, 1);
    updateHud();
    return;
  }
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

/* ---- hint "SIN MUNICIÓN": 2 s, una vez por oleada (flag reset en startLevelWave) ---- */
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

/* ============================================================ game state (E5: campaña) */
const game = {
  state: 'menu',           // menu | play | pause | dead | terminal (E5: overlay MORIS-9)
  wave: 1,                 // Nº GLOBAL de oleada (la fórmula vieja de hp/velocidad sigue acá)
  waveIn: 1,               // oleada DENTRO del nivel — la que muestra el HUD "n/total"
  level: 1,                // sector 1..5 (fila de LEVELS)
  lives: 3,                // "SECTORES REINICIADOS" (spec DESIGN_ARSENAL)
  boss: false,             // mini-jefe elite en pie
  bossPending: false,      // oleadas completas: el elite aún no pisó la arena
  bossDelay: 0,            // respiro tras el "regalo de MORIS" (compilador en N5) antes del elite
  bossGuard: false,        // onBossKilled corre una sola vez por nivel
  portalOpen: false, portalPending: false, midSpawned: false,
  respawnPending: false,       // muerte con vidas: el respawn se aplica al cerrar el loop de enemigos
  spawnQueue: [], spawnT: 0,
  intermission: 0,
  score: 0, kills: 0,      // score TOTAL de la campaña (persiste entre sectores)
  ammoHint: false,         // E3: hint "SIN MUNICIÓN" ya mostrado en esta oleada
  time: 0,
};
let best = parseInt(localStorage.getItem('moris-shooter-best') || '0', 10);
$('bestmenu').textContent = best;
const LIVES_MAX = 3;

/* ---- save de campaña (localStorage "moris-campaign"): checkpoint por sector para el
   retry de la muerte definitiva (spec E5: retoma en el LEVEL actual con armas
   conservadas). Se escribe al empezar cada sector (snapshot limpio) y se refresca al
   desbloquear un arma; el retry reparte pools con piso de balas (la vecinal dispara
    siempre). "NUEVA PARTIDA" lo borra. La vida/oleada NO se guardan: retry = oleada 1
   del sector, como en Doom. ---- */
const SAVE_KEY = 'moris-campaign';
function saveCampaign() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, level: game.level, score: game.score, kills: game.kills,
      owned: [...player.owned],
      pools: Object.fromEntries(Object.entries(player.pools).map(([k, p]) => [k, p.n])),
    }));
  } catch (e) { /* storage lleno/inaccesible: la campaña sigue jugable, sin checkpoint */ }
}
function loadCampaign() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || !(s.level >= 1 && s.level <= LEVELS.length)) return null;
    const owned = [...new Set((Array.isArray(s.owned) ? s.owned : []).filter(id => WEAPONS[id]))];
    if (!owned.includes('fists') || !owned.includes('rifle')) owned.push('fists', 'rifle');
    return { level: s.level | 0, score: s.score | 0, kills: s.kills | 0, owned,
             pools: s.pools && typeof s.pools === 'object' ? s.pools : {} };
  } catch (e) { return null; }
}
function clearCampaign() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function refreshContinueBtn() {
  const s = loadCampaign();
  const b = $('contbtn');
  if (!b) return;
  b.style.display = s ? '' : 'none';
  b.textContent = `CONTINUAR SECTOR ${s ? s.level : 1} · ${s ? LEVELS[s.level - 1].name : ''}`;
}

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

/* ---- oleadas POR NIVEL: LEVELS[].waves manda; game.wave sigue siendo el contador
   GLOBAL (escala de hp/velocidad del Enemy intacta) sobre el que se suma diffMult().
   HUD: "OLEADA n/total". El número global solo lo lee la fórmula de dificultad. ---- */
function startLevelWave(i) {
  const total = levelDef().waves;
  game.waveIn = clamp(i, 1, total);
  game.wave = waveBaseFor(game.level - 1) + game.waveIn;
  game.intermission = 0;
  game.bossPending = false;
  game.ammoHint = false; // el hint de munición vuelve a poder aparecer una vez
  game.spawnQueue = buildWave(game.wave);
  game.spawnT = 0;
  spawnWavePickups(game.waveIn); // E3: cajas de recurso (la tabla mira la oleada del nivel)
  $('wave').textContent = `${game.waveIn}/${total}`;
  const msg = $('wavemsg');
  msg.textContent = `OLEADA ${game.waveIn}/${total}`;
  msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
  Sfx.wave();
  updateHud();
}

// mini-jefe del sector: elite sobre un tipo existente (E6 los tendrá con conducta propia)
const BOSS_TYPE = ['droner', 'sprinter', 'brute', 'brute', 'brute'];
function spawnBoss() {
  game.boss = true;
  game.bossGuard = false;
  new Enemy(BOSS_TYPE[game.level - 1] || 'brute', spawnPoint(), true);
  const msg = $('wavemsg');
  msg.textContent = 'MINI-JEFE';
  msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
  feed(`SECTOR ${game.level}: MINI-JEFE DETECTADO`);
  Sfx.bossSpawn();
  updateHud();
}

// fin de oleada: bonus, siguiente oleada / regalo del guion ("te lo da MORIS") / elite
function onWaveCleared() {
  const d = levelDef();
  const bonus = 200 * game.waveIn;
  game.score += bonus;
  feed(`OLEADA COMPLETA +${bonus}`);
  if (game.waveIn < d.waves) game.intermission = 3.2;
  else if (d.weapons && d.weapons.mid && !game.midSpawned) {
    // N5: el Compilador cae tras las oleadas, antes del jefe — "la da MORIS-9" (traicionera)
    game.midSpawned = true;
    spawnWeaponPickup(d.weapons.mid, pickupPoint());
    feed('MORIS-9 TE PASA UN REGALO: EL COMPILADOR');
    toast('REGALO DE MORIS: COMPILADOR', 'weapon big');
    game.bossDelay = 5; // tiempo de verlo caer antes de que entre el elite
  } else game.bossPending = true;
  updateHud();
}

// limpieza de combate común a arranque de sector y respawn (Nada volando entre niveles:
// cohetes/células/orbes/rayos/casas fuera — hotfix E4a: el reset no puede dejar proyectiles huérfanos)
function resetArenaCombat() {
  while (enemies.length) enemies[0].remove();
  clearPickups();
  clearRockets(); clearCells(); clearOrbs(); clearBeams();
  cancelRailCharge();
  portalMesh = null; // el mesh vive en world: lo libera disposeWorld del próximo build
}
// puntería/cadencia/cámara a cero + spawn point del nivel (sur, mirando al centro)
function resetCombatState() {
  Object.assign(player, {
    yaw: 0, pitch: 0,
    reloading: 0, dryT: 0,
    recoilPitch: 0, heat: 0, fireCd: 0, lastHitT: -99, sprintCd: 0, sprintT: 0,
    cooling: 0, vmKick: 0, lastShotT: -9, jumpQueued: false,
    twinNext: 0, twinT: 0, shakeT: 0, chargeT: 0,
  });
  $('ammo').classList.remove('reloading');
  viewYaw = viewPitch = 0; // sin barrido de cámara al reaparecer
  player.pos.set(0, EYE, 28);
  player.vel.set(0, 0, 0);
}
// HARD (partida nueva): recursos del arranque (fists+vecinal, 120 balas) — el viejo resetGame
function resetGame() {
  resetArenaCombat();
  bruteKills = 0;
  Object.assign(player, startResources()); // hp100 / armor0 / owned / mags / pools iniciales
  resetCombatState();
  // la troca volvió al arranque (fists+vecinal): slot bar y crosshair se reconstruyen
  // (lastOwnedN=-1 fuerza rebuild en updateHud) y el viewmodel salta a la vecinal.
  lastOwnedN = -1;
  applyCrosshair(player.weaponId);
  applyViewModel(player.weaponId);
  updateTouchSwap();
  Object.assign(game, { score: 0, kills: 0, wave: 0, waveIn: 0, spawnQueue: [], intermission: 0,
                        time: 0, ammoHint: false });
  updateHud();
}
// SOFT (E5): respawn por vidas y arranque de sector. EL FIX PEDIDO: el reset CONSERVA
// owned (el resetGame hard limpiaba el arsenal) y cargadores; pools a la MITAD solo en
// la muerte (halvePools). hp100/armor0 siempre — spec DESIGN_ARSENAL "muerte".
function resetSOFT(halvePools = true) {
  resetArenaCombat();
  player.hp = 100; player.armor = 0;
  for (const id of Object.keys(player.mags))
    if (player.owned.has(id) && WEAPONS[id].magSize > 0) player.mags[id] = WEAPONS[id].magSize;
  if (halvePools) for (const k in player.pools) player.pools[k].n = Math.floor(player.pools[k].n * 0.5);
  if (!player.owned.has(player.weaponId)) player.weaponId = 'rifle';
  resetCombatState();
  applyCrosshair(player.weaponId);
  applyViewModel(player.weaponId);
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
  /* E5 — VIDAS: con vidas, "SECTOR REINICIADO": respawn en el spawn point del nivel con
     hp100/armor0/mags llenos/pools a la mitad (resetSOFT — owned INTACTO, hotfix pedido)
     y la oleada actual reiniciada. Sin vidas: game over definitivo (pantalla + botón de
     nueva partida que borra el save). El pointer lock NO se suelta: seguimos en play. */
  if (game.respawnPending) return; // ya morimos este frame (dos contactos simultáneos)
  if (game.lives > 0) {
    game.lives--;
    Sfx.death();
    // OJO: die() puede dispararse DESDE el loop de enemigos (daño por contacto) y el
    // respawn splicearía `enemies` a mitad de recorrido. Se difiere un frame:
    // respawnPending lo consume update() justo después de ese loop. hp a 1 tapa una
    // segunda muerte en el mismo frame (el respawn real pone 100).
    game.respawnPending = true;
    player.hp = 1;
    return;
  }
  game.state = 'dead';
  Sfx.death();
  clearRockets(); // E4a: cohetes en vuelo no sobreviven a la partida (no explotan en el menú)
  clearCells();   // E4b: ídem células de Mate
  clearOrbs();    // E4b: ídem orbes del compilador
  clearBeams();   // E4b: update() congela su fade — la línea del riel se borra acá
  cancelRailCharge(); // E4b: el anillo del riel no queda encendido sobre la pantalla de muerte
  document.exitPointerLock();
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state })); // suelta input táctil
  // E5: el best solo se canta con CAMPAÑA COMPLETA (campaignComplete); acá se muestra.
  $('finalscore').textContent = game.score;
  $('finalsector').textContent = `${game.level} · ${levelDef().name}`;
  $('finalwave').textContent = `${game.waveIn}/${levelDef().waves}`;
  $('finalkills').textContent = game.kills;
  $('bestdead').textContent = best; $('bestmenu').textContent = best;
  $('deadtitle').textContent = 'ELIMINADO';
  $('retrycta').textContent = 'CLIC PARA REINTENTAR SECTOR';
  $('hud').classList.add('hidden');
  $('touchhud').classList.add('hidden');
  $('dead').classList.remove('hidden');
}

// respawn por vidas — diferido por die(): correr LO QUE SIGUE al loop de enemigos de
// update(), cuando ninguna iteración activa está pisando `enemies`/pools de proyectiles.
function doRespawn() {
  Sfx.respawn();
  resetSOFT(true);
  startLevelWave(game.waveIn); // la misma oleada del nivel, de cero
  feed(`SECTOR REINICIADO — ${game.lives} ${game.lives === 1 ? 'vida' : 'vidas'} restantes`);
  toast('SECTOR REINICIADO', 'weapon big');
  updateHud();
}

function feed(text) {
  const kf = $('killfeed');
  const d = document.createElement('div');
  d.textContent = text;
  kf.appendChild(d);
  while (kf.children.length > 4) kf.removeChild(kf.firstChild);
  setTimeout(() => { d.classList.add('dying'); setTimeout(() => d.remove(), 1100); }, 2200);
}

/* ============================================================ E5 — flujo de campaña
   oleadas → MINI-JEFE → PORTAL (antesala norte) → terminal MORIS-9 → sector siguiente.
   Muerte definitiva → retry desde el checkpoint (moris-campaign). El guion pleno del
   terminal es E7: hoy se tipea título + subtítulo de la tabla + "...". Todo el flujo
   funciona con touch/mando: el portal se dispara PISÁNDOLO (caminar ya está mapeado)
   y el terminal avanza con tap/clic o A/Start (ver pollGamepad). */
let portalMesh = null; // el mesh vive en world: disposeWorld lo libera con el nivel
let portalCd = 0;      // un solo disparo por visita al umbral

// puerta del sector: plano emisivo vertical que rota + luz + chispas + sonido.
function spawnPortal() {
  const pal = levelDef().pal;
  const mat = new THREE.MeshBasicMaterial({ color: neon(pal.neon, 2.6), transparent: true,
    opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.6), mat);
  mesh.position.set(0, 2.3, -ARENA + 4.5);
  world.add(mesh);
  levelRes.push(mat, mesh.geometry); // si la partida se corta, el portal se va con el nivel
  portalMesh = mesh;
  const pl = new THREE.PointLight(pal.neon, 60, 24, 2);
  pl.position.set(0, 2.3, -ARENA + 5.5);
  world.add(pl);
  levelFx.push((dt, t) => {
    mesh.rotation.y = t * 1.4;
    mat.opacity = 0.66 + Math.sin(t * 6) * 0.2;
    if (Math.random() < dt * 6) burst(mesh.position, pal.neon, 2, 2, 0.6, 1.8);
  });
  game.portalOpen = true;
  Sfx.portal();
  feed('ASCENSOR ABIERTO — PORTAL AL NORTE');
}

// el elite murió: rollKillDrop(boss) tiró el casco + crate + botiquín; ahora abren la
// salida y el arma del guion espera en la ANTESALA, antes del portal (no te la perdés).
function onBossKilled() {
  if (game.bossGuard) return;
  game.bossGuard = true;
  game.boss = false;
  const d = levelDef();
  const exitW = d.weapons && d.weapons.exit;
  if (exitW) {
    spawnWeaponPickup(exitW, new THREE.Vector3(3.2, 0, -ARENA + 8));
    feed(`SEÑAL: ${WEAPONS[exitW].name} EN LA ANTESALA`);
  }
  spawnPortal();
  toast(game.level === LEVELS.length ? 'MORIS-9 CAE — PISÁ EL PORTAL' : 'MINI-JEFE ELIMINADO', 'weapon big');
}

// pisar el umbral: último sector = final de campaña; si no, terminal y sector siguiente
function portalTick(dt) {
  if (portalCd > 0) return;
  if (!game.portalOpen || game.state !== 'play') return;
  const dx = player.pos.x, dz = player.pos.z + ARENA - 4.5;
  if (dx * dx + dz * dz > 2.2 * 2.2) return;
  portalCd = 1;
  if (game.level >= LEVELS.length) { campaignComplete(); return; }
  game.portalPending = true;
  const nl = LEVELS[game.level]; // el siguiente (índice 0-based = game.level)
  showTerminal([
    `> sector ${game.level} ${levelDef().name}: DESHEREDADO. bien.`,
    `> descender al sector ${nl.id}. firmar con la sangre que haya.`,
    ``,
    `SECTOR ${nl.id}: ${nl.name}`,
    `"${nl.subtitle}"`,
    `...`,
  ], () => { beginLevel(game.level + 1); lockAndPlay(); });
}

/* ---- overlay terminal (transiciones MORIS-9): fondo negro, verde fósforo tipeado a
   ~16 ms/char con tick de teletipo. Tap/clic o A/Start: primer toque vuela el tipeo,
   el segundo cierra y corre el callback. E7 enchufa el guion completo (más líneas y
   sonido) pasando otro array a showTerminal — la máquina no cambia. ---- */
let termQueue = [], termFull = '', termBuf = '', termShown = false, termCb = null,
    termTimer = null, termTick = 0;
function showTerminal(lines, cb) {
  termQueue = lines.slice();
  termFull = lines.join('\n') + '\n';
  termBuf = '';
  termShown = false;
  termCb = cb || null;
  $('termwrap').textContent = '';
  $('terminal').classList.remove('hidden');
  const was = game.state;
  game.state = 'terminal';
  if (was !== 'terminal') dispatchEvent(new CustomEvent('gamestate', { detail: 'terminal' })); // suelta touch/firing
  document.exitPointerLock(); // con el lock activo el clic iría al canvas, no al overlay
  Sfx.init();
  clearInterval(termTimer);
  termTimer = setInterval(termStep, 16);
}
function termStep() {
  if (termShown) return;
  if (!termBuf.length && termQueue.length) termBuf = termQueue.shift() + '\n';
  if (termBuf.length) {
    const el = $('termwrap');
    el.textContent += termBuf[0];
    termBuf = termBuf.slice(1);
    if (++termTick % 3 === 0) Sfx.tone('square', 1150 + Math.random() * 450, 900, 0.012, 0.045);
  } else if (!termQueue.length) {
    termShown = true;
    clearInterval(termTimer);
  }
}
function terminalTap() {
  if (game.state !== 'terminal') return;
  if (!termShown) { // toque durante el tipeo: volcar todo (nadie espera)
    $('termwrap').textContent = termFull;
    clearInterval(termTimer);
    termShown = true;
    return;
  }
  $('terminal').classList.add('hidden');
  const cb = termCb; termCb = null;
  if (cb) cb();
  else lockAndPlay();
}

// arranque del sector n: mapaNUEVO (buildArena disposea el anterior), armas del guion,
// checkpoint guardado y oleada 1. Se llama desde el callback del terminal (gesto vivo).
function beginLevel(n) {
  game.level = n;
  buildArena(levelDef());
  game.portalOpen = false; game.portalPending = false;
  game.boss = false; game.bossPending = false; game.bossGuard = false;
  game.midSpawned = false; game.bossDelay = 0;
  portalCd = 0;
  resetSOFT(false); // arena limpia, hp100/armor0, mags llenos, POOLS INTACTOS entre niveles
  const d = levelDef();
  if (d.weapons && d.weapons.early) spawnWeaponPickup(d.weapons.early, new THREE.Vector3(4.5, 0, 21));
  $('sector').textContent = n;
  saveCampaign(); // checkpoint: retry = este sector con estas armas
  startLevelWave(1);
  updateHud();
}

// entrada común (menú / retry / continuo): reset hard de recursos, opcional snapshot del
// save encima, y terminal de bienvenida → beginLevel → play.
function campaignStart(level, snap) {
  Sfx.init();
  resetGame(); // arsenal/recursos a cero (el retry re-encima lo del save)
  if (snap) {
    player.owned = new Set(snap.owned);
    player.mags = {};
    for (const id of snap.owned) if (WEAPONS[id].magSize > 0) player.mags[id] = WEAPONS[id].magSize;
    for (const k in player.pools)
      player.pools[k].n = Math.max(+snap.pools[k] || 0, k === 'balas' ? 60 : 0); // piso: la vecinal dispara siempre
    player.weaponId = player.owned.has(player.weaponId) ? player.weaponId : 'rifle';
    game.score = snap.score; game.kills = snap.kills;
    lastOwnedN = -1;
    applyViewModel(player.weaponId);
    updateTouchSwap();
    updateHud();
  }
  game.lives = LIVES_MAX;
  const d = LEVELS[level - 1];
  showTerminal([
    `> MORIS-9 // SISTEMA CENTRAL DE ESTACIÓN CÓRDOBA-7`,
    `> descongelación de emergencia... lista.`,
    ``,
    `SECTOR ${d.id}: ${d.name}`,
    `"${d.subtitle}"`,
    `...`,
  ], () => { beginLevel(level); lockAndPlay(); });
}
function newCampaign() {
  clearCampaign(); // INICIAR / NUEVA PARTIDA: el save anterior no vale nada
  campaignStart(1, null);
}
function retryFromSave() {
  const s = loadCampaign();
  if (!s) { newCampaign(); return; }
  campaignStart(s.level, s);
}

// MORIS-9 cayó y el portal del núcleo se pisó: campaña completa. El best score SOLO se
// canta acá (spec E5) y el save se borra (no hay sector 6). Créditos pleno = E7.
function campaignComplete() {
  if (game.score > best) { best = game.score; localStorage.setItem('moris-shooter-best', best); }
  clearCampaign();
  game.state = 'dead';
  document.exitPointerLock();
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state }));
  $('deadtitle').textContent = 'MORIS-9 FUERA DE LÍNEA';
  $('finalscore').textContent = game.score;
  $('finalsector').textContent = '5 · NÚCLEO';
  $('finalwave').textContent = 'campaña completa';
  $('finalkills').textContent = game.kills;
  $('bestdead').textContent = best; $('bestmenu').textContent = best;
  $('retrycta').textContent = 'CLIC PARA VOLVER A JUGAR';
  $('hud').classList.add('hidden');
  $('touchhud').classList.add('hidden');
  $('dead').classList.remove('hidden');
  refreshContinueBtn();
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

// E5: vidas "SECTORES REINICIADOS" — corazones prendidos + los gastados tenues
function updateLives() {
  const on = '♥'.repeat(Math.max(0, Math.min(LIVES_MAX, game.lives)));
  const off = game.lives < LIVES_MAX ? `<span class="off">${'♥'.repeat(LIVES_MAX - Math.max(0, game.lives))}</span>` : '';
  $('lives').innerHTML = on + off;
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
  $('enemies').textContent = enemies.length + game.spawnQueue.length; // el boss es un Enemy más: ya cuenta
  $('sector').textContent = game.level;
  updateLives();
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
  // E4b: trocar ABANDONA la carga del riel (no consume: el costo se cobra al soltar) y
  // suelta el doble cañón pendiente del changó — ninguna promesa de disparo cruce de arma.
  cancelRailCharge();
  player.twinNext = 0; player.twinT = 0;
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
  saveCampaign(); // E5: el arma recién tomada entra al checkpoint (el retry no la pierde)
  updateHud();
  return true;
}

// E4a: en desktop no hay botones de troca táctiles; el bloque TOUCH_MODE reasigna esta
// función con la implementación real (unlockWeapon la llama sin saber de modo).
let updateTouchSwap = () => {};

/* ---- slot bar (HUD): una ficha por arma owned con pool: "2 M12 34" (slot, shortName,
   resto del pool). La activa resaltada. Se reconstruye solo cuando cambia owned; los
   números se refrescan desde updateHud (barato: ≤10 fichas). E4b (polish 4b): shortName
   de 4 letras limpias por arma (VECI era un truncamiento feo de VECINAL) + margen derecho
   de la barra en CSS (#slotbar margin-right). */
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
      d.innerHTML = `<b>${W.slot + 1}</b> ${W.shortName}<i></i>`;
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
  cancelRailCharge(); // E4b: pausa con carga llena NO dispara al reanudar — la carga se pierde
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
/* E5 — menú/muerte/terminal: el tap "libre" del overlay arranca campaña NUEVA (INICIAR);
   CONTINUAR SECTOR N (si hay save) y NUEVA PARTIDA (en el game over) son botones con
   stopPropagation + dedupe touch→click, como onTapStart, para que el overlay no duplique
   ni sobreescriba la acción. El tap sobre el terminal avanza su texto (terminalTap). */
function stopTap(el, fn) {
  let lastTouch = -1e9;
  el.addEventListener('touchstart', e => {
    e.preventDefault(); e.stopPropagation();
    lastTouch = performance.now();
    fn();
  }, { passive: false });
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (performance.now() - lastTouch < 500) return; // el click sintético del dedo ya contó
    fn();
  });
}
const playFromMenu = () => newCampaign(); // Start del mando en menú = campaña nueva
onTapStart($('menu'), () => newCampaign());
stopTap($('contbtn'), () => retryFromSave());
onTapStart($('pause'), () => lockAndPlay());
onTapStart($('dead'), () => retryFromSave()); // retry = checkpoint del save (oleada 1 del sector)
stopTap($('newbtn'), () => newCampaign());    // borra el save y arranca por CRIOPODS
onTapStart($('terminal'), () => terminalTap());
refreshContinueBtn();

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
  // E5: en terminal, Start/A lo avanzan; en muerte, Start reintenta el sector (save) y
  // B es NUEVA PARTIDA (el botón táctil equivalente borra el save).
  if (eStart) {
    if (game.state === 'play') {
      if (!TOUCH_MODE && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      else enterPause();
    } else if (game.state === 'pause') lockAndPlay();
    else if (game.state === 'terminal') terminalTap();
    else if (game.state === 'dead') retryFromSave();
    else playFromMenu(); // menú arranca campaña nueva (CONTINUAR queda para el tap en pantalla)
  }
  if (game.state === 'pause' && eB) lockAndPlay(); // B reanuda
  if (game.state === 'terminal' && (eA || eB)) terminalTap(); // A avanza el terminal (spec E5)
  if (game.state === 'dead' && eB) newCampaign(); // B = NUEVA PARTIDA con mando
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
    // fists (sin munición jamás): silencio total. Las de pool directo sin cargador sí
    // hacen click vacío + hint: el asador cuando NO le queda ninguna célula, y E4b extendió
    // la regla al costo del disparo — el riel necesita 5 células (pool 4 = sin riel), el
    // changó cobra 1 cartucho por cañón.
    const need = W.ammoCost || 1;
    if (W.ammo && player.pools[W.ammo].n < need && game.time >= player.dryT) {
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
  // E4b: el quad vive en vmScene (no bajo VM.root) → el z del cañón es VM.baseZ, no -0.02
  // (eso ponía el fogonazo contra el near plane, desincronizado de la boca del arma).
  vmFlash.position.set(VM.baseX + M.muzzle[0], VM.baseY + M.muzzle[1], VM.baseZ - 0.02);
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

/* --- changó (E4b, type 'twin'): UNO de los dos cañones — 14 pellets que cobran 1 cartucho
     DEL POOL (magSize 0: sin cargador, el pool va a la vista del HUD). El cañón 1 dispara
     con el FX común de fireWeapon; el 2 lo agenda en player.twinT (update lo disparará a
     los W.burst s con su propio eco de FX) y SOLO se dispara si al momento de salir queda
     pool: el segundo cartucho nunca se hipoteca. --- */
function fireTwinBarrel(W, first) {
  const need = W.ammoCost || 1;
  if (player.pools[W.ammo].n < need) {
    if (game.time >= player.dryT) { // el cañón 2 murió en el intento: click seco honesto
      player.dryT = game.time + 0.5;
      Sfx.dry();
      showAmmoHint();
    }
    return;
  }
  player.pools[W.ammo].n -= need;
  if (!first) { // eco del cañón 2: fogonazo más chico y media patada
    Sfx[W.sfx]();
    placeVmFlash(0.7); flashT = 0.04;
    player.vmKick = Math.max(player.vmKick, 0.6);
    player.recoilPitch += W.recoil * 0.6;
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_fwd);
  }
  let fxLeft = 3; // como el MORIS-12: daño a todos los pellets, FX solo en los 3 primeros
  for (let i = 0; i < W.pellets; i++) {
    const d = randomInCone(_fwd, W.spread);
    if (rayShot(_origin.x, _origin.y, _origin.z, d.x, d.y, d.z, W.dmg, fxLeft > 0)) fxLeft--;
  }
  updateHud(); // el pool cae cañón a cañón
}

/* ============================================================ E4b — riel del Colastiné
   GATILLO DE CARGA: mantener W.chargeT (0.35 s) el gatillo y disparar AL SOLTAR. El
   anillo del crosshair es DOM (#railring en index.html): se llena con las vars CSS
   --p1/--p2 (WebKit todavía no interpola @property, por eso son dos custom props).
   Los tres caminos de gatillo (mouse, RT de mando, FIRE táctil) ya escriben `firing` por
   toggleFiring → el flanco de suelta se pollea en update(), sin listeners nuevos por
   input: desktop/mando/touch quedan intactos y el riel funciona idéntico en los tres.
   Soltar ANTES de la carga = disipa (no consume nada — el costo se cobra al disparar).
   El disparo es hitscan PERFORANTE: la lista COMPLETA de intersectObjects contra las
   hitboxes (cada caja entry+exit → dedup por enemigo), cortada por el primer sólido. */
const railRingEl = $('railring');
let railRingP = null; // último valor escrito (string): el DOM no se toca cada frame
function railRing(p) { // p < 0 → ocultar; 0..1 → llenado; 1 queda en modo "ready"
  if (!railRingEl) return;
  if (p < 0) { railRingP = null; railRingEl.className = ''; return; }
  p = Math.min(1, p);
  const v = p.toFixed(2); // a 60 fps son ~7 writes en toda la carga (0.35 s)
  if (v !== railRingP) {
    railRingP = v;
    railRingEl.style.setProperty('--p1', v);
    railRingEl.style.setProperty('--p2', v); // WebKit: --p2 es la hermana spec-ready
    railRingEl.className = 'show' + (p >= 1 ? ' ready' : '');
  }
}
function cancelRailCharge() { // troca / pausa / suelta temprana: nada estaba consumido
  player.chargeT = 0;
  railRing(-1);
}
function railChargeStart(W) {
  if (player.pools[W.ammo].n < W.ammoCost) { // no llega a las 5 células: ni arranca la carga
    if (game.time >= player.dryT) {
      player.dryT = game.time + 0.5;
      Sfx.dry();
      showAmmoHint();
    }
    player.fireCd = 0.25; // gatillo hold: no spammar el click seco cada frame
    return;
  }
  player.chargeT = 1e-4; // >0 marca "cargando" (distingue el frame de suelta del de inicio)
  Sfx.railCharge();       // la subida dura W.chargeT: la barra del crosshair es audible
}
function releaseRail(W) {
  if (player.chargeT < W.chargeT) { cancelRailCharge(); return; } // carga a medias: disipa gratis
  player.chargeT = 0;
  railRing(-1);
  if (player.pools[W.ammo].n < W.ammoCost) { tryReload(); return; } // paranoia (pool no crece solo)
  fireRail(W);
}
function fireRail(W) {
  player.pools[W.ammo].n -= W.ammoCost;
  player.fireCd = W.cad;   // cooldown POST-disparo (la carga en sí no lo pisa)
  player.lastShotT = game.time;
  Sfx[W.sfx]();
  vmFireFx(W);             // patada + fogonazo del viewmodel como en todo el arsenal
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_fwd);
  railPierce(W);
  updateHud();             // las células bajan a la vista (5 por crack)
}
/* perforante: 160 a TODO enemigo del rayo. A diferencia del muzzle flash común, el riel
   dibuja su línea aditiva a lo largo de TODO el rayo (pool `beams`, vida 0.15 s — más
   larga que un tracer y cian puro) + flash de luz + chispas en el extremo. */
function railPierce(W) {
  raycaster.set(_origin, _fwd); // raycaster.far = 150 (el melee lo restaura siempre)
  const hitsEnemy = raycaster.intersectObjects(enemyHitboxes, false); // lista COMPLETA, ordenada
  const wHit = raycaster.intersectObjects(solids, false)[0];
  const wallD = wHit ? wHit.distance : raycaster.far;
  const end = _end.copy(_origin).addScaledVector(_fwd, wallD);
  shootBeam(muzzleWorld(_mv), end); // _mv/_end son temps: shootBeam copia las coords
  popFxLight(_origin, 0x66f6ff, 180, 0.3); // fogonazo del rayo, desde los ojos
  burst(end, 0x66f6ff, 8, 5, 0.7, 2);      // chispas cian en pared o en el infinito
  const hitOnce = []; // un raycast toca la caja del enemigo dos veces (entrada/salida):
                      // dedup por enemigo — 160 UNA vez por cuerpo. Alloc por disparo
                      // (cad 1.4 s): el camino caliente sigue sin alloc.
  let any = false;
  for (const h of hitsEnemy) {
    if (h.distance > wallD) break; // la lista viene ordenada: lo que sigue está tras el muro
    const en = h.object.userData.enemy;
    if (!en || en.spawnT <= 0.3 || hitOnce.includes(en)) continue;
    hitOnce.push(en);
    burst(h.point, 0x66f6ff, 4, 4, 0.6, 2); // marca cian ANTES del daño (die() puede splicear)
    en.takeDamage(W.dmg, h.point);
    any = true;
  }
  if (any) hitmarkT = 0.12;
  if (wHit) { // el extremo contra la geometría también sangra FX de impacto
    _nMat.getNormalMatrix(camera.matrixWorld);
    wallImpact(wHit.point, _hitN.copy(wHit.normal).applyMatrix3(_nMat).normalize());
  }
}

/* pool de líneas de RAYO (distinto al de tracers: vida 0.15 s y opacidad plena — la firma
   visual del riel). Con cad 1.4 s nunca hay más de un par vivas; se recicla la vieja. */
const beams = [];
for (let i = 0; i < 4; i++) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({
    color: neon(0x66f6ff, 2.6), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false;
  scene.add(line);
  beams.push({ line, life: 0, max: 0.15 });
}
function shootBeam(from, to, dur = 0.15) {
  const b = beams.find(b => b.life <= 0) || beams[0];
  const pos = b.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  b.life = b.max = dur;
  b.line.material.opacity = 1;
}
function beamTick(dt) {
  for (const b of beams) {
    if (b.life <= 0) continue;
    b.life -= dt;
    b.line.material.opacity = b.life > 0 ? b.life / b.max : 0;
  }
}
function clearBeams() { for (const b of beams) { b.life = 0; b.line.material.opacity = 0; } }

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

/* --- E4b mate: célula de plasma en vuelo — pool SEPARADO de los cohetes (no se toca la
     física de Kira, que tiene splash/auto-daño propios). 16 es holgado: cad 0.16 s ×
     vuelo <2.5 s → suele haber ~5 vivas. Sin splash: W.dmg (30) DIRECTO al enemigo que
     toca y pop cian contra muro/caja/suelo o al expirar. --- */
const cells = [];
{
  const cGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const cMat = new THREE.MeshBasicMaterial({ color: neon(0x5ee6ff, 2.2) }); // la célula del plasma, emisiva
  for (let i = 0; i < 16; i++) {
    const mesh = new THREE.Mesh(cGeo, cMat);
    mesh.visible = false;
    scene.add(mesh);
    cells.push({ mesh, vel: new THREE.Vector3(), life: 0, trailT: 0 });
  }
}
function fireCell(W) {
  const q = cells.find(q => q.life <= 0) || cells[0];
  camera.getWorldPosition(_origin);
  q.mesh.position.copy(_origin);
  q.mesh.position.y -= 0.1; // sale del pecho, no de los ojos
  randomInCone(q.vel, W.spread).multiplyScalar(W.projVel); // 28 m/s: lenta-ish, se puede esquivar
  q.life = 3;              // seguridad: la célula cruza la arena en ~2.3 s
  q.trailT = 0;
  q.mesh.visible = true;
}
function clearCells() { for (const q of cells) { q.life = 0; q.mesh.visible = false; } }
function updateCells(dt) {
  const W = WEAPONS.mate;
  for (const q of cells) {
    if (q.life <= 0) continue;
    q.life -= dt;
    const p = q.mesh.position;
    p.addScaledVector(q.vel, dt);
    q.trailT -= dt;
    if (q.trailT <= 0) { q.trailT = 0.05; burst(p, 0x5ee6ff, 1, 0.4, 0.35, 1.7); } // estela titilante
    let pop = q.life <= 0; // expiró: hace pop en el aire y ya
    if (Math.abs(p.x) >= ARENA - 0.15 || Math.abs(p.z) >= ARENA - 0.15 || p.y <= 0.06) pop = true;
    for (const b of boxes) // mismo test punto-vs-AABB del cohete
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) { pop = true; break; }
    let hit = false;
    if (!pop) for (let i = enemies.length - 1; i >= 0; i--) { // inverso: el impacto puede matar
      const en = enemies[i];
      const rr = 0.85 * en.T.scale + 0.14; // media hitbox + la bolita cian
      const dx = en.g.position.x - p.x, dy = en.baseY - p.y, dz = en.g.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        en.chest(_flP);
        en.takeDamage(W.dmg, _flP); // 30 directo en el impacto — sin splash, sin area
        hitmarkT = Math.max(hitmarkT, 0.1);
        burst(p, 0x5ee6ff, 8, 5, 0.6, 2); // pop cian en el pecho
        hit = true;
        break;
      }
    }
    if (pop || hit) {
      q.life = 0;
      q.mesh.visible = false;
      if (!hit) burst(p, 0x5ee6ff, 7, 4, 0.5, 1.9); // pop contra geometría/expiración
    }
  }
}

/* ============================================================ E4b — COMPILADOR (BFG local)
   Orbe verde emisivo: pool PROPIO de 6 (cadencia 2.0 s × vida 3 s: con 2 en vuelo va sobrado).
   Vuelo recto 12 m/s compartido con el patrón del cohete (piso/muros/cajas/enemigos) y
   detona al impactar, o a los 3 s de expirar. La onda NO tiene decaimiento: BFG_DMG (300)
   a TODO enemigo a < BFG_RADIUS (8 m) del centro — el score de esas muertes va al jugador
   porque die() suma siempre (single player: todo cuenta). Los sobrevivientes quedan
   SCORCHED 3 s (tinte oscuro persistente; el riel, a diferencia, no deja marca).
   Auto-daño al jugador: NO (spec E4b) — el riesgo del compilador son sus 10 argents, no
   pisarse la propia onda. FX: burst doble + luz + screen shake de 0.3 s (roll+offset de
   cámara, ver shakeT en update) + bfgBoom. */
const BFG_DMG = 300, BFG_RADIUS = 8, SCORCH_T = 3;
const orbs = [];
{
  const oGeo = new THREE.SphereGeometry(0.24, 10, 8);
  const oMat = new THREE.MeshBasicMaterial({ color: neon(0x6dff5e, 2.2) }); // emisivo: el bloom lo corona
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(oGeo, oMat);
    mesh.visible = false;
    scene.add(mesh);
    orbs.push({ mesh, vel: new THREE.Vector3(), life: 0, trailT: 0 });
  }
}
function fireOrb(W) {
  const o = orbs.find(o => o.life <= 0) || orbs[0];
  camera.getWorldPosition(_origin);
  o.mesh.position.copy(_origin);
  o.mesh.position.y -= 0.1; // sale del pecho, no de los ojos (misma regla que Kira)
  randomInCone(o.vel, 0.006).multiplyScalar(W.projVel);
  o.life = W.life;
  o.trailT = 0;
  o.mesh.visible = true;
}
function clearOrbs() { for (const o of orbs) { o.life = 0; o.mesh.visible = false; } }
function updateOrbs(dt) {
  const W = WEAPONS.compilador;
  for (const o of orbs) {
    if (o.life <= 0) continue;
    o.life -= dt;
    const p = o.mesh.position;
    p.addScaledVector(o.vel, dt);
    o.trailT -= dt;
    if (o.trailT <= 0) { o.trailT = 0.06; burst(p, 0x6dff5e, 1, 0.7, 0.6, 1.8); } // estela emisiva
    let boom = o.life <= 0; // expiración a los 3 s
    if (Math.abs(p.x) >= ARENA - 0.15 || Math.abs(p.z) >= ARENA - 0.15 || p.y <= 0.06) boom = true;
    for (const b of boxes) // mismo test punto-vs-AABB del cohete
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) { boom = true; break; }
    if (!boom) for (let i = enemies.length - 1; i >= 0; i--) { // inverso: la onda splicea
      const en = enemies[i];
      const rr = 0.85 * en.T.scale + 0.3; // media hitbox + margen del orbe
      const dx = en.g.position.x - p.x, dy = en.baseY - p.y, dz = en.g.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz < rr * rr) { boom = true; break; }
    }
    if (boom) {
      o.life = 0;
      o.mesh.visible = false;
      bfgBlast(p);
    }
  }
}
function bfgBlast(pos) {
  Sfx.bfgBoom();
  player.shakeT = 0.3; // screen shake breve: roll + offset, decae lineal (update/cámara)
  burst(pos, 0x6dff5e, 26, 10, 1.7, 2.4); // núcleo verde
  burst(pos, 0xd9ffc8, 12, 6, 1.1, 1.6);  // ceniza clara por encima
  popFxLight(pos, 0x6dff5e, 340, 0.55);   // la luz más fuerte del repertorio (era un BFG)
  const r = BFG_RADIUS + 0.6;
  const r2 = r * r;
  for (let i = enemies.length - 1; i >= 0; i--) { // inverso: takeDamage puede matar (splice)
    const en = enemies[i];
    const dx = en.g.position.x - pos.x,
          dy = en.baseY + 0.4 - pos.y,          // pecho, como el splash de explode()
          dz = en.g.position.z - pos.z;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    en.chest(_flP);
    en.takeDamage(BFG_DMG, _flP); // 300 sin decaimiento: a <8 m no hay superviviente sano
    if (en.hp > 0) en.scorch(SCORCH_T); // (los que sobreviven por spawn/hp extra quedan fritos)
  }
}

/* --- fireWeapon: UN disparo del arma actual (lo llama update() cuando firing y el
   cooldown llegó a 0). Consume el mag, dispara según W.type y dispara el FX común. --- */
function fireWeapon() {
  const W = curWeapon();
  if (W.type === 'rail') return; // el riel dispara por releaseRail() (carga de gatillo), nunca por cadencia
  if (W.magSize > 0) {
    if (player.mags[player.weaponId] <= 0) { tryReload(); return; } // seco: recarga o click vacío
    player.mags[player.weaponId]--;
  } else if (W.ammoCost) {
    // E4b pool-directo: weapons sin cargador con costo por disparo. El changó (twin) y el
    // riel cobran ELLOS (por cañón / al soltar la carga) — acá se cobra pool-directo (BFG).
    const pool = player.pools[W.ammo];
    if (pool.n < W.ammoCost) { tryReload(); return; } // click vacío: nada se gasta a medias
    if (W.type !== 'twin') pool.n -= W.ammoCost;
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
  } else if (W.type === 'twin') {
    // changó (E4b): cañón 1 sale ahora con el FX común de arriba; el cañón 2 queda
    // agendado en player.twinT → update() lo dispara a los W.burst s SOLO si queda pool
    // (fireTwinBarrel cobra al momento de salir, nunca antes).
    fireTwinBarrel(W, true);
    player.twinNext = W.bullets - 1;
    player.twinT = W.burst;
  } else if (W.type === 'projectile') {
    if (W.orb) fireOrb(W);       // compilador: orbe BFG (pool propio, detonación en updateOrbs)
    else if (W.splash > 0) fireRocket(); // kira: cohete clásico (pool 24, splash)
    else fireCell(W);            // mate: célula de plasma (pool 16, daño directo)
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
  // E4b — screen shake del Compilador: 0.3 s de roll + offset con amplitud que decae
  // lineal. Se aplica DESPUÉS del copiado yaw/pitch/roll y NO escribe player.pos ni
  // player.roll: el shake es puro frame de cámara, nunca muerde la posición real.
  if (player.shakeT > 0) {
    player.shakeT = Math.max(0, player.shakeT - dt);
    const k = player.shakeT / 0.3;
    camera.rotation.z += rand(-0.028, 0.028) * k;
    camera.position.x += rand(-0.075, 0.075) * k;
    camera.position.y += rand(-0.055, 0.055) * k;
    camera.position.z += rand(-0.075, 0.075) * k;
  }

  // E4a — viewmodel pixelado: sway idle con la velocidad + retorno + kick (ver el
  // bloque del viewmodel; el viejo gun 3D de cubos salió del juego).
  updateViewmodel(dt, moving);
  flashTick(dt);
  beamTick(dt); // E4b: fade de las líneas del riel (vida 0.15 s)

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
  /* --- E4b riel: carga con el gatillo mantenida y disparo AL SOLTAR. Como mouse/RT/FIRE
         táctil escriben `firing` por toggleFiring, el flanco de suelta se pollea acá: el
         mando y el touch no necesitaron ni un listener nuevo (ver bloque rail*). --- */
  if (Wc.type === 'rail') {
    if (firing && player.chargeT === 0 && player.fireCd <= 0 &&
        player.cooling <= 0 && player.reloading <= 0) railChargeStart(Wc);
    if (player.chargeT > 0) {
      if (!firing) releaseRail(Wc); // solté: dispara si la carga estaba llena, si no disipa
      else {
        player.chargeT += dt;
        railRing(player.chargeT / Wc.chargeT); // anillo DOM del crosshair llenándose
      }
    }
  } else if (player.chargeT !== 0) cancelRailCharge(); // troca o estado raro: disipa gratis
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
  } else if (firing && Wc.type !== 'flow' && Wc.type !== 'rail' && player.fireCd <= 0 &&
             player.cooling <= 0 && player.reloading <= 0) {
    fireWeapon(); // (el riel está fuera de la cadencia: su disparo sale del releaseRail de arriba)
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
  // changó (E4b): segundo cañón 0.25 s después del clic. Consume SOLO si al salir queda
  // cartuchos; trocar arma cancela la promesa (switchWeapon). cooling/reloading lo
  // respetan por coherencia con el resto del arsenal.
  if (player.twinT > 0) {
    player.twinT -= dt;
    if (player.twinT <= 0) {
      if (player.twinNext > 0 && player.weaponId === 'chango' &&
          player.cooling <= 0 && player.reloading <= 0) fireTwinBarrel(WEAPONS.chango, false);
      player.twinNext = 0;
    }
  }
  rocketsUpdate(dt); // cohetes de Kira en vuelo (pool 24, sin alloc)
  updateCells(dt);   // E4b: células de Mate (pool 16, daño directo al impacto)
  updateOrbs(dt);    // E4b: orbes del compilador (pool 6; detonan al impactar o a los 3 s)

  /* --- enemigos (E4a: loop inverso — el DoT de quemado puede matar al enemigo desde su
         propio update() y splicea `enemies` a mitad de recorrido; yendo al revés el
         splice del actual nunca salta un vecino) */
  for (let i = enemies.length - 1; i >= 0; i--) enemies[i].update(dt, t);

  // E5: la muerte con vidas se procesa ACÁ (die() difiere: su reset vaciaría `enemies`
  // dentro del loop de arriba). El frame de la muerte no spawna oleada nueva: next frame.
  if (game.respawnPending) { game.respawnPending = false; doRespawn(); }

  /* --- spawn / oleadas (E5: por nivel → mini-jefe → portal) --- */
  if (game.intermission > 0) {
    game.intermission -= dt;
    if (game.intermission <= 0) startLevelWave(game.waveIn + 1);
  } else if (game.spawnQueue.length > 0) {
    game.spawnT -= dt;
    if (game.spawnT <= 0) {
      game.spawnT = 0.55;
      new Enemy(game.spawnQueue.pop(), spawnPoint());
      updateHud();
    }
  } else if (enemies.length === 0 && game.state === 'play') {
    if (game.bossPending) { game.bossPending = false; spawnBoss(); }
    else if (game.bossDelay > 0) { // respiro del "regalo de MORIS" (compilador N5)
      game.bossDelay -= dt;
      if (game.bossDelay <= 0) game.bossPending = true;
    }
    else if (!game.portalOpen) onWaveCleared(); // tras el boss ya no hay oleadas: solo portal
  }

  portalTick(dt); // E5: pisar el portal del norte = sector siguiente (touch/mando incluidos)

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
    if (p.kind) { // atlas 4 vistas: recorte por offset (el pickup de arma NO tiene atlas)
      const view = ((p.t * 2) | 0) & 3; // ciclo 2 Hz: idle0 → idle1 → idle1' → idle0'
      if (view !== p.view) { p.view = view; p.tex.offset.x = view * 0.25; }
    }
    p.mesh.rotation.y = p.t * 1.15 + p.phase;                     // rotación lenta
    if (p.kind) p.mesh.position.y = p.baseY + Math.sin(p.t * 2.6 + p.phase) * 0.05; // bob vertical
    // E4b: el pickup de ARMA usa una sola textura (sin offsets) y respira más lento,
    // acorde a su levitación alta.
    else p.mesh.position.y = p.baseY + Math.sin(p.t * 1.6 + p.phase) * 0.09;
    p.mesh.visible = p.ttl <= 0 || p.ttl > 5 || ((p.ttl * 5) | 0) % 2 === 0;
    const dx = p.mesh.position.x - player.pos.x, dz = p.mesh.position.z - player.pos.z;
    if (dx * dx + dz * dz < 1.44 && pickupUsable(p.kind, p.weapon)) collectPickup(p);
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

  // E5: los ambientales del nivel (lava UV-scroll, chispas, cubos que rotan, lámpara
  // titilante, código del skydome, portal) — levelFx se resetea en cada buildArena.
  for (const fn of levelFx) fn(dt, t);

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
/* E5 boot: el sector 1 ya montado detrás del menú (fondo vivo = mapa real). updateHud
   pinta barras/slots/vidas antes del primer tap. */
buildArena(levelDef());
$('sector').textContent = game.level;
updateHud();
window.__dbg = () => ({ state: game.state, wave: game.wave, waveIn: game.waveIn, en: enemies.length,
  level: game.level, lives: game.lives, boss: enemies.some(e => e.boss), // E5: campaña
  portal: game.portalOpen ? 1 : 0,
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
  // E5: los props billboard nuevos (enredadera / estatua) a tamaño real de juego
  ['vine', 'statue'].forEach((kind, i) => {
    const A = propSprite(kind);
    const m = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: A.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.scale.setScalar(kind === 'vine' ? 1.3 : 2.2);
    m.position.set(2.9 + i * 2, (kind === 'vine' ? 1.3 : 2.2) / 2 - 0.9, -4.0);
    scene.add(m);
    pre.push(m);
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
  // E4a/E4b: las 10 siluetas del viewmodel (grilla 5×2 arriba — 3 columnas no las hacen
  // entrar desde que el arsenal está completo) — iterar sprites.js sin jugar
  Object.keys(WEAPONS).forEach((id, i) => {
    const art = makeWeaponSprite(WEAPONS[id].silhouette || 'pistol', WEAPONS[id].accent || '#54f0ff');
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.02), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set(((i % 5) - 2) * 1.5, player.pos.y + 0.3 - ((i / 5) | 0) * 1.15, -4.2);
    scene.add(m);
    pre.push(m);
  });
  addEventListener('gamestate', e => { if (e.detail === 'play') for (const o of pre) o.visible = false; }, { once: true });
}
loop();
