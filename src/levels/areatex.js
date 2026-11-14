import { $, rand, rr } from '../core/utils.js';
import { canvasTex } from '../render/sky.js';

/* ---------------- texturas procedurales del arena (canvas, sin assets) ------- */
export function specks(c, S, n, pick) {
  for (let i = 0; i < n; i++) { c.fillStyle = pick(); c.fillRect(rand(0, S), rand(0, S), 1, 1); }
}
export function rivet(c, x, y, r = 6) {
  c.fillStyle = '#050810'; c.beginPath(); c.arc(x, y, r * 1.25, 0, 7); c.fill();
  c.fillStyle = '#22304e'; c.beginPath(); c.arc(x, y, r * 0.9, 0, 7); c.fill();
  c.fillStyle = '#43597f'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.38, 0, 7); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(x + r * 0.35, y + r * 0.4, r * 0.24, 0, 7); c.fill();
}

// Piso (E5 parametrizado por paleta): paneles metálicos sci-fi — placa con bisel,
// remaches, junta emisiva en la costura (pal.seam; en N5 sube de brillo: grilla Tron),
// ranura de ventilación, código de barras y ruido sutil. 1 tile = 4 m.
export function makeFloorTex(pal, seamK = 1) {
  return canvasTex(512, (c, S) => {
    c.fillStyle = pal.floor; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 240; i++) { // rayado vertical tipo chapa
      c.fillStyle = `rgba(${pal.noise},${rand(0.012, 0.04).toFixed(3)})`;
      c.fillRect(rand(0, S), 0, rand(0.6, 2.4), S);
    }
    // costura del tile (biselada, con junta emisiva tenue que al repetir forma la grilla)
    c.strokeStyle = pal.dark; c.lineWidth = 26; c.strokeRect(14, 14, S - 28, S - 28);
    c.strokeStyle = `rgba(${pal.seam},${Math.min(0.9, 0.30 * seamK).toFixed(2)})`; c.lineWidth = 3; c.strokeRect(14, 14, S - 28, S - 28);
    c.strokeStyle = `rgba(${pal.seam},${Math.min(0.4, 0.09 * seamK).toFixed(2)})`; c.lineWidth = 9; c.strokeRect(14, 14, S - 28, S - 28);
    // placa interior con bisel (luz arriba/izq, sombra abajo/der)
    c.fillStyle = pal.lite; c.fillRect(30, 30, S - 60, S - 60);
    c.strokeStyle = pal.floor; c.lineWidth = 5;
    c.beginPath(); c.moveTo(30, 484); c.lineTo(30, 30); c.lineTo(484, 30); c.stroke();
    c.strokeStyle = pal.dark;
    c.beginPath(); c.moveTo(484, 32); c.lineTo(484, 484); c.lineTo(32, 484); c.stroke();
    for (let i = 0; i < 150; i++) { // ruido fino sobre la placa
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
      c.fillRect(rand(34, 476), rand(34, 476), rand(1, 3), 1);
    }
    // sub-panel interior rebajado
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 3; c.strokeRect(150, 150, 212, 212);
    c.strokeStyle = `rgba(${pal.noise},0.05)`; c.lineWidth = 1; c.strokeRect(153, 153, 206, 206);
    [58, 454].forEach(x => [58, 454].forEach(y => rivet(c, x, y)));
    // ranura de ventilación
    c.fillStyle = pal.dark; rr(c, 330, 340, 128, 40, 8); c.fill();
    c.strokeStyle = `rgba(${pal.noise},0.08)`; c.lineWidth = 1; rr(c, 330, 340, 128, 40, 8); c.stroke();
    c.fillStyle = pal.lite;
    for (let i = 0; i < 5; i++) c.fillRect(338, 346 + i * 7, 112, 2);
    // código de barras + marcas de stencil en el neón del nivel
    let bx = 66;
    while (bx < 170) { const w = rand(1, 3.4); c.fillStyle = `rgba(${pal.noise},${rand(0.07, 0.18).toFixed(2)})`; c.fillRect(bx, 344, w, 34); bx += w + rand(1.5, 4); }
    c.fillStyle = `rgba(${pal.seam},0.28)`; c.fillRect(66, 300, 46, 5); c.fillRect(66, 311, 22, 5);
    c.fillStyle = `rgba(${pal.seam},0.16)`; c.fillRect(404, 96, 5, 30); c.fillRect(415, 96, 5, 18);
    specks(c, S, 220, () => Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)');
  }, 16, 16);
}

