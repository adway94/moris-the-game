import { firing, toggleFiring, touch } from '../core/input.js';
import { TOUCH_MODE } from '../core/mode.js';
import { player } from '../core/player.js';
import { game, touchSwap } from '../core/state.js';
import { $, clamp } from '../core/utils.js';
import { renderer } from '../render/scene.js';
import { cycleWeapon } from '../weapons/arsenal.js';
import { tryReload } from '../weapons/fire.js';

/* ============================================================ touch controls (móvil)
   Un solo sistema de Pointer Events: pointerdown en el tercio izquierdo de la pantalla
   → joystick dinámico (base fantasma donde pisa el dedo); en el resto del canvas → look;
   FIRE/RECARGAR/SALTAR son botones DOM con pointer-events:auto — el puntero "nace" en el
   botón y queda capturado implícitamente ahí, así que sus eventos jamás llegan al canvas:
   arrastrar sobre FIRE dispara pero NUNCA rota la cámara (para apuntar, otro dedo afuera).
   Pointer Events unifican dedo y mouse: con ?touch=1 se puede probar en desktop con mouse.
   En táctil no se usa mousedown/mousemove (pointer lock off), así que no hay dobles rutas. */
if (TOUCH_MODE) {
  const STICK_R = 52;        // radio del joystick en px CSS
  const LOOK_SENS = 0.0045;  // rad/px (desktop 0.0023: el dedo recorre mucho menos que la mouse)
  const cv = renderer.domElement;
  const stickEl = $('stick'), thumbEl = stickEl.firstElementChild;
  const tfire = $('tfire'), treload = $('treload'), tjump = $('tjump');

  // .on habilita el overlay (vence el display:none del CSS); .hidden lo mantiene oculto
  // hasta entrar en play (lockAndPlay lo quita, die lo devuelve): en el menú no se ve nada.
  $('touchhud').classList.add('on', 'hidden');
  document.body.classList.add('touch'); // hooks de layout táctil en CSS (HUD, overlays)
  $('controlsDesktop').style.display = 'none';
  $('controlsTouch').style.display = '';
  $('rec').textContent = 'Modo táctil activo.';
  document.querySelectorAll('.cta').forEach(el => el.textContent = el.textContent.replace('CLIC', 'TOCA'));

  const setPressed = (el, on) => el.classList.toggle('pressed', on);
  let fireId = -1;
  // limpia todo el input táctil (fin de partida / pausa): nadie queda "apretado"
  const dropTouch = () => {
    touch.stickId = touch.lookId = fireId = -1;
    touch.mag = 0; touch.wishF = touch.wishR = 0;
    player.jumpQueued = false;
    setPressed(tfire, false); setPressed(treload, false); setPressed(tjump, false);
    stickEl.classList.remove('active');
    thumbEl.style.transform = '';
    if (firing) toggleFiring(false);
  };
  addEventListener('gamestate', e => { if (e.detail !== 'play') dropTouch(); });

  /* ---- joystick: empuje normalizado alimenta el wish vector (mismo accel/sprint que WASD;
          fondo del recorrido > 0.92 dispara el sprint con el cooldown ya existente) ---- */
  const drawStick = (dx, dy) => {
    thumbEl.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  };
  const startStick = e => {
    touch.stickId = e.pointerId;
    touch.baseX = e.clientX; touch.baseY = e.clientY;
    touch.mag = 0; touch.wishF = touch.wishR = 0; // dedo quieto = cero empuje → cero giro de cámara
    drawStick(0, 0);
    stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    stickEl.classList.add('active');
  };
  const moveStick = e => {
    let dx = e.clientX - touch.baseX, dy = e.clientY - touch.baseY;
    const len = Math.hypot(dx, dy);
    const m = Math.min(len / STICK_R, 1);
    if (len > 1e-3) { dx /= len; dy /= len; } // dirección unitaria (0,0 con len≈0)
    touch.mag = m;
    touch.wishF = -dy * m;   // arrastrar arriba = adelante
    touch.wishR = dx * m;    // arrastrar derecha = strafe derecha
    drawStick(dx * m * STICK_R, dy * m * STICK_R);
  };

  /* ---- look: delta del arrastre → yaw/pitch (yaw -dx equivale a movementX de desktop:
          arrastrar der/arriba mira der/arriba, sin inversión). LookId único: otros dedos
          no registrados se ignoran para que no giren la cámara al pulsar botones. ---- */
  const startLook = e => {
    touch.lookId = e.pointerId;
    touch.lookX = e.clientX; touch.lookY = e.clientY;
  };
  const moveLook = e => {
    // eventos coalescidos: el navegador los entrega una vez por frame; aplicando solo el
    // último punto se conserva el delta total sin saltos (el low-pass de la cámara termina de alisar)
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const p = (evs && evs.length) ? evs[evs.length - 1] : e;
    player.yaw -= (p.clientX - touch.lookX) * LOOK_SENS;
    player.pitch = clamp(player.pitch - (p.clientY - touch.lookY) * LOOK_SENS, -1.5, 1.5);
    touch.lookX = p.clientX; touch.lookY = p.clientY;
  };

  cv.addEventListener('pointerdown', e => {
    if (game.state !== 'play') return;
    e.preventDefault(); // sin gestos del navegador ni mouse sintético
    if (e.clientX < innerWidth / 3) {
      if (touch.stickId === -1) startStick(e);
    } else if (touch.lookId === -1) startLook(e);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId === touch.stickId) moveStick(e);
    else if (e.pointerId === touch.lookId) moveLook(e);
  });
  const endPointer = e => {
    if (e.pointerId === touch.stickId) { // soltar = stop suave: wish a 0 y el accel existente frena
      touch.stickId = -1; touch.mag = 0; touch.wishF = touch.wishR = 0;
      stickEl.classList.remove('active');
      thumbEl.style.transform = '';
    } else if (e.pointerId === touch.lookId) touch.lookId = -1;
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);

  /* ---- botones: pointer capture implícito (el evento sigue al dedo aunque salga del
          botón) → mantener presionado funciona; pointerleave NUNCA suelta la mira. ---- */
  const bindBtn = (el, onDown, onUp) => {
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      if (game.state !== 'play') return;
      e.preventDefault();
      setPressed(el, true);
      onDown(e);
    });
    el.addEventListener('pointerup', e => { setPressed(el, false); onUp(e); });
    el.addEventListener('pointercancel', e => { setPressed(el, false); onUp(e); });
  };
  // fireId se declaró junto a dropTouch, más arriba
  bindBtn(tfire,
    e => { if (fireId === -1) { fireId = e.pointerId; toggleFiring(true); } }, // auto-fire con cadencia desktop
    // suelta solo si era ESE puntero el disparador: un segundo dedo tocando FIRE al
    // levantarse no debe cortar el hold del primero
    e => { if (e && e.pointerId === fireId) { fireId = -1; toggleFiring(false); } });
  bindBtn(treload, () => tryReload(), () => {});
  bindBtn(tjump, () => { player.jumpQueued = true; }, () => {});

  /* ---- E4a: troca de arma táctil ◀ ▶ — dos botones de 56 px (estilo FIRE) junto al
         gatillo, visibles SOLO con ≥2 armas owned (touchSwap.update los muestra/esconde
         en cada unlock; con 1 arma no tienen sentido y no estorban). CSS: #tswapL/R. ---- */
  const mkSwap = (id, label, dir) => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'tbtn tswap'; b.textContent = label;
    b.setAttribute('aria-label', dir < 0 ? 'Arma anterior' : 'Arma siguiente');
    $('touchhud').appendChild(b);
    bindBtn(b, () => cycleWeapon(dir), () => {});
    return b;
  };
  const swapEls = [mkSwap('tswapL', '◀', -1), mkSwap('tswapR', '▶', 1)];
  touchSwap.update = () => {
    const show = player.owned.size > 1 ? 'flex' : 'none';
    for (const b of swapEls) b.style.display = show;
  };
  touchSwap.update(); // arranca con fists+vecinal → a la vista desde el minuto 0
}

