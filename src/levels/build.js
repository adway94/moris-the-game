import * as THREE from '../three.js';
import { portal } from '../core/state.js';
import { neon } from '../core/utils.js';
import { ARENA, WALL_H, addSolid, boxes, levelRes, mulberry32, ownRes, resetLevelArrays, solids, world } from '../core/world.js';
import { makeFloorTex, makeObTex, makeWallTex } from '../levels/areatex.js';
import { bandedFog } from '../render/fog.js';
import { configureLights } from '../render/lights.js';
import { scene } from '../render/scene.js';
import { buildSky } from '../render/sky.js';

// layout de cajas procedural CON SEMILLA (el del arena madre, ahora por nivel):
// rejilla 5×5 con jitter; libre el pasillo del spawn (sur) y la antesala del portal (norte)
export function makeLayout(rng, n) {
  const out = [];
  for (let tries = 0; tries < n * 8 && out.length < n; tries++) {
    const gx = ((rng() * 5) | 0) * 12 - 24, gz = ((rng() * 5) | 0) * 12 - 24;
    const x = gx + (rng() * 6 - 3), z = gz + (rng() * 6 - 3);
    const w = 2.5 + rng() * 5, d = 2.5 + rng() * 5, h = 1.6 + rng() * 4.4;
    if (Math.abs(x) + w / 2 < 9 && z > 17) continue;
    if (Math.abs(x) + w / 2 < 11 && z < -ARENA + 15) continue;
    if (out.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 2 && Math.abs(o.z - z) < (o.d + d) / 2 + 2)) continue;
    out.push({ x, z, w, h, d });
  }
  return out;
}

// antesala del portal (norte): dos pilares haciendo de puertas + guía emisiva al piso
export function buildAntechamber(def, obMat) {
  const g = ownRes(new THREE.BoxGeometry(2.2, WALL_H + 1, 2.2));
  [[-7, -ARENA + 6], [7, -ARENA + 6]].forEach(([x, z]) => {
    const p = new THREE.Mesh(g, obMat);
    p.position.set(x, (WALL_H + 1) / 2, z);
    addSolid(p);
  });
  const strip = new THREE.Mesh(ownRes(new THREE.BoxGeometry(12, 0.12, 0.5)),
    ownRes(new THREE.MeshBasicMaterial({ color: neon(def.pal.neon, 2.2) })));
  strip.position.set(0, 0.03, -ARENA + 3);
  world.add(strip);
}

// destructor del nivel anterior: libera TODO lo registrado (geos, mats, texturas, PMREM).
// Los caches compartidos (starMat, PROP_ART, arte de enemigos/pickups/viewmodel) NO están
// en levelRes: sobreviven al rebuild a propósito, como en E2/E3.
export function disposeWorld() {
  for (const r of levelRes) { try { r.dispose(); } catch (e) { /* ya liberado */ } }
  resetLevelArrays();
  portal.mesh = null;
  world.clear(); // los meshes/luces del nivel salen de la escena (FX y viewmodel no viven acá)
  solids.length = 0;
  boxes.length = 0;
}

// EL constructor de mapa: se llama en cada arranque de nivel (y en el boot). Con
// disposeWorld() primero, la escena se regenera sin leak entre sectores.
export function buildArena(def) {
  disposeWorld();
  const pal = def.pal;
  scene.background = new THREE.Color(def.bg);
  scene.fog.color.set(def.fog.color);
  scene.fog.density = def.fog.density;
  configureLights(def);
  buildSky(def);

  const floorMat = ownRes(new THREE.MeshStandardMaterial({ map: makeFloorTex(pal, def.seamK || 1), roughness: 0.7, metalness: 0.32, envMapIntensity: 0.35 }));
  const floor = new THREE.Mesh(ownRes(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  world.add(floor);

  const wallMat = ownRes(new THREE.MeshStandardMaterial({ map: makeWallTex(pal), roughness: 0.8, metalness: 0.35, envMapIntensity: 0.3 }));
  const trimMat = ownRes(new THREE.MeshBasicMaterial({ color: neon(pal.neon, def.trimK || 1.55) })); // N4 sube trimK: filo más HDR con la ambiental muerta
  const wallGeo = ownRes(new THREE.BoxGeometry(1, WALL_H, 1)); // caja unitaria escalada: 1 geo para los 4 muros
  [[0, -ARENA - 0.5, ARENA * 2 + 2, 1], [0, ARENA + 0.5, ARENA * 2 + 2, 1],
   [-ARENA - 0.5, 0, 1, ARENA * 2 + 2], [ARENA + 0.5, 0, 1, ARENA * 2 + 2]].forEach(([x, z, w, d]) => {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.scale.set(w, 1, d);
    wall.position.set(x, WALL_H / 2, z);
    addSolid(wall, false); // colisión con límites se hace por clamp (setFromObject respeta el scale)
    const trim = new THREE.Mesh(wallGeo, trimMat);
    trim.scale.set(w * 0.995, 0.07, d * 0.995);
    trim.position.set(x, WALL_H - 0.35, z);
    world.add(trim);
  });

  const rng = mulberry32(def.seed);
  const obMat = ownRes(new THREE.MeshStandardMaterial({ map: makeObTex(pal), roughness: 0.55, metalness: 0.45, envMapIntensity: 0.55 }));
  makeLayout(rng, 12).forEach(({ x, z, w, h, d }, i) => {
    const b = new THREE.Mesh(ownRes(new THREE.BoxGeometry(w, h, d)), obMat);
    b.position.set(x, h / 2, z);
    addSolid(b);
    if (i % 3 === 0) { // franja neón HDR encima de algunos bloques: canal oscuro + núcleo bloom
      const ch = new THREE.Mesh(ownRes(new THREE.BoxGeometry(w * 0.88, 0.1, d * 0.88)),
        ownRes(new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.4, metalness: 0.6 })));
      ch.position.set(x, h - 0.01, z);
      addSolid(ch, false);
      const glow = new THREE.Mesh(ownRes(new THREE.BoxGeometry(w * 0.8, 0.06, d * 0.8)),
        ownRes(new THREE.MeshBasicMaterial({ color: neon(i % 2 ? 0xff4d5e : pal.neon, 2.1) })));
      glow.position.set(x, h + 0.05, z);
      world.add(glow);
    }
  });

  const pylonGeo = ownRes(new THREE.CylinderGeometry(0.25, 0.35, WALL_H + 1.5, 8));
  const bulbGeo = ownRes(new THREE.SphereGeometry(0.42, 12, 12));
  const bulbMat = ownRes(new THREE.MeshBasicMaterial({ color: neon(pal.neon, 2.1) }));
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const p = new THREE.Mesh(pylonGeo, obMat);
    p.position.set(sx * (ARENA - 2), (WALL_H + 1.5) / 2, sz * (ARENA - 2));
    addSolid(p);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(sx * (ARENA - 2), WALL_H + 1.7, sz * (ARENA - 2));
    world.add(bulb);
    const pl = new THREE.PointLight(pal.neon, 30, 26, 2);
    pl.position.copy(bulb.position);
    world.add(pl);
  });

  def.set(def, obMat, rng); // props característicos del sector (≤40)
  buildAntechamber(def, obMat);

  world.traverse(o => { // banded fog del E1 sobre TODO el entorno recién construido
    if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => bandedFog(m));
  });
}

