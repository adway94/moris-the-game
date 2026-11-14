import * as THREE from '../three.js';
import { makePropSprite } from '../art/props.js';
import { neon, rand } from '../core/utils.js';
import { ARENA, addSolid, levelFx, ownRes, world } from '../core/world.js';
import { canvasTex } from '../render/sky.js';

/* ============================================================ E5 — sets de geometría por nivel
   Cada nivel suma SUS props sobre la base común (piso/muros/pilones que arma buildArena).
   Presupuesto: ≤40 props, geometría/material COMPARTIDO por tipo (patrón E2/E3), y todo
   recurso del nivel pasa por ownRes() → lo libera el dispose del rebuild. */

// arte de props billboard (cache PERSISTENTE entre niveles: el tex/geo compartido NO
// se registra en levelRes — los materiales por nivel sí)
export const PROP_ART = {};
export function propSprite(kind) {
  if (!PROP_ART[kind]) {
    const art = makePropSprite(kind);
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    PROP_ART[kind] = { tex, geo: new THREE.PlaneGeometry(art.cellW / art.cellH, 1) };
  }
  return PROP_ART[kind];
}

// N1 — pasillo-losa gris+cian: crio-cápsulas como pilares (base metálica + cristal
// emisivo) y una lámpara que titila (hangar roto).
export function setCriopods(def, obMat) {
  const baseGeo = ownRes(new THREE.BoxGeometry(1.7, 1.1, 2.7));
  const glassGeo = ownRes(new THREE.BoxGeometry(1.1, 2.1, 1.9));
  const capMat = ownRes(new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.5, metalness: 0.6 }));
  const glassMat = ownRes(new THREE.MeshStandardMaterial({
    color: 0x0a1420, emissive: 0x54f0ff, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.2,
    transparent: true, opacity: 0.85 }));
  for (let i = 0; i < 9; i++) {
    const x = -21 + (i % 3) * 21 + rand(-2, 2), z = -13 + ((i / 3) | 0) * 13 + rand(-2, 2);
    if (Math.abs(x) < 9 && z > 16) continue; // pasillo del spawn libre
    const base = new THREE.Mesh(baseGeo, capMat);
    base.position.set(x, 0.55, z); base.rotation.y = rand(-0.2, 0.2);
    addSolid(base);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(x, 2.2, z); glass.rotation.y = base.rotation.y;
    addSolid(glass); // el cristal también frena balas
  }
  const fl = new THREE.PointLight(0xdff0ff, 26, 30, 2);
  fl.position.set(2, 6, -4);
  world.add(fl);
  let flick = 1;
  levelFx.push((dt) => { // lámpara titilante: picos de corte cada tanto, retorno suave
    if (Math.random() < dt * 2.2) flick = 0.15 + Math.random() * 0.85;
    fl.intensity += (26 * flick - fl.intensity) * Math.min(1, dt * 14);
  });
}

