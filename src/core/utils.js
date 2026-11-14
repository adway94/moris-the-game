import * as THREE from '../three.js';

/* ============================================================ utils */
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const $ = id => document.getElementById(id);

// Color HDR para materiales emisivos: convierte hex sRGB a lineal y lo empuja
// por encima del threshold del bloom (0.75) para que el neón genere glow real.
export const neon = (hex, k = 2) => new THREE.Color(hex).multiplyScalar(k);

// rect redondeado compatible (sin depender de ctx.roundRect)
export function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

