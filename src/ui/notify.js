import * as THREE from '../three.js';
import { game } from '../core/state.js';
import { $, clamp } from '../core/utils.js';
import { camera } from '../render/scene.js';

/* ---- toast de pickup: pool de 3 mensajes, el viejo se va antes de spamear -------- */
export const toastWrap = $('toasts');
export function toast(text, cls) {
  while (toastWrap.childElementCount >= 3) toastWrap.removeChild(toastWrap.firstChild);
  const d = document.createElement('div');
  d.className = 'toast ' + cls;
  d.textContent = text;
  toastWrap.appendChild(d);
  setTimeout(() => d.classList.add('out'), 1250);
  setTimeout(() => d.remove(), 1650);
}

/* ---- hint "SIN MUNICIÓN": 2 s, una vez por oleada (flag reset en startLevelWave) ---- */
export let ammoHintTimer = null;
export function showAmmoHint() {
  if (game.ammoHint) return;
  game.ammoHint = true;
  const el = $('ammoHint');
  el.classList.add('show');
  clearTimeout(ammoHintTimer);
  ammoHintTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---- E8-polish(a): popup de score anclado a la pantalla -------------------------
   screenOf proyecta un punto world → px CSS (con margen-clamp para que el texto nunca
   se salga). Si el punto está detrás de la cámara devuelve la última posición visible
   (fallback) ya clampeada; sin fallback conocido, centro. Temporales de módulo: se
   llama por enemigo por frame, cero alloc. */
export const _popV = new THREE.Vector3(), _popV2 = new THREE.Vector3();
export function screenOf(p, fallback) {
  const out = fallback || { x: 0, y: 0 };
  const v = _popV2.copy(p).applyMatrix4(camera.matrixWorldInverse);
  if (v.z < 0) { // frente a la cámara (mira por -Z): → NDC → px
    v.applyMatrix4(camera.projectionMatrix); // applyMatrix4 divide por w
    out.x = clamp((v.x * 0.5 + 0.5) * innerWidth, 24, innerWidth - 24);
    out.y = clamp((-v.y * 0.5 + 0.5) * innerHeight, 34, innerHeight - 130);
  } else if (!fallback) {
    out.x = innerWidth / 2; out.y = innerHeight / 2;
  }
  return out;
}
export const cssColor = {};
export const toCss = hex => cssColor[hex] || (cssColor[hex] = '#' + hex.toString(16).padStart(6, '0'));
export const popupsEl = $('popups');
export const popPool = []; // pool de <div> (los kills en oleada tardía llueven: sin churn de DOM)
export let popSeq = 0;
export function killPopup(text, worldPos, prevScr, colorHex) {
  while (popupsEl.childElementCount > 12) popupsEl.removeChild(popupsEl.firstChild);
  let el = popPool.find(o => !o._use);
  if (!el) {
    el = document.createElement('div');
    el.className = 'killpop';
    popPool.push(el);
  }
  if (el.parentNode !== popupsEl) popupsEl.appendChild(el); // el trim (>12) pudo sacarlo del DOM
  el._use = true; // ocupado hasta que el timeout del keyframe lo devuelva
  el.textContent = text;
  el.style.color = toCss(colorHex);
  const scr = screenOf(worldPos, prevScr); // proyección actual; si no, la última visible
  el.style.left = scr.x.toFixed(0) + 'px';
  el.style.top = scr.y.toFixed(0) + 'px';
  const seq = ++popSeq;
  el.dataset.seq = seq; // mata el timeout de una reutilización anterior
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; // reinicia el keyframe
  setTimeout(() => { if (+el.dataset.seq === seq) el._use = false; }, 1050);
}

export function feed(text) {
  const kf = $('killfeed');
  const d = document.createElement('div');
  d.textContent = text;
  kf.appendChild(d);
  while (kf.children.length > 4) kf.removeChild(kf.firstChild);
  setTimeout(() => { d.classList.add('dying'); setTimeout(() => d.remove(), 1100); }, 2200);
}
