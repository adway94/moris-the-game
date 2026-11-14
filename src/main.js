import * as THREE from './three.js';
import { makeWeaponSprite } from './art/weapons.js';
import { firing } from './core/input.js';
import { TOUCH_MODE } from './core/mode.js';
import { curMag, player } from './core/player.js';
import { game, juice, portal } from './core/state.js';
import { clock, update } from './core/update.js';
import { $ } from './core/utils.js';
import { solids } from './core/world.js';
import { ENEMY_TYPES, enemies, enemyHitboxes, enemySprite } from './enemies/enemies.js';
import { eprojs, zones } from './enemies/field.js';
import { gp, pollGamepad } from './input/gamepad.js';
import { buildArena } from './levels/build.js';
import { campaignComplete } from './levels/campaign.js';
import { addAmmo, pickupArt, pickups } from './levels/items.js';
import { levelDef } from './levels/levels.js';
import { propSprite } from './levels/sets.js';
import { updateWorldFx } from './render/fx.js';
import { bloomOn, bloomPass, composer, retroOn, setBloom } from './render/pipeline.js';
import { camera, renderer, scene } from './render/scene.js';
import { vmCam, vmScene } from './render/viewmodel.js';
import { updateHud } from './ui/hud.js';
import { feed } from './ui/notify.js';
import { unlockWeapon } from './weapons/arsenal.js';
import { PICKUPS, WEAPONS } from './weapons/tables.js';

/* ============================================================ loop */
// FX ambientales: corren siempre (menú/pausa incluidos), cero alloc por frame
const fpsEl = $('fps');
let fpsN = 0, fpsLast = performance.now();

/* auto-degrade (PCs flojos / phones / SwiftShader): fps promediado en ventanas de 2 s
   solo en modo play; dos ventanas seguidas por debajo de 28 apagan el bloom UNA vez.
   Nunca se re-enciende solo; B lo puede reactivar manualmente. El retro NO se toca
   acá: retro ON es el modo barato (render a ~360p); apagarlo subiría el costo de
   render — dirección equivocada bajo problema de rendimiento. */
const FPS_WINDOW_MS = 2000, FPS_FLOOR = 28;
let winFrames = 0, winT0 = performance.now(), lowWindows = 0;
function autoDegrade(now) {
  if (game.state !== 'play') { winFrames = 0; winT0 = now; return; } // no degradar en menú/pausa
  winFrames++;
  const el = now - winT0;
  if (el < FPS_WINDOW_MS) return;
  const avg = winFrames * 1000 / el;
  winFrames = 0; winT0 = now;
  lowWindows = avg < FPS_FLOOR ? lowWindows + 1 : 0;
  if (lowWindows < 2) return;
  lowWindows = 0;
  if (bloomOn) { setBloom(false); feed('bloom auto-off (rendimiento)'); }
}

