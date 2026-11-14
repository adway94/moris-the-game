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

/* tabla de dibujo por tipo: el mapa único que consume makeEnemySprite. Fix E6a sobre el
   WIP: la declaración original se borró y quedó solo el Object.assign de abajo, lo que
   tiraba ReferenceError al evaluar el módulo (el juego no arrancaba). Los tipos E6 se
   suman igual: nueva función de dibujo + su fila en el Object.assign(DRAW, …). */
const DRAW = { droner: drawDroner, sprinter: drawSprinter, brute: drawBrute };

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

/* ============================================================ E4a/E4b/E9 — viewmodels de arma
   (brazo + arma pixelados, composición boomer-shooter estilo Doom/Boltgun: el arma entra
   en DIAGONAL desde la esquina inferior derecha hacia el centro-izquierda, cañón GRANDE con
   boca ANULAR visible apuntando arriba-afuera, >=65% del lienzo 96×72 ocupado, mano
   enguantada con dedos SIEMPRE agarrando el arma, shading de 4 tonos por material: base +
   luz arriba-izq + sombra abajo-der + outline 1px, remaches y reflejo puntual blanco 2px).
   makeWeaponSprite(silhouette, accent): una SILUETA PROPIA por familia (nada de variantes
   del mismo rectángulo), todas con el MISMO lenguaje gráfico (grano 96×72 y un acento
   emisivo por arma que viene en `accent`). Cada silueta tiene su boca de disparo
   (frame `muzzle` en celdas lógicas) → game.js ancla ahí el fogonazo del viewmodel, así
   el destello sale del cañón correcto en las 10 familias (las 6 de E4a + las 4 de E4b:
   'plasma'/'mate', 'twin'/'chango', 'rail'/'riel' y 'orb'/'compilador').
   NB: rectPx/px reciben SIEMPRE el argumento `s` de escala (fix E3: omitirlo daba NaN
   en fillRect). Las siluetas se pintan 100% opacas: el material del viewmodel usa
   alphaTest 0.5 y la transparencia suave se recortaría a media. E9: el draw sigue siendo
   estático (c,s,accent) — un idle de 2 frames exigiría cambiar la firma que game.js
   consume en 3 lugares, y la consigna es NO tocar consumidores. */

// ---- paleta E9 (4 tonos por material: out / lite / base / dark)
const MW = { out: '#0d0f14', lite: '#4a5260', base: '#2e333e', dark: '#1b1e26' };      // cañón (metal oscuro)
const RB = { out: '#0d0f14', lite: '#59616f', base: '#3a3f4c', dark: '#262a34' };      // cajera (chapa)
const HT = { out: '#171a20', lite: '#565e68', base: '#3a4048', dark: '#272b31' };      // guante #3a4048
const WD = { out: '#2a1a0c', lite: '#9c6a44', base: '#7a4a2b', dark: '#55351d' };      // madera #7a4a2b
const ARM = { out: '#0d0f14', lite: '#6b7280', base: '#4b525e', dark: '#333945' };     // blindaje (orb)
const GL = { out: '#171a20', lite: '#a8b0b8', base: '#6b7280', dark: '#3a4048' };      // guante gordo E9b #6b7280

// caja 4 tonos con outline 1px: luz arriba-izq, sombra abajo-der (la base del look E9)
function box4(c, s, x, y, w, h, P) {
  rectPx(c, x - 1, y - 1, w + 2, h + 2, s, P.out);
  rectPx(c, x, y, w, h, s, P.base);
  rectPx(c, x, y, w, 1, s, P.lite);
  rectPx(c, x, y + 1, 1, h - 2, s, P.lite);
  rectPx(c, x + 1, y + h - 1, w - 1, 1, s, P.dark);
  rectPx(c, x + w - 1, y + 1, 1, h - 2, s, P.dark);
}

// viga diagonal escalonada (cañones, tubos, cajas, culatas): (xt,yt) = BOCA arriba-izq,
// (xb,yb) = culata abajo-der. Pasada 1 pinta el outline, pasada 2 los 4 tonos: por columnas
// la cara de arriba toma luz y la de abajo sombra. Con yb<yt (ejes que suben a la derecha,
// culatas) la luz queda abajo: se pasa alar='b' para invertir las bandas.
function diagBeam(c, s, xt, yt, xb, yb, w, P, alar = 't') {
  const n = Math.max(Math.abs(xb - xt), Math.abs(yb - yt), 1);
  const dx = (xb - xt) / n, dy = (yb - yt) / n, lit = Math.max(1, w >> 2), drk = Math.max(1, w >> 1);
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i <= n; i++) {
      const x = Math.round(xt + dx * i), y = Math.round(yt + dy * i) - (w >> 1);
      if (pass === 0) { rectPx(c, x, y - 1, 1, w + 2, s, P.out); continue; }
      rectPx(c, x, y, 1, w, s, P.base);
      rectPx(c, x, (alar === 'b' ? y + w - lit : y), 1, lit, s, P.lite);
      rectPx(c, x, (alar === 'b' ? y : y + w - drk), 1, drk, s, P.dark);
    }
}

