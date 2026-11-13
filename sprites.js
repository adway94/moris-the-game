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

// E4b: variantes SIN relleno de ellipsePx — el borde del óvalo (anillo de energía de la
// célula del plasma) y el relleno plano (la frontera <=1 es la misma regla, sin el 5% de
// tolerancia del cuerpo para que el aro de 1 px quede parejo).
function ellipseOutline(c, cx, cy, rx, ry, s, col) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      const e = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (e <= 1 && ((x + 1) * (x + 1)) / (rx * rx) + (y * y) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
      if (e <= 1 && ((x - 1) * (x - 1)) / (rx * rx) + (y * y) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
      if (e <= 1 && (x * x) / (rx * rx) + ((y + 1) * (y + 1)) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
      if (e <= 1 && (x * x) / (rx * rx) + ((y - 1) * (y - 1)) / (ry * ry) > 1) px(c, cx + x, cy + y, s, col);
    }
}
function ellipseFill(c, cx, cy, rx, ry, s, col) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) px(c, cx + x, cy + y, s, col);
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

/* ============================================================ E6 — bestiario por nivel
   Cinco tipos nuevos + cinco mini-jefes, todos con el MISMO pipeline del E2: canvas
   lógico low-res, outlined() para la silueta, sombra elíptica en damero (dither opaco,
   compatible alphaTest 0.5) e idle de 2 frames. Paletas tomadas de las PALETTES de
   game.js para que cada bicho pertenezca visualmente a su sector:
     · esporeador (N2) — hongo caminante: verde invernadero + broches magenta de los charcos
     · lancellas  (N3) — droner armado con 3 lanzas: naranja reactor, lava en las puntas
     · posesivo   (N4) — calco del sprinter en violeta pálido de la cripta
     · espectro   (N4) — orbe con rostro velado; game.js le baja el alpha del material
     · glitch     (N5) — droner "roto": scanlines desplazadas y medias siluetas cyan/
       magenta (el tinte que parpadea lo pone game.js alternando material.color) */
Object.assign(PAL, {
  esporeador: { base:'#2f9e50', dark:'#17602f', lite:'#74e39a', glow:'#ff5ee0', eye:'#eafff0', stem:'#d8e8c8', stemDark:'#8fa884' },
  lancellas:  { base:'#e0641f', dark:'#7c3410', lite:'#ffb057', glow:'#ffd166', eye:'#fff3a0' },
  posesivo:   { base:'#c3b1ee', dark:'#6c5598', lite:'#efe7ff', glow:'#ffffff', eye:'#8dfaff' },
  espectro:   { base:'#7a4dd0', dark:'#3c2070', lite:'#c9a6ff', glow:'#ff5ee0', eye:'#f2e8ff' },
  glitch:     { base:'#27425f', dark:'#101c2c', lite:'#54f0ff', glow:'#ff3bd8', eye:'#e8ffff' },
});

// ---- ESPOREADOR (N2): hongo que CAMINA (piezas cortas bajo el sombrero, idle = balanceo)
function drawEsporeador(frame, s) {
  const W = 24, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.esporeador;
  const g = frame === 1 ? 1 : 0; // el sombrero hunde 1px y las esporas flotan (sombra fija)
  shadowPx(c, 12, 28, 6, s);
  ellipsePx(c, 12, 12 + g, 8, 5, s, P.base);       // sombrero (filas 7..17)
  rectPx(c, 5, 15 + g, 14, 1, s, P.dark);          // borde inferior del sombrero
  rectPx(c, 7, 8 + g, 9, 1, s, P.lite);            // brillo de copa
  px(c, 8, 11 + g, s, P.glow); px(c, 9, 11 + g, s, P.glow); // verrugas magenta emisivas
  px(c, 14, 10 + g, s, P.glow); px(c, 15, 11 + g, s, P.glow);
  px(c, 11, 13 + g, s, P.glow);
  rectPx(c, 10, 16 + g, 4, 6, s, P.stem);          // pie carnoso (filas 16..21)
  rectPx(c, 13, 16 + g, 1, 6, s, P.stemDark);      // sombra del pie
  px(c, 7, 6 + g, s, P.lite); px(c, 17, 7 + g, s, P.lite);   // esporas que se desprenden
  px(c, 16, 4 + g, s, P.stem);
  px(c, 6, 4 + g, s, P.stem); px(c, 18, 21, s, P.stem);      // esporas bajas (fijas, sin g)
  rectPx(c, 9, 18 + g, 6, 2, s, P.dark);                     // boca oscura bajo el sombrero
  px(c, 10, 18 + g, s, P.eye); px(c, 13, 18 + g, s, P.eye);  // ojitos hundidos
  rectPx(c, 8, 22, 3, 4, s, P.stem);               // patas cortas (filas fijas: camina)
  rectPx(c, 13, 22, 3, 4, s, P.stem);
  rectPx(c, 7, 26, 4, 1, s, P.stemDark);           // pies
  rectPx(c, 13, 26, 4, 1, s, P.stemDark);
  return cv;
}

