import { ellipseOutline, ellipsePx, outlined, pixelCanvas, px, rectPx, shadowPx } from '../art/pixel.js';

// paletas por tipo (base / sombra / luz / acento emisivo)
export const PAL = {
  droner:   { base:'#c0392b', dark:'#7d1f16', lite:'#ff6b5e', glow:'#ffdada', eye:'#fff3a0' },
  sprinter: { base:'#8e44ad', dark:'#5e2b76', lite:'#c77dff', glow:'#f0d9ff', eye:'#b8ffe8' },
  brute:    { base:'#d97a2b', dark:'#8a4a12', lite:'#ffb057', glow:'#fff0c0', eye:'#ffe14d' },
};

// ---- DRONER: dron flotante con un ojo grande y antenita (idle 2 frames = aleteo)
export function drawDroner(frame, s) {
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
export function drawSprinter(frame, s) {
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
export function drawBrute(frame, s) {
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
export const DRAW = { droner: drawDroner, sprinter: drawSprinter, brute: drawBrute };

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
export function drawEsporeador(frame, s) {
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
export function drawLancellas(frame, s) {
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
export function drawPosesivo(frame, s) {
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
export function drawEspectro(frame, s) {
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
export function drawGlitch(frame, s) {
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
export function drawCriopylot(frame, s) {
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
export function drawHuerta(frame, s) {
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
export function drawFundidor(frame, s) {
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
export function drawConfesor(frame, s) {
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
export function drawMoris9(frame, s) {
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

