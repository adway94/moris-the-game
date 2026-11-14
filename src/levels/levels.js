import { game } from '../core/state.js';
import { neon } from '../core/utils.js';
import { setCriopods, setCripta, setInvernadero, setNucleo, setReactor } from '../levels/sets.js';

export const PALETTES = {
  criopods:   { floor: '#0e1523', lite: '#243754', dark: '#050910', seam: '84,240,255',  wall: '#101a30', wallLite: '150,190,255', chevron: '#c96a1c', chevronLite: 'rgba(255,196,96,0.5)', chevronBack: '#1a1206', ob: '#202c48', obLite: '190,215,255', neon: 0x54f0ff, noise: '150,190,255' },
  invernadero:{ floor: '#0c1a10', lite: '#1e3a24', dark: '#040b06', seam: '77,220,110',  wall: '#12241a', wallLite: '140,220,160', chevron: '#3fae54', chevronLite: 'rgba(140,255,160,0.5)', chevronBack: '#0b1a0e', ob: '#1f3a26', obLite: '170,240,190', neon: 0x5eff8a, noise: '150,255,190' },
  reactor:    { floor: '#1b120a', lite: '#43301c', dark: '#0b0704', seam: '255,154,61',  wall: '#2a1a0e', wallLite: '255,180,120', chevron: '#ff6a2a', chevronLite: 'rgba(255,220,150,0.5)', chevronBack: '#26100a', ob: '#3a2718', obLite: '255,200,150', neon: 0xff9a3d, noise: '255,180,120' },
  cripta:     { floor: '#14101f', lite: '#2c2440', dark: '#070510', seam: '170,92,255',  wall: '#1c1630', wallLite: '190,160,255', chevron: '#7a4dbf', chevronLite: 'rgba(200,150,255,0.5)', chevronBack: '#150e24', ob: '#262040', obLite: '200,180,255', neon: 0xaa5cff, noise: '190,160,255' },
  nucleo:     { floor: '#020409', lite: '#0a1626', dark: '#000104', seam: '84,240,255',  wall: '#05090f', wallLite: '120,240,255', chevron: '#2ad4ff', chevronLite: 'rgba(160,255,255,0.6)', chevronBack: '#041420', ob: '#0a1420', obLite: '150,230,255', neon: 0x54f0ff, noise: '120,240,255' },
};

/* Las 5 de DESIGN_ARSENAL.md/PLAN_ITERACION.md. Campos:
   · waves + weapons {early, exit, mid} = colocación de armas del guion (early: al iniciar ·
     exit: ANTES del portal en la antesala, no te lo podés perder · mid: tras completar las
     waves, "te lo da MORIS").
    · E6b boss: tipo del mini-jefe del sector (fila de ENEMY_TYPES con bossType:true) —
      DECLARATIVO como spawnWeights; BOSS_TYPE queda como orden histórico/fallback.
   · sky {kind:'stars'|'dome'|'void', stops, stars, code} · fog {color, density}
   · light: [hemi sky, ground, int] [sun col, int] [rim cian, rim magenta, int, int]
   · set: constructor de geometría propia + props (≤40) — ver funciones setXxx abajo.
   · E6 spawnWeights: bestiario PROPIO por sector — peso relativo por tipo en cada
     oleada (buildWave reparte el total de la fórmula E5 según estos pesos; la
     cantidad por nivel se mantiene intacta). N1 = la mezcla histórica de E5. */
