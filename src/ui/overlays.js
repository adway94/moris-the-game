import { Sfx } from '../audio/sfx.js';
import { toggleFiring } from '../core/input.js';
import { TOUCH_MODE } from '../core/mode.js';
import { game } from '../core/state.js';
import { $ } from '../core/utils.js';
import { backToMenu, menuGuardT, newCampaign, retryFromSave } from '../levels/campaign.js';
import { refreshContinueBtn } from '../levels/save.js';
import { renderer } from '../render/scene.js';
import { terminalTap } from '../ui/terminal.js';
import { cancelRailCharge } from '../weapons/fire.js';

export function enterPause() {
  if (game.state !== 'play') return;
  game.state = 'pause';
  toggleFiring(false);
  cancelRailCharge(); // E4b: pausa con carga llena NO dispara al reanudar — la carga se pierde
  $('hud').classList.add('hidden');
  $('pause').classList.remove('hidden');
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state }));
}

export function lockAndPlay() {
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
  $('credits').classList.add('hidden'); // E7: Start del mando sobre los créditos → campaña nueva limpia
  $('hud').classList.remove('hidden');
  $('touchhud').classList.remove('hidden');
  game.state = 'play';
}

// tap-to-start: en táctil responde al touchstart (el click sintético posterior se ignora
// ~500 ms para no disparar dos veces); en desktop solo click, como siempre.
export function onTapStart(el, fn) {
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
export function stopTap(el, fn) {
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
export const playFromMenu = () => newCampaign(); // Start del mando en menú = campaña nueva
onTapStart($('menu'), () => { if (performance.now() >= menuGuardT) newCampaign(); }); // E7: la ráfaga que sale de créditos no arranca nada sola
stopTap($('contbtn'), () => retryFromSave());
onTapStart($('pause'), () => lockAndPlay());
onTapStart($('dead'), () => retryFromSave()); // retry = checkpoint del save (oleada 1 del sector)
stopTap($('newbtn'), () => newCampaign());    // borra el save y arranca por CRIOPODS
onTapStart($('terminal'), () => terminalTap());
onTapStart($('credits'), () => backToMenu()); // E7: crédito → menú (con guard anti-ráfaga en menú)
refreshContinueBtn();
