import { outlined, px, rectPx, shadowPx } from '../art/pixel.js';

/* ============================================================ E5 — props billboard del entorno
   makePropSprite(kind): planos pixelados para la decoracion de los niveles (mismo lenguaje
   16-bit: paleta limitada + outlined() + sombra en damero). A diferencia de los pickups NO
   llevan atlas de vistas: el juego los deja estaticos (billboard solo en yaw) y game.js
   cachea UN CanvasTexture por kind. Kinds hoy: 'vine' (enredadera N2, con broches que
   retoman el magenta de los charcos) y 'statue' (estatuas guardianas N4, acento violeta).
   Las variantes por nivel se hacen por escala/tinte/material en game.js, no por pixels. */
export const PROP = {
  vine: { W: 16, H: 30, draw(c, s) {
    const leaf = (cx, cy, rx, ry, col) => { // hoja chiquita: ellipsePx acepta rx,ry >= 1
      for (let y = -ry; y <= ry; y++)
        for (let x = -rx; x <= rx; x++)
          if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) px(c, cx + x, cy + y, s, col);
    };
    rectPx(c, 1, 28, 14, 2, s, '#101f14');                 // tierra
    const stem = [[8, 27], [7, 23], [7, 19], [8, 15], [9, 11], [9, 7], [8, 3]];
    for (const [x, y] of stem) { rectPx(c, x, y, 2, 5, s, '#1f7a3d'); px(c, x, y, s, '#2fae54'); }
    leaf(4, 21, 3, 2, '#27924a'); leaf(12, 17, 3, 2, '#2fae54'); // hojas alternadas
    leaf(4, 12, 3, 2, '#1f7a3d'); leaf(12, 8, 3, 2, '#27924a');
    rectPx(c, 6, 2, 3, 2, s, '#6fdca0');                   // brote terminal claro
    px(c, 11, 13, s, '#ff5ee0'); px(c, 12, 13, s, '#ff5ee0'); // broche magenta: la familia
    px(c, 11, 14, s, '#b23bb0'); px(c, 12, 14, s, '#b23bb0');  //   de los charcos del nivel
    px(c, 5, 5, s, '#ff5ee0'); px(c, 5, 6, s, '#b23bb0');
  } },
  statue: { W: 14, H: 26, draw(c, s) {
    rectPx(c, 2, 22, 10, 4, s, '#2c2740');                 // pedestal
    rectPx(c, 2, 22, 10, 1, s, '#4c4468');
    rectPx(c, 5, 8, 4, 14, s, '#3a3550');                  // torso columnar
    rectPx(c, 4, 10, 1, 8, s, '#4c4468');                  // luz de cara izquierda
    rectPx(c, 9, 10, 1, 8, s, '#241f36');                  // sombra derecha
    rectPx(c, 3, 9, 2, 7, s, '#332e48');                   // brazo izquierdo pegado
    rectPx(c, 9, 9, 2, 7, s, '#2c2740');                   // brazo derecho
    rectPx(c, 5, 3, 4, 4, s, '#3a3550');                   // cabeza sin rostro
    rectPx(c, 6, 4, 2, 2, s, '#8a5cff');                   // tercer ojo: unico detalle vivo
    px(c, 6, 4, s, '#d9c4ff');
    rectPx(c, 5, 2, 4, 1, s, '#4c4468');                   // frente iluminada
  } },
};

// una vista estatica por kind (el consumidor escala/tinta): outlined + sombra en damero.
export function makePropSprite(kind, scale = 3) {
  const d = PROP[kind];
  if (!d) throw new Error('makePropSprite: kind desconocido: ' + kind);
  const cellW = d.W + 4, cellH = d.H + 4;
  const full = document.createElement('canvas');
  full.width = cellW * scale; full.height = cellH * scale;
  const fc = full.getContext('2d');
  fc.imageSmoothingEnabled = false;
  shadowPx(fc, (cellW / 2) | 0, cellH - 2, Math.max(2, (d.W / 2 - 2) | 0), scale);
  const art = document.createElement('canvas');
  art.width = d.W * scale; art.height = d.H * scale;
  const ac = art.getContext('2d');
  ac.imageSmoothingEnabled = false;
  d.draw(ac, scale);
  fc.drawImage(outlined(art, scale), ((cellW - d.W) / 2) * scale, ((cellH - d.H) / 2) * scale);
  return { canvas: full, w: d.W, h: d.H, cellW: cellW * scale, cellH: cellH * scale };
}
