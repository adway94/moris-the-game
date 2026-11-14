import * as THREE from '../three.js';
import { scene } from '../render/scene.js';

/* ============================================================ campaña: LEVELS + arena (E5)
   El viejo buildArena hardcodeado pasa a ser buildArena(levelDef): UNA FILA POR NIVEL =
   spec de mapa (geometría procedural con semilla + set de props + paleta + niebla + cielo
   + luces). Layout de cajas: mismo motor del arena madre pero con semilla por nivel
   (mulberry32 → el mismo mapa en cada visita, clave para el retry del save) y las dos
   zonas libres de siempre: spawn del jugador (sur) y antesala del portal (norte).
   Presupuesto de rendimiento (E2/E3): ≤40 props por nivel, geometría/materiales
   COMPARTIDOS por tipo de prop, y TODO lo del nivel vive en el grupo `world` con sus
   recursos registrados en `levelRes` → buildArena hace dispose limpio del nivel anterior
   (geos, mats, texturas, PMREM) antes de construir el siguiente. */
export const ARENA = 32;              // semi-lado del piso jugable
export const WALL_H = 5;
export const solids = [];             // mallas que bloquean balas (se vacía en cada build)
export const boxes = [];              // AABBs para colisión {min:Vec3, max:Vec3} (idem)
export const world = new THREE.Group(); // grupo de TODO el contenido del nivel (cielo incluido)
scene.add(world);
export let levelRes = [];             // recursos del nivel actual con .dispose() (geos/mats/textos)
export let levelFx = [];              // callbacks ambientales del nivel (lava, cubos, chispas, portal)

export function addSolid(mesh, collide = true) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  world.add(mesh); solids.push(mesh);
  if (collide) {
    mesh.updateWorldMatrix(true, false);
    const bb = new THREE.Box3().setFromObject(mesh);
    boxes.push({ min: bb.min.clone(), max: bb.max.clone() });
  }
}

// PRNG determinista (mulberry32): layouts reproducibles por nivel
export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// paleta del nivel: colores SÓLO en hex strings (los niveles viven en la tabla de abajo)
export const ownRes = r => (levelRes.push(r), r);
/* ============================================================ colisión jugador/enemigos contra AABBs */
export function pushOutOfBoxes(p, radius) {
  for (const b of boxes) {
    if (p.x > b.min.x - radius && p.x < b.max.x + radius &&
        p.z > b.min.z - radius && p.z < b.max.z + radius) {
      const dxMin = p.x - (b.min.x - radius), dxMax = (b.max.x + radius) - p.x;
      const dzMin = p.z - (b.min.z - radius), dzMax = (b.max.z + radius) - p.z;
      const m = Math.min(dxMin, dxMax, dzMin, dzMax);
      if (m === dxMin) p.x = b.min.x - radius;
      else if (m === dxMax) p.x = b.max.x + radius;
      else if (m === dzMin) p.z = b.min.z - radius;
      else p.z = b.max.z + radius;
    }
  }
}

// E10 glue: world es dueno de levelRes/levelFx; build los vacia sin reasignarlos
export function resetLevelArrays() { levelRes = []; levelFx = []; }

