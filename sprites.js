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
// NB (fix E3): los rectPx/px acá abajo omitían el argumento `s` de escala (quedaba el
// color en su posición → NaN en fillRect). Nada lo renderizaba aún (viewmodel todavía
// es 3D), pero E4 lo enchufa tal cual: pasado de escala restaurado, arte intacto.
export function makeWeaponSprite(accent = '#54f0ff', scale = 3) {
  const W = 96, H = 72, { cv, c, s } = pixelCanvas(W, H, scale);
  // guante / brazo abajo-derecha
  rectPx(c, 58, 46, 20, 20, s, '#3a2f28');
  rectPx(c, 58, 46, 20, 3, s, '#5a4a3e');
  // cuerpo del arma (perspectiva forzada estilo Doom: cañón hacia arriba-izq)
  rectPx(c, 40, 18, 10, 34, s, '#2b2f3a');   // cañón vertical
  rectPx(c, 40, 18, 10, 3, s, accent);        // boca emisiva
  rectPx(c, 36, 30, 18, 14, s, '#3a3f4c');   // cajera
  rectPx(c, 52, 40, 12, 16, s, '#2b2f3a');   // culata hacia el guante
  rectPx(c, 44, 34, 3, 8, s, accent);         // detalle emisivo
  px(c, 44, 20, s, '#fff'); px(c, 46, 20, s, '#fff');
  return { canvas: cv };
}

/* ============================================================ E3 — pickups del piso
   Ítems de recurso estilo Doom (vida / armadura / munición) como billboards pixelados
   chiquitos: canvas lógico 16×16 (12×12 el botiquín chico), idle de 2 frames y EL MISMO
   pipeline del arte de enemigo — outlined() para la silueta legible contra el fondo y
   sombra elíptica en damero (dither opaco, compatible alphaTest 0.5 del billboard).
   Cada key se dibuja UNA sola vez al cargar el módulo (los 4 lienzos de las vistas se
   comparten, el consumidor los usa read-only). Frame 1 = acento emisivo un paso más
   brillante: sobre un objeto de 12 px la alteración de brillo se lee mejor que una
   rotación de 1 px, y el billboard ya gira solo en el juego. */
const PDRAW = {
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