// boca de cañón REAL: anillo grueso + alma negra + luz de anillo arriba-izq + destello.
// r>=3 (7 px de diámetro) es el mínimo que lee como agujero, no como línea.
function muzzleRing(c, s, cx, cy, r, P) {
  ellipseFill(c, cx, cy, r, r, s, P.dark);
  ellipseFill(c, cx, cy, r, r - 1, s, P.base);
  ellipseFill(c, cx, cy, r - 2, r - 2, s, '#07090c');
  px(c, cx - r + 1, cy - 1, s, P.lite);
  px(c, cx - r + 1, cy, s, P.lite);
  px(c, cx - 1, cy - r, s, P.lite);
  px(c, cx + r - 1, cy + 1, s, '#050609');
  px(c, cx - r, cy - r, s, '#e6ebf2');
}

// anillo EMISOR de energía perpendicular al cañón (plasma/rail): zócalo + aro accent + núcleo
function coilRing(c, s, cx, cy, ac, big = 0) {
  ellipseFill(c, cx, cy, 3 + big, 4 + big, s, MW.out);
  ellipseOutline(c, cx, cy, 2 + big, 3 + big, s, ac);
  ellipseFill(c, cx, cy, 1 + big, 2 + big, s, ac);
  px(c, cx - 1, cy - 1, s, '#ffffff');
}

// mano enguantada agarrando CON DEDOS: dorso + 4 dedos que envuelven el arma + placa de
// nudillos #6b7280 con studs + reflejo puntual. (x,y) = esquina de los dedos (lado cañón).
function gripHand(c, s, x, y, w, st = HT) {
  const fh = Math.max(2, Math.floor((w - 1) / 4)), gap = fh + 1;
  for (let f = 0; f < 4; f++) box4(c, s, x + f * gap, y, fh, 6, st);
  const bw = 4 * gap + 1;
  box4(c, s, x, y + 5, bw, 8, st);
  for (let f = 0; f < 4; f++) {
    const fx = x + f * gap;
    rectPx(c, fx, y + 5, fh, 2, s, '#6b7280');            // placa de nudillos
    px(c, fx + (fh >> 1), y + 5, s, '#98a2b0');           // stud
  }
  px(c, x + 1, y + 8, s, '#7a8492'); px(c, x + 2, y + 8, s, '#7a8492'); // reflejo puntual
}

// E9b: MANO GORDA de proporción heroica (dirección de arte b): nf dedos GRUESOS envolviendo
// el arma (2px de sombra entre dedo y dedo = separación leída a 1/3), dorso con placa de
// nudillos #6b7280 + studs, pulgar opcional asomando del lado del gatillo y edge highlight
// blanco arriba (c). (x,y) = esquina de los dedos (lado cañón), w ancho total (18-22).
function wrapHand(c, s, x, y, w, nf = 3, st = HT, thumb = false) {
  const fh = Math.max(3, Math.floor((w - 1) / nf)), gap = fh + 1, fhgt = Math.max(6, Math.round(w / 3));
  for (let f = 0; f < nf; f++) box4(c, s, x + f * gap, y, fh, fhgt, st);
  for (let f = 0; f < nf - 1; f++) rectPx(c, x + (f + 1) * gap - 1, y + 1, 1, fhgt - 2, s, st.out); // sombra entre dedos
  for (let f = 0; f < nf; f++) px(c, x + f * gap + 1, y, s, '#ffffff');                             // edge highlight nudillos
  const bw = nf * gap + 1, by = y + fhgt - 1;
  box4(c, s, x, by, bw, Math.max(6, Math.round(w / 2.6)), st);
  rectPx(c, x + 1, by, bw - 2, 2, s, '#6b7280');                          // placa de nudillos
  for (let f = 0; f < nf; f++) {
    px(c, x + f * gap + (fh >> 1), by, s, '#a8b0b8');                     // stud
    px(c, x + f * gap + (fh >> 1) + 1, by + 1, s, '#3a4048');             // AO del stud
  }
  px(c, x + 1, by + 3, s, '#a8b0b8'); px(c, x + 2, by + 3, s, '#a8b0b8'); // reflejo puntual
  if (thumb) box4(c, s, x - 1, y - 1, fh + 1, 5, st);                     // pulgar envolviendo
}

// antebrazo enguantado que sale de la esquina inferior derecha (el ancla de la composición)
function forearm(c, s, x, y, w = 16) {
  diagBeam(c, s, x, y, x + (95 - x) + 6, 78, w, HT);
  px(c, x + 2, y + 2, s, '#565e68'); px(c, x + 3, y + 2, s, '#565e68');
}

