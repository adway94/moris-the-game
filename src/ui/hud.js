import { curMag, curWeapon, player } from '../core/player.js';
import { LIVES_MAX, combatHud, game } from '../core/state.js';
import { $, clamp } from '../core/utils.js';
import { enemies } from '../enemies/enemies.js';
import { AMMO, SLOT, WEAPONS } from '../weapons/tables.js';


/* ---- E4a: nombre del arma y "CALOR" (sobrecalentamiento): el DOM solo se toca cuando
   el texto cambia (update() corre a 60 fps y el cooling es continuo). ---- */
export let lastWname = '';
export function updateWname() {
  const txt = player.cooling > 0 ? 'CALOR' : curWeapon().name;
  if (txt === lastWname) return;
  lastWname = txt;
  const el = $('wname');
  el.textContent = txt;
  el.classList.toggle('hot', player.cooling > 0);
}

// E5: vidas "SECTORES REINICIADOS" — corazones prendidos + los gastados tenues
export function updateLives() {
  const on = '♥'.repeat(Math.max(0, Math.min(LIVES_MAX, game.lives)));
  const off = game.lives < LIVES_MAX ? `<span class="off">${'♥'.repeat(LIVES_MAX - Math.max(0, game.lives))}</span>` : '';
  $('lives').innerHTML = on + off;
}

/* ---- E6 — barra de JEFE (spec 5): arriba y centrada, SOLO con un boss vivo; nombre +
   hp proporcional. Mismo cuidado DOM del archivo: el nombre solo se toca cuando cambia
   y el ancho se escribe con string-cache (update corre a 60 fps, el DOM no). La resetea
   resetArenaCombat (beginLevel/respawn). --bc tiñe el borde en el color del jefe. ---- */
export function bossHud() {
  const b = enemies.find(e => e.boss && e.spawnT > 0);
  const bar = $('bossbar');
  if (!b) {
    if (combatHud.bossK !== null) { combatHud.bossK = null; bar.classList.remove('show'); }
    return;
  }
  if (combatHud.bossK !== b.T.name) {
    combatHud.bossK = b.T.name;
    $('bossname').textContent = b.T.name;
    const hex = '#' + (b.T.color >>> 0).toString(16).padStart(6, '0');
    bar.style.setProperty('--bc', hex);
    $('bossfill').style.background = `linear-gradient(90deg,#6b1020,${hex})`;
    bar.classList.add('show');
  }
  const w = (clamp(b.hp / b.T.hp, 0, 1) * 100).toFixed(1) + '%';
  const f = $('bossfill');
  if (f._w !== w) { f._w = w; f.style.width = w; }
}

export function updateHud() {
  const pct = clamp(player.hp / player.maxHp, 0, 1);
  const bar = $('hpbar');
  bar.style.width = (pct * 100) + '%';
  bar.classList.toggle('low', pct < 0.35);
  // barra de ARMADURA azul (E3): mismo estilo que VITALIDAD, especular abajo
  const apct = clamp(player.armor / player.maxArmor, 0, 1);
  $('armorbar').style.width = (apct * 100) + '%';
  // Munición (E4a): "30 / 124 balas" = cargador / pool del tipo que consume el arma.
  // Armas sin cargador ni pool (fists) → "∞"; flow (asador) sin cargador → muestra el
  // pool directo: lo que consume en combate ES el pool.
  const W = curWeapon();
  const magEl = $('mag');
  if (!W.ammo) { magEl.textContent = '∞'; $('reserve').textContent = ''; }
  else if (W.magSize > 0) {
    magEl.textContent = curMag();
    $('reserve').textContent = ` / ${player.pools[W.ammo].n} ${AMMO[W.ammo].label.toLowerCase()}`;
  } else {
    magEl.textContent = player.pools[W.ammo].n;
    $('reserve').textContent = ` ${AMMO[W.ammo].label.toLowerCase()}`;
  }
  updateWname();
  updateSlotBar();
  $('score').textContent = game.score;
  $('enemies').textContent = enemies.length + game.spawnQueue.length; // el boss es un Enemy más: ya cuenta
  $('sector').textContent = game.level;
  updateLives();
}

/* ---- slot bar (HUD): una ficha por arma owned con pool: "2 M12 34" (slot, shortName,
   resto del pool). La activa resaltada. Se reconstruye solo cuando cambia owned; los
   números se refrescan desde updateHud (barato: ≤10 fichas). E4b (polish 4b): shortName
   de 4 letras limpias por arma (VECI era un truncamiento feo de VECINAL) + margen derecho
   de la barra en CSS (#slotbar margin-right). */
export let slotEls = [], lastOwnedN = -1;
export function updateSlotBar() {
  const ids = SLOT.filter(id => id && player.owned.has(id));
  if (ids.length !== lastOwnedN) {
    lastOwnedN = ids.length;
    const wrap = $('slotbar');
    wrap.innerHTML = ''; // rebuild = reconstruir de verdad (si no, retry duplicaría fichas)
    slotEls = ids.map(id => {
      const d = document.createElement('div');
      d.className = 'slot';
      d.dataset.id = id;
      const W = WEAPONS[id];
      d.innerHTML = `<b>${W.slot + 1}</b> ${W.shortName}<i></i>`;
      wrap.appendChild(d);
      return d;
    });
  }
  for (const el of slotEls) {
    const id = el.dataset.id, W = WEAPONS[id];
    el.classList.toggle('active', id === player.weaponId);
    el.querySelector('i').textContent = W.ammo ? String(player.pools[W.ammo].n) : '∞';
  }
}

// E10 glue: rebuild forzado del slot bar desde flow/campaign sin reasignar el let
export function resetSlotBarCache() { lastOwnedN = -1; }

