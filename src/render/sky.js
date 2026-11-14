import * as THREE from '../three.js';
import { $, rand } from '../core/utils.js';
import { levelFx, levelRes, world } from '../core/world.js';
import { renderer, scene } from '../render/scene.js';

/* ============================================================ cielo procedural (E5: por nivel)
   La esfera BackSide + campo de estrellas se construye en buildSky(def) con el gradiente,
   las estrellas y el "código" que declare la fila LEVELS.sky — ver más abajo. canvasTex
   queda acá porque también lo usan las texturas de la arena. */
export function canvasTex(size, draw, repX = 1, repY = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repX, repY);
  tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tx;
}

/* cielo POR NIVEL (E5): todo lo de acá abajo vive en `world` (grupo que buildArena
   destruye/rearma) con gradiente + estrellas + "código" parametrizados por la fila
   LEVELS.sky {kind, stops, stars, code}. Los temporales de módulo (starGeo/starTex)
   se crean UNA vez; por nivel solo se crean el Points/geo de estrellas y los materiales
   del domo, que se registran en levelRes para el dispose del rebuild. */
export function mkGradientTex(stops, noiseCol) {
  const tx = canvasTex(64, (c, S) => {
    const g = c.createLinearGradient(0, 0, 0, S);
    for (const [k, v] of stops) g.addColorStop(k, v);
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) { // ruido tipo banding (como el cielo original)
      c.fillStyle = `rgba(${noiseCol},${rand(0.006, 0.02).toFixed(3)})`;
      c.fillRect(0, rand(0, S), S, 1);
    }
  });
  tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
  return tx;
}

// N5 "código": filas de pixels cian sobre negro. Canvas chico (128) estirado con
// NEAREST a un domo de 150 m: pixeles gigantes retro. game.js lo re-dibuja throttleado
// (levelFx) para el parpadeo — cada redibujado sube 16 KB al GPU, costo irrisorio.
export function codeCanvasDraw(c, S, tt) {
  c.fillStyle = '#000305'; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(84,240,255,0.75)';
  for (let y = 0; y < S; y += 8) {
    const row = (Math.sin(tt * 0.7 + y * 1.7) * 43758.5453) % 1;
    const on = ((tt * 3 + y) | 0) % 3 !== 0; // la mitad de las filas parpadea por frames
    if (!on) continue;
    for (let x = ((row * 17) | 0); x < S; x += 4)
      if (Math.random() < 0.34) c.fillRect(x, y, 2, 2);
  }
}

export const STAR_N = 1500;
export const starTex = canvasTex(64, (c, S) => {
  const g = c.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
});
export const starMat = new THREE.PointsMaterial({
  size: 0.42, sizeAttenuation: true, map: starTex, vertexColors: true,
  transparent: true, opacity: 0.92, depthWrite: false,
  blending: THREE.AdditiveBlending, fog: false });

// construye domo + estrellas + PMREM del nivel actual (llamar con `world` ya limpio)
export function buildSky(def) {
  const SKY = def.sky;
  let tex;
  if (SKY.code) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const cc = cv.getContext('2d');
    codeCanvasDraw(cc, 128, 0);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    levelFx.push((dt, t) => { // parpadeo throttle 0.14 s (~9 frames a 60)
      levelFx._t = (levelFx._t || 0) + 1;
      if (levelFx._t % 9 === 0) {
        codeCanvasDraw(cc, 128, t); // clock del loop (avanza también en pausa/menú)
        tex.needsUpdate = true;
      }
    });
  } else {
    tex = mkGradientTex(SKY.stops, def.pal.noise);
  }
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  world.add(sky);

  if (SKY.stars) { // cascarón esférico 72-138 m (bajo el far plane), como el cielo madre
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(STAR_N * 3), col = new Float32Array(STAR_N * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const rad = rand(72, 138), r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * r * rad;
      pos[i * 3 + 1] = u * rad;
      pos[i * 3 + 2] = Math.sin(th) * r * rad;
      const k = Math.random();
      if (k > 0.86) tmp.setRGB(1.7, 1.15, 0.75);          // cálidas
      else if (k > 0.55) tmp.setRGB(0.95, 1.3, 1.9);      // azules
      else tmp.setRGB(1.35, 1.5, 1.65);                   // blancas
      tmp.multiplyScalar(rand(0.4, 1.15)); // parte queda bajo el threshold: no todo titila en HDR
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const st = new THREE.Points(geo, starMat); // starMat es compartido y sobrevive al dispose
    st.renderOrder = -1;
    world.add(st);
  }

  // entorno PMREM a partir del propio gradiente: reflejos sutiles en PBR. La textura
  // PMREM es del nivel → se disposea en el rebuild (era leak silencioso si no).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  levelRes.push(scene.environment);
}

