import * as THREE from '../three.js';
import { WEAPONS, startResources } from '../weapons/tables.js';

/* ============================================================ player */
export const EYE = 1.7;
export const player = {
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
export const curWeapon = () => WEAPONS[player.weaponId];
export const curMag = () => player.mags[player.weaponId] ?? -1; // -1: arma sin cargador (fists/asador)
export const GRAVITY = 24, SPEED = 6.4, SPRINT = 1.55, JUMP_V = 8;
// cámara suavizada: en desktop copia yaw/pitch 1:1; en táctil los sigue con un low-pass
// para que el arrastre del dedo no se sienta a saltos (ver update)

