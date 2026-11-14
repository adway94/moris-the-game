import * as THREE from '../three.js';
import { makeEnemySprite } from '../art/enemies.js';
import { Sfx } from '../audio/sfx.js';
import { player } from '../core/player.js';
import { combatHud, fb, game } from '../core/state.js';
import { update } from '../core/update.js';
import { $, clamp, neon, rand } from '../core/utils.js';
import { ARENA, boxes, pushOutOfBoxes } from '../core/world.js';
import { fireBolt, spawnGhost, spawnZone, testWall } from '../enemies/field.js';
import { onBossKilled } from '../levels/campaign.js';
import { damagePlayer, die } from '../levels/flow.js';
import { rollKillDrop } from '../levels/items.js';
import { diffMult } from '../levels/levels.js';
import { feedbackHit } from '../render/feedback.js';
import { _eDir, _eMove, _eSep, _eTmp, burst, popFxLight } from '../render/fx.js';
import { camera, scene } from '../render/scene.js';
import { _popV, feed, killPopup, screenOf } from '../ui/notify.js';

/* ============================================================ enemies */
// drop: E3 — los drops ya no son una chance por tipo (el viejo campo `drop` salió):
// rollKillDrop() centraliza las chances (35/40/15/10) + guarantee de BRUTE.
/* E6 — bestiario por nivel + mini-jefes. Cada tipo nuevo entra a la factory (clase
   Enemy) por su fila: beh = conducta dentro de update(); alpha = material translúcido
   (fantasmas); bossType + name = mini-jefe con barra en el HUD y score de la spec
   (400/600/800/1000/2000). El hp de los jefes es FIJO (no pasa por la fórmula de
   oleada): está balanceado para 25-60 s de pelea con el arma esperada del sector
   (vecinal→N1 ~1700, MORIS-12→N2 ~2100, Kira→N3 ~2700, changó/riel→N4 ~2700,
   arsenal completo→N5 ~4200). */
export const ENEMY_TYPES = {
  droner:  { hp: 40,  speed: 3.4, scale: 1.0,  dmg: 12, score: 100,  color: 0xff4d5e },
  sprinter:{ hp: 24,  speed: 6.6, scale: 0.72, dmg: 8,  score: 150,  color: 0xb465ff },
  brute:   { hp: 170, speed: 2.3, scale: 1.75, dmg: 26, score: 400,  color: 0xff9a3d },
  // E6 mobs — cada sector juega con su bestiario (pesos en LEVELS[].spawnWeights):
  esporeador:{ hp: 62,  speed: 1.7, scale: 1.25, dmg: 10, score: 120, color: 0x5eff8a, beh: 'spore' },
  lancellas: { hp: 58,  speed: 2.8, scale: 1.1,  dmg: 10, score: 160, color: 0xff9a3d, beh: 'lance' },
  posesivo:  { hp: 22,  speed: 5.6, scale: 0.78, dmg: 20, score: 200, color: 0xc3b1ee, beh: 'blink' },
  espectro:  { hp: 28,  speed: 3.6, scale: 1.1,  dmg: 9,  score: 180, color: 0xaa5cff, alpha: 0.68, beh: 'kite' },
  glitch:    { hp: 50,  speed: 3.2, scale: 1.0,  dmg: 12, score: 220, color: 0x54f0ff, beh: 'step' },
  // E6 mini-jefes — sprite propio grande en sprites.js, hitbox = escala del grupo.
  criopylot: { hp: 1700, speed: 2.1, scale: 2.6, dmg: 16, score: 400,  color: 0x54f0ff,  bossType: true, name: 'CRIOPYLOT',    beh: 'bcrio' },
  huerta:    { hp: 2100, speed: 0.0, scale: 2.6, dmg: 14, score: 600,  color: 0xff5ee0,  bossType: true, name: 'PADRE HUERTA', beh: 'static' },
  fundidor:  { hp: 2700, speed: 2.4, scale: 2.5, dmg: 26, score: 800,  color: 0xff6a2a,  bossType: true, name: 'FUNDIDOR',     beh: 'bfundi' },
  confesor:  { hp: 2700, speed: 2.8, scale: 2.4, dmg: 16, score: 1000, color: 0xaa5cff,  bossType: true, name: 'EL CONFESOR',  beh: 'bconf', alpha: 0.85 },
  moris9:    { hp: 4200, speed: 3.0, scale: 2.8, dmg: 20, score: 2000, color: 0x54f0ff,  bossType: true, name: 'MORIS-9',      beh: 'bmoris' },
};
export const enemies = [];
export const enemyHitboxes = []; // mallas invisibles para raycast
// E6b spec 7: summons del jefe que deben apagarse con él. die() puede correr DENTRO del
// update() de un enemigo (burn DoT) y splices ajenos al índice actual romperían el loop
// inverso de update(): la limpieza se difiere un frame (patrón respawnPending).
export let pendingPop = null;

