import { Sfx } from '../audio/sfx.js';
import { EYE, player } from '../core/player.js';
import { combatHud, game, juice, meta, portal, touchSwap, view } from '../core/state.js';
import { $, clamp } from '../core/utils.js';
import { enemies } from '../enemies/enemies.js';
import { clearEProj, clearGhosts, clearZones } from '../enemies/field.js';
import { nextDeathNote } from '../levels/campaign.js';
import { clearPickups, resetBruteKills } from '../levels/items.js';
import { levelDef } from '../levels/levels.js';
import { startLevelWave } from '../levels/waves.js';
import { applyViewModel } from '../render/viewmodel.js';
import { resetSlotBarCache, updateHud } from '../ui/hud.js';
import { feed, toast } from '../ui/notify.js';
import { cancelRailCharge, clearBeams, clearCells, clearOrbs, clearRockets } from '../weapons/fire.js';
import { WEAPONS, applyCrosshair, startResources } from '../weapons/tables.js';

export function resetArenaCombat() {
  while (enemies.length) enemies[0].remove();
  clearPickups();
  clearRockets(); clearCells(); clearOrbs(); clearBeams();
  clearEProj(); clearZones(); clearGhosts(); // E6
  cancelRailCharge();
  portal.mesh = null; // el mesh vive en world: lo libera disposeWorld del próximo build
  // E6 HUD: barra de jefe y pantallazo glitch se van con el combate
  combatHud.bossK = null; combatHud.gfxT = 0;
  $('bossbar').classList.remove('show');
  $('gflash').style.opacity = '0';
}
// puntería/cadencia/cámara a cero + spawn point del nivel (sur, mirando al centro)
export function resetCombatState() {
  Object.assign(player, {
    yaw: 0, pitch: 0,
    reloading: 0, dryT: 0,
    recoilPitch: 0, heat: 0, fireCd: 0, lastHitT: -99, sprintCd: 0, sprintT: 0,
    cooling: 0, vmKick: 0, lastShotT: -9, jumpQueued: false,
    twinNext: 0, twinT: 0, shakeT: 0, chargeT: 0,
  });
  $('ammo').classList.remove('reloading');
  view.yaw = view.pitch = 0; // sin barrido de cámara al reaparecer
  player.pos.set(0, EYE, 28);
  player.vel.set(0, 0, 0);
}
// HARD (partida nueva): recursos del arranque (fists+vecinal, 120 balas) — el viejo resetGame
export function resetGame() {
  resetArenaCombat();
  resetBruteKills();
  Object.assign(player, startResources()); // hp100 / armor0 / owned / mags / pools iniciales
  resetCombatState();
  // la troca volvió al arranque (fists+vecinal): slot bar y crosshair se reconstruyen
  // (lastOwnedN=-1 fuerza rebuild en updateHud) y el viewmodel salta a la vecinal.
  resetSlotBarCache();
  applyCrosshair(player.weaponId);
  applyViewModel(player.weaponId);
  touchSwap.update();
  Object.assign(game, { score: 0, kills: 0, wave: 0, waveIn: 0, spawnQueue: [], intermission: 0,
                        time: 0, ammoHint: false });
  updateHud();
}
// SOFT (E5): respawn por vidas y arranque de sector. EL FIX PEDIDO: el reset CONSERVA
// owned (el resetGame hard limpiaba el arsenal) y cargadores; pools a la MITAD solo en
// la muerte (halvePools). hp100/armor0 siempre — spec DESIGN_ARSENAL "muerte".
export function resetSOFT(halvePools = true) {
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
export function damagePlayer(d) {
  if (game.state !== 'play') return;
  const soak = Math.min(player.armor, d * 0.6);
  player.armor = Math.max(0, player.armor - soak);
  player.hp -= d - soak;
  player.lastHitT = game.time;
  Sfx.hurt();
  // E11: el vignette (#dmg — DOM aparte del #gflash del jefe, no chocan) escala CON el
  // golpe: un recorte de 8/envenenamiento apenas tiñe el borde, un brute a cara lavada
  // lo tiñe entero. Fade lineal ~0.25 s (decay 2.6/s en update).
  juice.dmgFlash = Math.min(0.9, juice.dmgFlash + clamp(d * 0.011, 0.2, 0.5));
  if (player.hp <= 0) {
    player.hp = 0;
    die();
  }
  updateHud();
}
export function die() {
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
  clearEProj(); clearZones(); clearGhosts(); // E6: ídem proyectiles/zonas/fantasmas enemigos
  combatHud.gfxT = 0; $('gflash').style.opacity = '0'; // E6: y el pantallazo glitch no queda colgado
  cancelRailCharge(); // E4b: el anillo del riel no queda encendido sobre la pantalla de muerte
  document.exitPointerLock();
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state })); // suelta input táctil
  // E5: el meta.best solo se canta con CAMPAÑA COMPLETA (campaignComplete); acá se muestra.
  $('finalscore').textContent = game.score;
  $('finalsector').textContent = `${game.level} · ${levelDef().name}`;
  $('finalwave').textContent = `${game.waveIn}/${levelDef().waves}`;
  $('finalkills').textContent = game.kills;
  $('bestdead').textContent = meta.best; $('bestmenu').textContent = meta.best;
  $('deadtitle').textContent = 'ELIMINADO';
  $('deathtip').textContent = nextDeathNote(); // E7: la burla de MORIS-9 bajo el título (rotan las 4 del doc)
  $('retrycta').textContent = 'CLIC PARA REINTENTAR SECTOR';
  $('hud').classList.add('hidden');
  $('touchhud').classList.add('hidden');
  $('dead').classList.remove('hidden');
}

// respawn por vidas — diferido por die(): correr LO QUE SIGUE al loop de enemigos de
// update(), cuando ninguna iteración activa está pisando `enemies`/pools de proyectiles.
export function doRespawn() {
  Sfx.respawn();
  resetSOFT(true);
  startLevelWave(game.waveIn); // la misma oleada del nivel, de cero
  feed(`SECTOR REINICIADO — ${game.lives} ${game.lives === 1 ? 'vida' : 'vidas'} restantes`);
  feed(nextDeathNote()); // E7: el doc ubica las notas de MORIS-9 "en el respawn" → rotates acá también
  toast('SECTOR REINICIADO', 'weapon big');
  updateHud();
}