// ---- LANCELLAS (N3): droner con tres lanzas de fundición (idle = aleteo + brasas)
function drawLancellas(frame, s) {
  const W = 30, H = 32, { cv, c } = pixelCanvas(W, H, s), P = PAL.lancellas;
  const b = frame === 1 ? -1 : 0; // el cuerpo sube 1px; las lanzas viajan con él
  shadowPx(c, 15, 29, 7, s);
  rectPx(c, 2, 2 + b, 1, 16, s, '#4a3a2e');        // caña lanza izq (hasta la fila 17 del cuerpo)
  rectPx(c, 27, 2 + b, 1, 16, s, '#4a3a2e');       // caña lanza der
  rectPx(c, 15, 3 + b, 1, 15, s, '#4a3a2e');       // caña lanza central (detrás del cuerpo)
  px(c, 2, 2 + b, s, P.eye); px(c, 1, 3 + b, s, P.eye); px(c, 3, 3 + b, s, P.eye); // puntas de lava
  px(c, 27, 2 + b, s, P.eye); px(c, 26, 3 + b, s, P.eye); px(c, 28, 3 + b, s, P.eye);
  px(c, 15, 3 + b, s, P.eye); px(c, 15, 2 + b, s, '#ffffff');
  rectPx(c, 14, 5 + b, 1, 3, s, P.dark);           // antena
  px(c, 14, 4 + b, s, P.glow);
  ellipsePx(c, 15, 13 + b, 6, 5, s, P.base);       // cuerpo (igual de droner, chapa naranja)
  rectPx(c, 11, 16 + b, 8, 1, s, P.dark);          // panza en sombra
  rectPx(c, 12, 9 + b, 6, 1, s, P.lite);           // brillo superior
  px(c, 8, 13 + b, s, P.dark); px(c, 22, 13 + b, s, P.dark); // púas laterales
  rectPx(c, 13, 12 + b, 5, 4, s, '#2a0e04');       // cuenca del ojo
  rectPx(c, 14, 13 + b, 3, 2, s, P.eye);           // iris de fundición
  px(c, 14, 13 + b, s, '#ffffff');
  px(c, 6, 22, s, P.glow); px(c, 24, 21, s, P.eye); // brasas que gotean (fijas, titilan 2px)
  return cv;
}

// ---- POSESVIVO (N4): calco exacto del sprinter en violeta pálido (idle = respiración)
function drawPosesivo(frame, s) {
  const W = 20, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.posesivo;
  const g = frame === 1 ? 1 : 0;
  shadowPx(c, 10, 28, 4, s);
  for (let i = 0; i < 5; i++) rectPx(c, 5 + i, 4 + i + g, 10 - 2 * i, 1, s, i === 0 ? P.lite : P.base);
  px(c, 7, 5 + g, s, P.eye); px(c, 12, 5 + g, s, P.eye);
  px(c, 8, 5 + g, s, '#ffffff'); px(c, 11, 5 + g, s, '#ffffff');
  rectPx(c, 8, 7 + g, 4, 1, s, '#241633');
  px(c, 8, 7 + g, s, '#fff'); px(c, 11, 7 + g, s, '#fff');
  rectPx(c, 9, 9 + g, 2, 1, s, P.dark);
  rectPx(c, 8, 10 + g, 4, 7, s, P.base);
  rectPx(c, 9, 12 + g, 2, 3, s, P.glow);           // esternón blanco (el poseído "está adentro")
  rectPx(c, 7, 11 + g, 1, 6, s, P.dark);
  rectPx(c, 12, 11 + g, 1, 6, s, P.dark);
  px(c, 6, 17 + g, s, P.lite); px(c, 13, 17 + g, s, P.lite);
  rectPx(c, 8, 17 + g, 1, 9, s, P.dark);
  rectPx(c, 11, 17 + g, 1, 9, s, P.dark);
  rectPx(c, 7, 26 + g, 3, 1, s, P.base);
  rectPx(c, 10, 26 + g, 3, 1, s, P.base);
  return cv;
}

// ---- ESPECTRO (N4): orbe flotante con rostro velado y flecos colgando (idle = respira)
function drawEspectro(frame, s) {
  const W = 22, H = 26, { cv, c } = pixelCanvas(W, H, s), P = PAL.espectro;
  const b = frame === 1 ? 1 : 0;                   // el cuerpo sube, los flecos se estiran
  shadowPx(c, 11, 24, 5, s);
  ellipsePx(c, 11, 11 + b, 7, 8, s, P.base);       // manto óvalo (filas 3..19)
  ellipsePx(c, 11, 9 + b, 5, 4, s, P.lite);        // frente iluminada
  rectPx(c, 7, 12 + b, 8, 4, s, '#1c0f33');        // cuenca del rostro velado
  px(c, 8, 13 + b, s, P.eye); px(c, 13, 13 + b, s, P.eye);   // ojos que miran desde el velo
  px(c, 9, 14 + b, s, P.glow); px(c, 12, 14 + b, s, P.glow); // pómulos magenta
  for (const [fx, fy, len] of [[5, 18, 2], [8, 19, 3], [11, 19, 4], [14, 19, 3], [17, 18, 2]])
    rectPx(c, fx, fy + b, 1, len, s, P.dark);      // flecos que gotean hacia la sombra
  rectPx(c, 10, 17 + b, 2, 1, s, P.glow);          // hilo emisivo del cierre del manto
  return cv;
}

