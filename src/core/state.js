import { update } from '../core/update.js';
import { $ } from '../core/utils.js';

/* ============================================================ game state (E5: campaña) */
export const game = {
  state: 'menu',           // menu | play | pause | dead | terminal (E5: overlay MORIS-9)
  wave: 1,                 // Nº GLOBAL de oleada (la fórmula vieja de hp/velocidad sigue acá)
  waveIn: 1,               // oleada DENTRO del nivel — la que muestra el HUD "n/total"
  level: 1,                // sector 1..5 (fila de LEVELS)
  lives: 3,                // "SECTORES REINICIADOS" (spec DESIGN_ARSENAL)
  boss: false,             // mini-jefe elite en pie
  bossPending: false,      // oleadas completas: el elite aún no pisó la arena
  bossDelay: 0,            // respiro tras el "regalo de MORIS" (compilador en N5) antes del elite
  bossGuard: false,        // onBossKilled corre una sola vez por nivel
  slowmoT: 0, completeT: 0, // E6: muerte de MORIS-9 → 1.5 s de slow-mo del FX y crédito
  portalOpen: false, portalPending: false, midSpawned: false,
  respawnPending: false,       // muerte con vidas: el respawn se aplica al cerrar el loop de enemigos
  spawnQueue: [], spawnT: 0,
  intermission: 0,
  score: 0, kills: 0,      // score TOTAL de la campaña (persiste entre sectores)
  ammoHint: false,         // E3: hint "SIN MUNICIÓN" ya mostrado en esta oleada
  time: 0,
};
export const meta = { best: parseInt(localStorage.getItem('moris-shooter-best') || '0', 10) };
$('bestmenu').textContent = meta.best;
export const LIVES_MAX = 3;

// E10 holders: primitivas mutables compartidas entre modulos (los objetos son
// mutables; las reasignaciones cruzadas de "let" no estan permitidas en ESM)
export const view = { yaw: 0, pitch: 0 };
export const juice = { dmgFlash: 0, hitmarkT: 0, hitstopT: 0 };
export const portal = { mesh: null, cd: 0 };
export const combatHud = { bossK: null, gfxT: 0 };
export const fb = { killSnd: -9 };
export const touchSwap = { update: () => {} };

