import { ellipseFill, ellipseOutline, ellipsePx, pixelCanvas, px, rectPx } from '../art/pixel.js';

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
export const MW = { out: '#0d0f14', lite: '#4a5260', base: '#2e333e', dark: '#1b1e26' };      // cañón (metal oscuro)
export const RB = { out: '#0d0f14', lite: '#59616f', base: '#3a3f4c', dark: '#262a34' };      // cajera (chapa)
export const HT = { out: '#171a20', lite: '#565e68', base: '#3a4048', dark: '#272b31' };      // guante #3a4048
export const WD = { out: '#2a1a0c', lite: '#9c6a44', base: '#7a4a2b', dark: '#55351d' };      // madera #7a4a2b
export const ARM = { out: '#0d0f14', lite: '#6b7280', base: '#4b525e', dark: '#333945' };     // blindaje (orb)
export const GL = { out: '#171a20', lite: '#a8b0b8', base: '#6b7280', dark: '#3a4048' };      // guante gordo E9b #6b7280

// caja 4 tonos con outline 1px: luz arriba-izq, sombra abajo-der (la base del look E9)
export function box4(c, s, x, y, w, h, P) {
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
export function diagBeam(c, s, xt, yt, xb, yb, w, P, alar = 't') {
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
export function muzzleRing(c, s, cx, cy, r, P) {
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
export function coilRing(c, s, cx, cy, ac, big = 0) {
  ellipseFill(c, cx, cy, 3 + big, 4 + big, s, MW.out);
  ellipseOutline(c, cx, cy, 2 + big, 3 + big, s, ac);
  ellipseFill(c, cx, cy, 1 + big, 2 + big, s, ac);
  px(c, cx - 1, cy - 1, s, '#ffffff');
}

// mano enguantada agarrando CON DEDOS: dorso + 4 dedos que envuelven el arma + placa de
// nudillos #6b7280 con studs + reflejo puntual. (x,y) = esquina de los dedos (lado cañón).
export function gripHand(c, s, x, y, w, st = HT) {
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
export function wrapHand(c, s, x, y, w, nf = 3, st = HT, thumb = false) {
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
export function forearm(c, s, x, y, w = 16) {
  diagBeam(c, s, x, y, x + (95 - x) + 6, 78, w, HT);
  px(c, x + 2, y + 2, s, '#565e68'); px(c, x + 3, y + 2, s, '#565e68');
}

// cable/manguera gruesa: polyline con luz arriba
export function cableRun(c, s, pts, col = '#1e222b', lite = '#4a5260') {
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
export function triggerGroup(c, s, x, y, st = RB) {
  box4(c, s, x, y, 10, 2, st);
  rectPx(c, x + 1, y + 2, 2, 4, s, st.out);
  rectPx(c, x + 7, y + 2, 2, 4, s, st.out);
  rectPx(c, x + 3, y + 1, 3, 4, s, '#14171d');            // gatillo
}

// tornel en un corner de chapa (el detalle "remachado" de Boltgun)
export function rivet(c, s, x, y) { px(c, x, y, s, '#59616f'); px(c, x, y + 1, s, '#12151d'); }
export function rivetRow(c, s, x, y, n, dx = 4, dy = 0) { for (let i = 0; i < n; i++) rivet(c, s, x + i * dx, y + i * dy); }

export const SIL = {
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

