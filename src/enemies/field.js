import * as THREE from '../three.js';
import { Sfx } from '../audio/sfx.js';
import { player } from '../core/player.js';
import { game } from '../core/state.js';
import { clamp, neon, rand } from '../core/utils.js';
import { ARENA, boxes, pushOutOfBoxes } from '../core/world.js';
import { enemySprite } from '../enemies/enemies.js';
import { damagePlayer } from '../levels/flow.js';
import { burst, popFxLight } from '../render/fx.js';
import { scene } from '../render/scene.js';

/* ============================================================ E6 — sistema de campo:
   zonas de piso (esporas/lava), un pool ENEMIGO compartido de 32 proyectiles (spec
   E6a), y los afterimages del glitch. Todo viaja en arrays de módulo (como los cohetes
   de E4a):
   NINGUNO vive en `world`, así que sobreviven el rebuild de buildArena a propósito —
   quien los borra es resetArenaCombat() (beginLevel y respawn pasan por ahí).
   Balances de la spec: halo verde 2 m / 3 dmg/s / 3 s · lava 8 dmg/s / 4 s ·
   lanza de lancellas 14 dmg contra muros se apaga (NO es hitscan) · loseta del
   Fundidor splash r2 + charco de lava. */

// test rápido xz vs AABBs del nivel (sin Y: los jefes vuelan por encima de todo)
export function testWall(x, z, r) {
  for (const b of boxes)
    if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true;
  return false;
}

// blob radial para las zonas de piso: núcleo opaco → borde suave (con AdditiveBlending
// sobre el suelo de E5 queda exactamente como el charco magenta del Invernadero)
export let _zoneTex = null;
export function zoneTex() {
  if (!_zoneTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    _zoneTex = new THREE.CanvasTexture(cv);
    _zoneTex.colorSpace = THREE.SRGBColorSpace;
  }
  return _zoneTex;
}
export const ZONE_COL = { poison: neon(0x5eff8a, 1.25), lava: neon(0xff6a2a, 1.6) };
export const zones = []; // máx 12 vivos (nubes + charcos comparten el presupuesto)
{
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: zoneTex(), transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.06; mesh.visible = false;
    scene.add(mesh);
    zones.push({ mesh, mat, life: 0, max: 1, r: 2, dps: 0, tick: 0, lava: false, phase: 0 });
  }
}
export function spawnZone(kind, x, z, r, life, dps, lava = false) {
  const h = zones.find(z => z.life <= 0) || zones[0]; // saturado: se pisa la más vieja
  const p = new THREE.Vector3(x, 0, z);
  pushOutOfBoxes(p, 0.4); // una nube sobre una tapa no se ve: la movemos al borde
  h.mesh.position.set(p.x, 0.06, p.z);
  h.mesh.scale.setScalar(r * 2);
  h.mat.color.copy(ZONE_COL[kind]);
  h.life = h.max = life; h.r = r; h.dps = dps; h.tick = 0.3; h.lava = lava;
  h.phase = rand(0, 6.28);
  h.mesh.visible = true;
}
export function zonesUpdate(dt) {
  for (const z of zones) {
    if (z.life <= 0) continue;
    z.life -= dt;
    if (z.life <= 0) { z.mesh.visible = false; z.mat.opacity = 0; continue; }
    const k = z.life / z.max;
    z.mat.opacity = (0.5 + Math.sin(game.time * 7 + z.phase) * 0.08) * (k > 0.25 ? 1 : k * 4);
    z.tick -= dt;
    if (z.tick <= 0) { // tic de daño: pisar la nube NO es un DoT silencioso (spec: el
      z.tick = 0.5;    // naranja no es suelo) — 0.5 s por golpe con audio de aviso
      const dx = player.pos.x - z.mesh.position.x, dz = player.pos.z - z.mesh.position.z;
      if (dx * dx + dz * dz < z.r * z.r) { Sfx.hazardTick(); damagePlayer(z.dps * 0.5); }
    }
  }
}
export function clearZones() { for (const z of zones) { z.life = 0; z.mesh.visible = false; z.mat.opacity = 0; } }

