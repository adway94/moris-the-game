import { toggleFiring } from '../core/input.js';
import { TOUCH_MODE } from '../core/mode.js';
import { player } from '../core/player.js';
import { game } from '../core/state.js';
import { $, clamp } from '../core/utils.js';
import { newCampaign, retryFromSave } from '../levels/campaign.js';
import { renderer } from '../render/scene.js';
import { enterPause, lockAndPlay, playFromMenu } from '../ui/overlays.js';
import { terminalTap } from '../ui/terminal.js';
import { cycleWeapon } from '../weapons/arsenal.js';
import { tryReload } from '../weapons/fire.js';

/* ============================================================ gamepad (Gamepad API)
   Mapeo (estándar W3C / "standard" layout):
     Eje 0 stick izq X   → strafe        ┐ deadzone 0.18 con curva suave renormalizada
     Eje 1 stick izq Y   → atrás/adelante┘ sign·t²; pisa al teclado SOLO si supera la
                          deadzone: con el stick quieto WASD sigue funcionando.
     Eje 2 stick der X   → yaw  (~2.6 rad/s a full deflection, misma curva muerta)
     Eje 3 stick der Y   → pitch (~2.0 rad/s, clamp ±1.5). Suma deltas por frame sobre
                           player.yaw/pitch: convive con mouse (movementX), pointer lock
                           y arrastre táctil sin pelearse.
     Botón 7  (RT analógico) → fuego: value > 0.35 u oprimido; integra con el flag
                                `firing` de desktop/touch vía toggleFiring.
     Botón 0  (A)     → salto (jumpQueued, igual que el botón táctil)
     Botón 2  (X)     → tryReload()
     Botón 4  (LB)    → arma anterior (cycleWeapon −1)   } E4a: hombros para trocar el
     Botón 5  (RB)    → arma siguiente (cycleWeapon +1)  }     arma, como todo boomer
     Botón 10 (L3)    → sprint: mismo efecto que ShiftLeft (respeta el cooldown).
                        OJO E4a: LB salió del sprint — era (LB ó L3); L3 queda solo.
     Botón 9  (Start) → pausa/reanudar (sale de pointer lock si estaba lockeado; el tap
                        en el overlay o B/1 reanudan). En menú arranca; en muerte reintenta.
     D-pad (12–15) y cualquier botón/dead de más: ignorados a propósito.
   REQUIERE HTTPS: la Gamepad API solo existe en secure context. Por http:// en una IP
   de la red local no hay navigator.getGamepads → usar serve_https.py (cert self-signed).
   Detección: eventos gamepadconnected/disconnected mueven el chip HUD (#gpadchip) y el
   índice preferido, pero el estado se pollea CADA FRAME desde loop() (el objeto puede
   aparecer sin evento; en pausa hay que seguir polleando para que Start reanude). Sin
   mando el coste es un early return; sin API (http), ni eso. */
