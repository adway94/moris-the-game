import { keys, toggleFiring } from '../core/input.js';
import { TOUCH_MODE } from '../core/mode.js';
import { player } from '../core/player.js';
import { game } from '../core/state.js';
import { $, clamp } from '../core/utils.js';
import { bloomOn, retroOn, setBloom, setRetro } from '../render/pipeline.js';
import { renderer } from '../render/scene.js';
import { enterPause } from '../ui/overlays.js';
import { terminalTap } from '../ui/terminal.js';
import { cycleWeapon, selectSlot } from '../weapons/arsenal.js';
import { tryReload } from '../weapons/fire.js';

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
  // E7: el terminal (prólogo/transiciones/final) también se avanza y se salta con tecla:
  // primer toque vuela el tipeo, el segundo cierra — mismo contrato que el click (terminalTap).
  if (game.state === 'terminal' && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) terminalTap();
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
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && game.state === 'play') {
    enterPause();
  }
});

// En táctil NUNCA se pide pointer lock (ni start, ni retry, ni resume): la mira se mueve
// con arrastre (sección touch). En desktop es idéntico a antes.
