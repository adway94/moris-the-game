// sprites.js — arte pixel-art procedural estilo Doom/Boltgun para MORIS ARENA.
// Genera CanvasTexture con NearestFilter (crunch retro) y sprite-sheets por enemigo:
// cada tipo tiene frames de idle (2), y una variante flip se hace por escala X en el material,
// no duplicando pixeles. Todo dibujado a mano en canvas low-res (paleta limitada) y luego
// se deja nearest-neighbour al escalar → look 16-bit real sin assets externos.

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

// paletas por tipo (base / sombra / luz / acento emisivo)
const PAL = {
  droner:   { base:'#c0392b', dark:'#7d1f16', lite:'#ff6b5e', glow:'#ffdada', eye:'#fff3a0' },
  sprinter: { base:'#8e44ad', dark:'#5e2b76', lite:'#c77dff', glow:'#f0d9ff', eye:'#b6ff' },
  brute:    { base:'#d97a2b', dark:'#8a4a12', lite:'#ffb057', glow:'#fff0c0', eye:'#ffe14d' },
};

// ---- DRONER: dron flotante con un ojo grande y antenita (idle 2 frames = aleteo)
function drawDroner(frame, s) {
  const W = 24, H = 28, { cv, c } = pixelCanvas(W, H, s), P = PAL.droner;
  const bob = frame === 0 ? 0 : -1; // aleteo vertical de 1px
  // antena
  rectPx(c, 11, 2 + bob, 1, 3, s, P.dark); px(c, 11, 1 + bob, s, P.glow);
  // cuerpo (óvalo escalonado)
  const body = [[8,7,8],[7,8,10],[6,9,12],[6,10,12],[6,11,12],[7,12,10],[8,13,8]];
  for (const [x,y,w] of body) rectPx(c, x, y + bob + 4, w, 1, s, P.base);
  // sombra inferior + luz superior
  rectPx(c, 7, 16 + bob, 10, 2, s, P.dark);
  rectPx(c, 8, 9 + bob, 6, 1, s, P.lite);
  // ojo emisivo central
  rectPx(c, 10, 12 + bob, 4, 3, s, '#2a0a0a');
  rectPx(c, 11, 13 + bob, 2, 2, s, P.eye);
  px(c, 11, 13 + bob, s, '#ffffff');
  // púas laterales
  px(c, 5, 12 + bob, s, P.dark); px(c, 18, 12 + bob, s, P.dark);
  return cv;
}

// ---- SPRINTER: criatura delgada y agresiva, dos ojos, fauces (idle = respiración)
function drawSprinter(frame, s) {
  const W = 20, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.sprinter;
  const g = frame === 0 ? 0 : 1;
  // cabeza triangular
  for (let i = 0; i < 6; i++) rectPx(c, 5 + i, 4 + i + g, 10 - i * 2, 1, s, P.base);
  // ojos brillantes
  px(c, 7, 8 + g, s, P.eye); px(c, 8, 8 + g, s, P.eye);
  px(c, 12, 8 + g, s, P.eye); px(c, 11, 8 + g, s, P.eye);
  // fauces
  rectPx(c, 8, 10 + g, 4, 1, s, '#1a0620');
  px(c, 8, 11 + g, s, '#fff'); px(c, 10, 11 + g, s, '#fff'); px(c, 12, 11 + g, s, '#fff');
  // torso flaco + patas
  rectPx(c, 8, 13 + g, 4, 6, s, P.base);
  rectPx(c, 7, 15 + g, 1, 4, s, P.dark); rectPx(c, 12, 15 + g, 1, 4, s, P.dark);
  // zarpas
  px(c, 6, 20 + g, s, P.lite); px(c, 13, 20 + g, s, P.lite);
  rectPx(c, 8, 25 + g, 4, 2, s, P.dark);
  return cv;
}

// ---- BRUTE: mole blindada con núcleo de energía en el pecho (idle = pulso)
function drawBrute(frame, s) {
  const W = 30, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.brute;
  const pulse = frame === 0 ? 0 : 1;
  // hombros anchos
  rectPx(c, 4, 6, 22, 4, s, P.base);
  rectPx(c, 3, 8, 24, 6, s, P.base);
  rectPx(c, 5, 14, 20, 8, s, P.dark);
  // cabeza hundida entre hombros
  rectPx(c, 12, 3, 6, 4, s, P.lite);
  px(c, 13, 4, s, '#2a0a0a'); px(c, 16, 4, s, '#2a0a0a');
  // núcleo de energía en el pecho (emisivo)
  rectPx(c, 12 - pulse, 11 - pulse, 6 + pulse * 2, 6 + pulse * 2, s, P.eye);
  rectPx(c, 13, 12, 4, 4, s, '#fff');
  // brazos columnas
  rectPx(c, 2, 10, 3, 12, s, P.base); rectPx(c, 25, 10, 3, 12, s, P.base);
  px(c, 2, 22, s, P.glow); px(c, 27, 22, s, P.glow);
  // base pesada
  rectPx(c, 8, 22, 14, 4, s, P.dark);
  return cv;
}

const DRAW = { droner: drawDroner, sprinter: drawSprinter, brute: drawBrute };

// genera para un tipo el canvas de 2 frames lado a lado (sprite-sheet horizontal) + metadatos.
export function makeEnemySprite(type, scale = 4) {
  const f0 = DRAW[type](0, scale), f1 = DRAW[type](1, scale);
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
