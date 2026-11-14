import { ellipsePx, outlined, pixelCanvas, px, rectPx, shadowPx } from '../art/pixel.js';
import { view } from '../core/state.js';

/* ============================================================ E3 — pickups del piso
   Ítems de recurso estilo Doom (vida / armadura / munición) como billboards pixelados
   chiquitos: canvas lógico 16×16 (12×12 el botiquín chico), idle de 2 frames y EL MISMO
   pipeline del arte de enemigo — outlined() para la silueta legible contra el fondo y
   sombra elíptica en damero (dither opaco, compatible alphaTest 0.5 del billboard).
   Cada key se dibuja UNA sola vez al cargar el módulo (los 4 lienzos de las vistas se
   comparten, el consumidor los usa read-only). Frame 1 = acento emisivo un paso más
   brillante: sobre un objeto de 12 px la alteración de brillo se lee mejor que una
   rotación de 1 px, y el billboard ya gira solo en el juego. */
export const PDRAW = {
  medkit: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // botiquín blanco, cruz verde (+25)
    rectPx(c, 3, 5, 10, 8, s, '#eef2f4');
    rectPx(c, 4, 6, 8, 2, s, '#ffffff');
    rectPx(c, 4, 10, 8, 2, s, '#c4ccd2');
    rectPx(c, 6, 5, 4, 1, s, '#8d979e');
    rectPx(c, 6, 4, 4, 1, s, p ? '#5effa8' : '#3ddc84');
    rectPx(c, 7, 7, 2, 4, s, p ? '#3ddc84' : '#1fae66');
    rectPx(c, 5, 8, 6, 2, s, p ? '#3ddc84' : '#1fae66');
    px(c, 7, 9, s, '#0d7a45');
  } },
  medbox: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // caja roja de campo, cruz blanca (+50)
    rectPx(c, 1, 5, 14, 9, s, '#b3261e');
    rectPx(c, 2, 6, 12, 2, s, '#e0473a');
    rectPx(c, 2, 11, 12, 2, s, '#7c1812');
    rectPx(c, 6, 4, 4, 1, s, '#5c100b');
    rectPx(c, 1, 7, 14, 1, s, p ? '#ffd9d5' : '#d99a92');
    rectPx(c, 7, 7, 2, 5, s, '#f2f5f7');
    rectPx(c, 5, 8, 6, 2, s, '#f2f5f7');
    px(c, 7, 8, s, '#c4ccd2'); px(c, 8, 9, s, '#c4ccd2');
  } },
  medkitSmall: { W: 12, H: 12, draw: (c, s, f) => {
    const p = f === 1;                       // botiquín chico de drop (+10)
    rectPx(c, 2, 3, 8, 6, s, '#dfe6ea');
    rectPx(c, 2, 3, 8, 1, s, '#f6fafc');
    rectPx(c, 4, 2, 4, 1, s, '#8d979e');
    rectPx(c, 5, 4, 2, 4, s, p ? '#3ddc84' : '#28b872');
    rectPx(c, 4, 5, 4, 2, s, p ? '#3ddc84' : '#28b872');
  } },
  armorShard: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // pedazo de coraza azul, diamante (+15)
    for (let i = 0; i <= 4; i++) rectPx(c, 7 - i, 3 + i, 2 + i * 2, 1, s, i === 0 ? '#a8cbff' : '#3f74d6');
    for (let i = 1; i <= 4; i++) rectPx(c, 3 + i, 7 + i, 10 - i * 2, 1, s, i <= 1 ? '#2b57a8' : '#1c3f80');
    rectPx(c, 6, 5, 2, 4, s, '#7fa9e8');
    rectPx(c, 7, 7, 2, 2, s, p ? '#eaf4ff' : '#bfe0ff');
    px(c, 8, 9, s, '#16305e');
  } },
  armorHelm: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // casco blindado azul, visor cian (+35)
    ellipsePx(c, 8, 8, 6, 5, s, '#2f5fc4');
    rectPx(c, 2, 10, 12, 3, s, '#244a9e');
    rectPx(c, 3, 9, 10, 1, s, '#5e8ee0');
    rectPx(c, 5, 5, 6, 1, s, '#7fa9e8');
    rectPx(c, 5, 8, 6, 2, s, '#142c58');
    rectPx(c, 5, 8, 6, 1, s, p ? '#8dfaff' : '#3ecfe0');
    px(c, 8, 3, s, '#a8cbff');
  } },
  ammoBalas: { W: 16, H: 16, draw: (c, s, f) => {
    const lite = f === 1 ? '#ffdc7d' : '#ffc94d'; // caja amarilla de fusilería (+18)
    rectPx(c, 2, 6, 12, 7, s, '#d9a520');
    rectPx(c, 3, 7, 10, 1, s, lite);
    rectPx(c, 3, 11, 10, 1, s, '#8f6a12');
    rectPx(c, 1, 5, 14, 2, s, '#b8860b');
    for (const bx of [3, 6, 9]) {
      rectPx(c, bx, 8, 2, 3, s, '#ffd94d');
      px(c, bx, 8, s, '#ffe9a3'); px(c, bx + 1, 8, s, '#ffe9a3');
      px(c, bx, 10, s, '#8f6a12'); px(c, bx + 1, 10, s, '#8f6a12');
    }
  } },
  ammoCartuchos: { W: 16, H: 16, draw: (c, s, f) => {
    const g = f === 1 ? '#ff6b5e' : '#e0473a';   // caja de cartuchos rojos (+8)
    rectPx(c, 2, 7, 12, 6, s, '#3d4450');
    rectPx(c, 3, 8, 10, 1, s, '#5a6472');
    rectPx(c, 3, 12, 10, 1, s, '#242a33');
    for (const bx of [3, 6, 9]) {
      rectPx(c, bx, 4, 2, 4, s, g);
      px(c, bx, 4, s, '#ffb3ab'); px(c, bx + 1, 4, s, '#ffb3ab');
      px(c, bx, 7, s, '#c9a53a'); px(c, bx + 1, 7, s, '#c9a53a');
    }
  } },
  ammoCelulas: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // celda de energía cian (+15)
    rectPx(c, 4, 4, 8, 11, s, '#1b2634');
    rectPx(c, 4, 4, 8, 1, s, '#39465a');
    rectPx(c, 5, 2, 6, 2, s, '#8a93a2');
    px(c, 6, 1, s, '#c2cbd6'); px(c, 9, 1, s, '#c2cbd6');
    rectPx(c, 6, 6, 4, 7, s, p ? '#54f0ff' : '#22b8cc');
    rectPx(c, 7, 7, 2, 2, s, '#e8ffff');
    px(c, 5, 13, s, '#0d7a8a'); px(c, 10, 13, s, '#0d7a8a');
  } },
  ammoCohetes: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // cajón militar de cohetes (+2)
    rectPx(c, 2, 6, 12, 8, s, '#3f5a34');
    rectPx(c, 3, 7, 10, 1, s, '#5d7a4c');
    rectPx(c, 3, 12, 10, 1, s, '#28391f');
    for (const rx of [4, 8]) {
      rectPx(c, rx, 8, 3, 4, s, '#aab4bc');
      px(c, rx + 1, 7, s, '#cfd6dc');
      px(c, rx, 8, s, '#e0473a'); px(c, rx + 2, 8, s, '#e0473a');
    }
    rectPx(c, 1, 5, 14, 1, s, p ? '#ffdd77' : '#c9a53a');
    rectPx(c, 1, 13, 14, 1, s, '#c9a53a');
  } },
  ammoArgents: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // orbe argent violeta (+2)
    ellipsePx(c, 8, 9, 5, 5, s, '#3c1e5c');
    ellipsePx(c, 8, 9, 3, 3, s, p ? '#c77dff' : '#9b4dca');
    px(c, 7, 8, s, '#f4e6ff');
    px(c, 8, 7, s, '#f4e6ff');
    rectPx(c, 5, 3, 6, 1, s, '#c9a53a');
    px(c, 4, 4, s, '#c9a53a'); px(c, 11, 4, s, '#c9a53a');
  } },
  ammoGrande: { W: 16, H: 16, draw: (c, s, f) => {
    const p = f === 1;                       // crate verde militar grande (drop BRUTE +40 balas)
    rectPx(c, 1, 4, 14, 10, s, '#4c5a34');
    rectPx(c, 2, 5, 12, 1, s, '#6f804c');
    rectPx(c, 1, 8, 14, 2, s, p ? '#ffd94d' : '#d9a520');
    rectPx(c, 2, 5, 1, 9, s, '#2d361f');
    rectPx(c, 13, 5, 1, 9, s, '#2d361f');
    rectPx(c, 4, 4, 8, 3, s, '#2d361f');
    rectPx(c, 5, 5, 2, 1, s, '#ffc94d');
    rectPx(c, 8, 5, 2, 1, s, '#ffc94d');
    rectPx(c, 11, 5, 1, 1, s, '#ffc94d');
  } },
};
// Vistas del pickup: 4 columnas = [idle0, idle1, idle1 espejado, idle0 espejado]. Los
// lienzos son compartidos por key (read-only): el pickup girando no duplica pixeles.
Object.keys(PDRAW).forEach(k => {
  const d = PDRAW[k];
  const c0 = pixelCanvas(d.W, d.H, 1); d.draw(c0.c, c0.s, 0);
  const c1 = pixelCanvas(d.W, d.H, 1); d.draw(c1.c, c1.s, 1);
  d.v = [[c0.cv, false], [c1.cv, false], [c1.cv, true], [c0.cv, true]];
});


