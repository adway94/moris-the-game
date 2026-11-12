// MORIS // ARENA — wave-based FPS, three.js r160, sin dependencias externas.
import * as THREE from 'three';

/* ============================================================ utils */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);

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

/* ============================================================ renderer / scene */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.018);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
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

// piso con textura de grilla pintada en canvas
const gridCv = document.createElement('canvas');
gridCv.width = gridCv.height = 128;
const gx = gridCv.getContext('2d');
gx.fillStyle = '#0a0f1c'; gx.fillRect(0, 0, 128, 128);
gx.strokeStyle = 'rgba(84,240,255,0.16)'; gx.lineWidth = 2;
gx.strokeRect(1, 1, 126, 126);
gx.strokeStyle = 'rgba(84,240,255,0.05)'; gx.lineWidth = 1;
gx.beginPath(); gx.moveTo(64, 0); gx.lineTo(64, 128); gx.moveTo(0, 64); gx.lineTo(128, 64); gx.stroke();
const gridTex = new THREE.CanvasTexture(gridCv);
gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
gridTex.repeat.set(ARENA, ARENA);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
  new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.9, metalness: 0.15 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// muros perimetrales
const wallMat = new THREE.MeshStandardMaterial({ color: 0x16203a, roughness: 0.8, metalness: 0.3 });
const trimMat = new THREE.MeshBasicMaterial({ color: 0x54f0ff });
[[0, -ARENA - 0.5, ARENA * 2 + 2, 1], [0, ARENA + 0.5, ARENA * 2 + 2, 1],
 [-ARENA - 0.5, 0, 1, ARENA * 2 + 2], [ARENA + 0.5, 0, 1, ARENA * 2 + 2]].forEach(([x, z, w, d]) => {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
  wall.position.set(x, WALL_H / 2, z);
  addSolid(wall, false); // colisión con límites se hace por clamp
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.995, 0.07, d * 0.995), trimMat);
  trim.position.set(x, WALL_H - 0.35, z);
  scene.add(trim);
});

// obstáculos: cajas y pilones neón
const obMat = new THREE.MeshStandardMaterial({ color: 0x243352, roughness: 0.6, metalness: 0.35 });
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
  if (i % 3 === 0) { // franja neón encima de algunos bloques
    const glow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.06, d * 0.8),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff4d5e : 0x54f0ff }));
    glow.position.set(x, h + 0.04, z);
    scene.add(glow);
  }
});
// pilones de luz en las esquinas
[[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, WALL_H + 1.5, 8), obMat);
  p.position.set(sx * (ARENA - 2), (WALL_H + 1.5) / 2, sz * (ARENA - 2));
  addSolid(p);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  bulb.position.set(sx * (ARENA - 2), WALL_H + 1.7, sz * (ARENA - 2));
  scene.add(bulb);
  const pl = new THREE.PointLight(0xffd166, 30, 26, 2);
  pl.position.copy(bulb.position);
  scene.add(pl);
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
};
const GRAVITY = 24, SPEED = 6.4, SPRINT = 1.55, JUMP_V = 8;

/* ============================================================ weapon viewmodel */
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.4, metalness: 0.8 });
const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.62), gunMat);
barrel.position.set(0, 0, -0.28);
const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.34), gunMat);
body.position.set(0, -0.06, 0.05);
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.09), gunMat);
grip.position.set(0, -0.2, 0.14); grip.rotation.x = 0.3;
const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.4), new THREE.MeshBasicMaterial({ color: 0x54f0ff }));
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

// fogonazo: sprite + luz
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
  map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
flash.scale.setScalar(0.5); flash.visible = false;
gun.add(flash); flash.position.copy(MUZZLE);
const flashLight = new THREE.PointLight(0xffc36b, 0, 14, 2);
flashLight.position.copy(MUZZLE);
gun.add(flashLight);