// E4a — tinte por ESTADO del sprite (riesgo documentado de "pisarse tintes" del E2):
// el color del material ya lo usa el flash blanco HDR; la solución es UN solo punto de
// control: el estado (burn > scorch > normal) y el flash. El color final decae por frame
// (lerp) HACIA el tinte del estado vigente:
//   flash()  → color=2.2 blanco (pisa el tinte un instante, como siempre)
//   update() → decae al tinte del estado: quemado = flash blanco → naranja → naranja
// E4b sumaron un estado más (scorched del compilador) y sigue habiendo UN solo escritor
// de `material.color`: el lerp de update(), que elige TINT_* por prioridad de timers.
export const TINT_NORMAL = new THREE.Color(1, 1, 1);
export const TINT_BURN   = new THREE.Color(1.5, 0.55, 0.22); // naranja HDR: el bloom lo hace lucir
export const TINT_SCORCH = new THREE.Color(0.40, 0.36, 0.42); // E4b "scorched" (compilador): tinte
// E5: el mini-jefe NUNCA vuelve a 1.0 — su "normal" es un HDR suave (1.45) que el bloom
// lee como glow permanente; el anillo del piso completa el aura.
export const TINT_BOSS   = new THREE.Color(1.45, 1.45, 1.45);
// E6 glitch: el droner "roto" tiene un NORMAL que parpadea entre cyan y magenta HDR
// (stepped, no lerp: la alternancia ES la animación). El lerp único de update() sigue
// siendo el único escritor del color — este tint solo cambia el TARGET del decay.
export const TINT_HEX_A  = new THREE.Color(0.45, 2.1, 2.4);
export const TINT_HEX_B  = new THREE.Color(2.4, 0.45, 1.9);
// oscuro SUB-1 — el sprite se apaga y el bloom lo suelta. A diferencia del quemado no
// hace DoT y el fuego manda: update() elige el tinte por prioridad burn > scorch > normal.

// hitbox caja compartida (raycast): invisibles y DoubleSide para que el disparo las
// agarre desde cualquier ángulo, igual que antes de los sprites.
export const hitGeo = new THREE.BoxGeometry(1.15, 1.9, 1.15);
export const SPRITE_H = 2.3; // alto del plano en unidades de grupo ≈ altura del viejo modelo
                      // (cápsula+antena); T.scale lo escala por tipo (spawn grow incluido)

/* E2 — enemigo SPRITE BILLBOARD (Doom/Boltgun): un plano con el sprite-sheet pixel-art
   de sprites.js reemplaza al Group 3D (cuerpo/cabeza/ojos/anillo/núcleo/antena).
   - UN CanvasTexture + UN PlaneGeometry por tipo (cacheados). Cada enemigo clona la
     texture para tener offset de frame PROPIO: los clones comparten `source`, así que
     el pixel-data del sprite se sube al GPU una sola vez por tipo (el clone solo añade
     transformaciones de UV por material).
   - NearestFilter + sin mipmaps + alphaTest 0.5 → bordes duros del pixel-art sin halo.
   - El color >1 del flash de daño pasa cru por el shader de MeshBasicMaterial →
     sprite blanco HDR que el bloom se come (equivalente al emissiveIntensity del 3D). */
export const enemyMatCache = {};
export function enemySprite(type) {
  if (!enemyMatCache[type]) {
    const art = makeEnemySprite(type);
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(SPRITE_H * (art.frameW / art.frameH), SPRITE_H);
    enemyMatCache[type] = { tex, geo };
  }
  return enemyMatCache[type];
}

