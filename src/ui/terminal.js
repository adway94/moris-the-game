import { Sfx } from '../audio/sfx.js';
import { game } from '../core/state.js';
import { $ } from '../core/utils.js';
import { lockAndPlay } from '../ui/overlays.js';


/* ---- overlay terminal (transiciones MORIS-9): fondo negro, verde fósforo tipeado a
   ~16 ms/char con tick de teletipo. Tap/clic o A/Start: primer toque vuela el tipeo,
   el segundo cierra y corre el callback. E7 enchufa el guion completo (más líneas y
   sonido) pasando otro array a showTerminal — la máquina no cambia. ---- */
export let termQueue = [], termFull = '', termBuf = '', termShown = false, termCb = null,
    termTimer = null, termTick = 0;
export function showTerminal(lines, cb) {
  termQueue = lines.slice();
  termFull = lines.join('\n') + '\n';
  termBuf = '';
  termShown = false;
  termCb = cb || null;
  $('termwrap').textContent = '';
  $('terminal').classList.remove('hidden');
  const was = game.state;
  game.state = 'terminal';
  if (was !== 'terminal') dispatchEvent(new CustomEvent('gamestate', { detail: 'terminal' })); // suelta touch/firing
  document.exitPointerLock(); // con el lock activo el clic iría al canvas, no al overlay
  Sfx.init();
  clearInterval(termTimer);
  termTimer = setInterval(termStep, 16);
}
export function termStep() {
  if (termShown) return;
  if (!termBuf.length && termQueue.length) termBuf = termQueue.shift() + '\n';
  if (termBuf.length) {
    const el = $('termwrap');
    el.textContent += termBuf[0];
    termBuf = termBuf.slice(1);
    if (++termTick % 3 === 0) Sfx.tone('square', 1150 + Math.random() * 450, 900, 0.012, 0.045);
  } else if (!termQueue.length) {
    termShown = true;
    clearInterval(termTimer);
  }
}
export function terminalTap() {
  if (game.state !== 'terminal') return;
  if (!termShown) { // toque durante el tipeo: volcar todo (nadie espera)
    $('termwrap').textContent = termFull;
    clearInterval(termTimer);
    termShown = true;
    return;
  }
  $('terminal').classList.add('hidden');
  const cb = termCb; termCb = null;
  if (cb) cb();
  else lockAndPlay();
}
