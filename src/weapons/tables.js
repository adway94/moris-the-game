import { $ } from '../core/utils.js';
import { burst } from '../render/fx.js';

/* ============================================================ recursos (E3) — spec DESIGN_ARSENAL.md
   Arquitectura pensada para que E4 enchufe las 10 armas sin tocar el sistema:
   - AMMO: tabla de pools por TIPO de munición (cap + etiqueta). Un arma nueva que use
     un tipo nuevo = una fila acá y nada más.
   - PICKUPS: definición por kind de pickup (categoría + cuánto otorga). El arte vive en
     sprites.js:makePickupSprite — el kind debe existir allí también. */
export const AMMO = {
  balas:     { cap: 200, label: 'BALAS' },
  cartuchos: { cap: 60,  label: 'CARTUCHOS' },
  celulas:   { cap: 150, label: 'CÉLULAS' },
  cohetes:   { cap: 12,  label: 'COHETES' },
  argents:   { cap: 20,  label: 'ARGENTS' },
};
/* ============================================================ E4a/E4b — tabla de armas (10/10)
   UNA FILA POR ARMA = spec de balance (DESIGN_ARSENAL.md). Tipos de disparo:
     melee      → ray corto sin mag ni pool, empujón (fists SIEMPRE andá: fallback Doom)
     hitscan    → un rayo con W.dmg (refactor del rifle de siempre: el id "rifle" ES la
                  vecinal — alias interno para no romper HUD/pools/mags de E3)
     shotgun    → W.pellets hitscan con dirección rotada en cono W.spread (cono TOTAL)
     twin       → escopeta doble (changó): UN clic dispara W.bullets cañones. El primero
                  consume W.ammoCost cartuchos DEL POOL y dispara; el segundo sale a los
                  W.burst s SOLO si queda pool (consumo sobre la marcha: el último cartucho
                  no se hipoteca). magSize 0 = sin cargador, el pool va directo a la vista
     flow       → dispara ticks de W.tick mientras firing y pool>0, consumiendo
                  W.flowRate células/s DEL POOL (sin cargador, sin tryReload)
     projectile → proyectil con pooling (W.projVel m/s, sale bajo los ojos). Con splash>0
                  es el cohete de Kira: bola de fuego con decaimiento lineal y auto-daño
                  al jugador <3 m. Con splash:0 es la célula de Mate: W.dmg DIRECTO al
                  enemigo que toca y pop contra muro/caja/suelo (sin área). Con orb:true
                  es el orbe del Compilador (pool propio): detona al impactar enemigo o
                  geometría, o a los W.life s → BFG_DMG a TODO enemigo a <BFG_RADIUS m,
                  screen shake y enemigos "scorched" (ver updateOrbs/bfgBlast)
     rail       → gatillo de carga (riel): mantener W.chargeT s el gatillo (el anillo DOM
                  #railring del crosshair se llena) y AL SOLTAR sale un hitscan PERFORANTE
                  de W.dmg a TODOS los enemigos del rayo (lista completa de
                  intersectObjects, cortada por la primera pared). Consume W.ammoCost (5)
                  células al soltar: si el pool no llega, no carga (click seco + hint).
                  W.cad = cooldown DESPUÉS del disparo. El riel no quema ni scorcha
   Campos: slot (teclas 1..0 = slot 0..9), cross (clase del crosshair DOM, por arma),
   shortName (abreviatura limpia de la slot bar — ≤4 letras, nada de "VECI" a medias),
   ammo (pool o null=infinito), magSize (0 = sin cargador: flow/twin/rail/orbe consumen el
   pool directo), dmg/cad (segundos entre disparos), pellets/spread (shotgun y twin),
   bullets/burst/ammoCost (twin; ammoCost también riel), chargeT (rail), projVel/splash/
   life/orb (proyectil), heatMax (ráfagas seguidas antes del bloqueo), kick (retroceso del
   viewmodel, m) / recoil (patada de cámara, rad), sfx (método de Sfx del disparo),
   silhouette y accent para el viewmodel pixelado (sprites.js:makeWeaponSprite). */
