// sprites.js — arte pixel-art procedural estilo Doom/Boltgun para MORIS ARENA.
// Genera CanvasTexture con NearestFilter (crunch retro) y sprite-sheets por enemigo:
// cada tipo tiene frames de idle (2), y una variante flip se hace por escala X en el material,
// no duplicando pixeles. Todo dibujado a mano en canvas low-res (paleta limitada) y luego
// se deja nearest-neighbour al escalar → look 16-bit real sin assets externos.
// E2: cada frame sale con silueta outline oscura de 1px (limpia contra el fondo) y
// sombra elíptica ditherada bajo el cuerpo. La sombra NO usa alpha: el material del
// billboard tiene alphaTest 0.5 (bordes duros sin halo), así que la transparencia falsa
// se logra con damero de pixeles enteros, técnica 16-bit de toda la vida.

// helper: dibuja un sprite de WxH lógico con px "gigantes" (cada celda = 1px del canvas grande).
function pixelCanvas(w, h, scale) {
  const cv = document.createElement('canvas');
  cv.width = w * scale; cv.height = h * scale;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  return { cv, c, s: scale };
}
function px(c, x, y, s, col) { c.fillStyle = col; c.fillRect(x * s, y * s, s, s); }
function rectPx(c, x, y, w, h, s, col) { c.fillStyle = col; c.fillRect(x * s, y * s, w * s, h * s); }

// óvalo de píxeles (centro en celda entera): cuerpos redondeados y sombras sin escalones feos
function ellipsePx(c, cx, cy, rx, ry, s, col) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1.05) px(c, cx + x, cy + y, s, col);
}

