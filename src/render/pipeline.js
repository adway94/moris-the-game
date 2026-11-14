import * as THREE from '../three.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { maxDpr } from '../core/mode.js';
import { clamp } from '../core/utils.js';
import { camera, renderer, scene } from '../render/scene.js';
import { applyGunGlow, vmCam, vmFit } from '../render/viewmodel.js';

/* ============================================================ post-processing
   RenderPass (HDR) -> UnrealBloomPass -> OutputPass (tonemap + sRGB).
   Con composer el tonemap/sRGB del renderer NO se aplica en los pases intermedios
   (solo OutputPass al screen), por eso el neón HDR atraviesa el umbral 0.75 y hace
   bloom real.

   PIPELINE RETRO E1 (toggle T): el composer renderiza la escena a un framebuffer
   interno de altura fija ~270 px y el último pase lo estira al canvas con filtrado
   NEAREST: poniendo NearestFilter en los RT del composer, el quad de OutputPass es en
   sí el upscale — pixelación Doom/Boltgun sin pases ni shaders extra.
   - Resolución interna = px de dispositivo / divisor ENTERO (retroSize): pixeles siempre
     cuadrados (sin shimmer al moverse) y ~270p sin importar devicePixelRatio.
   - Retro baja además el MSAA (samples 0): bordes duros crunchy, que es el look; el
     modo normal (T off) vuelve a dpr ≤ MAX_DPR + MSAA x4, idéntico a pre-E1.
   - samples es inmutable en un WebGLRenderTarget: el toggle intercambia los targets
     internos con composer.reset() (en r160 clone()/reset() preservan samples y
     filtros de la textura). */
export let retroOn = true;   // default: retro ON (nueva estética); T la alterna
export const RETRO_H = 270;  // altura objetivo del buffer interno (~270p, crunch más agresivo)

// un RT para cada ping-pong del composer: HalfFloat (el HDR debe llegar intacto
// al bloom). Filtros y MSAA según el modo: retro Nearest/sin MSAA, normal Linear/x4.
export function makeComposerTarget() {
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType, samples: retroOn ? 0 : 4,
  });
  const f = retroOn ? THREE.NearestFilter : THREE.LinearFilter;
  rt.texture.magFilter = f; rt.texture.minFilter = f; rt.texture.generateMipmaps = false;
  return rt;
}

// canvas en px de dispositivo dividido por un factor ENTERO que deja la altura en
// ~RETRO_H (270p). Preferencia: f = k·dpr con k entero → cada pixel interno cubre k px
// CSS exactos en ambos ejes (upscale nearest parejo, sin filas/columnas de grosor
// irregular). Si el dpr es fraccional y k·dpr no sale entero ("no entra"), se hace
// floor(devH/RETRO_H): el entero más cercano SIN pasar la altura objetivo.
export function retroSize() {
  const dpr = maxDpr();
  const devW = Math.max(2, Math.round(innerWidth * dpr));
  const devH = Math.max(2, Math.round(innerHeight * dpr));
  let f = Math.round(dpr * clamp(Math.round(devH / (RETRO_H * dpr)), 1, 16));
  if (!Number.isInteger(f) || f < 1) f = clamp(Math.floor(devH / RETRO_H), 1, 16);
  return [Math.max(2, Math.round(devW / f)), Math.max(2, Math.round(devH / f))];
}

export const composer = new EffectComposer(renderer, makeComposerTarget());
composer.addPass(new RenderPass(scene, camera));
// bloom a MEDIA resolución: la pirámide de mip de UnrealBloomPass arranca en 1/2 del
// buffer efectivo -> cada uno de sus ~11 fullscreen passes cuesta 1/4. Clave para PCs
// flojos / SwiftShader, donde el composer a resolución completa hundía el FPS.
// Con retro activo la pirámide arranca de los ~270p: bloom muy barato.
export const BLOOM_SCALE = 0.5;
export const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth * BLOOM_SCALE, innerHeight * BLOOM_SCALE), 0.55, 0.6, 0.75);
// addPass y composer.setSize siempre llaman pass.setSize(effectiveW, effectiveH) a
// tamaño completo; se intercepta para que la pirámide quede siempre a media resolución.
export const bloomSetSizeFull = bloomPass.setSize.bind(bloomPass);
bloomPass.setSize = (w, h) =>
  bloomSetSizeFull(Math.max(1, Math.round(w * BLOOM_SCALE)), Math.max(1, Math.round(h * BLOOM_SCALE)));
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// tamaños: retro → pixelRatio 1 y tamaño lógico = resolución baja (el buffer interno
// queda exactamente en low-res; el canvas conserva sus px nativos y OutputPass estira
// con nearest). Normal → el pixelRatio del renderer (dpr cap MAX_DPR) y tamaño CSS,
// como antes del E1. setPixelRatio internamente re-sizea; el setSize que sigue fija
// el tamaño lógico definitivo en ambos modos.
export function applyComposerSize() {
  if (retroOn) {
    const [w, h] = retroSize();
    composer.setPixelRatio(1);
    composer.setSize(w, h);
  } else {
    composer.setPixelRatio(maxDpr());
    composer.setSize(innerWidth, innerHeight);
  }
}
export function setRetro(on) {
  if (on === retroOn) return;
  retroOn = on;
  composer.reset(makeComposerTarget()); // swap de targets: samples/filtros del nuevo modo
  applyComposerSize();
}
applyComposerSize(); // normaliza los tamaños iniciales (arranca en retro)

/* bloom on/off: off desactiva el pase de bloom (bloomPass.enabled en el loop). Con
   retro sigue haciendo falta el composer (el upscale nearest vive en su último pase);
   sin retro Y sin bloom se va directo por renderer.render (en screen el renderer
   aplica ACES + sRGB, misma terminación que OutputPass). */
export let bloomOn = true;
export function setBloom(on) { bloomOn = on; applyGunGlow(); }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  vmCam.aspect = innerWidth / innerHeight; // E4a: la cámara del viewmodel también
  vmCam.updateProjectionMatrix();
  vmFit(); // E4b: el ancla abajo-derecha se re-deriva con el aspect nuevo
  const pr = maxDpr(); // mismo cap de dpr para renderer y composer (modo normal)
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  applyComposerSize(); // retro: re-deriva el buffer interno con el aspect/dpr nuevo
});

