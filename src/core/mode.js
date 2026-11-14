/* ============================================================ modo táctil
   Se activa con dedo real (ontouchstart / pointer:coarse) o forzando ?touch=1 para probar
   en desktop. Debe definirse ANTES del renderer: en táctil el pixel ratio se capa a 1.5
   (las GPUs móviles se ahogan con el bloom a HiDPI); el auto-degrade de bloom sigue igual. */
export const TOUCH_MODE = 'ontouchstart' in window ||
  (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
  new URLSearchParams(location.search).get('touch') === '1';
export const MAX_DPR = TOUCH_MODE ? 1.5 : 2;
export const maxDpr = () => Math.min(devicePixelRatio, MAX_DPR);

