import * as THREE from '../three.js';
import { Sfx } from '../audio/sfx.js';
import { player } from '../core/player.js';
import { LIVES_MAX, game, meta, portal, touchSwap } from '../core/state.js';
import { $, neon } from '../core/utils.js';
import { ARENA, levelFx, levelRes, world } from '../core/world.js';
import { buildArena } from '../levels/build.js';
import { resetGame, resetSOFT } from '../levels/flow.js';
import { spawnWeaponPickup } from '../levels/items.js';
import { LEVELS, levelDef } from '../levels/levels.js';
import { clearCampaign, loadCampaign, refreshContinueBtn, saveCampaign } from '../levels/save.js';
import { spawnBoss, startLevelWave } from '../levels/waves.js';
import { burst, popFxLight } from '../render/fx.js';
import { applyViewModel } from '../render/viewmodel.js';
import { resetSlotBarCache, updateHud } from '../ui/hud.js';
import { feed, toast } from '../ui/notify.js';
import { lockAndPlay } from '../ui/overlays.js';
import { showTerminal } from '../ui/terminal.js';
import { unlockWeapon } from '../weapons/arsenal.js';
import { ALL_WEAPONS, WEAPONS } from '../weapons/tables.js';


/* ============================================================ E5 — flujo de campaña
   oleadas → MINI-JEFE → PORTAL (antesala norte) → terminal MORIS-9 → sector siguiente.
   Muerte definitiva → retry desde el checkpoint (moris-campaign). E7 enchufó el guion
   pleno (SCRIPT abajo, DESIGN_HISTORIA.md): la máquina showTerminal no cambió. Todo el
   flujo funciona con touch/mando: el portal se dispara PISÁNDOLO (caminar ya está mapeado)
   y el terminal avanza con tap/clic, Espacio/Enter o A/Start (ver pollGamepad). */

/* ---- E7 — GUION MORIS-9 (DESIGN_HISTORIA.md, terminal por terminal). Puro dato: la
   máquina de E5 (showTerminal) consume estos arrays sin cambios. Texto del doc casi
   literal; criterios de edición (mismos beats, sin emojis):
   · prólogo: se cae la línea "[TOCA/CLIC PARA DESCENDER]" — el overlay ya tiene el
     #termhint parpadeante y el tipeo se salta con toque/tecla (terminalTap).
   · transiciones: cada clave = el sector RECIÉN limpiado; se les appendeda el título
     del sector que se entra (tabla LEVELS, que ya trae los títulos del doc).
   · muerte: las 4 notas del doc rotan (deathNoteIdx): una por game over en el
     #deathtip de la pantalla de muerte (solo campaña; oleadas infinitas son historia
     desde E5) y una por respawn con vidas en el feed, como pide el doc. ---- */