/* ============================================================ FX: tracers + partículas */
const tracerGeo = new THREE.BufferGeometry();
const tracers = [];
for (let i = 0; i < 40; i++) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({
    color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
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
function burst(pos, color, n, speed = 7, scale = 1) {
  let made = 0;
  for (const p of particles) {
    if (p.life > 0) continue;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(scale * rand(0.6, 1.4));
    p.mesh.visible = true;
    p.mesh.material.color.set(color);
    p.vel.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(speed * 0.4, speed));
    p.life = p.max = rand(0.35, 0.8);
    if (++made >= n) break;
  }
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

const bodyGeo = new THREE.CapsuleGeometry(0.42, 0.7, 4, 10);
const headGeo = new THREE.SphereGeometry(0.3, 12, 10);
const eyeGeo = new THREE.SphereGeometry(0.06, 8, 6);
const ringGeo = new THREE.TorusGeometry(0.5, 0.045, 8, 24);
const hitGeo = new THREE.BoxGeometry(1.15, 1.9, 1.15);

class Enemy {
  constructor(type, pos) {
    const T = ENEMY_TYPES[type];
    this.type = type; this.T = T;
    this.hp = T.hp * (1 + 0.14 * (game.wave - 1));
    this.speed = T.speed * (1 + 0.03 * (game.wave - 1)) * rand(0.9, 1.1);
    this.hitCd = 0; this.phase = rand(0, 6.28); this.spawnT = 0;

    const bMat = new THREE.MeshStandardMaterial({ color: 0x1a2233, roughness: 0.5, metalness: 0.6,
      emissive: T.color, emissiveIntensity: 0.12 });
    const glowMat = new THREE.MeshBasicMaterial({ color: T.color });
    this.mats = [bMat];
    this.g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bMat);
    const head = new THREE.Mesh(headGeo, bMat.clone()); this.mats.push(head.material);
    head.position.y = 0.85;
    const eyeL = new THREE.Mesh(eyeGeo, glowMat); eyeL.position.set(-0.11, 0.9, -0.26);
    const eyeR = new THREE.Mesh(eyeGeo, glowMat); eyeR.position.set(0.11, 0.9, -0.26);
    const ring = new THREE.Mesh(ringGeo, glowMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.35;
    this.g.add(body, head, eyeL, eyeR, ring);
    this.g.scale.setScalar(0.01);
    this.baseY = (0.95 + T.scale * 0.25) * T.scale;

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
  flash() { for (const m of this.mats) m.emissiveIntensity = 1.6; }
  takeDamage(d, point) {
    this.hp -= d;
    this.flash();
    burst(point, this.T.color, 4, 4, 0.6);
    if (this.hp <= 0) this.die();
  }
  die() {
    Sfx.kill();
    game.score += this.T.score; game.kills++;
    feed(`+${this.T.score} ${this.type.toUpperCase()}`);
    burst(this.g.position, this.T.color, 22, 9, 1.2);
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

    for (const m of this.mats)
      m.emissiveIntensity = Math.max(0.12, m.emissiveIntensity - dt * 5);

    const p = this.g.position;
    const dir = new THREE.Vector3(player.pos.x - p.x, 0, player.pos.z - p.z);
    const dist = dir.length();
    if (dist > 0.001) dir.normalize();

    // separación entre enemigos
    const sep = new THREE.Vector3();
    for (const o of enemies) {
      if (o === this) continue;
      const d = p.distanceTo(o.g.position);
      const r = 1.5 * (T.scale + o.T.scale) * 0.5;
      if (d < r && d > 0.001) sep.addScaledVector(
        new THREE.Vector3(p.x - o.g.position.x, 0, p.z - o.g.position.z).normalize(), (r - d) / r * 4);
    }

    const move = dir.multiplyScalar(this.speed).add(sep);
    p.x += move.x * dt; p.z += move.z * dt;
    p.x = clamp(p.x, -ARENA + 1.2, ARENA - 1.2);
    p.z = clamp(p.z, -ARENA + 1.2, ARENA - 1.2);
    pushOutOfBoxes(p, 0.55 * T.scale);

    // levitación + mirar al jugador
    p.y = this.baseY + Math.sin(t * 3 + this.phase) * 0.14;
    this.g.rotation.y = Math.atan2(player.pos.x - p.x, player.pos.z - p.z) + Math.PI;

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
    new THREE.MeshStandardMaterial({ color: 0x0e6b4a, emissive: 0x0ee6a0, emissiveIntensity: 0.5 }));
  const cm = new THREE.MeshBasicMaterial({ color: 0xd6ffe9 });
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
  });
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
  if (game.score > best) { best = game.score; localStorage.setItem('moris-shooter-best', best); }
  $('finalscore').textContent = game.score;
  $('finalwave').textContent = game.wave;
  $('finalkills').textContent = game.kills;
  $('bestdead').textContent = best; $('bestmenu').textContent = best;
  $('hud').classList.add('hidden');
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

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousedown', e => { if (e.button === 0 && game.state === 'play') firing = true; });
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0023;
  player.pitch = clamp(player.pitch - e.movementY * 0.0023, -1.5, 1.5);
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && game.state === 'play') {
    game.state = 'pause';
    firing = false;
    $('pause').classList.remove('hidden');
  }
});