// ---- GLITCH (N5): droner corrompido — mitades cyan/magenta + scanlines desplazadas.
// El tinte que parpadea lo hace game.js con material.color; acá vive la corrupción.
function drawGlitch(frame, s) {
  const W = 26, H = 30, { cv, c } = pixelCanvas(W, H, s), P = PAL.glitch;
  const dx = frame === 1 ? 1 : 0;                  // corrimiento horizontal de scanlines
  shadowPx(c, 13, 27, 6, s);
  rectPx(c, 12, 5, 1, 3, s, P.dark);
  px(c, 12, 4, s, P.lite);
  for (let y = 8; y < 19; y++) {                   // cuerpo banda a banda: borde cian, centro magenta
    const hw = Math.round(6 * Math.sqrt(Math.max(0, 1 - ((y - 13) * (y - 13)) / 25)));
    if (hw < 1) continue;
    const shift = ((y & 1) ? dx : 0) + ((y === 11 || y === 15) ? 1 : 0); // saltos de 1px por fila
    rectPx(c, 13 - hw + shift, y, 1, 1, s, P.lite);
    rectPx(c, 13 + hw - 1 + shift, y, 1, 1, s, P.glow);
    rectPx(c, 13 - hw + 1 + shift, y, Math.max(1, hw * 2 - 2), 1, s, P.base);
  }
  rectPx(c, 10 + dx, 12, 7, 5, s, '#081420');      // cuenca del ojo (corre con la banda)
  rectPx(c, 11 + dx, 13, 5, 3, s, '#00e5ff');
  px(c, 11 + dx, 13, s, '#ff3bd8'); px(c, 15 + dx, 15, s, '#ff3bd8'); // ojo bicolor roto
  px(c, 12 + dx, 13, s, '#ffffff');
  px(c, 5 + dx, 13, s, P.lite); px(c, 21 - dx, 13, s, P.glow); // púas desfasadas
  for (const [gx, gy] of [[3, 20], [22, 22], [7, 24], [18, 7], [21, 12]]) px(c, gx + (frame ? 1 : 0), gy, s, (gx & 1) ? P.lite : P.glow); // pixeles sueltos
  return cv;
}

/* ---- E6 — MINI-JEFES (sprites propios grandes; escala/plano lo pone game.js con
   ENEMY_TYPES.scale 2.2-2.8). Tinte HDR + aura de anillo heredados del elite E5. */
Object.assign(PAL, {
  criopylot: { base:'#35597c', dark:'#16283c', lite:'#7cc4ff', glow:'#8dfaff', eye:'#fff3a0', frost:'#d9f4ff' },
  huerta:    { base:'#2b8a48', dark:'#12522a', lite:'#78e39c', glow:'#ff5ee0', eye:'#ffd166', mouth:'#20081f' },
  fundidor:  { base:'#c85a22', dark:'#71300c', lite:'#ffb057', glow:'#ffe14d', eye:'#ff6a2a' },
  confesor:  { base:'#8a5ce0', dark:'#43227c', lite:'#d0b0ff', glow:'#ff5ee0', eye:'#f2e8ff', gold:'#ffc94d' },
  moris9:    { base:'#0a2438', dark:'#03101d', lite:'#2ad4ff', glow:'#54f0ff', eye:'#e0ffff', code:'#6dff5e' },
});

// ---- CRIOPYLOT (N1): droner gigante con cabina de cristal (el piloto criogénico adentro)
function drawCriopylot(frame, s) {
  const W = 32, H = 36, { cv, c } = pixelCanvas(W, H, s), P = PAL.criopylot;
  const b = frame === 1 ? -1 : 0;                  // aleteo del gigante (sombra fija)
  shadowPx(c, 16, 33, 9, s);
  rectPx(c, 15, 2 + b, 1, 4, s, P.dark);           // antena larga con baliza
  px(c, 15, 1 + b, s, P.glow);
  ellipsePx(c, 16, 16 + b, 10, 8, s, P.base);      // casco blindado
  rectPx(c, 7, 22 + b, 18, 1, s, P.dark);          // panza en sombra
  rectPx(c, 9, 9 + b, 14, 1, s, P.lite);           // brillo de casco
  rectPx(c, 4, 16 + b, 2, 1, s, P.dark); rectPx(c, 26, 16 + b, 2, 1, s, P.dark); // púas
  rectPx(c, 10, 12 + b, 12, 8, s, '#0e2c46');      // cabina de cristal (marco)
  rectPx(c, 11, 13 + b, 10, 6, s, '#1d5d94');      // vidrio
  px(c, 11, 13 + b, s, P.frost); px(c, 12, 13 + b, s, P.frost); // reflejo diagonal del cristal
  px(c, 12, 14 + b, s, P.frost); px(c, 13, 15 + b, s, P.frost);
  rectPx(c, 14, 14 + b, 4, 4, s, '#18314a');       // silueta del piloto criogénico
  px(c, 15, 15 + b, s, P.glow); px(c, 17, 16 + b, s, P.glow);   // visor del piloto
  rectPx(c, 20, 13 + b, 1, 5, s, P.frost);         // tubo del criopod
  rectPx(c, 24, 15 + b, 3, 3, s, P.dark);          // nano-puerto
  px(c, 25, 16 + b, s, P.glow);
  rectPx(c, 6, 25 + b, 4, 3, s, P.lite);           // cañones gemelos laterales
  rectPx(c, 22, 25 + b, 4, 3, s, P.lite);
  rectPx(c, 6, 25 + b, 4, 1, s, P.glow);
  rectPx(c, 22, 25 + b, 4, 1, s, P.glow);
  px(c, 6, 26 + b, s, '#0a1c2e'); px(c, 25, 26 + b, s, '#0a1c2e'); // bocas
  return cv;
}