export const WEAPONS = {
  fists:  { slot: 0, name: 'PUÑOS',          shortName: 'PUÑO', cross: 'melee',   ammo: null,      magSize: 0,  dmg: 30, cad: 0.5,
            type: 'melee',      range: 2.4, knock: 1.15, kick: 0.10, recoil: 0.006, sfx: 'shootFist',
            silhouette: 'fists' },
  rifle:  { slot: 1, name: 'VECINAL',        shortName: 'VEC',  cross: 'pistol',  ammo: 'balas',   magSize: 30, dmg: 22, cad: 0.22,
            type: 'hitscan',    spread: 0.006, kick: 0.05, recoil: 0.012, sfx: 'shootVecinal',
            silhouette: 'pistol',  accent: '#54f0ff' },
  moris12:{ slot: 2, name: 'MORIS-12',       shortName: 'M12',  cross: 'shotgun', ammo: 'cartuchos', magSize: 6, dmg: 8, cad: 0.85, pellets: 8,
            type: 'shotgun',    spread: 0.157 /* cono total ~9° */, kick: 0.11, recoil: 0.045, sfx: 'shootShotgun',
            silhouette: 'shotgun', accent: '#ffb057' },
  ametralladora: { slot: 3, name: 'AMETRALLADORA', shortName: 'AMET', cross: 'smg', ammo: 'balas', magSize: 60, dmg: 15, cad: 0.09,
            type: 'hitscan',    spread: 0.016, heatSpread: 0.014, heatMax: 40, /* 40 seguidas → bloqueo 1.2 s */
            kick: 0.035, recoil: 0.008, sfx: 'shootSmg',
            silhouette: 'smg',   accent: '#b6ff5e' },
  asador: { slot: 4, name: 'ASADOR',         shortName: 'ASAN', cross: 'flamer',  ammo: 'celulas', magSize: 0,  dmg: 9,  cad: 0,
            type: 'flow',       tick: 0.1, flowRate: 2, cone: 0.349 /* ±10° (20° total) */, range: 7,
            burnT: 4, burnDps: 2.25, kick: 0.02, recoil: 0, sfx: 'flame',
            silhouette: 'flamer', accent: '#ff5e3a' },
  kira:   { slot: 5, name: 'KIRA',           shortName: 'KIRA', cross: 'rocket',  ammo: 'cohetes', magSize: 4,  dmg: 95, cad: 1.1,
            type: 'projectile', projVel: 20, splash: 3, spread: 0.01, kick: 0.12, recoil: 0.05, sfx: 'rocketFire',
            silhouette: 'rocket', accent: '#ff2d55' },
  // ---- E4b (slots 6-9; siluetas 'plasma'/'twin'/'rail'/'orb' en sprites.js). OJOS E5:
  //  · MATE y ASADOR comiven el pool 'celulas' (decisión E4b, el riesgo que E4a anotó:
  //    pool compartido como la energía del plasma Doom — el riel cobra 5 células de ahí).
  //    La goma son los drops ammoCelulas y las cajas de arena (spawnWavePickups n≥4).
  //  · CHANGÓ comparte 'cartuchos' con MORIS-12 (dos escopetas, un solo lenguaje Doom).
  //  · COMPILADOR: 10 argents por orbe y cap 20 → el arma vive "a dos orbes"; la caja
  //    ammoArgents (+2) es escasa a propósito y el drop normal NO suelta argents.
  mate:   { slot: 6, name: 'MATE',           shortName: 'PLAS', cross: 'plasma',  ammo: 'celulas', magSize: 40, dmg: 30, cad: 0.16,
            type: 'projectile', projVel: 28, splash: 0 /* daño directo en el impacto, sin splash */, spread: 0.008,
            kick: 0.04, recoil: 0.008, sfx: 'shootPlasma',
            silhouette: 'plasma', accent: '#5ee6ff' },
  chango: { slot: 7, name: 'CHANGÓ',         shortName: 'DBLE', cross: 'twin',    ammo: 'cartuchos', magSize: 0 /* dos cañones al pool: sin recarga */, dmg: 10, cad: 1.2, pellets: 14,
            type: 'twin',       bullets: 2, ammoCost: 1, burst: 0.25, spread: 0.157 /* mismo cono del MORIS-12: la furia va en 14×10 */,
            kick: 0.13, recoil: 0.05, sfx: 'shootTwin',
            silhouette: 'twin',  accent: '#ffb057' },
  riel:   { slot: 8, name: 'RIEL',           shortName: 'RIEL', cross: 'rail',    ammo: 'celulas', magSize: 0 /* 5 células por disparo, directo al pool */, dmg: 160, cad: 1.4,
            type: 'rail',       chargeT: 0.35, ammoCost: 5,
            kick: 0.09, recoil: 0.03, sfx: 'railFire',
            silhouette: 'rail',  accent: '#b6ff5e' },
  compilador: { slot: 9, name: 'COMPILADOR', shortName: 'BFG',  cross: 'bfg',     ammo: 'argents', magSize: 0 /* 10 argents por orbe: el pool manda */, dmg: 300, cad: 2.0,
            type: 'projectile', orb: true, ammoCost: 10 /* 10 argents por orbe */, projVel: 12, life: 3 /* orbe: 12 m/s, detona al impactar o a los 3 s */,
            kick: 0.10, recoil: 0.04, sfx: 'bfgFire',
            silhouette: 'orb',   accent: '#6dff5e' },
};
// slot → id (teclas 1..0 = slot 0..9). A E4b le basta agregar filas arriba: esto se solo.
export const SLOT = Array(10).fill(null);
for (const id in WEAPONS) SLOT[WEAPONS[id].slot] = id;
// crosshair DOM por ARMA (clases wcross-* en index.html; `cross` distingue las que
// comparten type, p.ej. vecinal y ametralladora son ambas hitscan)
export const applyCrosshair = id => $('crosshair').className = 'wcross-' + (WEAPONS[id].cross || WEAPONS[id].type);
export const PICKUPS = {
  medkit:      { cat: 'hp',    amount: 25 },
  medbox:      { cat: 'hp',    amount: 50 },
  medkitSmall: { cat: 'hp',    amount: 10 },
  armorShard:  { cat: 'armor', amount: 15 },
  armorHelm:   { cat: 'armor', amount: 35 },
  ammoBalas:     { cat: 'ammo', ammo: 'balas',     amount: 18 },
  ammoCartuchos: { cat: 'ammo', ammo: 'cartuchos', amount: 8 },
  ammoCelulas:   { cat: 'ammo', ammo: 'celulas',   amount: 15 },
  ammoCohetes:   { cat: 'ammo', ammo: 'cohetes',   amount: 2 },
  ammoArgents:   { cat: 'ammo', ammo: 'argents',   amount: 2 },
  ammoGrande:    { cat: 'ammo', ammo: 'balas',     amount: 40 }, // drop garantizado de BRUTE
};
// estado inicial de recursos por partida/retry (hp100/armor0/120 balas vive acá).
// E4a: owned arranca fists+vecinal (id interno "rifle"); el mag solo se crea para las
// owned con cargador (las flow como el asador se crean al desbloquearse, vacías: E5
// las llena con el pickup de arma). El pickup de arma (spawnWeaponPickup, E4b) llama
// unlockWeapon(id) y suma START_AMMO del pool.
export const START_OWNED = ['fists', 'rifle']; // arranque fijo (E5 mueve el desbloqueo al pickup)
// E4b — puerta trasera de QA: ?weapons=all arranca con el arsenal completo + ammo inicial
// por pool para testear los 10 slots HOY. No reemplaza a E5: solo siembra startResources;
// los pickups de arma del piso siguen usando START_AMMO al pisarse.
export const ALL_WEAPONS = new URLSearchParams(location.search).get('weapons') === 'all';
// Munición que trae un pickup de arma al pisarse (spec E4b: cartuchos 24, células 40,
// argents 10). balas/cohetes las completa E4b para que ningún pickup llegue pelado a E5.
export const START_AMMO = { balas: 40, cartuchos: 24, celulas: 40, cohetes: 3, argents: 10 };
export const startResources = () => ({
  hp: 100, armor: 0,
  owned: new Set(ALL_WEAPONS ? Object.keys(WEAPONS) : START_OWNED),
  mags: Object.fromEntries((ALL_WEAPONS ? Object.keys(WEAPONS) : START_OWNED)
    .filter(id => WEAPONS[id].magSize > 0)
    .map(id => [id, WEAPONS[id].magSize])),
  weaponId: 'rifle',
  pools: { balas: { n: 120 + (ALL_WEAPONS ? START_AMMO.balas : 0) },
           cartuchos: { n: ALL_WEAPONS ? START_AMMO.cartuchos : 0 },
           celulas: { n: ALL_WEAPONS ? START_AMMO.celulas : 0 },
           cohetes: { n: ALL_WEAPONS ? START_AMMO.cohetes : 0 },
           argents: { n: ALL_WEAPONS ? START_AMMO.argents : 0 } },
});