export const GP_API = !!(navigator.getGamepads || navigator.webkitGetGamepads);
export const GP_DZ = 0.18, GP_YAW = 2.6, GP_PITCH = 2.0, GP_TRIG = 0.35;
export const gp = {
  connected: false, index: -1,
  mf: 0, mr: 0,      // stick izq curvado (+ adelante / + der); 0 = quieto → no pisa a WASD
  lookX: 0, lookY: 0, // stick der curvado
  sprint: false,
  wasFire: false,    // flanco del gatillo: toggleFiring solo se escribe en el cambio
  prev: {},          // flancos de los botones "de acción" (A/B/X/Start)
};
// curva muerta renormalizada: 0 bajo la deadzone, luego sign·t² (arranque suave, tope 1)
export const gpCurve = v => {
  const a = Math.abs(v);
  if (a <= GP_DZ) return 0;
  const t = (a - GP_DZ) / (1 - GP_DZ);
  return (v < 0 ? -1 : 1) * t * t;
};
export const gpPad = () => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : navigator.webkitGetGamepads();
  if (!pads) return null;
  const p = pads[gp.index];
  if (p && p.connected) return p;
  for (const q of pads) if (q && q.connected) return q; // el evento puede no haber llegado
  return null;
};
export const gpDown = (pad, i) => { const b = pad.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
export const gpEdge = (pad, i) => { // true solo en el frame del flanco de presión
  const now = gpDown(pad, i), was = gp.prev[i] === true;
  gp.prev[i] = now;
  return now && !was;
};

export const gchip = $('gpadchip');
if (gchip && !GP_API) gchip.style.display = 'none'; // navegador sin API: chip fuera
export function gpSetConnected(on, index = -1) {
  if (gp.connected === on && !on) { gp.index = -1; return; }
  const changed = gp.connected !== on;
  gp.connected = on; gp.index = index;
  if (changed) {
    if (gchip) {
      gchip.textContent = on ? '🎮 CONECTADO' : '🎮 SIN MANDO';
      gchip.classList.toggle('on', on);
    }
    // un mando real manda: con mando conectado el overlay táctil se oculta aunque
    // TOUCH_MODE sea true (de dispositivo o forzado con ?touch=1). Sin mando, todo
    // como antes: ?touch=1 sigue forzando el overlay manual.
    if (TOUCH_MODE) $('touchhud').classList.toggle('gpadhide', on);
  }
}
addEventListener('gamepadconnected', e => gpSetConnected(true, e.gamepad.index));
addEventListener('gamepaddisconnected', () => { // revalidamos por poll: el index del
  const pad = gpPad();                            // evento no siempre coincide con el real
  if (pad) gpSetConnected(true, pad.index);
  else gpSetConnected(false);
});

export function pollGamepad(dt) {
  if (!GP_API) return;                    // http:// (no secure): cero overhead
  const pad = gpPad();
  if (!pad) {
    if (gp.connected) {                   // desconectado en frío (a veces sin evento)
      gpSetConnected(false);
      if (gp.wasFire) { toggleFiring(false); gp.wasFire = false; }
      gp.mf = gp.mr = gp.lookX = gp.lookY = 0; gp.sprint = false;
    }
    return;
  }
  if (!gp.connected) gpSetConnected(true, pad.index); // apareció sin evento

  const ax = pad.axes || [];
  gp.mf = -gpCurve(ax[1] || 0); gp.mr = gpCurve(ax[0] || 0);
  gp.lookX = gpCurve(ax[2] || 0); gp.lookY = gpCurve(ax[3] || 0);
  gp.sprint = gpDown(pad, 10); // L3 (E4a: LB pasó a trocar arma, ver mapeo arriba)

  // Look: suma deltas por frame; el mouse (movementX) y el drag táctil siguen iguales.
  if (game.state === 'play') {
    if (gp.lookX) player.yaw -= gp.lookX * GP_YAW * dt;
    if (gp.lookY) player.pitch = clamp(player.pitch - gp.lookY * GP_PITCH * dt, -1.5, 1.5);
  }

  // RT (7): analógico > 0.35 u oprimido digital; escribe `firing` solo en los flancos.
  const fire = gpDown(pad, 7) || (pad.buttons[7] && pad.buttons[7].value > GP_TRIG);
  if (fire !== gp.wasFire) {
    if (game.state === 'play') toggleFiring(fire);
    gp.wasFire = fire;
  }
  // Flancos: se calculan SIEMPRE (los botones no usados se descartan) para que gp.prev
  // quede sincronizado en cualquier estado; sostener un botón a través de una transición
  // de estado no dispara una segunda acción.
  const eA = gpEdge(pad, 0), eX = gpEdge(pad, 2);
  const eStart = gpEdge(pad, 9), eB = gpEdge(pad, 1);
  const eLB = gpEdge(pad, 4), eRB = gpEdge(pad, 5); // E4a: hombros = troca

  if (game.state === 'play') {
    if (eA) player.jumpQueued = true; // A
    if (eX) tryReload();              // X
    if (eLB) cycleWeapon(-1);         // LB: arma anterior
    if (eRB) cycleWeapon(1);          // RB: arma siguiente
  }

  // Start (9): pausa con los dos caminos del flujo existente (pointer lock → el evento
  // pointerlockchange hace el resto; táctil o sin lock → enterPause directo).
  // E5: en terminal, Start/A lo avanzan; en muerte, Start reintenta el sector (save) y
  // B es NUEVA PARTIDA (el botón táctil equivalente borra el save).
  if (eStart) {
    if (game.state === 'play') {
      if (!TOUCH_MODE && document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      else enterPause();
    } else if (game.state === 'pause') lockAndPlay();
    else if (game.state === 'terminal') terminalTap();
    else if (game.state === 'dead') retryFromSave();
    else playFromMenu(); // menú arranca campaña nueva (CONTINUAR queda para el tap en pantalla)
  }
  if (game.state === 'pause' && eB) lockAndPlay(); // B reanuda
  if (game.state === 'terminal' && (eA || eB)) terminalTap(); // A avanza el terminal (spec E5)
  if (game.state === 'dead' && eB) newCampaign(); // B = NUEVA PARTIDA con mando
}