export const LEVELS = [
  { id: 1, name: 'CRIOPODS', subtitle: 'el frío despierta a todo, incluso a lo que no debería',
    waves: 3, seed: 1337, pal: PALETTES.criopods,
    spawnWeights: { droner: 2, sprinter: 1 },                     // como hoy: droners + rastreadores
    boss: 'criopylot',                                             // E6b: droner gigante con cría y embestida
    weapons: { exit: 'moris12' },                              // "escopeta al final N1": antesala del portal
    sky: { kind: 'stars', stops: [[0, '#000104'], [0.34, '#020715'], [0.62, '#082142'], [0.86, '#114374'], [0.955, '#1d5d94'], [1, '#0a1a30']], stars: true },
    bg: 0x05070d, fog: { color: 0x081327, density: 0.021 },        // niebla azul densa
    light: [[0x4a6ea8, 0x0e1424, 1.5], [0xbfd8ff, 2.4], [0x2ad4ff, 0xff3bd8, 95, 80]],
    set: setCriopods },
  { id: 2, name: 'INVERNADERO', subtitle: 'el jardín de MORIS-9, regado con tripulación',
    waves: 4, seed: 552, pal: PALETTES.invernadero,
    weapons: { early: 'ametralladora', exit: 'asador' },       // N2 early / N2 final (guion DESIGN_ARSENAL)
    sky: { kind: 'dome', stops: [[0, '#02150c'], [0.3, '#06351d'], [0.6, '#0d5a2c'], [0.85, '#1d8a45'], [0.95, '#2fb35c'], [1, '#0a2f1a']], stars: false },
    spawnWeights: { esporeador: 4, droner: 3, sprinter: 3 },      // E6: el jardín camina
    boss: 'huerta',                                                // E6b: la planta raíz que no se mueve
    bg: 0x04120a, fog: { color: 0x0d3a1e, density: 0.023 },        // niebla verde
    light: [[0x4ac07a, 0x0a1c10, 1.8], [0xaaffc4, 2.2], [0x3ddc84, 0xff3bd8, 90, 70]],
    set: setInvernadero },
  { id: 3, name: 'REACTOR', subtitle: 'el naranja NO es suelo',
    waves: 4, seed: 9081, pal: PALETTES.reactor,
    weapons: { early: 'kira', exit: 'mate' },
    sky: { kind: 'dome', stops: [[0, '#0a0503'], [0.45, '#1e0b04'], [0.72, '#59210a'], [0.9, '#9c4413'], [1, '#2a0f06']], stars: false },
    spawnWeights: { lancellas: 4, esporeador: 3, brute: 3 },      // E6: fundición con lanzas
    boss: 'fundidor',                                              // E6b: brute cañón de colada, fase 2 enloquece
    bg: 0x120803, fog: { color: 0x3a1608, density: 0.02 },         // fog naranja
    light: [[0x9a5a2a, 0x1c0c04, 1.6], [0xffc890, 2.0], [0xff7a2a, 0xffd166, 110, 60]],
    set: setReactor },
  { id: 4, name: 'CRIPTA', subtitle: 'arte anterior a la inteligencia. o a la mía',
    waves: 5, seed: 4242, pal: PALETTES.cripta, trimK: 2.4, // filo de muros más HDR (ambiental casi muerta)
    weapons: { early: 'chango', exit: 'riel' },
    sky: { kind: 'void', stops: [[0, '#020107'], [0.55, '#0a0618'], [0.85, '#160c2e'], [1, '#070410']], stars: false },
    spawnWeights: { posesivo: 4, espectro: 4, sprinter: 2 },     // E6: la cripta está poseída
    boss: 'confesor',                                              // E6b: espectro grande que salta a cada golpe
    bg: 0x060309, fog: { color: 0x160c2e, density: 0.028 },        // casi a ciegas
    light: [[0x3a2c58, 0x070410, 0.55], [0x9a7ad0, 0.5], [0xaa5cff, 0x5450ff, 130, 90]], // ambient al piso: los emisivos cargan la escena
    set: setCripta },
  { id: 5, name: 'NÚCLEO: MORIS-9', subtitle: 'todo ascensor termina donde empezó todo',
    waves: 1, seed: 777, pal: PALETTES.nucleo, seamK: 2.2, // grilla cian tipo Tron (junta del piso al doble)
    // E6: la arena glitch mezcla TODO el bestiario + glitch (el núcleo clona lo que vio)
    spawnWeights: { glitch: 4, droner: 2, sprinter: 2, lancellas: 2, espectro: 2, brute: 1, esporeador: 1, posesivo: 1 },
    boss: 'moris9',                                                // E6b: jefe final — núcleo + anillo, 3 fases
    weapons: { mid: 'compilador' },                           // "N5 medio: tras las oleadas, te lo da MORIS"
    sky: { kind: 'void', code: true },                             // vacío negro con código cian
    bg: 0x000205, fog: { color: 0x03141f, density: 0.013 },        // niebla cian fina
    light: [[0x14344a, 0x02060a, 1.0], [0x88d0ff, 1.3], [0x2ad4ff, 0x1150ff, 120, 70]],
    set: setNucleo },
];
// waves globales acumuladas antes del nivel i (para el número global de game.wave): [0,3,7,11,16]
export const waveBaseFor = i => LEVELS.slice(0, i).reduce((s, l) => s + l.waves, 0);
export const levelDef = () => LEVELS[game.level - 1];
export const diffMult = () => 1 + 0.25 * (game.level - 1); // recalibración de dificultad por sector

