import * as THREE from '../three.js';
import { Sfx } from '../audio/sfx.js';
import { SPEED, curMag, curWeapon, player } from '../core/player.js';
import { game } from '../core/state.js';
import { $, clamp, neon, rand } from '../core/utils.js';
import { ARENA, boxes, solids } from '../core/world.js';
import { enemies, enemyHitboxes } from '../enemies/enemies.js';
import { damagePlayer } from '../levels/flow.js';
import { _hitN, _nMat, burst, popFxLight, shootTracer, wallImpact } from '../render/fx.js';
import { bloomOn } from '../render/pipeline.js';
import { camera, scene } from '../render/scene.js';
import { VM, flashLight, muzzleWorld, vmFlash, vmModel } from '../render/viewmodel.js';
import { updateHud } from '../ui/hud.js';
import { showAmmoHint } from '../ui/notify.js';
import { WEAPONS } from '../weapons/tables.js';

/* ============================================================ E4a — shooting (fireWeapon)
   Punto único de disparo para TODOS los tipos (el viejo shoot(dt) del rifle se generó):
   cooldown en update() por W.cad, consumo del mag (y recarga genérica desde el pool
   W.ammo), y dispatch por W.type: melee / hitscan / shotgun / projectile. El flow
   (asador) no dispara por cadencia: update() llama al tick de llama mientras firing y
   pool > 0. Comunes a todo disparo: fogonazo del viewmodel (quad aditivo ~1 frame) +
   luz puntual en el mundo + kick del viewmodel (decae 0.12 s) + patada de cámara. */
export const raycaster = new THREE.Raycaster();
raycaster.far = 150;
export const _mv = new THREE.Vector3(), _dir = new THREE.Vector3(), _end = new THREE.Vector3(),
      _origin = new THREE.Vector3();

/* E3 — recarga con pool por tipo (genérica E4a): la reserva infinita se acabó. Con el
   pool del arma actual vacío NO hay recarga: click vacío (anti-spam 0.5 s) + hint
   "SIN MUNICIÓN" una vez por oleada. Con pool a medias la recarga es parcial.
   Armas sin cargador (fists: sin pool · asador: flow, consume el pool directo) no
   recargan nunca: la función sale sin efectos — R/RECARGAR/X se ignoran con ellas. */
export function tryReload() {
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
export let flashT = 0;
export function placeVmFlash(scaleMul) {
  const M = vmModel(player.weaponId);
  // E4b: el quad vive en vmScene (no bajo VM.root) → el z del cañón es VM.baseZ, no -0.02
  // (eso ponía el fogonazo contra el near plane, desincronizado de la boca del arma).
  vmFlash.position.set(VM.baseX + M.muzzle[0], VM.baseY + M.muzzle[1], VM.baseZ - 0.02);
  vmFlash.scale.setScalar(M.flashS * scaleMul);
  vmFlash.material.rotation = rand(0, 6.28);
  vmFlash.visible = true;
}
export function vmFireFx(W) {
  placeVmFlash(1);
  flashT = 0.045;
  flashLight.intensity = bloomOn ? 46 : 26;
  player.vmKick = 1;
  if (W.recoil) player.recoilPitch += W.recoil;
}
export function flashTick(dt) {
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) vmFlash.visible = false; }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 400);
}

/* --- cono: vector unitario aleatorio alrededor de `_fwd` con apertura TOTAL `rad`.
   Para conos chicos (~9°) basta con un offset perpendicular proporcional al radio
   (r = √u·tan(rad/2) → uniforme en el disco) + normalize. _fwd debe salir de
   camera.getWorldDirection. --- */