// ---- PADRE HUERTA (N2): planta gorda QUIETA, boca de escupir y raíces anchas
function drawHuerta(frame, s) {
  const W = 36, H = 32, { cv, c } = pixelCanvas(W, H, s), P = PAL.huerta;
  const p = frame === 1 ? 1 : 0;                   // el bulbo se hincha (la boca abre)
  shadowPx(c, 18, 30, 12, s);
  ellipsePx(c, 18, 12, 12, 8 + p, s, P.base);      // bulbo gigante (más alto cuando traga)
  rectPx(c, 7, 17, 22, 1, s, P.dark);              // línea de base del bulbo
  rectPx(c, 10, 6, 14, 1, s, P.lite);              // brillo de copa
  px(c, 8, 9, s, P.glow); px(c, 9, 9, s, P.glow); px(c, 27, 10, s, P.glow); px(c, 26, 11, s, P.glow); // verrugas magenta
  px(c, 14, 7, s, P.glow); px(c, 22, 8, s, P.glow);
  rectPx(c, 11, 12 - p, 14, 6 + p * 2, s, P.mouth);// boca cueva (se abre 2px con el cuadro)
  for (let tx = 11; tx < 25; tx += 3) px(c, tx, 12 - p, s, '#eaffea');           // colmillos de pistilo arriba
  for (let tx = 12; tx < 25; tx += 3) px(c, tx, 17 + p * 2 - 1, s, '#eaffea');   // colmillos abajo
  rectPx(c, 15, 14, 6, 2, s, P.glow);              // garganta emisiva (carga el escupitajo)
  px(c, 8, 20, s, P.lite); px(c, 28, 20, s, P.lite); // ojitos codiciosos bajo el borde
  rectPx(c, 16, 20, 4, 5, s, '#256b38');           // tallo grueso
  rectPx(c, 19, 20, 1, 5, s, P.dark);              // sombra del tallo
  for (const [rx, rw] of [[3, 6], [12, 5], [21, 5], [30, 6]]) rectPx(c, rx, 26, rw, 2, s, '#1d5c30'); // raíces
  px(c, 3, 25, s, P.dark); px(c, 33, 25, s, P.dark);
  return cv;
}

// ---- FUNDIDOR (N3): brute con cañón de colada en el brazo derecho (idle = pulso del reactor)
function drawFundidor(frame, s) {
  const W = 34, H = 32, { cv, c } = pixelCanvas(W, H, s), P = PAL.fundidor;
  const pulse = frame === 1 ? 1 : 0;
  shadowPx(c, 17, 29, 11, s);
  rectPx(c, 13, 3, 6, 4, s, P.lite);               // cabeza hundida (mismo lenguaje del brute)
  px(c, 14, 4, s, '#2a0e04'); px(c, 17, 4, s, '#2a0e04');
  rectPx(c, 4, 6, 20, 4, s, P.base);               // hombro izquierdo + torso superior
  rectPx(c, 3, 8, 22, 6, s, P.base);
  rectPx(c, 6, 6, 16, 1, s, P.lite);               // brillo de hombros
  rectPx(c, 4, 14, 18, 8, s, P.dark);              // torso inferior
  rectPx(c, 10, 10, 7, 7, s, '#3a1608');           // reactor del pecho (hueco: el cañón lo corre)
  rectPx(c, 11 - pulse, 11 - pulse, 5 + pulse * 2, 5 + pulse * 2, s, P.eye);
  px(c, 13, 13, s, '#ffffff');
  rectPx(c, 23, 9, 3, 10, s, P.base);              // brazo izquierdo normal (columna)
  px(c, 23, 21, s, P.glow);
  rectPx(c, 1, 7, 4, 18, s, '#3a3f4c');            // CAÑÓN de colada (brazo derecho)
  rectPx(c, 1, 7, 4, 2, s, '#59616f');             // tapa del cañón
  rectPx(c, 2, 4, 3, 3, s, '#12151d');             // boca
  rectPx(c, 2, 4, 3, 2, s, P.eye);                 // lava en la boca (late con el pulso)
  px(c, 3, 3, s, frame ? '#ffe14d' : '#ff9a3d');   // brasa que asoma (alterna por frame)
  rectPx(c, 2, 11, 3, 2, s, P.eye);                // ventanilla de colada
  rectPx(c, 2, 15, 3, 2, s, P.eye);
  px(c, 7, 20, s, P.eye); px(c, 18, 23, s, P.eye); px(c, 8, 24, s, P.eye); // grietas de lava
  rectPx(c, 7, 22, 12, 4, s, P.dark);              // base pesada
  rectPx(c, 8, 22, 10, 1, s, P.base);              // brillo de cintura
  return cv;
}