// N2 — invernadero: enredaderas billboard (makePropSprite 'vine') + charcos magenta
// emisivos pegados al piso (decals a 0.02 m: sin z-fighting).
export function setInvernadero() {
  const A = propSprite('vine');
  const mat = ownRes(new THREE.MeshBasicMaterial({ map: A.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  let n = 0;
  for (let i = 0; i < 24 && n < 22; i++, n++) {
    let x, z;
    if (i % 3 === 0) { // hileras contra los muros norte/sur
      x = -26 + i * 2.4 + rand(-1, 1);
      z = (i % 6 === 0 ? -1 : 1) * (ARENA - 2 - rand(0, 1.5));
    } else { x = rand(-ARENA + 3, ARENA - 3); z = rand(-ARENA + 3, ARENA - 3); }
    if (Math.abs(x) < 8 && z > 17) continue;          // spawn
    if (Math.abs(x) < 11 && z < -ARENA + 15) { i--; continue; } // antesala
    const v = new THREE.Mesh(A.geo, mat);
    const s = rand(0.8, 1.7);
    v.scale.setScalar(s);
    v.position.set(x, s / 2, z);
    v.rotation.y = rand(-0.5, 0.5);
    world.add(v);
  }
  const pudMat = ownRes(new THREE.MeshBasicMaterial({ color: neon(0xff3bd8, 1.5), transparent: true, opacity: 0.85, depthWrite: false }));
  const pudGeo = ownRes(new THREE.CircleGeometry(1, 10));
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(pudGeo, pudMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(rand(-24, 24), 0.02, rand(-22, 20));
    const s = rand(1.4, 3.2);
    p.scale.set(s, s, 1);
    world.add(p);
  }
}

// N3 — reactor: lagunas de "lava" emisivas con UV-scroll entre pasarelas metálicas +
// chispas ambientales (Points propio, lento, NO el pool de combate). OJO: el daño por
// pisar naranja queda para E6/E8 — acá la lava es visual.
export function setReactor(def, obMat) {
  const lavaTex = canvasTex(256, (c, S) => {
    c.fillStyle = '#7c2a07'; c.fillRect(0, 0, S, S);
    const veins = ['#3f1403', '#b34a10', '#ff7a2a', '#ffc36b', '#2a0c02'];
    for (let i = 0; i < 30; i++) {
      c.fillStyle = veins[i % 5];
      c.globalAlpha = 0.28 + Math.random() * 0.5;
      c.fillRect(0, rand(0, S), S, rand(2, 9));
    }
    c.globalAlpha = 1;
  }, 3, 6);
  const lavaMat = ownRes(new THREE.MeshBasicMaterial({ map: lavaTex, color: neon(0xff7a2a, 1.15) }));
  const lavaGeo = ownRes(new THREE.PlaneGeometry(11, 54));
  [-19, 0.5, 19.5].forEach(x => {
    const p = new THREE.Mesh(lavaGeo, lavaMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.05, 0);
    world.add(p);
  });
  levelFx.push(dt => { lavaTex.offset.y -= dt * 0.05; }); // magma reptando (UV scroll)
  const walkGeo = ownRes(new THREE.BoxGeometry(10.5, 0.9, 6)); // pasarelas sobre la lava
  [[-19, -16], [-19, 14], [0.5, -2], [19.5, -18], [19.5, 10]].forEach(([x, z]) => {
    const w = new THREE.Mesh(walkGeo, obMat);
    w.position.set(x, 0.45, z);
    addSolid(w);
  });
  const N = 90;
  const geo = ownRes(new THREE.BufferGeometry());
  const pos = new Float32Array(N * 3);
  const vy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = [-19, 0.5, 19.5][i % 3] + rand(-5, 5);
    pos[i * 3 + 1] = rand(0, 6);
    pos[i * 3 + 2] = rand(-26, 26);
    vy[i] = rand(0.4, 1.6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = ownRes(new THREE.PointsMaterial({ color: neon(0xffb057, 1.8), size: 0.16,
    transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pts = new THREE.Points(geo, mat);
  world.add(pts);
  levelFx.push(dt => {
    const a = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) + vy[i] * dt;
      if (y > 6.5) y = 0.05;
      a.setY(i, y);
    }
    a.needsUpdate = true;
  });
}

// N4 — cripta: columnas de piedra low-poly + estatuas billboard ('statue') + brasas
// violetas. La ambiental va al piso (config de luces) y ESTOS emisivos cargan el mapa.
export function setCripta() {
  const stoneMat = ownRes(new THREE.MeshStandardMaterial({ color: 0x241f36, roughness: 0.9, metalness: 0.1 }));
  const colGeo = ownRes(new THREE.CylinderGeometry(0.7, 0.85, 6, 6));
  const capGeo = ownRes(new THREE.BoxGeometry(2.1, 0.5, 2.1));
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.283 + 0.39;
    const x = Math.cos(a) * 13.5, z = Math.sin(a) * 13.5;
    const c = new THREE.Mesh(colGeo, stoneMat);
    c.position.set(x, 3, z);
    addSolid(c);
    const cap = new THREE.Mesh(capGeo, stoneMat);
    cap.position.set(x, 6.2, z);
    addSolid(cap, false);
  }
  const A = propSprite('statue');
  const mat = ownRes(new THREE.MeshBasicMaterial({ map: A.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  [[-8, -6], [8, -6], [-8, 6], [8, 6], [-21, 0], [21, 0]].forEach(([x, z]) => {
    const st = new THREE.Mesh(A.geo, mat);
    st.scale.setScalar(3.6); // el geo cache mide 1 m de alto
    st.position.set(x, 1.8, z);
    st.rotation.y = Math.atan2(-x, -z); // mirando al centro del templo
    world.add(st);
  });
  const flGeo = ownRes(new THREE.BoxGeometry(0.7, 1.5, 0.7));
  [[-13, -13], [13, -13], [-13, 13], [13, 13]].forEach(([x, z]) => {
    const fl = new THREE.Mesh(flGeo, ownRes(new THREE.MeshBasicMaterial({ color: neon(0xaa5cff, 2.6) })));
    fl.position.set(x, 0.75, z);
    world.add(fl);
    const pl = new THREE.PointLight(0xaa5cff, 26, 20, 2);
    pl.position.set(x, 2.2, z);
    world.add(pl);
    levelFx.push((dt, t) => { pl.intensity = 26 + Math.sin(t * 5.3 + x) * 7; }); // brasa oscilante
  });
}

// N5 — núcleo: cubos flotantes que rotan (props animados por levelFx) sobre la losa
// Tron; el cielo "código" lo arma buildSky (def.sky.code).
export function setNucleo() {
  const cubeMat = ownRes(new THREE.MeshStandardMaterial({
    color: 0x071426, emissive: 0x1899cc, emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.7 }));
  const cubes = [];
  for (let i = 0; i < 12; i++) {
    const s = rand(1.2, 2.8);
    const m = new THREE.Mesh(ownRes(new THREE.BoxGeometry(s, s, s)), cubeMat);
    m.position.set(rand(-25, 25), rand(3.5, 9), rand(-25, 20));
    m.castShadow = false;
    world.add(m);
    cubes.push({ m, spin: rand(0.15, 0.5) * (Math.random() < 0.5 ? -1 : 1), bob: rand(0, 6.28), y0: m.position.y });
  }
  levelFx.push((dt, t) => {
    for (const c of cubes) {
      c.m.rotation.y += c.spin * dt;
      c.m.rotation.x += c.spin * 0.35 * dt;
      c.m.position.y = c.y0 + Math.sin(t * 0.7 + c.bob) * 0.5;
    }
  });
}

