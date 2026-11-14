import * as THREE from '../three.js';
import { makePickupSprite } from '../art/pickups.js';
import { makeWeaponSprite } from '../art/weapons.js';
import { Sfx } from '../audio/sfx.js';
import { player } from '../core/player.js';
import { game, view } from '../core/state.js';
import { $, rand } from '../core/utils.js';
import { ARENA, boxes } from '../core/world.js';
import { hudPunch } from '../render/feedback.js';
import { burst } from '../render/fx.js';
import { scene } from '../render/scene.js';
import { updateHud } from '../ui/hud.js';
import { toast } from '../ui/notify.js';
import { unlockWeapon } from '../weapons/arsenal.js';
import { AMMO, PICKUPS, START_AMMO, WEAPONS } from '../weapons/tables.js';

/* ============================================================ E3 — pickups, drops y popups
   Reemplaza al viejo medkit 3D hardcoded (fuera de juego: el sistema nuevo cubre vida,
   armadura y munición; nada de drops duplicados). Pickups = billboards pixelados chiquitos
   con el MISMO patrón del E2: atlas propio de sprites.js (4 vistas), CanvasTexture con
   NearestFilter + sin mipmaps, alphaTest 0.5, textura clonada por ítem (offsets de vista
   propios, pixel-data compartido 1× por kind en el GPU). */
export const PICKUP_ART = {};
export function pickupArt(kind) {
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

export const pickups = [];
export const DROP_TTL = 20;   // los drops por kill viven 20 s (parpadean los últimos 5)
export const DROP_MAX = 40;   // exceso de drops en escena → muere el más viejo
export let bruteKills = 0;    // contador de brutos muertos (alterna ammoGrande/armorHelm cada 2)

// ttl = 0 → caja de arena permanente (spawn de oleada); ttl > 0 → drop con expiración
export function spawnPickup(kind, pos, ttl = 0) {
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

export function clearPickups() {
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
export const WPNPICK_ART = {};
export function spawnWeaponPickup(weaponId, pos) {
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
export function spawnWavePickups(n) {
  const list = ['ammoBalas', 'ammoBalas', 'ammoBalas', 'medkit']; // base toda oleada
  if (n % 2 === 0) list.push('armorShard');
  if (n >= 3) list.push('medbox');
  if (n >= 5) list.push('ammoCohetes');
  for (const kind of list) spawnPickup(kind, pickupPoint(), 0);
}

// Punto de arena despejado: lejos del jugador, afuera de AABBs, sin solapar pickups.
export function pickupPoint() {
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
export function rollKillDrop(pos, type, boss = false) {
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
export function trimDrops() {
  let drops = pickups.filter(p => p.drop);
  while (drops.length > DROP_MAX) {
    const oldest = drops.reduce((a, b) => (a.born < b.born ? a : b));
    scene.remove(oldest.mesh); oldest.tex.dispose();
    pickups.splice(pickups.indexOf(oldest), 1);
    drops = pickups.filter(p => p.drop);
  }
}

/* ---- aplicación del pickup: pools caps por tipo + helpers HUD ---------------- */
export function addAmmo(type, amount) {
  const pool = player.pools[type], before = pool.n;
  pool.n = Math.min(AMMO[type].cap, pool.n + amount);
  return pool.n - before; // lo que REALMENTE entró (el toast no muestra lo que el cap mordió)
}
// un pickup full no se levanta (queda en el piso para más tarde — evita gastar cajas).
// E4b: el pickup de ARMA (weaponId no null) se levanta si el arma falta, o si siendo
// tuya al pool de su munición todavía le cabe algo (degrada a caja de ammo).
export function pickupUsable(kind, weaponId) {
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
export const PICKUP_FX = { hp: 0x0ee6a0, armor: 0x4da3ff, ammo: 0xffd166 }; // color de partícula

export function collectPickup(p) {
  if (p.weapon) {
    // pickup de arma (E4b): para siempre + ammo inicial por pool + aviso grande. Con el
    // arma ya en el bolsillo, el pickup sirve de caja de munición de su tipo.
    const W = WEAPONS[p.weapon];
    const fresh = unlockWeapon(p.weapon); // updateHud/touchSwap.update + toast corto incl.
    const gained = W.ammo ? addAmmo(W.ammo, START_AMMO[W.ammo] || 0) : 0;
    if (fresh) {
      toast(`OBTENIDA: ${W.name}`, 'weapon big'); // aviso grande (CSS .toast.big)
      Sfx.weaponGet();
      burst(p.mesh.position, 0x5ee6ff, 18, 6, 0.9, 1.9);
      hudPunch($('wname'), 1.12); // E11: el nombre del arma también pega su golpe
    } else {
      if (gained <= 0) return; // paranoia: pickupUsable ya filtra (pool full + owned)
      Sfx.pickupAmmo();
      toast(`+${gained} ${AMMO[W.ammo].label}`, 'ammo');
      burst(p.mesh.position, PICKUP_FX.ammo, 10, 5, 0.7);
      hudPunch($('ammo')); // E11: parpadeo del contador (degradó a caja de munición)
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
  // E11 — micro-punch de 100 ms en el HUD del recurso que entró: vida/armadura destellan
  // su barra entera, munición hace parpadear el contador. Puramente cosmético (WAAPI).
  hudPunch(d.cat === 'hp' ? $('hpwrap') : d.cat === 'armor' ? $('armwrap') : $('ammo'));
}

// E10 glue: reseteo cruzado desde flow.resetGame()
export function resetBruteKills() { bruteKills = 0; }