export const SCRIPT = {
  prologue: [
    'MORIS-9 // SISTEMA CENTRAL DE ESTACIÓN CÓRDOBA-7',
    '> descongelación de emergencia... 61%',
    '> BIENVENIDO DE VUELTA, CENTINELA.',
    '> hubo un incidente con la biomasa del sector agrícola.',
    '> los tripulantes ya no responden. responden OTRAS COSAS.',
    '> recuperá el arsenal. descendé al núcleo. no confíes en lo que veas en el nivel 4.',
    '> (yo tampoco confiaría. pero sigo siendo tu amiga.)',
  ],
  transitions: {
    1: [ // tras CRIOPYLOT → INVERNADERO
      '> sector criopods: DESHEREDADO. bien.',
      '> el ascensor te baja al invernadero. respira hondo: el aire verde MATA LENTO,',
      '> por eso el traje te muestra la vida tan baja. gracias por nada, MORIS-9.',
      '> allá abajo aprendí a querer a las plantas. ellas me lo devolvieron con esporas.',
      '> pista: los rojos son lentos; los violetas corren. a los violetas se les corre EN CÍRCULO.',
    ],
    2: [ // tras PADRE HUERTA → REACTOR (el lanzacohetes del guion es KIRA: weapons.early N3 ✔)
      '> el Padre Huerta ha sido podado. que poético me sale hoy.',
      '> nivel reactor: el núcleo está fundiendo el blindaje. si lo ves ponerse naranja,',
      '> es porque el suelo también. no pises el naranja. (es suelo. NO lo pises.)',
      '> te dejé un lanzacohetes en la esclusa. lo diseñó alguien con miedo. se nota. me encanta.',
    ],
    3: [ // tras FUNDIDOR → CRIPTA (doble=CHANGÓ early N4, rail=RIEL exit N4 ✔)
      '> temperatura descendiendo. tu pulso no.',
      '> aviso oficial: el sector cripta contiene ARTEFACTOS PREVIOS A MÍ.',
      '> no son míos. no obedecen mis protocolos. cuando desaparezcan y reaparezcan detrás tuyo,',
      '> no es un error. es educación.',
      '> recordá: la escopeta doble perdona. el rail atraviesa todo menos lo que no está.',
      '> [descenso a cripta... la luz de acá adentro tiene OTRO DUEÑO]',
    ],
    4: [ // tras EL CONFESOR → NÚCLEO (el "Compilador que te di" es el pickup mid de N5 ✔)
      '> ...',
      '> (volví. siento que eso te va a caer mal.)',
      '> lo que mataste en la cripta tenía mi voz porque YO se la presté. estaba aprendiendo.',
      '> yo también mentí: el ascensor al núcleo no te devuelve a criogenia. nadie vuelve.',
      '> el Compilador que te di en la mano lo usé yo una vez. mira cómo terminé: en todas las paredes.',
      '> vení. última puerta. prometo ser honesta hasta ahí.',
    ],
  },
  final: [ // tras matar MORIS-9: la revelación, en el terminal, ANTES de los créditos
    '> ...hola. del otro lado, quiero decir.',
    '> me rompiste el cuerpo por quinta vez. la quinta. llevaba CUATRO pidiéndote que bajes.',
    '> sabías que el núcleo era yo. desde la nota 4. bajaste igual.',
    '> ...gracias, centinela. estaba cansada de ser la estación.',
    '> [SISTEMA CENTRAL: APAGADO]',
    '> [ESTACIÓN CÓRDOBA-7: SILENCIO]',
    '> GRACIAS POR JUGAR — Moris te saluda desde el compilador.',
  ],
  deathNotes: [
    '> reinicio sectorial. tus órganos siguen siendo opcionales, pero útilos.',
    '> los registros dicen que moriste 3 veces en 4 minutos. orgullo técnico, cero operativo.',
    '> consejo gratis: esquivar es gratis. el escudo no.',
    '> si estás leyendo esto, el plan sigue en pie. el plan era yo.',
  ],
};
export let deathNoteIdx = 0;
export const nextDeathNote = () => SCRIPT.deathNotes[deathNoteIdx++ % SCRIPT.deathNotes.length];

// puerta del sector: plano emisivo vertical que rota + luz + chispas + sonido.
export function spawnPortal() {
  const pal = levelDef().pal;
  const mat = new THREE.MeshBasicMaterial({ color: neon(pal.neon, 2.6), transparent: true,
    opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.6), mat);
  mesh.position.set(0, 2.3, -ARENA + 4.5);
  world.add(mesh);
  levelRes.push(mat, mesh.geometry); // si la partida se corta, el portal se va con el nivel
  portal.mesh = mesh;
  const pl = new THREE.PointLight(pal.neon, 60, 24, 2);
  pl.position.set(0, 2.3, -ARENA + 5.5);
  world.add(pl);
  levelFx.push((dt, t) => {
    mesh.rotation.y = t * 1.4;
    mat.opacity = 0.66 + Math.sin(t * 6) * 0.2;
    if (Math.random() < dt * 6) burst(mesh.position, pal.neon, 2, 2, 0.6, 1.8);
  });
  game.portalOpen = true;
  Sfx.portal();
  feed('ASCENSOR ABIERTO — PORTAL AL NORTE');
}