// sombra de suelo: núcleo lleno + borde exterior en damero (dither opaco, compatible alphaTest)
function shadowPx(c, cx, cy, rx, s, col = '#141019') {
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
function outlined(art, s, col = '#130d18') {
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

// paletas por tipo (base / sombra / luz / acento emisivo)
const PAL = {
  droner:   { base:'#c0392b', dark:'#7d1f16', lite:'#ff6b5e', glow:'#ffdada', eye:'#fff3a0' },
  sprinter: { base:'#8e44ad', dark:'#5e2b76', lite:'#c77dff', glow:'#f0d9ff', eye:'#b8ffe8' },
  brute:    { base:'#d97a2b', dark:'#8a4a12', lite:'#ffb057', glow:'#fff0c0', eye:'#ffe14d' },
};

// ---- DRONER: dron flotante con un ojo grande y antenita (idle 2 frames = aleteo)
function drawDroner(frame, s) {
  const W = 24, H = 28, { cv, c } = pixelCanvas(W, H, s), P = PAL.droner;
  const b = frame === 1 ? -1 : 0; // aleteo: cuerpo y antena suben 1px, sombra queda fija
  shadowPx(c, 12, 25, 5, s);
  rectPx(c, 11, 5 + b, 1, 3, s, P.dark);        // antena (apoya en el cuerpo, fila 8)
  px(c, 11, 4 + b, s, P.glow);                  // puntito emisivo
  ellipsePx(c, 12, 13 + b, 6, 5, s, P.base);    // cuerpo óvalo (filas 8..18)
  rectPx(c, 8, 16 + b, 8, 1, s, P.dark);        // panza en sombra (dentro del óvalo)
  rectPx(c, 9, 9 + b, 6, 1, s, P.lite);         // brillo superior (filas 9 = tapa)
  px(c, 5, 13 + b, s, P.dark); px(c, 19, 13 + b, s, P.dark); // púas laterales
  rectPx(c, 10, 12 + b, 5, 4, s, '#2a0a0a');    // cuenca del ojo
  rectPx(c, 11, 13 + b, 3, 2, s, P.eye);        // iris emisivo
  px(c, 11, 13 + b, s, '#ffffff');              // destello
  return cv;
}

// ---- SPRINTER: criatura delgada y agresiva, dos ojos, fauces (idle = respiración)
function drawSprinter(frame, s) {
  const W = 20, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.sprinter;
  const g = frame === 1 ? 1 : 0; // respiración: todo hunde 1px (sombra fija)
  shadowPx(c, 10, 28, 4, s);
  // cabeza cuña: frente ancha que estrecha hacia el hocico (filas 4..8)
  for (let i = 0; i < 5; i++) rectPx(c, 5 + i, 4 + i + g, 10 - 2 * i, 1, s, i === 0 ? P.lite : P.base);
  px(c, 7, 5 + g, s, P.eye); px(c, 12, 5 + g, s, P.eye);       // ojos exteriores
  px(c, 8, 5 + g, s, '#ffffff'); px(c, 11, 5 + g, s, '#ffffff'); // brillos internos
  rectPx(c, 8, 7 + g, 4, 1, s, '#1a0620');                     // fauces
  px(c, 8, 7 + g, s, '#fff'); px(c, 11, 7 + g, s, '#fff');     // colmillos a los bordes
  rectPx(c, 9, 9 + g, 2, 1, s, P.dark);                        // cuello (une cabeza y torso)
  rectPx(c, 8, 10 + g, 4, 7, s, P.base);                       // torso flaco (filas 10..16)
  rectPx(c, 9, 12 + g, 2, 3, s, P.glow);                       // esternón emisivo
  rectPx(c, 7, 11 + g, 1, 6, s, P.dark);                       // brazos apoyados al torso
  rectPx(c, 12, 11 + g, 1, 6, s, P.dark);
  px(c, 6, 17 + g, s, P.lite); px(c, 13, 17 + g, s, P.lite);   // zarpas
  rectPx(c, 8, 17 + g, 1, 9, s, P.dark);                       // piernas (filas 17..25)
  rectPx(c, 11, 17 + g, 1, 9, s, P.dark);
  rectPx(c, 7, 26 + g, 3, 1, s, P.base);                       // pies
  rectPx(c, 10, 26 + g, 3, 1, s, P.base);
  return cv;
}

// ---- BRUTE: mole blindada con núcleo de energía en el pecho (idle = pulso)
function drawBrute(frame, s) {
  const W = 30, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.brute;
  const pulse = frame === 1 ? 1 : 0;
  shadowPx(c, 15, 27, 8, s);
  // cabeza hundida entre hombros
  rectPx(c, 12, 3, 6, 4, s, P.lite);
  px(c, 13, 4, s, '#2a0a0a'); px(c, 16, 4, s, '#2a0a0a');
  // hombros anchos + torso superior
  rectPx(c, 4, 6, 22, 4, s, P.base);
  rectPx(c, 3, 8, 24, 6, s, P.base);
  rectPx(c, 6, 6, 18, 1, s, P.lite);        // brillo de hombros
  rectPx(c, 5, 14, 20, 8, s, P.dark);       // torso inferior
  // núcleo de energía en el pecho (emisivo, late agrandándose 2px)
  rectPx(c, 11, 10, 8, 8, s, '#3a1608');    // cuenca del reactor
  rectPx(c, 12 - pulse, 11 - pulse, 6 + pulse * 2, 6 + pulse * 2, s, P.eye);
  rectPx(c, 13, 12, 4, 4, s, '#fff');
  // brazos columnas con nudillos emisivos
  rectPx(c, 2, 10, 3, 12, s, P.base); rectPx(c, 25, 10, 3, 12, s, P.base);
  px(c, 2, 22, s, P.glow); px(c, 27, 22, s, P.glow);
  // base pesada
  rectPx(c, 8, 22, 14, 4, s, P.dark);
  rectPx(c, 9, 22, 12, 1, s, P.base);       // brillo de cintura
  return cv;
}

const DRAW = { droner: drawDroner, sprinter: drawSprinter, brute: drawBrute };

// genera para un tipo el canvas de 2 frames lado a lado (sprite-sheet horizontal) + metadatos.
// Cada frame pasa por outlined() → la silueta ya viene con el borde oscuro hecho.
export function makeEnemySprite(type, scale = 4) {
  const f0 = outlined(DRAW[type](0, scale), scale);
  const f1 = outlined(DRAW[type](1, scale), scale);
  const cv = document.createElement('canvas');
  cv.width = f0.width * 2; cv.height = f0.height;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(f0, 0, 0); c.drawImage(f1, f0.width, 0);
  return { canvas: cv, frames: 2, frameW: f0.width, frameH: f0.height };
}

// ---- viewmodel del arma en primera persona (brazo + cañón pixelado, idle 2 frames)
export function makeWeaponSprite(accent = '#54f0ff', scale = 3) {
  const W = 96, H = 72, { cv, c } = pixelCanvas(W, H, scale);
  // guante / brazo abajo-derecha
  rectPx(c, 58, 46, 20, 20, '#3a2f28');
  rectPx(c, 58, 46, 20, 3, '#5a4a3e');
  // cuerpo del arma (perspectiva forzada estilo Doom: cañón hacia arriba-izq)
  rectPx(c, 40, 18, 10, 34, '#2b2f3a');   // cañón vertical
  rectPx(c, 40, 18, 10, 3, accent);        // boca emisiva
  rectPx(c, 36, 30, 18, 14, '#3a3f4c');   // cajera
  rectPx(c, 52, 40, 12, 16, '#2b2f3a');   // culata hacia el guante
  rectPx(c, 44, 34, 3, 8, accent);         // detalle emisivo
  px(c, 44, 20, '#fff'); px(c, 46, 20, '#fff');
  return { canvas: cv };
}
