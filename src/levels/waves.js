import * as THREE from '../three.js';
import { Sfx } from '../audio/sfx.js';
import { player } from '../core/player.js';
import { game } from '../core/state.js';
import { $, clamp, rand } from '../core/utils.js';
import { ARENA, pushOutOfBoxes } from '../core/world.js';
import { Enemy } from '../enemies/enemies.js';
import { pickupPoint, spawnWavePickups, spawnWeaponPickup } from '../levels/items.js';
import { levelDef, waveBaseFor } from '../levels/levels.js';
import { updateHud } from '../ui/hud.js';
import { feed, toast } from '../ui/notify.js';

/* E6 — oleada por TABLA: LEVELS[].spawnWeights es la spec declarativa del bestiario
   de cada sector (peso relativo por tipo). La CANTIDAD sigue la fórmula de E5
   (5+2·n global, tope 26): el multiplicador de cantidad por nivel se mantiene tal cual.
   Redondeo grande→chico (los pesados llenan primero) y los que pesan tan poco que
   el redondeo los borra tienen 1 unidad por sorteo; el último tipo recibe el saldo
   para que el total cierre exacto. */
export function buildWave(n) {
  const w = levelDef().spawnWeights;
  const total = Math.min(5 + 2 * n, 26);
  const keys = Object.keys(w).sort((a, b) => w[b] - w[a]);
  const sum = keys.reduce((s, k) => s + w[k], 0);
  const q = [];
  let acc = 0;
  keys.forEach((k, i) => {
    const cnt = i === keys.length - 1 ? total - acc
      : (total * w[k] >= 1 ? Math.round(total * w[k] / sum) : (Math.random() < total * w[k] / sum ? 1 : 0));
    acc += cnt;
    for (let j = 0; j < cnt; j++) q.push(k);
  });
  return q.sort(() => Math.random() - 0.5);
}

export function spawnPoint() {
  for (let tries = 0; tries < 24; tries++) {
    const side = Math.floor(rand(0, 4));
    const m = ARENA - 3;
    let x, z;
    if (side === 0) { x = rand(-m, m); z = -m; }
    else if (side === 1) { x = rand(-m, m); z = m; }
    else if (side === 2) { x = -m; z = rand(-m, m); }
    else { x = m; z = rand(-m, m); }
    if (Math.hypot(x - player.pos.x, z - player.pos.z) > 14) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(rand(-ARENA + 4, ARENA - 4), 0, rand(-ARENA + 4, ARENA - 4));
}

/* ---- oleadas POR NIVEL: LEVELS[].waves manda; game.wave sigue siendo el contador
   GLOBAL (escala de hp/velocidad del Enemy intacta) sobre el que se suma diffMult().
   HUD: "OLEADA n/total". El número global solo lo lee la fórmula de dificultad. ---- */
export function startLevelWave(i) {
  const total = levelDef().waves;
  game.waveIn = clamp(i, 1, total);
  game.wave = waveBaseFor(game.level - 1) + game.waveIn;
  game.intermission = 0;
  game.bossPending = false;
  game.ammoHint = false; // el hint de munición vuelve a poder aparecer una vez
  game.spawnQueue = buildWave(game.wave);
  game.spawnT = 0;
  spawnWavePickups(game.waveIn); // E3: cajas de recurso (la tabla mira la oleada del nivel)
  $('wave').textContent = `${game.waveIn}/${total}`;
  const msg = $('wavemsg');
  msg.textContent = `OLEADA ${game.waveIn}/${total}`;
  msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
  Sfx.wave();
  updateHud();
}

/* ---- E6: mini-jefes con tipo, arte y patrón PROPIOS (ENEMY_TYPES rows arriba). El
   genérico elite de E5 (scale×2.2 hp×6) quedó reemplazado; la firma del spawn queda igual. ---- */
export const BOSS_TYPE = ['criopylot', 'huerta', 'fundidor', 'confesor', 'moris9'];
export function spawnBossPoint() {
  // centro-norte como el elite viejo, pero DESTRABADO de muros/props (el Huerta vive de
  // su anchor: nace quieto y un spawn dentro de una tapa lo hundiría para siempre)
  const x = (game.level === 2 ? 0 : rand(-9, 9)), z = -10;
  const p = { x, z };
  pushOutOfBoxes(p, 1.6);
  return new THREE.Vector3(clamp(p.x, -ARENA + 3, ARENA - 3), 0, clamp(p.z, -ARENA + 3, ARENA - 3));
}
export function spawnBoss() {
  game.boss = true;
  game.bossGuard = false;
  const type = BOSS_TYPE[game.level - 1] || 'criopylot';
  const b = new Enemy(type, spawnBossPoint(), true);
  const msg = $('wavemsg');
  msg.textContent = b.T.name;
  msg.classList.remove('show'); void msg.offsetWidth; msg.classList.add('show');
  feed(`SECTOR ${game.level}: ${b.T.name} DESPIERTA`);
  Sfx.bossSpawn(type); // queja grave ÚNICA por jefe (spec 3)
  updateHud();
}

// fin de oleada: bonus, siguiente oleada / regalo del guion ("te lo da MORIS") / elite
export function onWaveCleared() {
  const d = levelDef();
  const bonus = 200 * game.waveIn;
  game.score += bonus;
  feed(`OLEADA COMPLETA +${bonus}`);
  if (game.waveIn < d.waves) game.intermission = 3.2;
  else if (d.weapons && d.weapons.mid && !game.midSpawned) {
    // N5: el Compilador cae tras las oleadas, antes del jefe — "la da MORIS-9" (traicionera)
    game.midSpawned = true;
    spawnWeaponPickup(d.weapons.mid, pickupPoint());
    feed('MORIS-9 TE PASA UN REGALO: EL COMPILADOR');
    toast('REGALO DE MORIS: COMPILADOR', 'weapon big');
    game.bossDelay = 5; // tiempo de verlo caer antes de que entre el elite
  } else game.bossPending = true;
  updateHud();
}

// limpieza de combate común a arranque de sector y respawn (Nada volando entre niveles:
// cohetes/células/orbes/rayos/casas fuera — hotfix E4a: el reset no puede dejar proyectiles huérfanos.
// E6: ídem con el pool ENEMIGO y las zonas/afterimages: ni proyectiles
// ni charcos de veneno sobreviven el cambio de nivel — validación pedida en el pedido).