// cable/manguera gruesa: polyline con luz arriba
function cableRun(c, s, pts, col = '#1e222b', lite = '#4a5260') {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + (x1 - x0) * k / n), y = Math.round(y0 + (y1 - y0) * k / n);
      px(c, x, y, s, col); px(c, x, y - 1, s, lite); px(c, x, y + 1, s, '#050609');
    }
  }
}

// guardamonte + gatillo (todas las armas de fuego)
function triggerGroup(c, s, x, y, st = RB) {
  box4(c, s, x, y, 10, 2, st);
  rectPx(c, x + 1, y + 2, 2, 4, s, st.out);
  rectPx(c, x + 7, y + 2, 2, 4, s, st.out);
  rectPx(c, x + 3, y + 1, 3, 4, s, '#14171d');            // gatillo
}

// tornel en un corner de chapa (el detalle "remachado" de Boltgun)
function rivet(c, s, x, y) { px(c, x, y, s, '#59616f'); px(c, x, y + 1, s, '#12151d'); }
function rivetRow(c, s, x, y, n, dx = 4, dy = 0) { for (let i = 0; i < n; i++) rivet(c, s, x + i * dx, y + i * dy); }

const SIL = {
  // puños E9b: DOS PUÑOS GORDOS enguantados en primerísimo plano (guante #6b7280, sombra
  // #3a4048, highlight #a8b0b8): el DERECHO abajo-centro enorme con los nudillos y studs
  // mirando al jugador (de ahí sale el fogonazo) y el IZQUIERDO arriba-izq más chico en
  // guardia. Antebrazos saliendo del borde inferior, AO pintado bajo cada puño y edge
  // highlight blanco arriba (dirección de arte b+c).
  fists: { muzzle: [46, 35], draw(c, s, ac) {
    diagBeam(c, s, 28, 31, 52, 46, 13, GL);                 // antebrazo del guardia (se pierde detrás del puño grande)
    box4(c, s, 8, 18, 22, 15, GL);                          // puño izquierdo en guardia (chico, arriba-izq)
    for (let f = 0; f < 4; f++) {                           // nudilleras redondas de la guardia
      const kx = 12 + f * 5;
      ellipseFill(c, kx, 15, 4, 3, s, GL.out); ellipseFill(c, kx, 15, 3, 2, s, GL.dark);
      ellipseFill(c, kx, 15, 2, 2, s, GL.base);
      px(c, kx, 15, s, '#e6ebf2'); px(c, kx - 1, 14, s, '#a8b0b8'); // stud + luz
    }
    box4(c, s, 10, 27, 9, 6, GL);                           // pulgar cruzado
    px(c, 12, 28, s, '#a8b0b8'); px(c, 13, 28, s, '#a8b0b8');
    rectPx(c, 9, 33, 20, 1, s, '#242a31');                  // AO pintado bajo el puño
    px(c, 10, 13, s, '#ffffff'); px(c, 9, 15, s, '#ffffff'); // edge highlight de la guardia
    px(c, 18, 22, s, ac);                                   // remate accent del dorso
    diagBeam(c, s, 62, 50, 103, 77, 22, GL);                // antebrazo del recto (ENORME, sale del cuadro)
    rectPx(c, 79, 56, 3, 14, s, '#171a20'); rectPx(c, 79, 60, 3, 4, s, ac); // correa del guante
    box4(c, s, 30, 40, 40, 23, GL);                         // puño derecho: el que llena el lienzo
    for (let f = 0; f < 4; f++) {
      const kx = 37 + f * 9;                                // nudilleras GORDAS mirando al jugador
      ellipseFill(c, kx, 36, 6, 5, s, GL.out);
      ellipseFill(c, kx, 36, 5, 4, s, GL.dark);             // AO pintado en el nudillo
      ellipseFill(c, kx, 36, 4, 3, s, GL.base);
      rectPx(c, kx - 2, 34, 5, 1, s, GL.lite);              // luz arriba del nudillo
      px(c, kx, 36, s, '#e6ebf2'); px(c, kx + 1, 37, s, '#050609'); // stud de metal + sombra
    }
    box4(c, s, 36, 54, 14, 7, GL);                          // pulgar
    px(c, 38, 55, s, '#a8b0b8'); px(c, 39, 55, s, '#a8b0b8');
    rectPx(c, 31, 64, 38, 1, s, '#242a31'); rectPx(c, 33, 65, 34, 1, s, '#050609'); // AO dos tonos bajo el puño
    px(c, 36, 32, s, '#ffffff'); px(c, 34, 34, s, '#ffffff'); // edge highlight nudillo externo (esquina de luz)
    px(c, 44, 34, s, '#ffffff');                            // destello sobre los nudillos (boca real)
    px(c, 62, 35, s, ac); px(c, 63, 35, s, ac);             // acento en la nudillera externa
    px(c, 73, 52, s, ac); px(c, 71, 48, s, ac);             // chispas del golpe
  } },
  // Vecinal E9b: 9mm COMPACTA — slide CORTA (largo ≈ 2× alto) con 4 serrations y edge
  // highlight blanco arriba, boca con anillo, mira frontal blanca con punto accent, ranura
  // del slide en cian (2 focos de accent), grip diagonal con MANO GORDA (3 dedos
  // envolviendo + pulgar) y antebrazo saliendo del borde. Masa centrada-der, aire
  // arriba-izq (~55% del lienzo).
  pistol: { muzzle: [34, 16], draw(c, s, ac) {
    diagBeam(c, s, 36, 18, 56, 31, 11, MW);                // slide corta (largo ≈ 2× alto)
    muzzleRing(c, s, 35, 17, 4, MW);                       // boca con anillo
    px(c, 38, 14, s, '#ffffff'); px(c, 41, 16, s, '#8f9aab'); px(c, 44, 18, s, '#8f9aab'); // edge highlight del lomo
    for (let i = 0; i < 4; i++) {                          // 4 serrations (impresión, no retrato)
      rectPx(c, 48 + i * 2, 26 + i, 1, 6, s, '#12151d');
      px(c, 49 + i * 2, 26 + i, s, '#4a5260');
    }
    rectPx(c, 42, 22, 8, 2, s, '#0d0f14'); rectPx(c, 43, 22, 6, 1, s, ac); // ranura del slide (accent)
    rectPx(c, 37, 9, 2, 4, s, '#e6ebf2'); px(c, 37, 9, s, '#ffffff');      // mira frontal blanca
    px(c, 55, 27, s, ac); px(c, 56, 28, s, ac);            // punto de mira trasero (accent)
    box4(c, s, 50, 34, 14, 6, RB);                         // armazón
    rivet(c, s, 61, 35);
    triggerGroup(c, s, 46, 39);                            // guardamonte + gatillo
    diagBeam(c, s, 57, 38, 71, 54, 12, RB);                // grip diagonal
    for (let i = 0; i < 3; i++) rectPx(c, 61 + i * 3, 44 + i * 3, 2, 3, s, MW.dark); // ranurado
    wrapHand(c, s, 55, 45, 20, 3, HT, true);               // mano gorda: 3 dedos + pulgar
    forearm(c, s, 76, 56, 22);                             // antebrazo gordo del cuadro
  } },
  // MORIS-12 E9: break-action gorda y BAJA — caña + tubo con ánima doble (dos bocas),
  // cajón grande con port-ejection abierto mostrando el cartucho rojo, madera veteada,
  // mano adelante sobre el guardamano y guardamonte abajo-der.
  shotgun: { muzzle: [16, 10], draw(c, s, ac) {
    diagBeam(c, s, 20, 11, 54, 32, 9, MW);                // caña
    diagBeam(c, s, 24, 20, 56, 39, 6, MW);                // tubo del cargador
    for (let i = 0; i < 4; i++) rectPx(c, 30 + i * 7, 17 + i * 3, 4, 1, s, '#0d0f14'); // ventilado
    muzzleRing(c, s, 18, 10, 4, MW);                      // boca de arriba (ánima doble)
    muzzleRing(c, s, 22, 19, 3, MW);                      // boca del tubo
    px(c, 26, 5, s, '#e6ebf2'); px(c, 26, 6, s, '#e6ebf2'); // fibra de mira
    px(c, 18, 6, s, '#ffffff'); px(c, 26, 5, s, '#ffffff'); // E9b: edge highlights (aro boca + mira)
    box4(c, s, 52, 28, 26, 14, RB);                       // cajón de mecanismos
    px(c, 53, 28, s, '#ffffff');                           // E9b: edge highlight del cajón (pop)
    rivetRow(c, s, 74, 31, 3, 0, 4);
    box4(c, s, 58, 31, 11, 7, { out: '#0d0f14', lite: '#161a22', base: '#0d1015', dark: '#12151d' }); // port abierto
    rectPx(c, 59, 33, 8, 4, s, '#c0392b');                // cartucho rojo asomando
    rectPx(c, 59, 33, 8, 1, s, '#e0473a');
    rectPx(c, 66, 32, 3, 6, s, '#d9a441');                // culote latón
    triggerGroup(c, s, 60, 43);
    diagBeam(c, s, 80, 42, 95, 58, 14, WD, 'b');          // culata de madera
    for (let i = 0; i < 4; i++) rectPx(c, 84 + i * 3, 45 + i * 3, 1, 3, s, WD.dark); // vetas
    rectPx(c, 91, 56, 5, 6, s, MW.out);                   // cantonera de goma
    box4(c, s, 30, 28, 20, 9, WD);                        // guardamano veteado
    for (let i = 0; i < 6; i++) rectPx(c, 32 + i * 3, 32, 1, 5, s, WD.dark);
    gripHand(c, s, 30, 26, 17);                           // mano adelante sobre el tubo
    gripHand(c, s, 72, 52, 16);                           // mano atrás en el grip
    forearm(c, s, 84, 60, 16);
    px(c, 54, 29, s, ac); px(c, 56, 29, s, ac);           // grabado accent del cajón
  } },
  // Ametralladora E9b: subfusil CORTO de silueta inconfundible — cuerpo cuadrado, CARGADOR
  // CURVO GRUESO colgando (seña principal, la mano izquierda lo abraza por abajo), cañón
  // corto con 3 perforaciones, culata tubular plegada atrás, mira frontal blanca + mirilla
  // plegada y DOS manos gordas (der en el grip, izq bajo el cargador). Accent lima: mirilla
  // + ranura eyector con destello + bisagra de la culata.
  smg: { muzzle: [23, 9], draw(c, s, ac) {
    diagBeam(c, s, 26, 10, 40, 19, 8, MW);                 // cañón corto
    muzzleRing(c, s, 25, 9, 3, MW);                        // boca
    rectPx(c, 30, 11, 1, 4, s, '#050609'); px(c, 29, 11, s, '#59616f'); // 3 perforaciones
    rectPx(c, 33, 13, 1, 4, s, '#050609'); px(c, 32, 13, s, '#59616f');
    rectPx(c, 36, 15, 1, 4, s, '#050609'); px(c, 35, 15, s, '#59616f');
    rectPx(c, 29, 4, 2, 4, s, '#e6ebf2'); px(c, 29, 4, s, '#ffffff');   // mira frontal blanca
    diagBeam(c, s, 38, 18, 70, 38, 16, RB);                // cuerpo cuadrado
    px(c, 46, 15, s, '#ffffff'); px(c, 47, 15, s, '#ffffff');           // edge highlight del cajón
    diagBeam(c, s, 42, 14, 66, 29, 3, RB);                 // riel superior
    px(c, 50, 18, s, '#ffffff'); px(c, 58, 23, s, '#ffffff');           // edge highlight del riel
    box4(c, s, 45, 11, 9, 4, RB);                          // mirilla plegada sobre el riel
    px(c, 47, 13, s, ac); px(c, 48, 13, s, ac);            // punto de mira (accent)
    box4(c, s, 52, 22, 9, 5, RB);                          // puerto de eyección
    rectPx(c, 53, 23, 7, 3, s, '#0d0f14'); rectPx(c, 54, 24, 5, 1, s, ac); // ranura con glow (accent)
    px(c, 54, 23, s, '#ffffff');                           // destello del borde
    rectPx(c, 46, 29, 14, 8, s, RB.out); rectPx(c, 47, 30, 12, 6, s, RB.base); // boca del cargador
    rectPx(c, 47, 30, 12, 1, s, RB.lite); rectPx(c, 47, 35, 12, 1, s, RB.dark);
    rectPx(c, 47, 33, 6, 1, s, '#050609'); px(c, 48, 33, s, '#d9a441'); px(c, 50, 33, s, '#d9a441'); // balas asomando
    diagBeam(c, s, 50, 34, 46, 46, 12, RB);                // cargador curvo GRUESO (3 tramos, seña de la silueta)
    diagBeam(c, s, 46, 46, 41, 57, 12, RB);
    diagBeam(c, s, 41, 57, 40, 64, 12, RB);
    box4(c, s, 35, 64, 10, 4, RB);                         // base del cargador
    diagBeam(c, s, 62, 40, 69, 53, 8, RB);                 // grip
    triggerGroup(c, s, 54, 38);                            // guardamonte + gatillo
    box4(c, s, 70, 33, 6, 8, RB); px(c, 72, 36, s, ac); px(c, 72, 37, s, '#3a4048'); // bisagra accent
    diagBeam(c, s, 76, 38, 93, 49, 5, MW);                 // culata tubular plegada
    rectPx(c, 89, 44, 7, 11, s, MW.out); rectPx(c, 90, 45, 5, 9, s, '#14171d'); // cantonera
    rectPx(c, 90, 45, 1, 9, s, '#4a5260');                 // luz del borde de la cantonera
    rivet(c, s, 64, 24); rivet(c, s, 68, 26);
    forearm(c, s, 50, 58, 20);                             // antebrazo izquierdo (el que abraza)
    wrapHand(c, s, 33, 50, 17, 3, HT);                     // mano izq: 3 dedos abrazando el cargador por abajo
    forearm(c, s, 78, 58, 22);                             // antebrazo derecho
    wrapHand(c, s, 61, 47, 18, 3, HT);                     // mano der en el grip
  } },
  // Asador E9: TANQUE a la espalda asomando arriba-der con visor redondo encendido,
  // manguera curva al cañón-crisol, boquilla con 3 púas y llama, mano en el grip y otra
  // en la llave del crisol.
  flamer: { muzzle: [24, 20], draw(c, s, ac) {
    box4(c, s, 66, 8, 22, 30, RB);                        // tanque de combustible
    ellipseFill(c, 77, 9, 11, 4, s, RB.base); rectPx(c, 67, 8, 20, 1, s, RB.lite); // tapa
    rectPx(c, 67, 13, 20, 3, s, '#55351d'); rectPx(c, 67, 27, 20, 3, s, '#55351d'); // correas
    ellipseFill(c, 81, 20, 4, 4, s, MW.out); ellipseFill(c, 81, 20, 2, 2, s, ac);   // visor encendido
    px(c, 80, 19, s, '#ffffff');
    box4(c, s, 61, 22, 6, 7, RB);                         // válvula
    rivetRow(c, s, 68, 24, 4, 0, 4);
    cableRun(c, s, [[63, 29], [56, 38], [50, 44], [46, 46]]); // manguera curva
    diagBeam(c, s, 42, 40, 64, 54, 11, RB);               // cuerpo de la lanza
    ellipseFill(c, 58, 40, 3, 3, s, MW.out); ellipseFill(c, 58, 40, 1, 1, s, ac);   // visor de chispa
    diagBeam(c, s, 32, 30, 46, 39, 13, MW);               // crisol
    for (let i = 0; i < 6; i++) rectPx(c, 40 + (i & 1), 33 + i, 2, 1, s, '#12151d'); // anillos
    rectPx(c, 26, 21, 9, 8, s, MW.base); rectPx(c, 26, 26, 9, 3, s, MW.dark);       // boca
    rectPx(c, 24, 19, 3, 2, s, '#4a5260'); rectPx(c, 23, 18, 2, 2, s, '#4a5260');   // púa sup
    rectPx(c, 23, 23, 3, 2, s, '#4a5260');                                            // púa media
    rectPx(c, 24, 28, 3, 2, s, '#4a5260'); px(c, 23, 29, s, '#4a5260');              // púa inf
    rectPx(c, 22, 15, 2, 2, s, ac); px(c, 20, 13, s, '#ff8a3a'); px(c, 23, 12, s, ac); // llama chica
    rectPx(c, 21, 10, 2, 2, s, '#ffe66b'); px(c, 19, 8, s, '#ff8a3a');
    diagBeam(c, s, 60, 54, 66, 64, 7, RB);                // grip
    triggerGroup(c, s, 52, 50);
    gripHand(c, s, 60, 50, 16);                           // mano en el gatillo
    forearm(c, s, 74, 62, 20);
    gripHand(c, s, 34, 36, 16);                           // mano en la llave del crisol
    px(c, 44, 42, s, ac);                                 // luz de la llave
  } },
  // Kira E9: tubo RPG ENORME en diagonal (tiro de 24 celdas) — boca ancha con cohetes
  // asomando (ogiva + aletas rojas), mira de tijera levantada, óxido, guante y hombrera.
  rocket: { muzzle: [15, 12], draw(c, s, ac) {
    diagBeam(c, s, 20, 17, 84, 56, 24, MW);               // tubo de tiro
    ellipseFill(c, 20, 17, 10, 9, s, MW.dark); ellipseFill(c, 20, 17, 9, 8, s, MW.base); // collarín
    ellipseFill(c, 20, 17, 7, 6, s, '#07090c');           // alma del tubo
    ellipseFill(c, 21, 17, 3, 3, s, '#c9ced6');           // ogiva asomando
    px(c, 24, 13, s, '#e0473a'); px(c, 24, 14, s, '#e0473a');
    px(c, 24, 20, s, '#e0473a'); px(c, 24, 21, s, '#e0473a'); // aletas rojas
    px(c, 25, 17, s, '#e0473a');
    px(c, 13, 11, s, '#e6ebf2'); px(c, 14, 11, s, '#e6ebf2'); // destello del borde
    rectPx(c, 40, 24, 3, 13, s, RB.lite); rectPx(c, 43, 25, 3, 13, s, MW.dark);     // banda de montaje
    rivet(c, s, 41, 26); rivet(c, s, 41, 32);
    px(c, 33, 28, s, '#7a4a2b'); px(c, 34, 29, s, '#9c6a44'); px(c, 35, 28, s, '#7a4a2b'); // óxido
    px(c, 55, 42, s, '#7a4a2b'); px(c, 56, 43, s, '#9c6a44'); px(c, 57, 42, s, '#7a4a2b');
    px(c, 70, 50, s, '#7a4a2b'); px(c, 71, 51, s, '#9c6a44'); px(c, 72, 50, s, '#7a4a2b');
    rectPx(c, 37, 30, 3, 2, s, ac); px(c, 39, 31, s, ac); // banda de peligro accent
    rectPx(c, 46, 20, 10, 3, s, RB.base);                 // base de la mira de tijera
    for (let i = 0; i < 9; i++) { px(c, 47 + i, 19 - i, s, '#59616f'); px(c, 47 + i, 11 + i, s, '#3a3f4c'); }
    px(c, 55, 11, s, ac); px(c, 55, 19, s, ac);           // puntas emisivas
    triggerGroup(c, s, 56, 50);
    diagBeam(c, s, 60, 48, 64, 58, 6, RB);                // grip bajo el tubo
    gripHand(c, s, 56, 52, 16);                           // guante agarra el grip
    rectPx(c, 74, 62, 19, 9, s, ARM.base); rectPx(c, 74, 62, 19, 2, s, ARM.lite);   // hombrera
    rectPx(c, 74, 69, 19, 2, s, ARM.dark); px(c, 77, 65, s, ac);
    rivet(c, s, 88, 65);
  } },
  // Mate E9: rifle de energía con TUBO DE BOBINA (3 anillos accent emisivos a lo largo),
  // cable grueso al pack lateral con ventilador circular, núcleo brillante en la caleta.
  plasma: { muzzle: [21, 9], draw(c, s, ac) {
    diagBeam(c, s, 26, 13, 80, 51, 12, MW);               // cuerpo del rifle
    rectPx(c, 34, 17, 42, 2, s, ac);                      // núcleo brillante en la caleta
    rectPx(c, 34, 19, 42, 1, s, '#12151d');
    diagBeam(c, s, 22, 10, 30, 15, 8, MW);                // stub de emisora
    muzzleRing(c, s, 21, 9, 3, MW);
    rectPx(c, 26, 4, 2, 3, s, '#e6ebf2');                 // poste de mira
    coilRing(c, s, 40, 24, ac); coilRing(c, s, 52, 32, ac); coilRing(c, s, 64, 40, ac); // bobinas
    box4(c, s, 66, 22, 18, 15, RB);                       // pack lateral
    ellipseFill(c, 75, 29, 5, 5, s, '#0d0f14');           // ventilador
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]])
      rectPx(c, 75 + ax, 29 + ay, 1, 1, s, RB.lite);
    px(c, 75, 29, s, RB.dark); px(c, 73, 27, s, RB.lite);
    rivetRow(c, s, 67, 24, 4, 0, 4); rivet(c, s, 81, 24);
    cableRun(c, s, [[70, 38], [64, 46], [56, 46]], '#1e222b', ac); // cable grueso accent
    diagBeam(c, s, 58, 46, 62, 56, 6, RB);                // grip
    triggerGroup(c, s, 52, 48);
    gripHand(c, s, 56, 52, 16);                           // mano en el grip
    forearm(c, s, 72, 62, 20);
    px(c, 28, 11, s, '#ffffff'); px(c, 29, 11, s, '#ffffff'); // reflejo del emisor
  } },
  // Changó E9: DOS escopetas escalonadas en diagonal — la de atrás arriba (recortada), la
  // de adelante abajo con ánima doble y guardamano de madera; humo de 1 px de una boca.
  twin: { muzzle: [18, 22], draw(c, s, ac) {
    diagBeam(c, s, 32, 5, 66, 25, 8, MW);                 // caña de atrás
    box4(c, s, 62, 22, 16, 9, RB);                        // cajón de atrás
    diagBeam(c, s, 78, 30, 95, 42, 10, RB, 'b');          // culata de atrás
    muzzleRing(c, s, 32, 5, 3, MW);
    for (let i = 0; i < 4; i++) rectPx(c, 50 + i * 4, 16 + i * 2, 1, 6, s, '#12151d'); // serrations
    rivet(c, s, 74, 25);
    px(c, 31, 1, s, '#7c8794'); px(c, 33, 0, s, '#59616f'); px(c, 35, 1, s, '#4a5260'); // humo 1px
    diagBeam(c, s, 22, 24, 58, 46, 8, MW);                // caña adelante (más gorda, más cerca)
    diagBeam(c, s, 26, 32, 60, 52, 6, MW);                // tubo adelante
    box4(c, s, 54, 42, 24, 12, RB);                       // cajón adelante
    rivetRow(c, s, 74, 45, 3, 0, 4);
    diagBeam(c, s, 76, 54, 95, 64, 12, WD, 'b');          // culata de madera adelante
    for (let i = 0; i < 4; i++) rectPx(c, 82 + i * 3, 58 + i, 1, 4, s, WD.dark);
    muzzleRing(c, s, 21, 23, 4, MW);                      // ánima doble de la boca adelante
    muzzleRing(c, s, 25, 31, 3, MW);
    box4(c, s, 32, 40, 18, 8, WD);                        // guardamano de madera
    for (let i = 0; i < 5; i++) rectPx(c, 34 + i * 3, 43, 1, 4, s, WD.dark);
    triggerGroup(c, s, 60, 55);
    rectPx(c, 57, 44, 4, 2, s, ac);                       // chapa grabada accent
    gripHand(c, s, 32, 38, 16);                           // mano adelante en la madera
    gripHand(c, s, 64, 56, 17);                           // mano atrás en el grip
    forearm(c, s, 82, 64, 16);
    rectPx(c, 70, 27, 3, 2, s, ac);                       // luz del cajón de atrás
  } },
  // Riel del Colastiné E9: rifle sniper-riel LARGO — cañón finísimo que cruza el lienzo
  // con DOS emisores accent y bípode plegado, scope cilíndrico con lente violeta
  // reflectante y culata con agujero de pulgar.
  rail: { muzzle: [7, 12], draw(c, s, ac) {
    diagBeam(c, s, 8, 14, 80, 54, 5, MW);                 // cañón larguísimo
    muzzleRing(c, s, 7, 13, 3, MW);
    rectPx(c, 14, 18, 12, 3, s, RB.base); rectPx(c, 14, 17, 12, 1, s, RB.lite); // bípode plegado
    px(c, 13, 18, s, '#59616f');
    coilRing(c, s, 30, 26, ac); coilRing(c, s, 48, 36, ac); // los dos emisores del riel
    diagBeam(c, s, 34, 16, 62, 32, 2, RB);                // riel superior
    box4(c, s, 68, 46, 20, 11, RB);                       // cajón
    rectPx(c, 73, 49, 8, 4, s, '#07090c'); rectPx(c, 74, 50, 3, 2, s, ac); // ranura cargador
    rivet(c, s, 85, 48);
    box4(c, s, 40, 4, 28, 10, RB);                        // scope cilíndrico
    rectPx(c, 47, 13, 4, 3, s, RB.base); rectPx(c, 58, 18, 4, 3, s, RB.base); // torretas
    ellipseFill(c, 40, 9, 4, 5, s, MW.out);               // objetivo
    ellipseFill(c, 40, 9, 3, 4, s, '#7a3ff2');
    ellipseFill(c, 40, 9, 1, 2, s, '#a86bff');
    px(c, 39, 7, s, '#e6d5ff'); px(c, 41, 11, s, '#4a1fa0'); // reflejo de la lente
    box4(c, s, 82, 54, 14, 10, WD);                       // culata con agujero
    rectPx(c, 86, 57, 6, 4, s, '#07090c');                // thumbhole
    for (let i = 0; i < 3; i++) rectPx(c, 83 + i * 4, 61, 2, 1, s, WD.dark); // vetas
    triggerGroup(c, s, 70, 58);
    gripHand(c, s, 72, 62, 14);                           // mano en el grip
    forearm(c, s, 88, 68, 12);
    px(c, 10, 14, s, '#ffffff');                          // destello en la punta
  } },
  // Compilador E9: GUANTE MECÁNICO gigante abierto en primer plano (llena el lienzo),
  // dedos mecánicos abiertos, cables al antebrazo blindado y la esfera de plasma
  // flotando sobre la palma con aura ditherada. La boca = centro de la esfera.
  orb: { muzzle: [24, 20], draw(c, s, ac) {
    diagBeam(c, s, 38, 46, 92, 72, 26, ARM);              // antebrazo blindado
    rectPx(c, 52, 54, 3, 10, s, ARM.dark); rectPx(c, 68, 60, 3, 10, s, ARM.dark); rectPx(c, 82, 66, 3, 8, s, ARM.dark); // planchas
    rivetRow(c, s, 56, 56, 3, 14, 6);
    cableRun(c, s, [[44, 52], [50, 42], [60, 40], [72, 44]], '#1e222b', '#6b7280');
    cableRun(c, s, [[62, 60], [74, 50], [86, 50]], '#1e222b', '#6b7280');
    box4(c, s, 26, 36, 26, 16, ARM);                      // dorso del guante
    rectPx(c, 30, 40, 18, 5, s, ac); rectPx(c, 33, 41, 12, 3, s, '#e9fff0'); // placa emisiva
    rivet(c, s, 28, 38); rivet(c, s, 49, 49);
    for (let f = 0; f < 4; f++) {                         // dedos mecánicos abiertos
      const fx = 8 + f * 5, fy = 32 - f * 3;
      box4(c, s, fx, fy, 5, 11, ARM);
      px(c, fx + 2, fy + 3, s, ARM.lite);
      px(c, fx + 2, fy + 7, s, ac);                       // bisagra accent del dedo
    }
    box4(c, s, 46, 26, 11, 7, ARM);                       // pulgar
    ellipsePx(c, 26, 40, 11, 3, s, '#0d0f14');            // sombra de la esfera sobre el guante
    for (let i = 0; i < 16; i++) {                        // aura ditherada (damero accent)
      const a = i * Math.PI / 8;
      px(c, Math.round(24 + Math.cos(a) * 15), Math.round(20 + Math.sin(a) * 14), s, ac);
      px(c, Math.round(24 + Math.cos(a + 0.4) * 13), Math.round(20 + Math.sin(a + 0.4) * 12), s, MW.dark);
    }
    ellipseFill(c, 24, 20, 10, 10, s, MW.dark);           // esfera de plasma
    ellipseFill(c, 24, 20, 9, 9, s, ac);
    ellipseFill(c, 24, 20, 5, 5, s, '#eafff0');
    px(c, 20, 16, s, '#ffffff'); px(c, 21, 15, s, '#ffffff'); // especular
    px(c, 28, 25, s, '#0d3b12');                          // sombra interna inferior-der
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