function loop() {
  requestAnimationFrame(loop);
  const rdt = Math.min(clock.getDelta(), 0.05); // dt REAL del frame (relojes, input, HUD)
  let dt = rdt;
  // E6 — MORIS-9 murió: 1.5 s de slow-mo (el dt de juego al 30%; el clock real manda, así
  // el efecto dura 1.5 s de verdad) y recién ahí campaignComplete(). Todo el update se
  // frena parejo porque recibe el dt escalado — los FX del núcleo son los que flotan.
  if (game.slowmoT > 0) { game.slowmoT = Math.max(0, game.slowmoT - rdt); dt *= 0.3; }
  // E11 — HITSTOP: 40 ms de dt de JUEGO congelado cuando un tiro hace KILL (feedbackHit,
  // una vez por frame; HITSTOP=0.025 si se siente brusco). Ultrakill-lite: el clock real,
  // el mando, el puntero y el render siguen corriendo — solo la simulación se detiene un
  // latido, que es justo lo que "vende" el golpe. Con dt=0 todo el update es no-op por
  // diseño (no hay divisiones por dt; fireCd/shakeT/bob se congelan: deseado).
  if (juice.hitstopT > 0) { juice.hitstopT = Math.max(0, juice.hitstopT - rdt); dt = 0; }
  // countdown del crédito en tiempo real; si el jugador muere en el ínterin se congela
  if (game.completeT > 0 && game.state === 'play') {
    game.completeT -= rdt;
    if (game.completeT <= 0) { game.completeT = 0; campaignComplete(); }
  }
  pollGamepad(rdt); // cada frame, play o pausa (Start tiene que poder reanudar) — reloj real
  const prev = game.state;
  if (game.state === 'play') update(dt, rdt); // rdt: el pantallazo glitch no se estira con el slow-mo
  if (game.state !== prev) dispatchEvent(new CustomEvent('gamestate', { detail: game.state })); // ex: muerte dentro de update → soltar input táctil
  updateWorldFx(dt, clock.elapsedTime);
  // retro necesita el composer SIEMPRE (el upscale nearest es su último pase); el bloom
  // solo añade el UnrealBloomPass. Sin retro y sin bloom: renderer directo, costo cero.
  // E4a: el viewmodel viaja DENTRO del composer (vmPass: RenderPass clear=false +
  // clearDepth=true agregado tras el RenderPass de la escena) → se pinta encima de la
  // geometría (depth limpiado: riesgo E2 resuelto) y comparte pixelación + bloom. En el
  // path directo el mismo truco se hace a mano con renderer.autoClear=false ANTES del
  // render del viewmodel (que corre DESPUÉS de la escena principal, como dicta el plan).
  if (retroOn || bloomOn) {
    bloomPass.enabled = bloomOn;
    composer.render();
  } else {
    renderer.render(scene, camera); // path directo: cero costo de composer
    renderer.autoClear = false;     // no limpiar lo que acaba de pintar la escena...
    renderer.clearDepth();          // ...pero sí el depth: el viewmodel gana siempre
    renderer.render(vmScene, vmCam);
    renderer.autoClear = true;
  }
  fpsN++;
  const now = performance.now();
  autoDegrade(now);
  if (now - fpsLast >= 1000) { // FPS discreto, 1 actualización por segundo
    fpsEl.textContent = `${Math.round(fpsN * 1000 / (now - fpsLast))} FPS · bloom ${bloomOn ? 'on' : 'off'} · retro ${retroOn ? 'on' : 'off'}`;
    fpsN = 0; fpsLast = now;
  }
}
camera.position.copy(player.pos);
camera.rotation.order = 'YXZ';
/* E5 boot: el sector 1 ya montado detrás del menú (fondo vivo = mapa real). updateHud
   pinta barras/slots/vidas antes del primer tap. */
buildArena(levelDef());
$('sector').textContent = game.level;
updateHud();
window.__dbg = () => ({ state: game.state, wave: game.wave, waveIn: game.waveIn, en: enemies.length,
  level: game.level, lives: game.lives, boss: enemies.some(e => e.boss), // E5: campaña
  bossName: (enemies.find(e => e.boss) || { T: {} }).T.name || '',       // E6: qué jefe está en pie
  bossHp: Math.ceil((enemies.find(e => e.boss) || { hp: 0 }).hp),        // E6: qa de la barra
  portal: game.portalOpen ? 1 : 0,
  q: game.spawnQueue.length, hp: Math.round(player.hp), score: game.score,
  armor: Math.round(player.armor), // E3: recursos
  pools: Object.fromEntries(Object.entries(player.pools).map(([k, v]) => [k, v.n])),
  mag: curMag(), weapon: player.weaponId, pickups: pickups.length,
  owned: [...player.owned], cooling: +player.cooling.toFixed(2), // E4a: arsenal
  pk: pickups.map(p => [Math.round(p.mesh.position.x), Math.round(p.mesh.position.z)]), // test E3
  eProj: eprojs.reduce((n, p) => n + (p.life > 0 ? 1 : 0), 0),   // E6: pool compartido (tope 32)
  zones: zones.reduce((n, z) => n + (z.life > 0 ? 1 : 0), 0),    // E6: nubes/charcos vivos
  enemyTypes: [...new Set(enemies.map(e => e.type))],            // E6a: tipos vivos (QA de spawnWeights por sector)
  slowmo: +game.slowmoT.toFixed(2),                              // E6: lento del final
  hitT: +juice.hitmarkT.toFixed(2), stop: +juice.hitstopT.toFixed(2),        // E11: qa hitmarker/hitstop
  inter: +game.intermission.toFixed(2), t: +game.time.toFixed(1), bloom: bloomOn, retro: retroOn,
  spriteMode: true, // E2: enemigos = sprite billboard (constante: no hay fallback 3D)
  touchMode: TOUCH_MODE, firing, gamepad: gp.connected,
  x: Math.round(player.pos.x * 10) / 10, z: Math.round(player.pos.z * 10) / 10,
  yaw: Math.round(player.yaw * 100) / 100, pitch: Math.round(player.pitch * 100) / 100 });