export const _fwd = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
export function randomInCone(out, rad) {
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
export function rayShot(ox, oy, oz, dx, dy, dz, dmg, fx) {
  _dir.set(dx, dy, dz);
  raycaster.set(_origin.set(ox, oy, oz), _dir);
  _nMat.getNormalMatrix(camera.matrixWorld); // para pasar normales de hit a world
  const hitsEnemy = raycaster.intersectObjects(enemyHitboxes, false);
  const hitsWorld = raycaster.intersectObjects(solids, false);
  const eHit = hitsEnemy[0], wHit = hitsWorld[0];
  if (eHit && (!wHit || eHit.distance < wHit.distance)) {
    const en = eHit.object.userData.enemy;
    if (en && en.spawnT > 0.3) {
      en.takeDamage(dmg, eHit.point); // E11: sangre/tick/hitmarker/hitstop salen de feedbackHit
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
export function meleeStrike(W) {
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
      en.takeDamage(W.dmg, eHit.point, true); // E11: `melee` → whack con cuerpo en vez del tick
      en.knockback(W.knock); // (los static como Huerta ya se guardan adentro, ver knockback)
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
export const _flP = new THREE.Vector3(), _flD = new THREE.Vector3();
export function flamerTick(W) {
  camera.getWorldPosition(_origin);
  camera.getWorldDirection(_fwd); // eje del cono = hacia donde se MIRA (camera final)
  // E11: el hitmarker/tick del chorro ahora sale de feedbackHit (takeDamage) — el `any`
  // de antes solo existía para encenderlos acá.
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
  }
  Sfx.flame();
  player.vmKick = Math.max(player.vmKick, 0.5);
  flashLight.intensity = Math.max(flashLight.intensity, bloomOn ? 18 : 10);
}

/* --- changó (E4b, type 'twin'): UNO de los dos cañones — 14 pellets que cobran 1 cartucho
     DEL POOL (magSize 0: sin cargador, el pool va a la vista del HUD). El cañón 1 dispara
     con el FX común de fireWeapon; el 2 lo agenda en player.twinT (update lo disparará a
     los W.burst s con su propio eco de FX) y SOLO se dispara si al momento de salir queda
     pool: el segundo cartucho nunca se hipoteca. --- */
export function fireTwinBarrel(W, first) {
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
  // E11: cada cañón del Changó Delgado sacude la cámara cortito (shake del Compilador
  // con amplitud ~40 %; el cañón 2, que es el eco, un poco menos).
  player.shakeT = Math.max(player.shakeT, first ? 0.13 : 0.1);
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
export const railRingEl = $('railring');
export let railRingP = null; // último valor escrito (string): el DOM no se toca cada frame
export function railRing(p) { // p < 0 → ocultar; 0..1 → llenado; 1 queda en modo "ready"
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
export function cancelRailCharge() { // troca / pausa / suelta temprana: nada estaba consumido
  player.chargeT = 0;
  railRing(-1);
}
export function railChargeStart(W) {
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
export function releaseRail(W) {
  if (player.chargeT < W.chargeT) { cancelRailCharge(); return; } // carga a medias: disipa gratis
  player.chargeT = 0;
  railRing(-1);
  if (player.pools[W.ammo].n < W.ammoCost) { tryReload(); return; } // paranoia (pool no crece solo)
  fireRail(W);
}
export function fireRail(W) {
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
export function railPierce(W) {
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
  for (const h of hitsEnemy) {
    if (h.distance > wallD) break; // la lista viene ordenada: lo que sigue está tras el muro
    const en = h.object.userData.enemy;
    if (!en || en.spawnT <= 0.3 || hitOnce.includes(en)) continue;
    hitOnce.push(en);
    burst(h.point, 0x66f6ff, 4, 4, 0.6, 2); // marca cian ANTES del daño (die() puede splicear)
    en.takeDamage(W.dmg, h.point); // E11: hitmarker/tick/sangre por feedbackHit
  }
  if (wHit) { // el extremo contra la geometría también sangra FX de impacto
    _nMat.getNormalMatrix(camera.matrixWorld);
    wallImpact(wHit.point, _hitN.copy(wHit.normal).applyMatrix3(_nMat).normalize());
  }
}

/* pool de líneas de RAYO (distinto al de tracers: vida 0.15 s y opacidad plena — la firma
   visual del riel). Con cad 1.4 s nunca hay más de un par vivas; se recicla la vieja. */
export const beams = [];
for (let i = 0; i < 4; i++) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({
    color: neon(0x66f6ff, 2.6), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false;
  scene.add(line);
  beams.push({ line, life: 0, max: 0.15 });
}
export function shootBeam(from, to, dur = 0.15) {
  const b = beams.find(b => b.life <= 0) || beams[0];
  const pos = b.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  b.life = b.max = dur;
  b.line.material.opacity = 1;
}
export function beamTick(dt) {
  for (const b of beams) {
    if (b.life <= 0) continue;
    b.life -= dt;
    b.line.material.opacity = b.life > 0 ? b.life / b.max : 0;
  }
}
export function clearBeams() { for (const b of beams) { b.life = 0; b.line.material.opacity = 0; } }

/* --- kira: pool de 24 cohetes SIN alloc por disparo. Vuelven a la vida solo cuando
   explotan: contacto con enemigo, AABB de obstáculo, muros de arena o piso. --- */
export const rockets = [];
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
export function fireRocket() {
  const r = rockets.find(r => r.life <= 0) || rockets[0]; // saturado: se recicla el viejo
  camera.getWorldPosition(_origin);
  r.mesh.position.copy(_origin);
  r.mesh.position.y -= 0.12; // sale del hombro, no de los ojos
  randomInCone(r.vel, curWeapon().spread).multiplyScalar(curWeapon().projVel);
  r.life = 4; // seguridad: nada vuela más de 4 s
  r.trailT = 0;
  r.mesh.visible = true;
  // E11: el retroceso del cohete también sacude la cámara — MISMA función del shake del
  // Compilador (player.shakeT en update), solo menor: 0.2 s → amplitud inicial 2/3 y
  // menos duración. Math.max respeta un shake de BFG que ya esté en curso.
  player.shakeT = Math.max(player.shakeT, 0.2);
}
export function rocketsUpdate(dt) {
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
export function explode(pos, dmg, radius) {
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
export function clearRockets() {
  for (const r of rockets) { r.life = 0; r.mesh.visible = false; }
}

/* --- E4b mate: célula de plasma en vuelo — pool SEPARADO de los cohetes (no se toca la
     física de Kira, que tiene splash/auto-daño propios). 16 es holgado: cad 0.16 s ×
     vuelo <2.5 s → suele haber ~5 vivas. Sin splash: W.dmg (30) DIRECTO al enemigo que
     toca y pop cian contra muro/caja/suelo o al expirar. --- */
export const cells = [];
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
export function fireCell(W) {
  const q = cells.find(q => q.life <= 0) || cells[0];
  camera.getWorldPosition(_origin);
  q.mesh.position.copy(_origin);
  q.mesh.position.y -= 0.1; // sale del pecho, no de los ojos
  randomInCone(q.vel, W.spread).multiplyScalar(W.projVel); // 28 m/s: lenta-ish, se puede esquivar
  q.life = 3;              // seguridad: la célula cruza la arena en ~2.3 s
  q.trailT = 0;
  q.mesh.visible = true;
}
export function clearCells() { for (const q of cells) { q.life = 0; q.mesh.visible = false; } }
export function updateCells(dt) {
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
        en.takeDamage(W.dmg, _flP); // 30 directo en el impacto — sin splash, sin area (E11: hitmarker por feedbackHit)
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
export const BFG_DMG = 300, BFG_RADIUS = 8, SCORCH_T = 3;
export const orbs = [];
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
export function fireOrb(W) {
  const o = orbs.find(o => o.life <= 0) || orbs[0];
  camera.getWorldPosition(_origin);
  o.mesh.position.copy(_origin);
  o.mesh.position.y -= 0.1; // sale del pecho, no de los ojos (misma regla que Kira)
  randomInCone(o.vel, 0.006).multiplyScalar(W.projVel);
  o.life = W.life;
  o.trailT = 0;
  o.mesh.visible = true;
}
export function clearOrbs() { for (const o of orbs) { o.life = 0; o.mesh.visible = false; } }
export function updateOrbs(dt) {
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
export function bfgBlast(pos) {
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
export function fireWeapon() {
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