// Muros (E5 parametrizado): paneles verticales con rejilla de detalle, franja de
// chevrons de advertición abajo (el color viene de la paleta) y zócalo oscuro.
// 1 tile ≈ 6 × 5 m (repeat 11 × 1).
export function makeWallTex(pal) {
  return canvasTex(256, (c, S) => {
    c.fillStyle = pal.wall; c.fillRect(0, 0, S, S);
    // rejilla sutil en toda la cara
    c.strokeStyle = `rgba(${pal.wallLite},0.035)`; c.lineWidth = 1;
    c.beginPath();
    for (let x = 16; x < S; x += 16) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, S); }
    for (let y = 16; y < S; y += 16) { c.moveTo(0, y + 0.5); c.lineTo(S, y + 0.5); }
    c.stroke();
    // juntas verticales de panel (cada 64 px = ~1.5 m) con filo iluminado
    [0, 64, 128, 192].forEach(x => {
      c.fillStyle = pal.dark; c.fillRect(x - 2, 0, 5, S);
      c.fillStyle = `rgba(${pal.wallLite},0.10)`; c.fillRect(x + 3, 0, 1, S);
    });
    // pernos a media altura
    [32, 96, 160, 224].forEach(x => rivet(c, x, 108, 3));
    // sombra del borde superior
    const g = c.createLinearGradient(0, 0, 0, 68);
    g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, 68);
    // ---- franja de chevrons (paso 32 → envuelve sin costura) ----
    const BY = S - 88, BH = 54;
    c.save();
    c.beginPath(); c.rect(0, BY, S, BH); c.clip();
    c.fillStyle = pal.chevronBack; c.fillRect(0, BY, S, BH);
    c.lineCap = 'square';
    for (let x = -S; x < S * 2; x += 32) {
      c.strokeStyle = pal.chevron; c.lineWidth = 15;
      c.beginPath(); c.moveTo(x, BY + BH + 20); c.lineTo(x + BH + 40, BY - 20); c.stroke();
      c.strokeStyle = pal.chevronLite; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x, BY + BH + 20); c.lineTo(x + BH + 40, BY - 20); c.stroke();
    }
    c.restore();
    c.fillStyle = pal.dark; c.fillRect(0, BY - 5, S, 5); c.fillRect(0, BY + BH, S, 4);
    c.fillStyle = pal.chevronLite; c.fillRect(0, BY - 8, S, 2);
    // zócalo inferior
    const g2 = c.createLinearGradient(0, S - 34, 0, S);
    g2.addColorStop(0, 'rgba(2,4,9,0.15)'); g2.addColorStop(1, 'rgba(2,4,9,0.85)');
    c.fillStyle = g2; c.fillRect(0, S - 34, S, 34);
    // rayones y mugre
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = `rgba(0,0,0,${rand(0.12, 0.3).toFixed(2)})`; c.lineWidth = rand(1, 2.4);
      const x = rand(0, S), y = rand(0, S - 96), l = rand(6, 34);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + rand(-l, l), y + rand(-l * 0.3, l * 0.3)); c.stroke();
    }
    specks(c, S, 160, () => Math.random() < 0.6 ? 'rgba(0,0,0,0.10)' : `rgba(${pal.wallLite},0.04)`);
  }, 11, 1);
}