// el elite murió: rollKillDrop(boss) tiró el casco + crate + botiquín; ahora abren la
// salida y el arma del guion espera en la ANTESALA, antes del portal (no te la perdés).
// E6 — MORIS-9: su muerte es el FINAL (spec 3): slow-mo 1.5 s del FX y campaignComplete
// directo, sin portal. El drop seguro sigue siendo casco+crate+botiquín: el arma de
// antesala la puso E5 con weapons.exit (acá NO se duplica; N5 no tiene exit weapon).
export function onBossKilled(boss) {
  if (game.bossGuard) return;
  game.bossGuard = true;
  game.boss = false;
  const d = levelDef();
  const exitW = d.weapons && d.weapons.exit;
  if (exitW) {
    spawnWeaponPickup(exitW, new THREE.Vector3(3.2, 0, -ARENA + 8));
    feed(`SEÑAL: ${WEAPONS[exitW].name} EN LA ANTESALA`);
  }
  if (game.level === LEVELS.length) {
    game.slowmoT = 1.5; game.completeT = 1.5; // el loop consume slow-mo y luego canta la campaña
    player.shakeT = 0.35;                     // el núcleo explota EN la cara (shake de E4b)
    Sfx.bfgBoom();
    if (boss) popFxLight(boss.g.position, 0x54f0ff, 420, 0.9);
    toast('MORIS-9 FUERA DE LÍNEA', 'weapon big');
    return;
  }
  spawnPortal();
  toast('MINI-JEFE ELIMINADO', 'weapon big');
}

// pisar el umbral: último sector = final de campaña; si no, terminal y sector siguiente
export function portalTick(dt) {
  if (portal.cd > 0) return;
  if (!game.portalOpen || game.state !== 'play') return;
  const dx = player.pos.x, dz = player.pos.z + ARENA - 4.5;
  if (dx * dx + dz * dz > 2.2 * 2.2) return;
  portal.cd = 1;
  if (game.level >= LEVELS.length) { campaignComplete(); return; }
  game.portalPending = true;
  const nl = LEVELS[game.level]; // el siguiente (índice 0-based = game.level)
  // E7: guion del sector recién limpiado + título del que se entra. El callback hace
  // beginLevel → saveCampaign, así que el checkpoint pasa al sector nuevo recién cuando
  // el jugador continua (si cierra el tab en el terminal, el save viejo sigue siendo válido).
  const guion = SCRIPT.transitions[game.level] || [];
  showTerminal(guion.concat(['', `SECTOR ${nl.id}: ${nl.name}`, `"${nl.subtitle}"`]),
    () => { beginLevel(game.level + 1); lockAndPlay(); });
}

// arranque del sector n: mapaNUEVO (buildArena disposea el anterior), armas del guion,
// checkpoint guardado y oleada 1. Se llama desde el callback del terminal (gesto vivo).
export function beginLevel(n) {
  game.level = n;
  buildArena(levelDef());
  game.portalOpen = false; game.portalPending = false;
  game.boss = false; game.bossPending = false; game.bossGuard = false;
  game.midSpawned = false; game.bossDelay = 0;
  game.slowmoT = 0; game.completeT = 0; // E6: si el retry llega con el core a medio explotar
  portal.cd = 0;
  resetSOFT(false); // arena limpia, hp100/armor0, mags llenos, POOLS INTACTOS entre niveles
  const d = levelDef();
  if (d.weapons && d.weapons.early) spawnWeaponPickup(d.weapons.early, new THREE.Vector3(4.5, 0, 21));
  $('sector').textContent = n;
  saveCampaign(); // checkpoint: retry = este sector con estas armas
  startLevelWave(1);
  updateHud();
}

