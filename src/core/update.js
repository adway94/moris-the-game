import * as THREE from '../three.js';
import { firing, keys, touch } from '../core/input.js';
import { TOUCH_MODE } from '../core/mode.js';
import { EYE, GRAVITY, JUMP_V, SPEED, SPRINT, curMag, curWeapon, player } from '../core/player.js';
import { combatHud, game, juice, view } from '../core/state.js';
import { $, clamp, rand } from '../core/utils.js';
import { ARENA, pushOutOfBoxes } from '../core/world.js';
import { Enemy, enemies } from '../enemies/enemies.js';
import { eProjUpdate, ghostsUpdate, zonesUpdate } from '../enemies/field.js';
import { gp } from '../input/gamepad.js';
import { portalTick } from '../levels/campaign.js';
import { doRespawn } from '../levels/flow.js';
import { collectPickup, pickupUsable, pickups } from '../levels/items.js';
import { onWaveCleared, spawnBoss, spawnPoint, startLevelWave } from '../levels/waves.js';
import { _hmEl } from '../render/feedback.js';
import { _pf, _pr, _pw, blood, particles, tracers } from '../render/fx.js';
import { camera, scene } from '../render/scene.js';
import { updateViewmodel } from '../render/viewmodel.js';
import { bossHud, updateHud, updateWname } from '../ui/hud.js';
import { beamTick, cancelRailCharge, fireTwinBarrel, fireWeapon, flamerTick, flashT, flashTick, placeVmFlash, railChargeStart, railRing, releaseRail, rocketsUpdate, updateCells, updateOrbs } from '../weapons/fire.js';
import { WEAPONS } from '../weapons/tables.js';

/* ============================================================ update */
export const clock = new THREE.Clock();

export function update(dt, rdt) {
  game.time += dt;
  const t = game.time;

  // E6 — pantallazo glitch de MORIS-9 f3 (cian, 0.11 s): el clock es REAL (rdt) para
  // que el efecto no se estire con el slow-mo del final. #gflash vive en index.html.
  if (combatHud.gfxT > 0) {
    combatHud.gfxT = Math.max(0, combatHud.gfxT - rdt);
    $('gflash').style.opacity = combatHud.gfxT > 0 ? '0.5' : '0';
  }

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
    view.yaw += (player.yaw - view.yaw) * k;
    view.pitch += (player.pitch - view.pitch) * k;
  } else { view.yaw = player.yaw; view.pitch = player.pitch; }
  camera.rotation.y = view.yaw;
  camera.rotation.x = clamp(view.pitch + player.recoilPitch, -1.55, 1.55);
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
  eProjUpdate(dt);   // E6: proyectiles ENEMIGOS (pool compartido de 32: bolts/esporas/lava)
  zonesUpdate(dt);   // E6: nubes de esporas y charcos de lava del piso (Daño al pisar)
  ghostsUpdate(dt);  // E6: afterimages del glitch (pool 8, vida 0.2 s)

  /* --- enemigos (E4a: loop inverso — el DoT de quemado puede matar al enemigo desde su
         propio update() y splicea `enemies` a mitad de recorrido; yendo al revés el
         splice del actual nunca salta un vecino) */
  for (let i = enemies.length - 1; i >= 0; i--) enemies[i].update(dt, t);

  // E5: la muerte con vidas se procesa ACÁ (die() difiere: su reset vaciaría `enemies`
  // dentro del loop de arriba). El frame de la muerte no spawna oleada nueva: next frame.
  if (game.respawnPending) { game.respawnPending = false; doRespawn(); }

  bossHud(); // E6: barra del jefe (después del loop: el hp ya está actualizado)

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
    // E6: bossGuard = el jefe del sector ya murió — en N5 no hay portal (la campaña se
    // cierra con slow-mo), y sin este guard onWaveCleared re-arma bossPending: MORIS-9
    // resucitaría en plena cuenta de crédito.
    else if (!game.portalOpen && !game.bossGuard) onWaveCleared();
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
      const pickView = ((p.t * 2) | 0) & 3; // ciclo 2 Hz: idle0 → idle1 → idle1' → idle0'
      if (pickView !== p.view) { p.view = pickView; p.tex.offset.x = pickView * 0.25; }
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

  /* --- E11: sangre (pool de 40) — más rápida y terrenal que las chispas: cae duro y
         se apaga en ~0.3 s. Con hitstop dt=0 simplemente se congela (correcto: todo el
         mundo de juego se congela, el FX de pantalla sigue). */
  for (const p of blood) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vel.y -= 16 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.03) { p.mesh.position.y = 0.03; p.vel.multiplyScalar(0.3); }
    p.mesh.material.opacity = Math.min(1, (p.life / p.max) * 1.7); // fade corto con body
  }

  /* --- tracers */
  for (const tr of tracers) {
    if (tr.life <= 0) continue;
    tr.life -= dt;
    if (tr.life <= 0) tr.line.material.opacity = 0;
    else tr.line.material.opacity = 0.9 * (tr.life / 0.07);
  }

  /* --- overlays de daño / hitmarker (E11). EL HITMARKER VIVE EN DOM (index.html
         #hitmark, dentro de #hud z 20), NO en el framebuffer retro: el mundo renderiza
         a ~270p y upscale nearest, y una X de 3 px ahí sería una manchita borrosa.
         Sobre el DOM el marker se SIEMPRE nítido (render nativo del browser), con
         retro ON u OFF. Acá solo el timer de apagado: el encendido, las clases
         kill/boss y el pop de escala los hace feedbackHit. */
  juice.dmgFlash = Math.max(0, juice.dmgFlash - dt * 2.6); // fade ~0.25 s desde el flash de damagePlayer
  $('dmg').style.opacity = juice.dmgFlash;
  juice.hitmarkT = Math.max(0, juice.hitmarkT - dt);
  _hmEl.style.opacity = juice.hitmarkT > 0 ? 1 : 0;
  if (juice.hitmarkT <= 0) _hmEl.classList.remove('kill', 'boss'); // el próximo hit arranca en blanco
}