// Obstáculos (E5 parametrizado): metal cepillado con bordes achaflanados gastados y
// esquinas desportilladas (el desgaste vive en los bordes del UV de cada cara).
export function makeObTex(pal) {
  return canvasTex(256, (c, S) => {
    c.fillStyle = pal.ob; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 340; i++) { // cepillado horizontal
      c.fillStyle = Math.random() < 0.55
        ? `rgba(${pal.obLite},${rand(0.015, 0.055).toFixed(3)})`
        : `rgba(0,0,0,${rand(0.02, 0.06).toFixed(3)})`;
      c.fillRect(0, rand(0, S), S, rand(0.6, 2));
    }
    // bisel de aristas: gradientes interior + hilo brillante del chaflán
    const gl = [c.createLinearGradient(0, 0, 0, 26), c.createLinearGradient(0, S - 26, 0, S),
                c.createLinearGradient(0, 0, 26, 0), c.createLinearGradient(S - 26, 0, S, 0)];
    const fills = [`rgba(${pal.obLite},0.10)`, 'rgba(0,0,0,0.38)', `rgba(${pal.noise},0.06)`, 'rgba(0,0,0,0.20)'];
    gl[0].addColorStop(0, fills[0]); gl[0].addColorStop(1, 'rgba(0,0,0,0)');
    gl[1].addColorStop(0, 'rgba(0,0,0,0)'); gl[1].addColorStop(1, fills[1]);
    gl[2].addColorStop(0, fills[2]); gl[2].addColorStop(1, 'rgba(0,0,0,0)');
    gl[3].addColorStop(0, 'rgba(0,0,0,0)'); gl[3].addColorStop(1, fills[3]);
    c.fillStyle = gl[0]; c.fillRect(0, 0, S, 26);
    c.fillStyle = gl[1]; c.fillRect(0, S - 26, S, 26);
    c.fillStyle = gl[2]; c.fillRect(0, 0, 26, S);
    c.fillStyle = gl[3]; c.fillRect(S - 26, 0, 26, S);
    c.strokeStyle = `rgba(${pal.obLite},0.30)`; c.lineWidth = 1; c.strokeRect(0.5, 0.5, S - 1, S - 1);
    // desgaste de esquinas: manchas claras + picaduras oscuras + rasguños radiales
    [[14, 14, 1, 1], [S - 14, 14, -1, 1], [14, S - 14, 1, -1], [S - 14, S - 14, -1, -1]].forEach(([cx, cy, sx, sy]) => {
      for (let i = 0; i < 24; i++) {
        c.fillStyle = `rgba(${pal.obLite},${rand(0.05, 0.24).toFixed(2)})`;
        c.beginPath(); c.ellipse(cx + sx * rand(0, 32), cy + sy * rand(0, 32), rand(0.5, 2.6), rand(0.5, 2.2), rand(0, 3.14), 0, 7); c.fill();
      }
      for (let i = 0; i < 10; i++) {
        c.fillStyle = `rgba(8,12,22,${rand(0.15, 0.38).toFixed(2)})`;
        c.beginPath(); c.arc(cx + sx * rand(0, 28), cy + sy * rand(0, 28), rand(0.4, 1.8), 0, 7); c.fill();
      }
      for (let i = 0; i < 5; i++) {
        c.strokeStyle = `rgba(${pal.obLite},${rand(0.06, 0.16).toFixed(2)})`; c.lineWidth = rand(0.5, 1.2);
        const a = rand(0.6, 2.2);
        c.beginPath(); c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * sx * rand(10, 36), cy + Math.sin(a) * sy * rand(10, 36)); c.stroke();
      }
      rivet(c, cx + sx * 8, cy + sy * 8, 3);
    });
    // marca de plantilla central en el neón del nivel
    c.fillStyle = `rgba(${pal.seam},0.16)`; c.fillRect(104, 116, 48, 8); c.fillRect(104, 130, 26, 8);
    let bx = 158; while (bx < 186) { const w = rand(1, 2.6); c.fillStyle = `rgba(${pal.noise},${rand(0.08, 0.16).toFixed(2)})`; c.fillRect(bx, 116, w, 22); bx += w + rand(1.5, 3); }
    specks(c, S, 180, () => Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.09)');
  }, 2, 2);
}