// Helper de pruebas (E4a): simula el pickup de arma que E5 va a enchufar — desbloquea
// (unlockWeapon real) y opcionalmente carga munición del pool para poder disparar.
window.__dbgGive = (id, ammo = 999) => {
  const ok = unlockWeapon(id);
  const W = WEAPONS[id];
  if (W && W.ammo) addAmmo(W.ammo, ammo);
  updateHud();
  return { ok, owned: [...player.owned] };
};
window.__probe = () => {
  if (!enemies.length) return 'no enemies';
  const o = camera.getWorldPosition(new THREE.Vector3());
  return enemies.map(e => {
  const d = new THREE.Vector3().subVectors(e.g.position, o).normalize();
  const rc = new THREE.Raycaster(o, d, 0, 150);
  const he = rc.intersectObjects(enemyHitboxes, false);
  const hw = rc.intersectObjects(solids, false);
  return {    eDist: Math.round(e.g.position.distanceTo(o) * 10) / 10,
    eScale: Math.round(e.g.scale.x * 100) / 100,
    spawnT: Math.round(e.spawnT * 100) / 100,
    hitEnemy: he[0] ? Math.round(he[0].distance * 10) / 10 : -1,
    enemyType: he[0] ? he[0].object.userData.enemy.type : null,
    hitWorld: hw[0] ? Math.round(hw[0].distance * 10) / 10 : -1,
    hitWorldPos: hw[0] ? hw[0].point.toArray().map(round2) : null,
    hitWorldType: hw[0] ? hw[0].object.type : null,
    camPos: camera.getWorldPosition(new THREE.Vector3()).toArray().map(round2),
    eType: e.type };
  });
  function round2(v) { return Math.round(v * 100) / 100; }
};
/* Vista de arte (?sprite=1): los 3 billboards de enemigo + la fila de 11 pickups (E3)
   estáticos frente a la cámara en el título, para iterar sprites.js sin spawnear nada
   (útil también en E6). Se ocultan al entrar en play; nada más del gameplay los toca. */
if (new URLSearchParams(location.search).has('sprite') || localStorage.getItem('moris-sprites') === '1') {
  // E6: preview de las 13 siluetas (3 heredados + 5 mobs + 5 jefes): mobs en la fila
  // de adelante, jefes una fila más atrás y más lejos (tapan menos y se lee su escala).
  const mobs = ['droner', 'sprinter', 'brute', 'esporeador', 'lancellas', 'posesivo', 'espectro', 'glitch'];
  const jefes = ['criopylot', 'huerta', 'fundidor', 'confesor', 'moris9'];
  const pre = [...mobs.map((type, i) => [type, ((i % 8) - 3.5) * 1.32, player.pos.y + 0.32, -4.2, -0.07]),
               ...jefes.map((type, i) => [type, (i - 2) * 2.65, player.pos.y + 0.30, -6.6, 0])].map(([type, x, y, z, rx]) => {
    const A = enemySprite(type);
    const tex = A.tex.clone();
    tex.repeat.set(0.5, 1);
    const T = ENEMY_TYPES[type];
    const m = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: T.alpha ? 0.04 : 0.5, side: THREE.DoubleSide,
      depthWrite: T.alpha ? false : true, opacity: T.alpha || 1 })); // fantasmas como en juego
    m.position.set(x, y, z);
    m.rotation.x = rx; // leve tilt: la fila de mobs no se come la de jefes
    scene.add(m);
    return m;
  });
  // E5: los props billboard nuevos (enredadera / estatua) a tamaño real de juego
  ['vine', 'statue'].forEach((kind, i) => {
    const A = propSprite(kind);
    const m = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: A.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.scale.setScalar(kind === 'vine' ? 1.3 : 2.2);
    m.position.set(2.9 + i * 2, (kind === 'vine' ? 1.3 : 2.2) / 2 - 0.9, -4.0);
    scene.add(m);
    pre.push(m);
  });
  // pickups: grilla 6+5, vista 0 del atlas (idle sin girar) para leer el dibujo entero
  Object.keys(PICKUPS).forEach((kind, i) => {
    const A = pickupArt(kind);
    const tex = A.tex.clone();
    tex.repeat.set(0.25, 1);
    const m = new THREE.Mesh(A.geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set(((i % 6) - 2.5) * 0.85, player.pos.y - 0.55 - ((i / 6) | 0) * 0.62, -4.0);
    scene.add(m);
    pre.push(m);
  });
  // E4a/E4b: las 10 siluetas del viewmodel (grilla 5×2 arriba — 3 columnas no las hacen
  // entrar desde que el arsenal está completo) — iterar sprites.js sin jugar
  Object.keys(WEAPONS).forEach((id, i) => {
    const art = makeWeaponSprite(WEAPONS[id].silhouette || 'pistol', WEAPONS[id].accent || '#54f0ff');
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.02), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.position.set(((i % 5) - 2) * 1.5, player.pos.y + 0.3 - ((i / 5) | 0) * 1.15, -4.2);
    scene.add(m);
    pre.push(m);
  });
  addEventListener('gamestate', e => { if (e.detail === 'play') for (const o of pre) o.visible = false; }, { once: true });
}
loop();