function lockAndPlay() {
  Sfx.init();
  renderer.domElement.requestPointerLock();
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('dead').classList.add('hidden');
  $('hud').classList.remove('hidden');
  game.state = 'play';
}
$('menu').addEventListener('click', () => { resetGame(); startWave(1); lockAndPlay(); });
$('pause').addEventListener('click', () => lockAndPlay());
$('dead').addEventListener('click', () => { resetGame(); startWave(1); lockAndPlay(); });

/* ============================================================ shooting */
const raycaster = new THREE.Raycaster();
raycaster.far = 150;
const _mv = new THREE.Vector3(), _dir = new THREE.Vector3(), _end = new THREE.Vector3();

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

  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, _dir);
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
    burst(wHit.point, 0x9fd8ff, 3, 3, 0.5);
  } else {
    end = _end.copy(origin).addScaledVector(_dir, 120);
  }

  muzzleWorld(_mv);
  shootTracer(_mv, end);

  // feedback visual del disparo
  flash.visible = true; flashT = 0.045;
  flashLight.intensity = 26;
  flash.rotation.z = rand(0, 6.28);
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

  /* --- movimiento del jugador */
  const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const wish = new THREE.Vector3();
  if (keys['KeyW']) wish.add(f);
  if (keys['KeyS']) wish.sub(f);
  if (keys['KeyD']) wish.add(r);
  if (keys['KeyA']) wish.sub(r);
  const moving = wish.lengthSq() > 0;
  if (moving) wish.normalize();

  player.sprintCd -= dt; player.sprintT -= dt;
  let speed = SPEED;
  if (keys['ShiftLeft'] && moving && player.sprintCd <= 0 && player.sprintT <= 0) {
    player.sprintT = 0.3; player.sprintCd = 1.3;
  }
  if (player.sprintT > 0) speed *= SPRINT;

  const accel = player.onGround ? 60 : 14;
  player.vel.x += (wish.x * speed - player.vel.x) * Math.min(1, accel * dt / speed || 0.3);
  player.vel.z += (wish.z * speed - player.vel.z) * Math.min(1, accel * dt / speed || 0.3);

  if (keys['Space'] && player.onGround) { player.vel.y = JUMP_V; player.onGround = false; }
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
  camera.rotation.y = player.yaw;
  camera.rotation.x = clamp(player.pitch + player.recoilPitch, -1.55, 1.55);
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
  flash.scale.setScalar(0.4 + player.heat * 0.25);

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
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state === 'play') update(dt);
  renderer.render(scene, camera);
}
camera.position.copy(player.pos);
camera.rotation.order = 'YXZ';
window.__dbg = () => ({ state: game.state, wave: game.wave, en: enemies.length,
  q: game.spawnQueue.length, hp: Math.round(player.hp), score: game.score,
  inter: +game.intermission.toFixed(2), t: +game.time.toFixed(1) });
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
loop();
