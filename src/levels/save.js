import { player } from '../core/player.js';
import { game } from '../core/state.js';
import { $ } from '../core/utils.js';
import { LEVELS } from '../levels/levels.js';
import { WEAPONS } from '../weapons/tables.js';

/* ---- save de campaña (localStorage "moris-campaign"): checkpoint por sector para el
   retry de la muerte definitiva (spec E5: retoma en el LEVEL actual con armas
   conservadas). Se escribe al empezar cada sector (snapshot limpio) y se refresca al
   desbloquear un arma; el retry reparte pools con piso de balas (la vecinal dispara
    siempre). "NUEVA PARTIDA" lo borra. La vida/oleada NO se guardan: retry = oleada 1
   del sector, como en Doom. ---- */
export const SAVE_KEY = 'moris-campaign';
export function saveCampaign() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, level: game.level, score: game.score, kills: game.kills,
      owned: [...player.owned],
      pools: Object.fromEntries(Object.entries(player.pools).map(([k, p]) => [k, p.n])),
    }));
  } catch (e) { /* storage lleno/inaccesible: la campaña sigue jugable, sin checkpoint */ }
}
export function loadCampaign() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || !(s.level >= 1 && s.level <= LEVELS.length)) return null;
    const owned = [...new Set((Array.isArray(s.owned) ? s.owned : []).filter(id => WEAPONS[id]))];
    if (!owned.includes('fists') || !owned.includes('rifle')) owned.push('fists', 'rifle');
    return { level: s.level | 0, score: s.score | 0, kills: s.kills | 0, owned,
             pools: s.pools && typeof s.pools === 'object' ? s.pools : {} };
  } catch (e) { return null; }
}
export function clearCampaign() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
export function refreshContinueBtn() {
  const s = loadCampaign();
  const b = $('contbtn');
  if (!b) return;
  b.style.display = s ? '' : 'none';
  b.textContent = `CONTINUAR SECTOR ${s ? s.level : 1} · ${s ? LEVELS[s.level - 1].name : ''}`;
}