// ---- EL CONFESOR (N4): espectro grande y largo con mitra dorada y rostrillo (idle = flota)
function drawConfesor(frame, s) {
  const W = 26, H = 36, { cv, c } = pixelCanvas(W, H, s), P = PAL.confesor;
  const b = frame === 1 ? 1 : 0;                   // flota 1px (sombra fija)
  shadowPx(c, 13, 34, 7, s);
  for (let i = 0; i < 4; i++) rectPx(c, 11 - i, 2 + i, 4 + i * 2, 1, s, i === 0 ? P.gold : '#a87b1a'); // mitra
  px(c, 12, 1, s, P.gold);                          // punta de la mitra
  px(c, 12, 4, s, P.glow);                          // gema del obispo
  ellipsePx(c, 13, 14 + b, 9, 10, s, P.base);       // manto amplio (filas 4..24)
  ellipsePx(c, 13, 11 + b, 6, 5, s, P.lite);        // frente luminosa
  rectPx(c, 8, 15 + b, 10, 5, s, '#231040');        // rostro velado, más grande que el espectro
  px(c, 9, 16 + b, s, P.eye); px(c, 16, 16 + b, s, P.eye);
  px(c, 10, 18 + b, s, P.glow); px(c, 15, 18 + b, s, P.glow);
  rectPx(c, 12, 21 + b, 2, 3, s, '#d8ccf0');        // rostrillo que reza (cuelga del velo)
  rectPx(c, 11, 10 + b, 4, 1, s, P.gold);           // banda dorada del manto
  for (const [fx, fy, len] of [[5, 23, 3], [8, 25, 4], [13, 25, 6], [18, 25, 4], [21, 23, 3]])
    rectPx(c, fx, fy + b, 1, len, s, P.dark);       // flecos largos hasta la sombra
  px(c, 4, 12 + b, s, P.glow); px(c, 21, 13 + b, s, P.glow); // velas que lo escoltan
  px(c, 3, 20 + b, s, P.glow); px(c, 23, 19 + b, s, P.glow);
  return cv;
}

// ---- MORIS-9 (N5): núcleo hexagonal flotante con anillo de datos y código en la coraza
function drawMoris9(frame, s) {
  const W = 34, H = 34, { cv, c } = pixelCanvas(W, H, s), P = PAL.moris9;
  const f = frame === 1 ? 1 : 0;
  shadowPx(c, 17, 32, 10, s);
  ellipseOutline(c, 17, 17, 15, 11, s, P.lite);     // anillo de datos (el borde del óvalo)
  if (f) { px(c, 1, 16, s, P.eye); px(c, 33, 17, s, P.glow); } else { px(c, 2, 14, s, P.eye); px(c, 31, 15, s, P.glow); } // paquetes que orbitan
  for (let y = 0; y < 17; y++) {                    // núcleo hexagonal banda a banda
    const hw = y < 5 ? 4 + y * 2 : y > 12 ? 14 - (y - 12) * 3 : 14;
    if (hw < 1) continue;
    rectPx(c, 17 - hw, 9 + y, hw * 2, 1, s, y === 0 || y === 16 ? P.dark : P.base);
  }
  rectPx(c, 6, 11, 22, 1, s, P.lite);               // bisel superior
  rectPx(c, 8, 13, 2, 8, s, P.code);                // columnas de código que scrollean
  rectPx(c, 11, 15 - f * 2, 1, 6, s, P.glow);
  rectPx(c, 25, 12 + f, 2, 7, s, P.code);
  px(c, 24, 18, s, P.lite); px(c, 27, 14, s, P.code);
  rectPx(c, 13, 15, 9, 7, s, '#02090f');            // cuenca del ojo
  rectPx(c, 14, 16, 7, 5, s, P.glow);               // ojo cian pleno (es la IA de la estación)
  rectPx(c, 15, 17, 5, 3, s, '#eaffff');
  px(c, 14 + f, 16, s, '#00344a'); px(c, 20 - f, 20, s, '#00344a'); // píxeles muertos que rotan
  rectPx(c, 16, 3, 2, 3, s, P.dark);                // mástil superior
  px(c, 17, 2, s, P.eye);
  rectPx(c, 14, 27, 7, 2, s, P.dark);               // quilla (el núcleo flota: sin patas)
  return cv;
}

Object.assign(DRAW, {
  esporeador: drawEsporeador, lancellas: drawLancellas, posesivo: drawPosesivo,
  espectro: drawEspectro, glitch: drawGlitch,
  criopylot: drawCriopylot, huerta: drawHuerta, fundidor: drawFundidor,
  confesor: drawConfesor, moris9: drawMoris9,
});

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

/* ============================================================ E4a/E4b — viewmodels de arma
   (brazo + arma pixelados, perspectiva forzada Doom: cañón hacia arriba-izquierda).
   makeWeaponSprite(silhouette, accent): una SILUETA por familia de arma, todas con el
   MISMO lenguaje gráfico (grano 96×72, chapa #2b2f3a/#3a3f4c, guante #3a2f28 y un acento
   emisivo por arma que viene en `accent`). Cada silueta tiene su boca de disparo
   (frame `muzzle` en celdas lógicas) → game.js ancla ahí el fogonazo del viewmodel, así
   el destello sale del cañón correcto en las 10 familias (las 6 de E4a + las 4 de E4b:
   'plasma'/'mate', 'twin'/'chango', 'rail'/'riel' y 'orb'/'compilador').
   NB: rectPx/px reciben SIEMPRE el argumento `s` de escala (fix E3: omitirlo daba NaN
   en fillRect). Las siluetas se pintan 100% opacas: el material del viewmodel usa
   alphaTest 0.5 y la transparencia suave se recortaría a media. */

