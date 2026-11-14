import * as THREE from '../three.js';
import { ARENA } from '../core/world.js';
import { scene } from '../render/scene.js';

/* lights: EL RIG es fijo (no se recrea entre niveles — sin leak de shadow maps), pero
   colores/intensidades los fija configureLights(def) por paleta (N4 baja la ambiental y
   sube los emisivos: "casi sin luz"). Se declaran acá porque buildArena los configura. */
export const hemi = new THREE.HemisphereLight(0x4a6ea8, 0x0e1424, 1.7);
scene.add(hemi);
export let sun, rimCyan, rimMagenta;
export function configureLights(def) {
  const L = def.light; // [hemi[cielo, suelo, int]] [sun[color, int]] [rim cian, rim magenta, int, int]
  hemi.color.set(L[0][0]); hemi.groundColor.set(L[0][1]); hemi.intensity = L[0][2];
  sun.color.set(L[1][0]); sun.intensity = L[1][1];
  rimCyan.color.set(L[2][0]); rimCyan.intensity = L[2][2];
  rimMagenta.color.set(L[2][1]); rimMagenta.intensity = L[2][3];
}

// rim lights: crecen ACÁ (el rig lo configura configureLights por paleta), decay 2,
// sin sombras. Altos y sobre la altura de muros: bañan de color los bordes sin quemar.
sun = new THREE.DirectionalLight(0xbfd8ff, 2.6);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.camera.far = 90;
scene.add(sun);
rimCyan = new THREE.PointLight(0x2ad4ff, 95, 0, 2);
rimCyan.castShadow = false;
rimCyan.position.set(-ARENA + 6, 12, -ARENA + 6);
rimMagenta = new THREE.PointLight(0xff3bd8, 80, 0, 2);
rimMagenta.castShadow = false;
rimMagenta.position.set(ARENA - 6, 12, ARENA - 6);
scene.add(rimCyan, rimMagenta);

