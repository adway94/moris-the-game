import { Sfx } from '../audio/sfx.js';
import { player } from '../core/player.js';
import { touchSwap } from '../core/state.js';
import { $ } from '../core/utils.js';
import { addAmmo } from '../levels/items.js';
import { saveCampaign } from '../levels/save.js';
import { applyViewModel } from '../render/viewmodel.js';
import { updateHud } from '../ui/hud.js';
import { feed, toast } from '../ui/notify.js';
import { cancelRailCharge } from '../weapons/fire.js';
import { SLOT, WEAPONS, applyCrosshair } from '../weapons/tables.js';

/* ============================================================ E4a — cambio de arma
   Entrada única: selectSlot(i) (teclas 1..0 / gamepad) y cycleWeapon(dir) (rueda / RB/LB /
   botones táctiles). Slot sin arma (E4b) o arma no owned → beep breve, NO cambia.
   Trocar cancela TODO lo en curso: recarga (con su clase de HUD), heat/cooling y una
   cadencia corta (0.12 s) para que spamear rueda no intercale dos disparos. */
export function switchWeapon(id) {
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
export function selectSlot(i) {
  const id = SLOT[i];
  if (!id || !player.owned.has(id)) { Sfx.deny(); return; } // slot vacío / no comprada
  switchWeapon(id);
}
export function cycleWeapon(dir) {
  const list = SLOT.filter(id => id && player.owned.has(id)); // owned en orden de slot
  if (list.length < 2) return;
  const i = list.indexOf(player.weaponId);
  switchWeapon(list[(i + dir + list.length) % list.length]);
}
// Desbloqueo (lo que va a enchufar el pickup de arma de E5): una vez tomada es PARA
// SIEMPRE (DESIGN_ARSENAL). El mag arranca lleno, salvo flow (sin cargador): arrives vacía
// de células y el piso las pone. touchSwap.update: los botones ◀▶ solo tienen sentido con 2+.
export function unlockWeapon(id, giveAmmo = 0) {
  const W = WEAPONS[id];
  if (!W || player.owned.has(id)) return false;
  player.owned.add(id);
  if (W.magSize > 0) player.mags[id] = W.magSize;
  else if (W.ammo && giveAmmo > 0) addAmmo(W.ammo, giveAmmo);
  touchSwap.update();
  toast(`ARSENAL + ${W.name}`, 'ammo');
  feed(`ARSENAL: ${W.name}`);
  saveCampaign(); // E5: el arma recién tomada entra al checkpoint (el retry no la pierde)
  updateHud();
  return true;
}

// E4a: en desktop no hay botones de troca táctiles; el bloque TOUCH_MODE reasigna esta
// función con la implementación real (unlockWeapon la llama sin saber de modo).