// guante + antebrazo abajo-derecha: comunes a TODAS las siluetas (mismo estilo 16-bit)
function gunHand(c, s) {
  rectPx(c, 56, 48, 22, 18, s, '#3a2f28');    // guante
  rectPx(c, 56, 48, 22, 3, s, '#5a4a3e');     // dorso iluminado
  rectPx(c, 66, 58, 12, 10, s, '#2e261f');    // antebrazo (sale del cuadro)
  rectPx(c, 56, 51, 3, 4, s, '#241d17');      // puño
}

// cañón hueco en "V" de pixel art (paredes laterales + boca): base de escopetas.
// Por fila: pared izq en (xL − t·4), pared der en (xR + t·4 − w) y adentro el hueco,
// cuyo ancho se calcula EXACTO entre las dos paredes (sin solapar la derecha).
function vBarrel(c, s, xL, xR, yTop, yBot, colW, colIn) {
  for (let i = 0; yTop + i < yBot; i++) {
    const t = i / (yBot - yTop);
    const w = Math.max(1, Math.round(1.5 + t * 4));
    const lx = Math.round(xL - t * 4), rx = Math.round(xR + t * 4 - w);
    rectPx(c, lx, yTop + i, w, 1, s, colW);
    rectPx(c, rx, yTop + i, w, 1, s, colW);
    rectPx(c, lx + w, yTop + i, rx - lx - w, 1, s, colIn);
  }
}

