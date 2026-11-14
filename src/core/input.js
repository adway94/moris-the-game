/* ============================================================ input */
export const keys = {};
export let firing = false;

// disparo continuo compartido desktop/táctil (auto-fire por cadencia en update)
export function toggleFiring(on) { firing = on; }


/* scope de módulo (no dentro del if): update() lo lee siempre; en desktop queda todo en 0 */
export const touch = {
  stickId: -1, baseX: 0, baseY: 0,        // id del dedo y base dinámica (px de pantalla)
  mag: 0, wishF: 0, wishR: 0,             // empuje 0..1 y componentes del wish (-1..1)
  lookId: -1, lookX: 0, lookY: 0,         // look: id y último punto procesado (px)
};