// Atlas de un pickup: las 4 vistas en fila, cada celda con outline propio Y su sombra
// elíptica en damero (la sombra viaja con el sprite, igual que en los enemigos — el
// material usa alphaTest 0.5 y no admite alpha suave). El consumidor recorta la vista
// activa con tex.repeat=(1/4, 1) + offset.x = view/4 (mismo patrón de frames del E2).
export function makePickupSprite(kind, scale = 4) {
  const d = PDRAW[kind];
  if (!d) throw new Error('makePickupSprite: kind desconocido: ' + kind);
  const cellW = d.W + 4, cellH = d.H + 6;
  const cv = document.createElement('canvas');
  cv.width = cellW * 4 * scale; cv.height = cellH * scale;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  d.v.forEach((view, i) => {
    const art = document.createElement('canvas');
    art.width = cellW * scale; art.height = cellH * scale;
    const ac = art.getContext('2d');
    ac.imageSmoothingEnabled = false;
    const sx = ((cellW - d.W) / 2) * scale, sy = ((cellH - d.H) / 2) * scale;
    shadowPx(ac, (cellW / 2) | 0, cellH - 3, Math.max(2, (d.W / 2 - 1) | 0), scale);
    if (view[1]) { // espejo en X: la "espalda" del pickup conserva la silueta legible
      ac.save();
      ac.translate(sx + d.W * scale, sy);
      ac.scale(-1, 1);
      ac.drawImage(view[0], 0, 0, d.W, d.H, 0, 0, d.W * scale, d.H * scale);
      ac.restore();
    } else {
      ac.drawImage(view[0], 0, 0, d.W, d.H, sx, sy, d.W * scale, d.H * scale);
    }
    c.drawImage(outlined(art, scale), i * cellW * scale, 0);
  });
  return { canvas: cv, views: 4, cellW: cellW * scale, cellH: cellH * scale };
}