const SIL = {
  // puños: guante enorme de nudillos emisivos (Doom fist), sin arma
  fists: { muzzle: [34, 26], draw(c, s, ac) {
    rectPx(c, 52, 56, 26, 14, s, '#3a2f28');      // antebrazo
    rectPx(c, 48, 34, 26, 22, s, '#4a3b31');      // puño
    rectPx(c, 48, 34, 26, 4, s, '#5f4d40');       // nudillos iluminados
    rectPx(c, 48, 34, 5, 10, s, ac);              // acento: placa del guante (bloom)
    rectPx(c, 50, 39, 6, 4, s, '#241d17');
    rectPx(c, 58, 39, 6, 4, s, '#241d17');        // hendijas de nudillos
    rectPx(c, 40, 36, 8, 14, s, '#4a3b31');       // pulgar
    rectPx(c, 46, 52, 22, 4, s, '#241d17');       // puño/cierre
    rectPx(c, 49, 34, 2, 2, s, '#fff');           // brillo metálico
  } },
  // vecinal: pistoletita barrial con riel emisivo (la vieja fila del rifle XM-9)
  pistol: { muzzle: [45, 19], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 40, 18, 10, 34, s, '#2b2f3a');      // cañón vertical
    rectPx(c, 40, 18, 10, 3, s, ac);              // boca emisiva
    rectPx(c, 36, 30, 18, 14, s, '#3a3f4c');      // cajera
    rectPx(c, 52, 40, 12, 16, s, '#2b2f3a');      // culata hacia el guante
    rectPx(c, 44, 34, 3, 8, s, ac);               // detalle emisivo
    px(c, 44, 20, s, '#fff'); px(c, 46, 20, s, '#fff');
  } },
  // moris12: boca grande octogonal + tubo del cargador + bomba de bombeo
  shotgun: { muzzle: [47, 15], draw(c, s, ac) {
    gunHand(c, s);
    vBarrel(c, s, 42, 52, 12, 30, '#2b2f3a', '#12151d');  // boca acampanada
    rectPx(c, 41, 11, 14, 3, s, '#3a3f4c');               // anillo de boca
    rectPx(c, 43, 12, 10, 2, s, ac);                      // banda emisiva del anillo
    rectPx(c, 58, 30, 26, 8, s, '#2b2f3a');               // cuerpo sobre el guante
    rectPx(c, 38, 30, 40, 12, s, '#3a3f4c');              // cajera
    rectPx(c, 52, 34, 4, 14, s, ac);                      // detalle emisivo
    rectPx(c, 38, 44, 16, 7, s, '#4a3324');               // bomba de bombeo (madera)
    rectPx(c, 38, 44, 16, 2, s, '#6b4c33');               // brillo de la madera
  } },
  // ametralladora: cañón largo acanalado, cargador curvo, cantidad de remaches
  smg: { muzzle: [33, 12], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 30, 10, 6, 36, s, '#2b2f3a');       // cañón largo
    rectPx(c, 30, 10, 6, 3, s, ac);               // boca emisiva
    px(c, 30, 18, s, '#12151d'); px(c, 35, 18, s, '#12151d'); // estrías externas
    px(c, 30, 26, s, '#12151d'); px(c, 35, 26, s, '#12151d');
    px(c, 30, 34, s, '#12151d'); px(c, 35, 34, s, '#12151d');
    rectPx(c, 34, 26, 20, 14, s, '#3a3f4c');      // cajera
    rectPx(c, 54, 36, 12, 14, s, '#2b2f3a');      // culata
    rectPx(c, 40, 40, 10, 20, s, '#2b2f3a');      // cargador curvo (tramos escalonados)
    rectPx(c, 42, 52, 10, 10, s, '#2b2f3a');
    rectPx(c, 44, 60, 10, 4, s, '#2b2f3a');
    rectPx(c, 42, 30, 4, 2, s, ac);               // luz de carga
    px(c, 32, 12, s, '#fff'); px(c, 34, 12, s, '#fff'); // chispazo de cañón
  } },
  // asador: tanque a la espalda, manguera, boquilla con llama perpetua
  flamer: { muzzle: [30, 22], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 62, 20, 16, 26, s, '#3a3f4c');      // tanque de células
    rectPx(c, 62, 20, 16, 3, s, '#59616f');       // tapa del tanque
    rectPx(c, 66, 26, 8, 14, s, '#141a24');       // ventana de nivel
    rectPx(c, 67, 28, 6, 4, s, ac);               // células (fila 1)
    rectPx(c, 67, 34, 6, 4, s, ac);               // células (fila 2)
    rectPx(c, 52, 38, 10, 4, s, '#2b2f3a');       // válvula tanque→manguera
    rectPx(c, 42, 40, 12, 12, s, '#2b2f3a');      // manguera (tramos escalonados)
    rectPx(c, 36, 34, 8, 10, s, '#2b2f3a');
    rectPx(c, 30, 26, 8, 10, s, '#3a3f4c');       // cuerpo de boquilla
    rectPx(c, 27, 24, 4, 6, s, '#12151d');        // boca
    rectPx(c, 28, 22, 3, 2, s, '#ffe66b');        // llama: núcleo
    rectPx(c, 26, 19, 5, 4, s, ac);               // llama: media
    rectPx(c, 24, 16, 4, 3, s, '#ff8a3a');        // llama: punta
    px(c, 25, 14, s, '#ff5a1e');
  } },
  // kira: tubo lanzacohetes con visor, ogiva asomando y tope trasero
  rocket: { muzzle: [31, 14], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 26, 16, 56, 14, s, '#3a4a44');      // tubo (verde militar, coherente con ammoCohetes)
    rectPx(c, 26, 16, 56, 3, s, '#566b60');       // brillo superior del tubo
    rectPx(c, 26, 27, 56, 3, s, '#24312c');       // sombra inferior
    rectPx(c, 22, 13, 6, 20, s, '#2b2f3a');       // boca (aro ancho)
    rectPx(c, 23, 16, 3, 12, s, '#12151d');       // hueco del tubo
    rectPx(c, 23, 20, 3, 3, s, ac);               // acento del aro
    rectPx(c, 44, 8, 14, 8, s, '#2b2f3a');        // visor
    rectPx(c, 47, 10, 8, 3, s, ac);               // lente emisivo
    rectPx(c, 29, 17, 9, 5, s, '#c9ced6');        // ogiva asomando
    px(c, 29, 18, s, '#e0473a'); px(c, 29, 20, s, '#e0473a'); // aletas rojas
    rectPx(c, 70, 20, 4, 8, s, ac);               // franja de peligro trasera
  } },
  // ---- E4b — las 4 que faltaban (changó/riel/compilador/mate), mismo lenguaje gráfico:
  // twin: escopeta doble — dos bocas V gemelas hermanadas + bombe + guante doble
  twin: { muzzle: [47, 14], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 40, 44, 16, 7, s, '#4a3324');               // bombe doble (madera, bajo las cañas)
    rectPx(c, 40, 44, 16, 2, s, '#6b4c33');               // brillo de la madera
    vBarrel(c, s, 38, 46, 12, 32, '#2b2f3a', '#12151d');  // caña izquierda
    vBarrel(c, s, 48, 56, 12, 32, '#2b2f3a', '#12151d');  // caña derecha (espejada, gemela)
    rectPx(c, 37, 11, 10, 3, s, '#3a3f4c');               // anillo boca izq
    rectPx(c, 47, 11, 10, 3, s, '#3a3f4c');               // anillo boca der
    rectPx(c, 39, 12, 6, 2, s, ac);                       // banda emisiva izq
    rectPx(c, 49, 12, 6, 2, s, ac);                       // banda emisiva der
    rectPx(c, 44, 17, 4, 13, s, '#12151d');               // junta central entre las dos cañas
    rectPx(c, 58, 28, 26, 9, s, '#2b2f3a');               // lomo sobre el guante
    rectPx(c, 38, 30, 40, 12, s, '#3a3f4c');              // cajera compartida
    rectPx(c, 62, 15, 20, 6, s, '#2b2f3a');               // culata clavada al hombro
    rectPx(c, 64, 17, 3, 2, s, ac);                       // chapa grabada
    rectPx(c, 60, 10, 12, 6, s, '#3a2f28');               // segundo guante arriba (cañón alto)
    rectPx(c, 60, 10, 12, 2, s, '#5a4a3e');               // dorso del guante alto
    px(c, 41, 13, s, '#fff'); px(c, 51, 13, s, '#fff');    // chispas en los anillos
  } },
  // plasma: riel de células estilo Doom — aro de energía con célula adentro, emisor arriba
  plasma: { muzzle: [40, 9], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 46, 12, 22, 36, s, '#2b2f3a');      // cuerpo hacia el guante
    rectPx(c, 46, 12, 22, 3, s, '#3a3f4c');       // tapa superior
    rectPx(c, 50, 16, 14, 3, s, ac);              // emisor de la boca
    rectPx(c, 62, 30, 8, 10, s, '#141a24');       // mirilla lateral
    rectPx(c, 64, 32, 4, 6, s, ac);               // célula visible en la mirilla
    ellipseOutline(c, 53, 34, 5, 5, s, ac);       // aro de energía (borde del óvalo)
    ellipseFill(c, 53, 34, 2, 2, s, ac);          // célula cian cargada en el centro
    rectPx(c, 52, 33, 2, 2, s, '#e8ffff');        // brillo de la célula
    rectPx(c, 42, 30, 4, 10, s, '#141a24');       // ranura del aro (conecta a la boca)
    rectPx(c, 43, 32, 2, 6, s, ac);               // hilo de energía ranura→aro
  } },
  // rail: riel largo con dos prongs emisivos que abrazan la boca + bobinas (Colastiné)
  rail: { muzzle: [30, 5], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 28, 22, 54, 12, s, '#2b2f3a');      // viga larga del riel
    rectPx(c, 28, 22, 54, 2, s, '#3a3f4c');       // brillo de la viga
    rectPx(c, 28, 32, 54, 2, s, '#12151d');       // sombra de la viga
    rectPx(c, 30, 5, 5, 14, s, '#3a3f4c');        // prong emisivo izquierdo
    rectPx(c, 41, 5, 5, 14, s, '#3a3f4c');        // prong emisivo derecho
    rectPx(c, 31, 5, 3, 8, s, ac);                // carga del prong izq
    rectPx(c, 42, 5, 3, 8, s, ac);                // carga del prong der
    rectPx(c, 30, 5, 5, 2, s, '#fff');            // chispa alta izq
    rectPx(c, 41, 5, 5, 2, s, '#fff');            // chispa alta der
    rectPx(c, 36, 10, 4, 6, s, '#12151d');        // boca entre los prongs
    rectPx(c, 36, 16, 4, 6, s, ac);               // descarga hacia la viga
    rectPx(c, 50, 26, 4, 6, s, ac);               // bobina 1
    rectPx(c, 58, 26, 4, 6, s, ac);               // bobina 2
    rectPx(c, 66, 26, 4, 6, s, ac);               // bobina 3
    rectPx(c, 60, 36, 14, 12, s, '#3a3f4c');      // cajera sobre el guante
  } },
  // orb: brazo extendido con el orbe argent flotando sobre la palma (el Compilador no se
  // "sostiene": se manda — el cañón es la mano del MORIS)
  orb: { muzzle: [44, 31], draw(c, s, ac) {
    gunHand(c, s);
    rectPx(c, 30, 48, 26, 8, s, '#3a2f28');       // antebrazo extendido (hacia la palma)
    rectPx(c, 30, 48, 26, 2, s, '#5a4a3e');       // dorso del antebrazo
    rectPx(c, 24, 44, 14, 10, s, '#4a3b31');      // palma abierta bajo el orbe
    rectPx(c, 24, 44, 14, 2, s, '#5f4d40');       // nudillos de la palma
    ellipsePx(c, 32, 37, 4, 1, s, '#141a24');     // sombra proyectada del orbe sobre la mano
    ellipseFill(c, 31, 36, 5, 5, s, '#1f4d1c');   // orbe verde: argolla externa oscura
    ellipseFill(c, 31, 36, 3, 3, s, ac);          // núcleo verde emisivo
    px(c, 30, 35, s, '#f0ffe8'); px(c, 31, 34, s, '#f0ffe8'); // brillo especular
    rectPx(c, 50, 44, 12, 6, s, '#2b2f3a');       // guante de soporte (la otra mano)
    rectPx(c, 52, 45, 8, 2, s, ac);               // deditos con acento
  } },
};

// silueta → canvas del viewmodel. accent = color emisivo del arma (ver WEAPONS en game.js).
export function makeWeaponSprite(silhouette = 'pistol', accent = '#54f0ff', scale = 3) {
  const S = SIL[silhouette];
  if (!S) throw new Error('makeWeaponSprite: silueta desconocida: ' + silhouette);
  const W = 96, H = 72, { cv, c, s } = pixelCanvas(W, H, scale);
  S.draw(c, s, accent);
  return { canvas: cv, muzzle: [S.muzzle[0] * scale, S.muzzle[1] * scale] };
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

/* ============================================================ E5 — props billboard del entorno
   makePropSprite(kind): planos pixelados para la decoracion de los niveles (mismo lenguaje
   16-bit: paleta limitada + outlined() + sombra en damero). A diferencia de los pickups NO
   llevan atlas de vistas: el juego los deja estaticos (billboard solo en yaw) y game.js
   cachea UN CanvasTexture por kind. Kinds hoy: 'vine' (enredadera N2, con broches que
   retoman el magenta de los charcos) y 'statue' (estatuas guardianas N4, acento violeta).
   Las variantes por nivel se hacen por escala/tinte/material en game.js, no por pixels. */
const PROP = {
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