export class Enemy {
  // E6 — la factory: TODO entra por la fila de ENEMY_TYPES. bossType:true = mini-jefe
  // (stats fijos, aura, nombre en HUD); beh = conducta dentro de update() (default: el
  // steering de E2 intacto). Firma (type,pos) igual que E5 — spawn no se toca.
  constructor(type, pos, boss = false) {
    const T = ENEMY_TYPES[type];
    this.T = T; this.type = type;
    this.boss = boss || !!T.bossType;
    const mult = diffMult(); // 1 + 0.25·(nivel-1): todo el mapa sube de dificultad por sector
    if (this.boss) {
      this.hp = T.hp;        // los jefes NO escalan por oleada: 25-60 s con el arma esperada
      this.speed = T.speed;
    } else {
      this.hp = T.hp * (1 + 0.14 * (game.wave - 1)) * mult;
      this.speed = T.speed * (1 + 0.03 * (game.wave - 1)) * (1 + 0.08 * (game.level - 1)) * rand(0.9, 1.1);
    }
    this.hitCd = 0; this.phase = rand(0, 6.28); this.spawnT = 0;
    this.lastScr = null; // E8-polish(a): última posición en pantalla con el enemigo visible
    this.burnT = 0;      // E4a: segundos de estado QUEMADO (asador); DoT fraccional
    this.burnDps = 0;    // 2.25 lo fija la fila WEAPONS.asador en burn() (única fuente)
    this.scorchT = 0;    // E4b: segundos de tinte oscuro por detonación del compilador
    // ---- E6: estado de conducta (barato: un puñado de números por enemigo) ----
    this.atkT = rand(1.2, 2.8);  // reloj de disparo/emit (beh lance/kite/spore y jefes)
    this.tell = 0;               // telegrafía activa (flash + shake 0.3 s antes de atacar)
    this.tellQ = null;           // acción diferida: se corre cuando tell llega a 0
    this.tpT = -1;               // posesivo/jefes: cuenta del salto (blink si <0.5)
    this.dashT = 0; this.dashOn = false; // embestida (Criopylot/Fundidor fase 2)
    this.dashHit = false;
    this.stepT = rand(0, 0.3);   // glitch: reloj del saltito discreto
    this.hex = 0;                // glitch: 0 cyan / 1 magenta (material.color alterna)
    this.sporeT = rand(2, 4);    // esporeador: primera nube a los 2-4 s
    this.owner = null;           // summon: el jefe que lo parió (se muestra en el feed)
    this.pets = this.boss ? [] : null;   // jefes: registro de invocados (cap por jefe)
    this.pT = this.boss ? 4 : 0; // reloj de invocación (los jefes arrancan a los 4 s:
                                 // el jefe se presenta primero, su séquito después)
    this.phaseN = 1;             // MORIS-9: fase por hp (100/66/33)
    this.orbA = rand(0, 6.28);   // MORIS-9: ángulo de órbita

    const A = enemySprite(type);
    this.tex = A.tex.clone();
    this.tex.repeat.set(0.5, 1); // hoja horizontal de 2 frames
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, alphaTest: 0.5, depthWrite: true,
      side: THREE.DoubleSide,
    });
    if (T.alpha) { // E6 fantasmas (espectro/confesor): alpha material bajo, sin depthWrite
      mat.alphaTest = 0.04; mat.opacity = T.alpha; mat.depthWrite = false;
    }
    this.baseOpacity = T.alpha || 1;
    this.spr = new THREE.Mesh(A.geo, mat);
    if (this.boss) this.spr.material.color.setScalar(1.45); // aura ALSO tiñe el sprite (HDR suave: glow por bloom)
    this.spr.position.y = 0.1; // el plano cubre local -1.05..1.25 ⊃ hitbox (-0.75..1.15)
    this.g = new THREE.Group();
    this.g.scale.setScalar(0.01);
    this.baseY = (0.95 + T.scale * 0.25) * T.scale;
    this.g.add(this.spr);
    if (this.boss) { // anillo base: la firma visual del elite (late en update)
      this.aura = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.15, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: neon(T.color, 2.4), transparent: true,
          opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      this.aura.position.y = -this.baseY / T.scale + 0.08; // pispa el suelo real del grupo
      this.g.add(this.aura);
    }
    if (type === 'moris9') { // E6b (spec 1): anillo de datos PROPIO — torus inclinado con
                             // 3 nodos emisivos; los nodos son los que HACEN VISIBLE el
                             // giro (un torus liso girando sobre su eje no se mueve).
      this.ringMat = new THREE.MeshBasicMaterial({ color: neon(0x54f0ff, 2.6), transparent: true,
        opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      this.ring = new THREE.Group();
      this.ring.add(new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.055, 5, 24), this.ringMat));
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * 6.2832;
        const node = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.34), this.ringMat);
        node.position.set(Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0);
        this.ring.add(node);
      }
      this.ring.rotation.x = -Math.PI / 2 + 0.5; // Saturno oblicuo sobre el núcleo
      this.g.add(this.ring);
    }

    this.hitbox = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this.hitbox.userData.enemy = this;
    this.g.add(this.hitbox);
    this.hitbox.position.y = 0.2;
    this.g.position.copy(pos);
    this.g.position.y = this.baseY;
    scene.add(this.g);
    enemies.push(this);
    enemyHitboxes.push(this.hitbox);
    burst(pos, T.color, this.boss ? 26 : 14, this.boss ? 8 : 5, this.boss ? 1.4 : 0.8);
    if (this.boss) popFxLight(this.g.position, T.color, 260, 0.6); // entrada con luz: se presenta
  }
  // flash de daño: tinte blanco SUPERRADIANTE (Basic multiplica el map con color >1 →
  // sprite blanco HDR); en update() decae HACIA el tinte del estado (blanco / quemado /
  // scorched).
  flash() { this.spr.material.color.setScalar(2.2); }
  // E4a — estado quemado (asador): renueva/extends el tinte naranja + DoT burnDps.
  burn(sec, dps) {
    if (this.burnT <= 0) burst(this.g.position, 0xff7f2f, 5, 3.5, 0.6, 1.7); // primera ignición
    this.burnT = Math.max(this.burnT, sec);
    this.burnDps = dps;
  }
  // E4b — estado scorched (detonación del compilador): tinte oscuro persistente SIN DoT.
  // El riel, a propósito, no deja marca: solo el orbe verde fríe el piso.
  scorch(sec) { this.scorchT = Math.max(this.scorchT, sec); }
  // E11 — `melee` cambia el sonido del tick (whack con cuerpo). Todo el feedback de
  // impacto (sangre, tick, hitmarker, hitstop) sale de feedbackHit: UN punto único por
  // el que pasan raycast, melee, asador, riel, células, splash y BFG. El burst genérico
  // de antes queda reemplazado por la sangre (pool propio, más chico y más corto).
  takeDamage(d, point, melee = false) {
    this.hp -= d;
    this.flash();
    feedbackHit(this, point, this.hp <= 0, melee);
    // E6 Confesor: CADA golpe conectado agenda un salto (telegrafía 0.2 s). El debounce
    // 0.25 s evita que los 14 pellets del changó agenden 14 teleports en el mismo frame.
    if (this.hp > 0 && this.T.beh === 'bconf') {
      if (game.time - (this.lastHurtT || -9) > 0.25) { this.tpT = Math.max(this.tpT, 0.2); Sfx.blink(); }
      this.lastHurtT = game.time;
    }
    if (this.hp <= 0) this.die();
  }
  // E4a — empujón (puños): desplazamiento inmediato lejos del jugador, con los mismos
  // clamps de arena/cajas que update(). El steering enemigo vuelve a acercar al tipo:
  // es el "knockback" Doom, no un stun.
  knockback(dist) {
    // E11 FIX — beh 'static' (Padre Huerta) es una ANCLA del escenario: el llamado
    // genérico de melee lo deslizaba con cada tiro y lo hacía "dar vueltas por el
    // lugar". Nadie más empuja: knockback() se llama solo desde meleeStrike y las
    // explosiones (explode/bfgBlast) solo dañan, no mueven (verificado por grep).
    if (this.T.beh === 'static') return;
    const p = this.g.position;
    let dx = p.x - player.pos.x, dz = p.z - player.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    p.x += dx / l * dist; p.z += dz / l * dist;
    p.x = clamp(p.x, -ARENA + 1.2, ARENA - 1.2);
    p.z = clamp(p.z, -ARENA + 1.2, ARENA - 1.2);
    pushOutOfBoxes(p, 0.55 * this.T.scale);
  }
  die() {
    // E11: confirmación de kill ÚNICA por frame (los 14 pellets del changó o un splash
    // no apilan 14 crunch) y diferenciada: crunch+blip ascendente normal, thud grave +
    // boom para el jefe. fb.killSnd lo agrupa feedbackHit (ver su definición).
    if (this.boss) { Sfx.killBoss(); Sfx.explosion(); } // el jefe se apaga con boom, no con el blip normal
    else if (game.time !== fb.killSnd) { fb.killSnd = game.time; Sfx.kill(); }
    // E6b spec 7: el séquito PROPIO (drones/esporeadores/posesivos/glitches) se apaga CON
    // su jefe — sin score ni drop (no fue mérito del jugador) y sin tocar el killfeed.
    // Diferido un frame (pendingPop): die() puede correr desde el update() del propio
    // enemigo (burn) y el loop inverso no perdona splices ajenos al índice actual.
    if (this.boss)
      for (const m of enemies) if (m.owner === this) (pendingPop || (pendingPop = [])).push(m);
    game.score += this.T.score; game.kills++;
    if (this.boss) feed(`BOSS: ${this.T.name} +${this.T.score}`); // E6: score alto al killfeed
    // E8-polish(a): el "+100 DRONER" ya NO sube al killfeed arriba a la derecha — es un
    // popup anclado a la proyección en pantalla del pecho del enemigo (o a su última
    // posición visible si murió de espaldas). El killfeed queda para oleadas/avisos.
    // E6 glitch: el popup sale en el color del último tinte (números: killPopup hace
    // toCss(hex) — strings tipo '#54f0ff' le producirían un '##54f0ff' inválido).
    killPopup(`+${this.T.score} ${(this.T.name || this.type).toUpperCase()}`,
      this.chest(_popV), this.lastScr, this.T.beh === 'step' ? (this.hex ? 0xff3bd8 : 0x54f0ff) : this.T.color);
    rollKillDrop(this.g.position, this.type, this.boss); // E3: drops (el boss garantiza casco)
    // E6 esporeador: muere ESCUPIDO — la nube de esporas sigue ardiendo 3 s sobre su cuerpo
    if (this.T.beh === 'spore') spawnZone('poison', this.g.position.x, this.g.position.z, 2.0, 3, 3);
    burst(this.g.position, this.T.color, this.boss ? 44 : 22, this.boss ? 12 : 9, this.boss ? 2 : 1.2, 1.7);
    popFxLight(this.g.position, this.T.color, this.boss ? 320 : 150, 0.38); // flash momentáneo desde el pool
    this.remove();
    if (this.boss) onBossKilled(this); // E5: abre el portal (E6: MORIS-9 cierra la campaña)
  }
  // punto "pecho" para el popup de score (centro alto del billboard)
  chest(out) { return out.set(this.g.position.x, this.g.position.y + 0.8, this.g.position.z); }
  // E6b: apagón de summon (el jefe murió) — burst corto y afuera. El guard cubre el caso
  // de que el reset de nivel (resetArenaCombat) se lo haya llevado por delante primero.
  pop() {
    if (!enemies.includes(this)) return;
    burst(this.g.position, this.T.color, 12, 5, 0.9, 1.5);
    this.remove();
  }
  remove() {
    scene.remove(this.g);
    if (this.aura) { this.aura.geometry.dispose(); this.aura.material.dispose(); } // geo/mat del elite son propios
    if (this.ring) { // E6b: el anillo de MORIS-9 también es propio (geo por hijo, mat compartida)
      for (const m of this.ring.children) m.geometry.dispose();
      this.ringMat.dispose();
    }
    const i = enemies.indexOf(this); if (i >= 0) enemies.splice(i, 1);
    const j = enemyHitboxes.indexOf(this.hitbox); if (j >= 0) enemyHitboxes.splice(j, 1);
  }
  update(dt, t) {
    const T = this.T;
    // spawn grow
    if (this.spawnT < 1) { this.spawnT = Math.min(1, this.spawnT + dt / 0.35);
      this.g.scale.setScalar(T.scale * this.spawnT); }
    else if (this.g.scale.x !== T.scale) this.g.scale.setScalar(T.scale);

    // idle: alterna los 2 frames del sheet a ~2.5 Hz, desfasado por enemigo
    this.tex.offset.x = ((t * 2.5 + this.phase * 0.4) % 1 < 0.5) ? 0 : 0.5;
    // scale-bob sutil (reemplaza el pulso emisivo del viejo núcleo)
    this.spr.scale.setScalar(1 + Math.sin(t * 3 + this.phase) * 0.03);
    // E4a — DoT de quemado: hp baja fraccional (burnDps/s, valor de la tabla WEAPONS);
    // la muerte por fuego cuenta score/drops igual que un tiro (die() único camino).
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.hp -= this.burnDps * dt;
      if (this.hp <= 0) { this.die(); return; }
    }
    if (this.scorchT > 0) this.scorchT -= dt; // E4b: el tinte oscuro del compilador se apaga solo
    // tinte: el flash (setScalar 2.2 en flash()) decae HACIA el tinte de estado vigente
    // (E4b: prioridad burn > scorch > normal — un quemado-scorcheado sale naranja mientras
    // hierve y queda oscuro al apagarse el fuego). Sin burn ni scorch esto es idéntico al
    // "decay to 1" del E2: el único escritor del color sigue siendo este lerp.
    // E6: el "normal" puede ser propio del tipo (glitch: cyan/magenta a saltos).
    const baseTint = this.boss ? TINT_BOSS
      : T.beh === 'step' ? (this.hex ? TINT_HEX_B : TINT_HEX_A) : TINT_NORMAL;
    this.spr.material.color.lerp(
      this.burnT > 0 ? TINT_BURN : this.scorchT > 0 ? TINT_SCORCH : baseTint,
      Math.min(1, dt * 5));
    if (this.aura) this.aura.scale.setScalar(1 + Math.sin(t * 4 + this.phase) * 0.12); // E5: aura latiendo
    // E6b: el anillo de MORIS-9 gira sobre su eje (los nodos delatan el giro); f3 acelera
    // junto con TODO lo demás (spec: fase final al 140 % de ritmo).
    if (this.ring) this.ring.rotation.z += dt * (this.phaseN >= 3 ? 1.9 : 1.1);

    // E6 telegrafía: 0.3 s de flash + shake de sprite antes de cada ataque (spec 4);
    // al vencer corre la acción agendada por el comportamiento.
    if (this.tell > 0) {
      this.tell -= dt;
      this.spr.position.x = rand(-0.06, 0.06);
      if (this.tell <= 0) {
        this.spr.position.x = 0;
        const f = this.tellQ; this.tellQ = null;
        if (f) f();
      }
    }
    // E6 blink de posesivo/confesor (parpadeo 0.5 s ANTES de saltar): opacidad a saltos
    if (this.tpT > 0 && this.tpT < 0.5)
      this.spr.material.opacity = (t * 24 % 1 < 0.5 ? 0.3 : 1) * this.baseOpacity;
    else if (this.spr.material.opacity !== this.baseOpacity)
      this.spr.material.opacity = this.baseOpacity;

    // E6: los summoned que quedan huérfanos (su jefe murió) siguen sueltos, pero se
    // quitan del registro del padre para no contar basura.
    if (this.owner && !enemies.includes(this.owner)) this.owner = null;

    const p = this.g.position;
    _eDir.set(player.pos.x - p.x, 0, player.pos.z - p.z);
    const dist = _eDir.length();
    if (dist > 0.001) _eDir.normalize();

    // separación entre enemigos — el mismo loop O(n²) de E2 (26-30 bichos = ~900 tests,
    // holgado a 60 fps; cualquier "optimización" por velocidad deja a los droners sin
    // orden y apilados contra el jugador: E2 verificado, no se toca). Única excepción
    // E6: el Huerta QUIETA no acumula separación (es un ancla, no un peón).
    _eSep.set(0, 0, 0);
    if (T.beh !== 'static')
    for (const o of enemies) {
      if (o === this) continue;
      const d = p.distanceTo(o.g.position);
      const r = 1.5 * (T.scale + o.T.scale) * 0.5;
      if (d < r && d > 0.001) {
        _eTmp.set(p.x - o.g.position.x, 0, p.z - o.g.position.z).normalize();
        _eSep.addScaledVector(_eTmp, (r - d) / r * 4);
      }
    }

    // ---- movimiento: embestida > conducta propia > steering E2 ----
    if (this.dashOn) { // Criopylot / Fundidor fase 2: línea rápida, sin steering
      this.dashT -= dt;
      if (this.dashT <= 0) this.dashOn = false;
      p.x += this._dx * dt; p.z += this._dz * dt;
    } else if (T.beh === 'static') {
      p.x += _eSep.x * dt * 0.3; p.z += _eSep.z * dt * 0.3; // respira en su sitio
    } else if (T.beh === 'kite') {
      // espectro: mantiene ~8 m (acorta de lejos, retrocede de cerca, tangencia en la banda)
      _eMove.copy(_eDir).multiplyScalar(dist > 9 ? this.speed : dist < 7 ? -this.speed : 0)
        .addScaledVector(_eTmp.set(-_eDir.z, 0, _eDir.x), Math.sin(t * 0.9 + this.phase) * this.speed * 0.55)
        .add(_eSep);
      p.x += _eMove.x * dt; p.z += _eMove.z * dt;
    } else if (T.beh === 'step') {
      // glitch: saltos DISCRETOS de 0.5 m cada 0.3 s (no slide) + afterimage fantasma
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.3;
        _eMove.copy(_eDir).multiplyScalar(0.5).addScaledVector(_eSep, 0.12);
        const L = _eMove.length();
        if (L > 0.5) _eMove.multiplyScalar(0.5 / L);
        spawnGhost(p.x, p.z, this.g.scale.x, this.spr.rotation.y, this.hex); // fantasma en el sitio viejo
        p.x += _eMove.x; p.z += _eMove.z;
        this.hex ^= 1;                       // el tinte alterna cyan ↔ magenta…
        Sfx.glitchZip();                     // …y el oído también
      }
    } else if (T.beh === 'lance') {
      // lancellas: vuelo errático (deriva lateral senoidal sobre el steering de E2)
      _eMove.copy(_eDir).multiplyScalar(this.speed)
        .addScaledVector(_eTmp.set(-_eDir.z, 0, _eDir.x), Math.sin(t * 2.3 + this.phase) * this.speed * 0.8)
        .add(_eSep);
      p.x += _eMove.x * dt; p.z += _eMove.z * dt;
    } else if (!this.boss) {
      _eMove.copy(_eDir).multiplyScalar(this.speed).add(_eSep);
      p.x += _eMove.x * dt; p.z += _eMove.z * dt;
    }

    p.x = clamp(p.x, -ARENA + 1.2, ARENA - 1.2);
    p.z = clamp(p.z, -ARENA + 1.2, ARENA - 1.2);
    pushOutOfBoxes(p, 0.55 * T.scale);

    // ---- conducta de ataque (telegrafía mediante) ----
    if (this.spawnT >= 1 && game.state === 'play') {
      if (this.boss) this.bossBehave(dt, t, dist);
      else this.behave(dt, t, dist);
    }

    // levitación + billboard SOLO yaw alineado a la cámara (estilo Doom): el sprite
    // siempre da de frente, sin flip → nunca se ve la "espalda" y no deforma con el
    // pitch (por eso un plano rotado en Y y no un Sprite de three, que hace billboard
    // total contra el plano de imagen y estira con la mirada arriba/abajo).
    // E6: los que CAMINAN (esporeador/Huerta) apenas se despegan del piso.
    const bobA = T.beh === 'spore' || T.beh === 'static' ? 0.03 : 0.14;
    p.y = this.baseY + Math.sin(t * 3 + this.phase) * bobA;
    this.spr.rotation.y = camera.rotation.y;

    // E8-polish(a): recordar dónde se ve al enemigo (px CSS) — si muere fuera de la
    // vista, su popup de score se ancla a esta última posición conocida
    this.lastScr = screenOf(this.chest(_popV), this.lastScr);

    // daño por contacto — E6: la embestida pega DURANTE todo el dash (una vez por
    // carrera); E6b fija 25 para TODO jefe que embiste (spec: "como el criopylot"). El
    // contacto común mantiene el radio de E2 (el Huerta quieta cobra su "radio 3 m" con
    // hitbox × escala: 1.1×2.6+0.6 ≈ 3.5).
    this.hitCd -= dt;
    if (this.dashOn) {
      if (!this.dashHit && dist < 1.3 * T.scale + 0.7) {
        this.dashHit = true;
        damagePlayer(25);
        player.shakeT = Math.max(player.shakeT, 0.25); // el embiste se siente en la cámara
      }
    } else if (dist < 1.1 * T.scale + 0.6 && this.hitCd <= 0 && this.spawnT >= 1) {
      this.hitCd = 0.9;
      damagePlayer(T.dmg);
    }
  }

  // ============ E6 — conductas por tipo (spec 4: todo new enemy entra por acá) =======
  // Los que disparan telegrafían con startTell (flash + shake 0.3 s) y el disparo real
  // corre cuando el tell vence. LOS = línea de visión libre contra los sólidos del nivel.
  startTell(sec, fn) { if (this.tell > 0) return; this.tell = sec; this.tellQ = fn; this.flash(); }
  blinkNear(maxD = 6) { // posesivo / Confesor: salto a un punto DETRÁS o al LADO del jugador,
                // dentro de maxD m, clamp arena y nunca dentro de un muro. (a = yaw manda
                // hacia atrás: el offset 0 cae a la espalda, ±1.5 sale a los costados.)
                // E6b: el Confesor pide ≤7 m (blinkNear(7)); el posesivo conserva los 6 del E6a.
    for (let i = 0; i < 10; i++) {
      const a = player.yaw + rand(-1.5, 1.5);
      const d = rand(2.4, maxD);
      const x = clamp(player.pos.x + Math.sin(a) * d, -ARENA + 1.5, ARENA - 1.5);
      const z = clamp(player.pos.z + Math.cos(a) * d, -ARENA + 1.5, ARENA - 1.5);
      let wall = false;
      for (const b of boxes)
        if (x > b.min.x - 0.8 && x < b.max.x + 0.8 && z > b.min.z - 0.8 && z < b.max.z + 0.8) { wall = true; break; }
      if (wall) continue;
      burst(this.g.position, this.T.color, 10, 4, 0.9, 1.8); // ceniza en el origen
      this.g.position.x = x; this.g.position.z = z;
      burst(this.g.position, this.T.color, 10, 4, 0.9, 1.8); // y en el destino
      Sfx.blink();
      return;
    }
  }
  startDash(speed = 22) { // E6b: 22 m/s de línea (spec; el WIP corría a 19) — Criopylot y
                          // Fundidor f2 comparten la embestida, solo cambia el intervalo.
    const p = this.g.position;
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    this._dx = dx / l * speed; this._dz = dz / l * speed;
    this.dashOn = true; this.dashT = 0.6; this.dashHit = false; // 0.6 s de línea rápida
    Sfx.dash(); // rugido corto de arranque
  }
  spawnPet(type, cap, msg) {
    let n = 0; for (const e of enemies) if (e.owner === this) n++;
    if (n >= cap) return;
    const p = this.g.position;
    // Vector3 de verdad: el ctor hace position.copy(pos) + burst(pos) y un {x,z} dejaría
    // el y en NaN (las partículas nacerían invisibles — bug clásico de copiar planos).
    const m = new Enemy(type, new THREE.Vector3(clamp(p.x + rand(-2.5, 2.5), -ARENA + 2, ARENA - 2),
                                                0,
                                                clamp(p.z + rand(-2.5, 2.5), -ARENA + 2, ARENA - 2)));
    pushOutOfBoxes(m.g.position, 0.8);
    m.owner = this;
    (this.pets || (this.pets = [])).push(m);
    if (msg) feed(`INVOCADO: ${m.T.name || m.type.toUpperCase()}`);
  }
  // relojes de jefe comunes: telegraph window + invocación por petT
  bossCommon(dt, type, cap, interval, msg) {
    this.pT -= dt;
    if (this.pT <= 0) { this.pT = interval; this.spawnPet(type, cap, msg); }
  }
  behave(dt, t, dist) {
    const T = this.T;
    switch (T.beh) {
      case 'spore': { // hongo: cada 4 s suelta un halo verde de 2 m (3 dmg/s por 3 s).
                      // Spec 4: el hinchado se telegrafía con el flash de startTell (0.3 s);
                      // la nube nace bajo el sombrero en el momento del POP (camina lento).
        this.sporeT -= dt;
        if (this.sporeT <= 0 && this.tell <= 0) {
          this.sporeT = 4;
          this.startTell(0.3, () => {
            const p = this.g.position;
            spawnZone('poison', p.x, p.z, 2, 3, 3);
            burst(p, 0x6dff8a, 8, 3, 0.7, 1.5);
            Sfx.sporePop();
          });
        }
        break;
      }
      case 'lance': { // 1 lanza de lava lenta cada ~2.8 s (proyectil, NO hitscan)
        this.atkT -= dt;
        if (this.atkT <= 0 && dist < 20) {
          this.atkT = 2.8;
          const p = this.g.position;
          // TODO numéricos antes del startTell: el tell corre 0.3 s DESPUÉS y los
          // temporales de módulo (_eTmp) a esa altura ya son basura de otro enemigo.
          const ox = p.x, oy = this.baseY + 0.4, oz = p.z;
          _eTmp.set(player.pos.x - ox, (player.pos.y - 0.25) - oy, player.pos.z - oz).normalize();
          const vx = _eTmp.x * 9, vy = _eTmp.y * 9, vz = _eTmp.z * 9;
          this.startTell(0.3, () => {
            fireBolt('lava', ox, oy, oz, vx, vy, vz, { dmg: 14, life: 3.6 });
            Sfx.boltFire();
          });
        }
        break;
      }
      case 'blink': { // posesivo: parpadea 0.5 s y salta cada 3-4 s (spec)
        this.tpT -= dt;
        if (this.tpT <= 0) { this.tpT = rand(3, 4); this.blinkNear(); }
        break;
      }
      case 'kite': { // espectro: ráfaga de 3 bolts lentos en abanico cada ~3 s
        this.atkT -= dt;
        if (this.atkT <= 0 && dist < 17) {
          this.atkT = 3;
          const p = this.g.position;
          const a0 = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
          this.startTell(0.3, () => {
            for (const off of [-0.2, 0, 0.2]) {
              const a = a0 + off; // abanico ~±11°
              fireBolt('bolt', p.x, this.baseY + 0.3, p.z,
                       Math.sin(a) * 7, (player.pos.y - 0.35 - this.baseY - 0.3) * 0.08, Math.cos(a) * 7,
                       { dmg: 9, life: 3.6 });
            }
            Sfx.boltFire();
          });
        }
        break;
      }
      // droner/sprinter/brute y glitch: sin ataque a distancia — contacto (E2)
    }
  }

  // ============ E6 — patrones de mini-jefe (spec 3) ================================
  bossBehave(dt, t, dist) {
    const p = this.g.position;
    switch (this.T.beh) {
      case 'bcrio': { // Criopylot: 1 droner de compañía c/8 s (máx 3) + embiste c/6 s
        if (!this.dashOn) { // el dash es LÍNEA: el steering se corre durante la carrera
          _eMove.copy(_eDir).multiplyScalar(this.speed).add(_eSep);
          p.x += _eMove.x * dt; p.z += _eMove.z * dt;
        }
        this.bossCommon(dt, 'droner', 3, 8);
        this.atkT -= dt;
        // E6b: telegraph 0.5 s de flash blanco + dash de 0.6 s a 22 m/s (spec 1)
        if (this.atkT <= 0) { this.atkT = 6; this.startTell(0.5, () => this.startDash(22)); }
        break;
      }
      case 'static': { // Padre Huerta: 5 esporas en abanico c/2.5 s (explotan en nube
                       // de veneno de piso 3 s) + esporeadores c/10 s (máx 2)
        this.atkT -= dt;
        if (this.atkT <= 0) {
          this.atkT = 2.5;
          const a0 = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
          this.startTell(0.3, () => {
            for (let i = 0; i < 5; i++) {
              const a = a0 + (i - 2) * 0.16; // abanico ~±23°
              // E6b: espora LENTA que revienta en nube de veneno al impactar o A LOS 2 s
              // (life 2 → el expired del pool ya la hace explotar: spec 1).
              fireBolt('spore', p.x, 1.9, p.z,
                       Math.sin(a) * 7.2, (player.pos.y - 1.1) * 0.1, Math.cos(a) * 7.2,
                       { dmg: 6, life: 2 });
            }
            Sfx.sporePop();
          });
        }
        this.bossCommon(dt, 'esporeador', 2, 10, 'HUERTA SIEMBRA');
        break;
      }
      case 'bfundi': { // Fundidor: fase 1 loseta de lava c/3 s (splash r2 + charco 4 s
                       // 8 dmg/s); fase 2 (hp≤50%) +50% velocidad y embiste c/6 s
        const rage = this.hp <= this.T.hp * 0.5;
        if (rage && this.phaseN === 1) {
          this.phaseN = 2;
          this.speed = this.T.speed * 1.5;
          feed('FUNDIDOR ENROJECE — EL CAÑÓN AL ROJO');
          Sfx.phaseUp();
          this.flash(); popFxLight(p, 0xff3bd8, 240, 0.5);
          this.atkT = 1.6; // la primera embestida agarrá al jugador desprevenido
        }
        if (!this.dashOn) { _eMove.copy(_eDir).multiplyScalar(this.speed).add(_eSep); p.x += _eMove.x * dt; p.z += _eMove.z * dt; }
        this.atkT -= dt;
        if (this.atkT <= 0 && !this.dashOn) {
          if (!rage) { // loseta: tiro parabólico al pie del jugador
            this.atkT = 3;
            const x0 = p.x, y0 = this.baseY + 0.3, z0 = p.z;
            const tx = player.pos.x, tz = player.pos.z;
            const dx = tx - x0, dz = tz - z0, d = Math.hypot(dx, dz) || 1, tt = clamp(d / 10, 0.4, 1.6);
            const vx = dx / tt, vz = dz / tt, vy = (player.pos.y - 1.7 - y0) / tt + 0.5 * 18 * tt;
            this.startTell(0.3, () => {
              fireBolt('lava', x0, y0, z0, vx, vy, vz, { dmg: 14, grav: 18, life: 4, splash: 2, lava: 1 });
              Sfx.boltFire();
            });
          } else { this.atkT = 6; this.startTell(0.3, () => this.startDash()); }
        }
        break;
      }
      case 'bconf': { // El Confesor: kite de 9 m + ráfaga de 5 bolts c/2.6 s + posesivos
                      // c/12 s (máx 2) — y salta CADA golpe conectado (ver takeDamage)
        if (!this.dashOn) {
          _eMove.copy(_eDir).multiplyScalar(dist > 10 ? this.speed : dist < 8 ? -this.speed * 0.8 : 0)
            .addScaledVector(_eTmp.set(-_eDir.z, 0, _eDir.x), Math.sin(t * 0.8 + this.phase) * this.speed * 0.5)
            .add(_eSep);
          p.x += _eMove.x * dt; p.z += _eMove.z * dt;
        }
        if (this.tpT > 0) { this.tpT -= dt; if (this.tpT <= 0) { this.tpT = -1; this.blinkNear(); } }
        this.atkT -= dt;
        if (this.atkT <= 0 && dist < 22) {
          this.atkT = 2.6;
          const a0 = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
          this.startTell(0.3, () => {
            for (let i = 0; i < 5; i++) {
              const a = a0 + (i - 2) * 0.15;
              fireBolt('bolt', p.x, this.baseY + 0.2, p.z,
                       Math.sin(a) * 7.5, (player.pos.y - 0.4 - this.baseY - 0.2) * 0.08, Math.cos(a) * 7.5,
                       { dmg: 10, life: 3.6 });
            }
            Sfx.boltFire();
          });
        }
        this.bossCommon(dt, 'posesivo', 2, 12, 'EL CONFESOR ABSUELVE');
        break;
      }
      case 'bmoris': { // MORIS-9: núcleo que órbita el centro; 3 fases (100/66/33%):
                       // f1 rayo dirigible · f2 invoca 2 glitches + anillo de bolts ·
                       // f3 todo más rápido + pantallazo glitch cian
        this.orbA += dt * 0.5 * (this.phaseN >= 3 ? 1.7 : 1);
        const r = 13;
        const nx = Math.cos(this.orbA) * r, nz = Math.sin(this.orbA) * r;
        const stuck = testWall(p.x, p.z, 1.2), targetWall = testWall(nx, nz, 1.0);
        if (!stuck && !targetWall && Math.hypot(nx - p.x, nz - p.z) > 2.2) { // vuela a su
          const k = Math.min(1, dt * this.speed / Math.max(0.001, Math.hypot(nx - p.x, nz - p.z))); // órbita sin
          p.x += (nx - p.x) * k; p.z += (nz - p.z) * k;                       // atravesar tapas
        }
        const f = this.phaseN;
        const nf = this.hp > this.T.hp * 0.66 ? 1 : this.hp > this.T.hp * 0.33 ? 2 : 3;
        if (nf !== f) {
          this.phaseN = nf;
          feed(nf === 2 ? 'MORIS-9 DESPLIEGA ANILLO' : 'MORIS-9 EN PÁNICO — LA REALIDAD PARPADEA');
          Sfx.phaseUp(); this.flash(); popFxLight(p, 0x54f0ff, 300, 0.5);
          if (nf === 2) { this.spawnPet('glitch', 2, 'CLON GLITCH DETECTADO'); this.spawnPet('glitch', 2, 'CLON GLITCH DETECTADO'); }
        }
        const fast = nf >= 3 ? 0.65 : 1;
        this.atkT -= dt;
        if (this.atkT <= 0) { // f1/f3: rayo lento DIRIGIBLE (homing suave, no hitscan)
          this.atkT = 2.6 * fast;
          const a0 = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
          this.startTell(0.3, () => {
            fireBolt('bolt', p.x, this.baseY + 0.2, p.z,
                     Math.sin(a0) * 6.5, (player.pos.y - 0.5 - this.baseY - 0.2) * 0.07, Math.cos(a0) * 6.5,
                     { dmg: 14, homing: 1.1, life: 5.5 });
            Sfx.boltFire();
          });
        }
        if (nf >= 2) { // f2/f3: anillo de bolts en círculo
          this.p2T = (this.p2T || 4.5) - dt;
          if (this.p2T <= 0) {
            this.p2T = 5.5 * fast;
            const n = nf >= 3 ? 12 : 8, off = rand(0, 6.28);
            this.startTell(0.3, () => {
              for (let i = 0; i < n; i++) {
                const a = off + i / n * 6.2832;
                fireBolt('bolt', p.x, 1.7, p.z, Math.sin(a) * 6, 0, Math.cos(a) * 6,
                         { dmg: 9, life: 4 });
              }
              Sfx.boltFire();
            });
          }
        }
        if (nf >= 3) { // f3: pantallazo glitch cian (el retro de E1 ya hace de la mitad)
          this.p3T = (this.p3T || 2) - dt;
          if (this.p3T <= 0) { this.p3T = rand(1.4, 2.4); combatHud.gfxT = 0.11; popFxLight(p, 0x54f0ff, 120, 0.12); } // fix WIP: decía `gflash` (inexistente → ReferenceError en el strict del module)
        }
        break;
      }
    }
    // pinza anti-emparedamiento para TODO jefe móvil (el quieteísmo del Huerta no aplica)
    if (this.T.beh !== 'static' && testWall(p.x, p.z, 0.9 * this.T.scale)) {
      const cx = p.x, cz = p.z;
      pushOutOfBoxes(p, 1.1 * this.T.scale);
      if (p.x === cx && p.z === cz) { // sigue trabado: empujón hacia el centro
        const l = Math.hypot(p.x, p.z) || 1;
        p.x -= p.x / l * 0.4; p.z -= p.z / l * 0.4;
        pushOutOfBoxes(p, 0.9 * this.T.scale);
      }
    }
  }
}

