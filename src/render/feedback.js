import { Sfx } from '../audio/sfx.js';
import { game, juice } from '../core/state.js';
import { $ } from '../core/utils.js';
import { bloodSpray } from '../render/fx.js';


/* ============================================================ E11 — game feel (juice)
   Feedback sensorio de lo que YA pasa (cero cambios de balance/mecánica). Todo el daño
   de arma del jugador pasa por Enemy.takeDamage → feedbackHit: UN punto que dispara
   sangre, tick sonoro, hitmarker y hitstop, con grouping por frame de juego (game.time
   se suma una vez por update, así los 14 pellets del changó o los ticks del asador
   cuentan como UN evento: un tick y UN hitmarker, kills no spamean). --- */
export const HITSTOP = 0.04;   // s de dt congelado en KILL (25 ms si se siente brusco)
export let _fbFrame = -1;      // game.time del grupo actual (grouping por frame)
export let _fbTick = 0;        // ya sonó el tick de este frame?
export let _fbKill = 0;        // ya hubo kill este frame? (hitstop una sola vez)
export let _fbMode = 0;        // severidad del hitmarker del frame: 0 off · 1 hit · 2 kill · 3 kill de jefe
export let _hitTickT = -9;     // cooldown global del tick (50 ms: la ametralladora no atruena)
export const _hmEl = $('hitmark');
export function feedbackHit(en, point, killed, melee) {
  const t = game.time;
  if (t !== _fbFrame) { _fbFrame = t; _fbTick = 0; _fbKill = 0; _fbMode = 0; }
  // sangre en el punto exacto del raycast (splash/células pasan el pecho: alcanza y sobra)
  bloodSpray(point || en.g.position, en.T.color, killed ? 9 + ((Math.random() * 4) | 0) : 3 + ((Math.random() * 3) | 0));
  // tick anti-spam: uno por frame Y con gap mínimo; el jefe come el tick (thud grave sutil)
  if (!_fbTick && t - _hitTickT >= 0.05) {
    _fbTick = 1; _hitTickT = t;
    if (melee) Sfx.meleeHit(); else if (en.boss) Sfx.bossThud(); else Sfx.hitTick();
  }
  // hitstop: 40 ms congelados, una sola vez por frame, solo en KILL de tiro
  // (el DoT de burn baja hp directo y no pasa acá: los ticks por fuego no detienen nada)
  if (killed && !_fbKill) { _fbKill = 1; juice.hitstopT = Math.max(juice.hitstopT, HITSTOP); }
  // hitmarker DOM: blanco · amarillo GRUESO en kill · rojo en kill de jefe. Solo sube de
  // severidad dentro del frame (pelotazo que primero roza y después mata no se apaga).
  const mode = killed ? (en.boss ? 3 : 2) : 1;
  if (mode > _fbMode) {
    const pop = juice.hitmarkT <= 0 || mode >= 2; // pop de escala al encender / al confirmar kill
    _fbMode = mode;
    _hmEl.classList.toggle('kill', mode >= 2);
    _hmEl.classList.toggle('boss', mode === 3);
    if (pop && _hmEl.animate) // WAAPI: sin clases que queden colgadas; no-op en browsers sin animate
      _hmEl.animate([{ transform: 'scale(1.7)' }, { transform: 'scale(1)' }], { duration: 110, easing: 'ease-out' });
  }
  juice.hitmarkT = Math.max(juice.hitmarkT, mode >= 2 ? 0.14 : 0.11); // 110/140 ms (spec: 100-140)
}
// E11 — micro-punch de 100 ms en el HUD del recurso que acaba de entrar (pickup).
// WAAPI otra vez: nada que "quedar colgado" si llegan dos pickups pegados.
export function hudPunch(el, s = 1.08) {
  if (el && el.animate) el.animate(
    [{ transform: `scale(${s})`, filter: 'brightness(2.6)' },
     { transform: 'scale(1)', filter: 'brightness(1)' }],
    { duration: 100, easing: 'ease-out' });
}

