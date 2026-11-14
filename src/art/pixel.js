// sprites.js — arte pixel-art procedural estilo Doom/Boltgun para MORIS ARENA.
// Genera CanvasTexture con NearestFilter (crunch retro) y sprite-sheets por enemigo:
// cada tipo tiene frames de idle (2), y una variante flip se hace por escala X en el material,
// no duplicando pixeles. Todo dibujado a mano en canvas low-res (paleta limitada) y luego
// se deja nearest-neighbour al escalar → look 16-bit real sin assets externos.
// E2: cada frame sale con silueta outline oscura de 1px (limpia contra el fondo) y
// sombra elíptica ditherada bajo el cuerpo. La sombra NO usa alpha: el material del
// billboard tiene alphaTest 0.5 (bordes duros sin halo), así que la transparencia falsa
// se logra con damero de pixeles enteros, técnica 16-bit de toda la vida.
// E6: bestiario por nivel (esporeador/lancellas/posesivo/espectro/glitch) y los 5
// mini-jefes (criopylot/huerta/fundidor/confesor/moris9) entran por el mismo DRAW →
// makeEnemySprite no cambió: nuevo tipo = nueva función de dibujo + una fila en DRAW.

// helper: dibuja un sprite de WxH lógico con px "gigantes" (cada celda = 1px del canvas grande).
export function pixelCanvas(w, h, scale) {
  const cv = document.createElement('canvas');
  cv.width = w * scale; cv.height = h * scale;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  return { cv, c, s: scale };
}
export function px(c, x, y, s, col) { c.fillStyle = col; c.fillRect(x * s, y * s, s, s); }
export function rectPx(c, x, y, w, h, s, col) { c.fillStyle = col; c.fillRect(x * s, y * s, w * s, h * s); }

// óvalo de píxeles (centro en celda entera): cuerpos redondeados y sombras sin escalones feos
export function ellipsePx(c, cx, cy, rx, ry, s, col) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1.05) px(c, cx + x, cy + y, s, col);
}

// E4b: variantes SIN relleno de ellipsePx — el borde del óvalo (anillo de energía de la
// célula del plasma) y el relleno plano (la frontera <=1 es la misma regla, sin el 5% de
// tolerancia del cuerpo para que el aro de 1 px quede parejo).
export function ellipseOutline(c, cx, cy, rx, ry, s, col) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      const e = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (e <= 1 && ((x + 1) * (x + 1)) / (rx * rx) + (y * y) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
      if (e <= 1 && ((x - 1) * (x - 1)) / (rx * rx) + (y * y) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
      if (e <= 1 && (x * x) / (rx * rx) + ((y + 1) * (y + 1)) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
      if (e <= 1 && (x * x) / (rx * rx) + ((y - 1) * (y - 1)) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
    }
}
export function ellipseFill(c, cx, cy, rx, ry, s, col) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) px(c, cx + x, cy + y, s, col);
}

// sombra de suelo: núcleo lleno + borde exterior en damero (dither opaco, compatible alphaTest)
export function shadowPx(c, cx, cy, rx, s, col = '#141019') {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -rx; dx <= rx; dx++) {
      const e = (dx * dx) / (rx * rx) + dy * dy;
      if (e <= 0.5) px(c, cx + dx, cy + dy, s, col);
      else if (e <= 1.1 && ((dx + dy) & 1) === 0) px(c, cx + dx, cy + dy, s, col);
    }
}

// outline de 1px: copia el arte desplazado en las 8 vecindades, tiñe el resultado a color
// oscuro (source-in sobre el alpha) y re-dibuja el arte encima → silueta 16-bit limpia
// sin tocar los colores internos ni duplicar pixeles a mano.
export function outlined(art, s, col = '#130d18') {
  const sil = document.createElement('canvas');
  sil.width = art.width; sil.height = art.height;
  const sc = sil.getContext('2d'); sc.imageSmoothingEnabled = false;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
    sc.drawImage(art, dx * s, dy * s);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = col; sc.fillRect(0, 0, sil.width, sil.height);
  const out = document.createElement('canvas');
  out.width = art.width; out.height = art.height;
  const oc = out.getContext('2d'); oc.imageSmoothingEnabled = false;
  oc.drawImage(sil, 0, 0); oc.drawImage(art, 0, 0);
  return out;
}

