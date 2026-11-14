import * as THREE from '../three.js';
import { $, neon, rand } from '../core/utils.js';
import { levelFx } from '../core/world.js';
import { camera, scene } from '../render/scene.js';
import { canvasTex, starMat } from '../render/sky.js';

/* ============================================================ FX: tracers + partículas + decals + luces de muerte */
// temporales de módulo: cero allocations por frame en los hot loops
export const _pf = new THREE.Vector3(), _pr = new THREE.Vector3(), _pw = new THREE.Vector3();       // jugador
export const _eDir = new THREE.Vector3(), _eSep = new THREE.Vector3(),
      _eTmp = new THREE.Vector3(), _eMove = new THREE.Vector3();                              // enemigos
export const _hitN = new THREE.Vector3(), _scrR = new THREE.Vector3(), _scrU = new THREE.Vector3();  // impactos
export const _nMat = new THREE.Matrix3();

export const tracerGeo = new THREE.BufferGeometry();
export const tracers = [];
for (let i = 0; i < 40; i++) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({
    color: neon(0x9fe8ff, 1.6), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
export function shootTracer(from, to) {
  const t = tracers.find(t => t.life <= 0) || tracers[0];
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.life = 0.07;
  t.line.material.opacity = 0.9;
}

export const P_MAX = 220;
export const pGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
export const particles = [];
for (let i = 0; i < P_MAX; i++) {
  const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1 });
}
export function burst(pos, color, n, speed = 7, scale = 1, hdr = 1) {
  let made = 0;
  for (const p of particles) {
    if (p.life > 0) continue;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(scale * rand(0.6, 1.4));
    p.mesh.visible = true;
    p.mesh.material.color.set(color).multiplyScalar(hdr);
    p.vel.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(speed * 0.4, speed));
    p.life = p.max = rand(0.35, 0.8);
    if (++made >= n) break;
  }
}

/* E11 — SANGRE: pool propio de 40 pixels chicos (5.5 cm) del color del enemigo, ~0.3 s
   con gravedad. NORMAL blending a propósito: la sangre no brilla (additive + bloom la
   volvía fantasma sobre sprites claros). Cero alloc: los mismos 40 meshes de siempre,
   invisibles entre impactos — auto-degrade no sufre nada nuevo. */
export const bGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
export const blood = [];
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  m.visible = false;
  scene.add(m);
  blood.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 0.3 });
}
// punto del impacto (world) + color del enemigo; n chico en hit, grande en kill
export function bloodSpray(pos, color, n) {
  let made = 0;
  for (const p of blood) {
    if (p.life > 0) continue;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(rand(0.7, 1.35));
    p.mesh.visible = true;
    p.mesh.material.color.set(color).multiplyScalar(0.85); // un punto más oscuro que el sprite
    p.vel.set(rand(-1, 1), rand(0.1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.2, 3.4));
    p.life = p.max = rand(0.22, 0.3);
    if (++made >= n) break;
  }
}

/* decals de impacto: pool de 20 sprites con marca radial oscura dibujada en canvas
   (barrillos de quemado arriba → material.rotation los orienta según la normal del hit).
   Fade de 4 s. Reemplaza el más viejo si el pool está lleno. */
export const decalTex = canvasTex(64, (c, S) => {
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(2,4,9,0.95)');
  g.addColorStop(0.45, 'rgba(2,4,9,0.55)');
  g.addColorStop(0.8, 'rgba(2,4,9,0.16)');
  g.addColorStop(1, 'rgba(2,4,9,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 7; i++) { // lenguas de quemadura hacia el borde superior (v+)
    c.fillStyle = `rgba(1,3,7,${rand(0.14, 0.3).toFixed(2)})`;
    c.beginPath();
    c.ellipse(32 + rand(-13, 13), rand(4, 20), rand(1.4, 3.4), rand(4, 11), rand(-0.3, 0.3), 0, 7);
    c.fill();
  }
  for (let i = 0; i < 10; i++) { // salpicaduras dispersas
    c.fillStyle = `rgba(2,4,9,${rand(0.1, 0.25).toFixed(2)})`;
    c.beginPath(); c.arc(rand(6, 58), rand(6, 58), rand(0.6, 2.2), 0, 7); c.fill();
  }
});
export const decals = [];
for (let i = 0; i < 20; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: decalTex, transparent: true, opacity: 0, depthWrite: false }));
  sp.visible = false;
  sp.renderOrder = 1;
  scene.add(sp);
  decals.push({ sp, life: 0, max: 4 });
}
// point: punto de impacto (world); normal: normal de la cara (world)
export function spawnDecal(point, normal) {
  const d = decals.find(d => d.life <= 0) || decals[0];
  d.sp.position.copy(point).addScaledVector(normal, 0.045);
  // orientar el barrillo a lo largo de la normal proyectada en el plano de pantalla
  const e = camera.matrixWorld.elements;
  _scrR.set(e[0], e[1], e[2]); _scrU.set(e[4], e[5], e[6]);
  d.sp.material.rotation = Math.atan2(normal.dot(_scrR), normal.dot(_scrU));
  const s = rand(0.36, 0.62);
  d.sp.scale.set(s, s, 1);
  d.life = d.max = 4;
  d.sp.visible = true;
  d.sp.material.opacity = 0.9;
}
export function wallImpact(point, normal) {
  burst(point, 0xffc884, 5, 4.5, 0.5, 1.8); // chispas calientes (HDR → bloom)
  burst(point, 0x9fd8ff, 3, 3, 0.5);        // chispas frías
  spawnDecal(point, normal);                // orificio oscuro temporal
}

/* pool de 4 PointLights para el flash de muerte de enemigos */
export const fxFlashes = [];
for (let i = 0; i < 4; i++) {
  const light = new THREE.PointLight(0xffffff, 0, 16, 2);
  light.castShadow = false;
  scene.add(light);
  fxFlashes.push({ light, life: 0, max: 1, peak: 0 });
}
export function popFxLight(pos, color, peak = 150, dur = 0.38) {
  const f = fxFlashes.find(f => f.life <= 0) || fxFlashes[0];
  f.light.position.set(pos.x, pos.y + 0.5, pos.z);
  f.light.color.set(color);
  f.peak = peak; f.life = f.max = dur;
  f.light.intensity = peak;
}

export function updateWorldFx(dt, t) {
  // titilación global sutil de las estrellas (dos senos desfasados)
  starMat.opacity = 0.82 + Math.sin(t * 0.9) * 0.07 + Math.sin(t * 2.7 + 1.3) * 0.05;

  // E5: los ambientales del nivel (lava UV-scroll, chispas, cubos que rotan, lámpara
  // titilante, código del skydome, portal) — levelFx se resetea en cada buildArena.
  for (const fn of levelFx) fn(dt, t);

  // decaimiento de los flashes de muerte (pool de luces)
  for (const f of fxFlashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) { f.light.intensity = 0; continue; }
    const k = f.life / f.max;
    f.light.intensity = f.peak * k * k;
  }

  // fade de decals (4 s, curva suave al final)
  for (const d of decals) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.sp.visible = false; d.sp.material.opacity = 0; continue; }
    d.sp.material.opacity = 0.9 * Math.pow(d.life / d.max, 0.7);
  }
}