/* ---- Proyectiles enemigos: UN pool COMPARTIDO de 32 (spec E6a: "máx 32 compartidos,
   reuse sin alloc" — el tope es GLOBAL: con espectros+lanzas+jetes en pista jamás pasan
   de 32 tiros vivos). bolt = violeta (espectro/Confesor/MORIS) · lava = naranja (lanzas y
   loseta del Fundidor) · spore = verde (esporas del Huerta; explotan en nube de piso).
   El slot cambia geo+material al disparar: ambas son compartidas por kind (3 geos + 3
   mats para los 32 slots) → el reuse no aloja nada. Física prestada del patrón de
   cohetes/células de E4: punto vs AABB, muros, vida. Solo le hacen daño AL JUGADOR
   (explode() de E4 no sirve acá: lastimaría a los propios minions).
   Campos por tiro: dmg/grav/homing/splash/lava. */
export const EPROJ = {
  bolt:  { geo: new THREE.SphereGeometry(0.13, 8, 6), col: 0xaa5cff },
  lava:  { geo: new THREE.BoxGeometry(0.24, 0.24, 0.24), col: 0xff7a2a },
  spore: { geo: new THREE.SphereGeometry(0.17, 8, 6), col: 0x5eff8a },
};
export const eprojs = [];
for (const kind in EPROJ) // material por kind, UNA vez (los 32 slots los comparten)
  EPROJ[kind].mat = new THREE.MeshBasicMaterial({ color: neon(EPROJ[kind].col, 2.1) });
for (let i = 0; i < 32; i++) {
  const mesh = new THREE.Mesh(EPROJ.bolt.geo, EPROJ.bolt.mat);
  mesh.visible = false; mesh.frustumCulled = false;
  scene.add(mesh);
  eprojs.push({ kind: 'bolt', mesh, vel: new THREE.Vector3(), life: 0, dmg: 1, grav: 0,
                homing: 0, splash: 0, lava: 0, trail: 0 });
}
export function fireBolt(kind, x, y, z, vx, vy, vz, o = {}) {
  const S = EPROJ[kind];
  const q = eprojs.find(p => p.life <= 0) || eprojs[0]; // saturado: recicla (tope 32 real)
  q.kind = kind;
  q.mesh.geometry = S.geo; q.mesh.material = S.mat; // swap sin alloc: geo/mat compartidas
  q.mesh.position.set(x, y, z);
  q.vel.set(vx, vy, vz);
  q.life = o.life || 3.5;
  q.dmg = o.dmg || 10; q.grav = o.grav || 0; q.homing = o.homing || 0;
  q.splash = o.splash || 0; q.lava = o.lava || 0; q.trail = 0;
  q.mesh.visible = true;
}
// estallido SOLO-jugador (impacto directo, splash de loseta o expiración con splash)
export function eBoom(pos, dmg, r) {
  burst(pos, 0xff7a2a, 12, 7, 1.2, 2);
  popFxLight(pos, 0xff9a3d, 180, 0.3);
  const pd = Math.hypot(player.pos.x - pos.x, player.pos.y - pos.y, player.pos.z - pos.z);
  if (pd < r) damagePlayer(dmg * clamp(1 - pd / r, 0.25, 1));
}
export const _ebP = new THREE.Vector3(), _ebD = new THREE.Vector3();
export function eProjUpdate(dt) {
  for (const q of eprojs) {
    if (q.life <= 0) continue;
    q.life -= dt;
    const p = q.mesh.position;
    if (q.homing > 0) { // MORIS f1: "rayo lento dirigible" — gira su velocidad hacia
      q.trail -= dt;    // el jugador con rate limitado: se esquiva corriendo, no rezando
      _ebD.set(player.pos.x - p.x, player.pos.y - 0.1 - p.y, player.pos.z - p.z).normalize();
      _ebP.copy(q.vel).normalize().lerp(_ebD, Math.min(1, q.homing * dt)).normalize();
      q.vel.copy(_ebP).multiplyScalar(q.vel.length());
    }
    if (q.grav) q.vel.y -= q.grav * dt; // loseta del Fundidor: parábola
    p.addScaledVector(q.vel, dt);
    const S = EPROJ[q.kind];
    q.trail -= dt;
    if (q.trail <= 0 && q.kind !== 'lava') { q.trail = 0.07; burst(p, S.col, 1, 0.4, 0.4, 1.6); }
    let hitWall = Math.abs(p.x) >= ARENA - 0.15 || Math.abs(p.z) >= ARENA - 0.15 || p.y <= 0.05;
    if (!hitWall) for (const b of boxes) // mismo test punto-vs-AABB de los cohetes
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) { hitWall = true; break; }
    let hitPlayer = false;
    if (!hitWall) { // cápsula burda del jugador: radio 0.55 × vertical 2.2 (ojo E8:
      const dx = player.pos.x - p.x, dz = player.pos.z - p.z, dy = player.pos.y - 0.75 - p.y; // si hay salto alto, el dy perdona)
      hitPlayer = dx * dx + dz * dz < 0.55 * 0.55 && dy > -1.2 && dy < 1.1;
    }
    const expired = q.life <= 0;
    if (!hitPlayer && !hitWall && !expired) continue;
    q.life = 0; q.mesh.visible = false;
    if (hitPlayer && !q.splash) {
      damagePlayer(q.dmg);
      if (q.kind === 'spore') { // la espora del Huerta EXPLOTA contra lo que toca — en la
        spawnZone('poison', p.x, p.z, 1.7, 3, 3); // cara también queda el charco verde
        burst(p, 0x5eff8a, 8, 3, 0.7, 1.4);
        Sfx.sporePop();
      }
    } else if (q.splash) {
      eBoom(p, q.dmg + 14, q.splash); // loseta: la explosión pesa más que el impacto
      if (q.lava) spawnZone('lava', p.x, p.z, 1.6, 4, 8, true); // el naranja NO es suelo
    } else if (q.kind === 'spore') {
      spawnZone('poison', p.x, p.z, 1.7, 3, 3);                 // espora del Huerta → nube
      burst(p, 0x5eff8a, 8, 3, 0.7, 1.4);
      Sfx.sporePop();
    } else if (hitWall || q.kind === 'bolt') {
      burst(p, S.col, 6, 3, 0.5, 1.7);                          // pop limpio contra geometría
    }
  }
}
export function clearEProj() { for (const q of eprojs) { q.life = 0; q.mesh.visible = false; } }