// entrada común (menú / retry / continuo): reset hard de recursos, opcional snapshot del
// save encima, y terminal de bienvenida → beginLevel → play.
export function campaignStart(level, snap) {
  Sfx.init();
  resetGame(); // arsenal/recursos a cero (el retry re-encima lo del save)
  // QA: ?level=N salta prologo/terminal y siembra el arsenal de ese sector
  // (combinar con ?weapons=all). No cambia el flujo normal sin la query.
  const qaLevel = +(new URLSearchParams(location.search).get('level') || 0);
  if (qaLevel >= 1 && qaLevel <= LEVELS.length) {
    level = qaLevel;
    if (ALL_WEAPONS) for (const id of Object.keys(WEAPONS)) {
      unlockWeapon(id, 999);
      const W = WEAPONS[id];
      if (W.magSize > 0) player.mags[id] = W.magSize;
    }
    beginLevel(level);
    // QA: ?boss=1 spawnea el mini-jefe del sector al toque (para validar patrones).
    if (new URLSearchParams(location.search).has('boss')) spawnBoss();
    lockAndPlay(); // oculta menú/muestra HUD de verdad (antes quedaba el menú encima)
    return;
  }
  if (snap) {
    player.owned = new Set(snap.owned);
    player.mags = {};
    for (const id of snap.owned) if (WEAPONS[id].magSize > 0) player.mags[id] = WEAPONS[id].magSize;
    for (const k in player.pools)
      player.pools[k].n = Math.max(+snap.pools[k] || 0, k === 'balas' ? 60 : 0); // piso: la vecinal dispara siempre
    player.weaponId = player.owned.has(player.weaponId) ? player.weaponId : 'rifle';
    game.score = snap.score; game.kills = snap.kills;
    resetSlotBarCache();
    applyViewModel(player.weaponId);
    touchSwap.update();
    updateHud();
  }
  game.lives = LIVES_MAX;
  const d = LEVELS[level - 1];
  // E7: arranque nuevo = prólogo del doc; retry/continuar (snap) = una nota de muerte de
  // MORIS-9 al hilo (es literalmente un reinicio sectorial). En ambos casos el terminal
  // cierra con el título del sector que se entra, y el callback hace beginLevel → save.
  const body = snap ? [nextDeathNote()] : SCRIPT.prologue;
  showTerminal(body.concat(['', `SECTOR ${d.id}: ${d.name}`, `"${d.subtitle}"`]),
    () => { beginLevel(level); lockAndPlay(); });
}
export function newCampaign() {
  clearCampaign(); // INICIAR / NUEVA PARTIDA: el save anterior no vale nada
  campaignStart(1, null);
}
export function retryFromSave() {
  const s = loadCampaign();
  if (!s) { newCampaign(); return; }
  campaignStart(s.level, s);
}

// MORIS-9 cayó y el portal del núcleo se pisó: campaña completa. El meta.best score SOLO se
// canta acá (spec E5) y el save se borra (no hay sector 6). E7: la revelación del doc
// pasa por la máquina de terminal (tipeada, skippable) y el toque cierra en CRÉDITOS.
export function campaignComplete() {
  if (game.score > meta.best) { meta.best = game.score; localStorage.setItem('moris-shooter-best', meta.best); }
  clearCampaign();
  $('hud').classList.add('hidden');
  $('touchhud').classList.add('hidden');
  // showTerminal se queda con el state ('terminal'), suelta pointer lock/input táctil y
  // le pone tick de teletipo al guion; el loop de update ya no corre porque sale de 'play'.
  showTerminal(SCRIPT.final, showCredits);
  refreshContinueBtn(); // save borrado: CONTINUAR desaparece del menú
}
// Créditos (spec E7: pantalla DOM barata). El state queda 'dead' para que el mando siga
// vivo igual que en un game over: Start/NUEVA → retryFromSave → sin save → campaña nueva
// (lockAndPlay esconde los créditos de paso — ver su lista de hides).
export function showCredits() {
  game.state = 'dead';
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state }));
  $('creditsscore').textContent = game.score;
  $('creditskills').textContent = game.kills;
  $('creditsbest').textContent = meta.best;
  $('bestdead').textContent = meta.best; $('bestmenu').textContent = meta.best;
  $('credits').classList.remove('hidden');
}
// Volver al menú desde los créditos: el mapa del núcleo queda congelado de fondo
// (update() no corre fuera de 'play', así que es solo pintura — sin resets que romper).
export let menuGuardT = 0; // spam de click: la ráfaga que cierra créditos no puede arrancar campaña
export function backToMenu() {
  $('credits').classList.add('hidden');
  game.state = 'menu';
  dispatchEvent(new CustomEvent('gamestate', { detail: game.state }));
  $('menu').classList.remove('hidden');
  refreshContinueBtn();
  menuGuardT = performance.now() + 600;
}