/* ---- Afterimages del glitch: pool de 8 planos que heredan el arte del glitch (geo +
   texture-source compartidos — el clon solo lleva su offset/opacidad, el patrón E2).
   Vida 0.2 s con fade: es el "fantasma barato" de la spec (no un Enemy). */
export const ghosts = [];
export function initGhosts() { if (ghosts.length) return;
  const A = enemySprite('glitch');
  for (let i = 0; i < 8; i++) {
    const tex = A.tex.clone(); tex.repeat.set(0.5, 1); tex.offset.x = 0;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(A.geo, mat);
    mesh.visible = false; mesh.frustumCulled = false;
    scene.add(mesh);
    ghosts.push({ mesh, mat, life: 0 });
  }
}
export function spawnGhost(x, z, scale, yaw, hex) {
  const a = ghosts.find(a => a.life <= 0) || ghosts[0];
  a.mesh.position.set(x, 0.95 * scale + 0.1, z);
  a.mesh.rotation.y = yaw;
  a.mesh.scale.setScalar(scale);
  a.mat.color.setHex(hex ? 0xff3bd8 : 0x54f0ff); // el fantasma sale en el color del frame
  a.life = 0.2;
  a.mesh.visible = true;
}
export function ghostsUpdate(dt) {
  for (const a of ghosts) {
    if (a.life <= 0) continue;
    a.life -= dt;
    if (a.life <= 0) { a.mesh.visible = false; continue; }
    a.mat.opacity = a.life * 1.8; // 0.36 → 0 lineal
  }
}
export function clearGhosts() { for (const a of ghosts) { a.life = 0; a.mesh.visible = false; } }

// E6 estado HUD global: combatHud.bossK = clave de la barra (nombre vigente), combatHud.gfxT = pantallazo
// glitch de MORIS-9 f3 (sobre el DOM #gflash). Reset en resetArenaCombat.

