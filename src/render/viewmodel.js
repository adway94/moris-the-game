import * as THREE from '../three.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { makeWeaponSprite } from '../art/weapons.js';
import { SPEED, curWeapon, player } from '../core/player.js';
import { bloomOn, composer } from '../render/pipeline.js';
import { camera, scene } from '../render/scene.js';
import { WEAPONS, applyCrosshair } from '../weapons/tables.js';

/* ============================================================ E4a — weapon viewmodel
   El rifle 3D de cubos sale del juego: el viewmodel ahora es PIXELADO con
   sprites.js:makeWeaponSprite (una silueta por arma, ver WEAPONS.silhouette/accent) y
   vive en una ESCENA SEPARADA (vmScene) con cámara propia (vmCam), NO en la escena
   principal:
   - Render: vmPass entra al composer DESPUÉS de RenderPass con clear=false (por dentro
     three hace renderer.autoClear=false) + clearDepth=true (renderer.clearDepth() antes
     de pintar): el viewmodel se dibuja ENCIMA de la geometría, con el depth buffer del
     mundo borrado → riesgo E2 de "que no lo tape la geometría" resuelto por diseño.
     Como entra al MISMO render target: hereda la pixelación retro (~270p) y el bloom
     (el fogonazo suma glow) — unified look Boltgun. Sin retro Y sin bloom (path directo
     renderer.render) el loop hace el mismo truco a mano: autoClear=false + clearDepth.
   - La cámara NO es padre de nada: el arma no se "pega" a camera; vmCam queda quieta y
     el sway/kick se aplican a vmRoot (más determinista y a cero costo de matrices).
   - MUZZLE (world, para el origen del tracer) y flashLight (luz que sí ilumina el mundo)
     siguen colgando de un ancla invisible bajo la cámara. */
export const vmScene = new THREE.Scene();
export const vmCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
// QA E4b (polish 4a): baseX/baseY ya no son mágicos fijos — vmFit() los deriva del aspect
// real de vmCam (se llama al arrancar y en cada resize). Los valores acá son solo el
// punto de partida del primer frame (16:9).
export const VM = { root: new THREE.Group(), baseX: 0.164, baseY: -0.056, baseZ: -0.34, mesh: null };
vmScene.add(VM.root);

// fogonazo del viewmodel: quad ADITIVO que vive 1 frame por disparo (flashT). Se
// reposiciona en cada disparo sobre la boca de la silueta activa (frame `muzzle` de
// sprites.js: px de canvas → unidades del viewmodel con la misma regla de VM_VH).
export const flashCv = document.createElement('canvas');
flashCv.width = flashCv.height = 64;
{
  const fc = flashCv.getContext('2d');
  const grad = fc.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,170,60,0.7)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  fc.fillStyle = grad; fc.fillRect(0, 0, 64, 64);
}
export const flashTex = new THREE.CanvasTexture(flashCv);
export const vmFlash = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false }));
vmFlash.visible = false; vmFlash.renderOrder = 2;
vmScene.add(vmFlash);

// luz de fogonazo del MUNDO (baña de luz la arena un instante; no es del viewmodel)
export const flashLight = new THREE.PointLight(0xffc36b, 0, 18, 2);
export const muzzleAnchor = new THREE.Object3D(); // local a la cámara: boca de disparo "world"
muzzleAnchor.position.set(0.18, -0.12, -0.6);
muzzleAnchor.add(flashLight);
camera.add(muzzleAnchor);
scene.add(camera);
export function muzzleWorld(out) {
  return out.setFromMatrixPosition(muzzleAnchor.matrixWorld);
}

// E8-polish(b) (adaptado E4a): con bloom APAGADO no hay umbral 0.75 que se "coma" el
// HDR: el quad del fogonazo y la luz bajan a ≤1 (mismo matiz, sin glow → sin quema).
// El riel 3D del rifle ya no existe (el acento del viewmodel es parte del pixel-art).
export const FLASH_BASE = new THREE.Color(0xffffff);
export function applyGunGlow() {
  vmFlash.material.color.copy(FLASH_BASE).multiplyScalar(bloomOn ? 2.4 : 1.4);
  flashLight.color.set(0xffc36b);
  flashLight.intensity = Math.min(flashLight.intensity, bloomOn ? 46 : 26);
}
applyGunGlow(); // estado inicial acorde al bloom (on por default)

// un viewmodel por arma: texture Nearest (crunch) + quad con alphaTest 0.5 (el arte es
// 100% opaco → bordes duros sin halo) + boca de fogonazo en celdas lógicas de la silueta
// QA E4b (polish 4a): 12% más chico (0.34 → 0.30). Con el alto viejo el sprite ocupaba
// ~87% del alto de vmCam y el baseY fijo lo colgaba del centro: a 270p se veía "centrado
// y cortado abajo". vmFit() ancla el cuadro abajo-derecha según el aspect de vmCam.
export const VM_VH = 0.30; // alto del viewmodel en unidades de vmCam
export function vmFit() { // se llama al arrancar y en resize (vmCam.updateProjectionMatrix dixit)
  const halfH = Math.tan(THREE.MathUtils.degToRad(vmCam.fov / 2)) * Math.abs(VM.baseZ);
  const vw = VM_VH * 96 / 72; // todas las siluetas comparten la grilla lógica 96×72
  VM.baseY = -(halfH - VM_VH / 2) - 0.010; // sentado al borde inferior (sangrado ~3%: roza, no se corta)
  VM.baseX = Math.max(0.08, halfH * vmCam.aspect - vw / 2 + 0.015); // idem contra el borde derecho
}
vmFit();
export const VM_MODELS = {};
export function vmModel(id) {
  if (!VM_MODELS[id]) {
    const W = WEAPONS[id];
    const art = makeWeaponSprite(W.silhouette || 'pistol', W.accent || '#54f0ff');
    const tex = new THREE.CanvasTexture(art.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const vh = VM_VH, vw = vh * art.canvas.width / art.canvas.height;
    VM_MODELS[id] = {
      mesh: new THREE.Mesh(new THREE.PlaneGeometry(vw, vh),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: false, fog: false })),
      // canvas → unidades: con vh para H celdas lógicas, cada celda mide vh/H
      muzzle: [vh * art.muzzle[0] / (art.canvas.width / 3) - vw / 2,
               vh / 2 - vh * art.muzzle[1] / (art.canvas.height / 3)],
      flashS: vh * 0.22,
    };
  }
  return VM_MODELS[id];
}
// troca: el mesh cambia AL INSTANTE (misma raíz → el sway/kick no se reinician)
export function applyViewModel(id) {
  const m = vmModel(id).mesh;
  if (VM.mesh !== m) { VM.root.remove(VM.mesh); VM.root.add(m); VM.mesh = m; }
}
applyViewModel(player.weaponId); // vecinal al arrancar
applyCrosshair(player.weaponId); // crosshair inicial acorde al arma

// sway idle con la velocidad + retorno al centro (bobT lo maneja update()) + kick por
// disparo (retroceso pos/rot que decae en 0.12 s — player.vmKick). player.vel se lee
// acá (se declara arriba); vmCam es fija: TODO el movimiento vive en VM.root.
export function updateViewmodel(dt, moving) {
  const W = curWeapon();
  bobT += dt * (moving ? 9 + player.vel.length() : 2); // reloj del idle (antes en update)
  const speed = player.vel.length();
  const bobAmp = 0.006 + Math.min(speed / SPEED, 1) * 0.011;
  const bobX = Math.cos(bobT * 0.5) * bobAmp * (moving ? 1 : 0.25);
  const bobY = Math.sin(bobT) * bobAmp * (moving ? 1 : 0.25);
  const k = Math.min(1, dt * 10);
  VM.root.position.x += (VM.baseX + bobX - VM.root.position.x) * k;
  VM.root.position.y += (VM.baseY + bobY - VM.root.position.y) * k;
  const kick = (W.kick || 0.04) * player.vmKick;
  VM.root.position.z += (VM.baseZ + kick - VM.root.position.z) * Math.min(1, dt * 18);
  VM.root.rotation.z += (bobX * 0.4 - VM.root.rotation.z) * k; // lean strafe
  VM.root.rotation.x = -kick * 3.2 + player.recoilPitch * 1.6; // rot del kick + patada
  if (player.vmKick > 0) player.vmKick = Math.max(0, player.vmKick - dt / 0.12);
}

// El pase del viewmodel entra al composer DESPUÉS del RenderPass de la escena (index 1,
// antes de bloom/output — el fogonazo suma glow y el todo se pixela junto).
// clear=false: RenderPass pone renderer.autoClear=false por dentro y pinta sin limpiar.
// clearDepth=true: renderer.clearDepth() antes → el depth del mundo se borra y el
// viewmodel NUNCA es tapado por geometría (riesgo conocido del E2, resuelto acá).
// VERIFICADO E4b (riesgo anotado en E4a): el toggle T hace composer.reset(nuevoTarget),
// y en r160 reset() SOLO re-asigna renderTarget1/2 y read/writeBuffer — la lista `passes`
// no se toca, así que vmPass (insertPass index 1) sobrevive el swap de targets; resize
// re-sizea todos los passes por igual. Además RenderPass.render restituye autoClear al
// salir (fuente en vendor/) → el RenderPass de la escena sigue limpiando el RT cada frame
// y no hay acumulación. Si algo de esto se rompe en una upgrade de three: la arena deja
// de limpiar y el viewmodel desaparece al tocar T — dos síntomas imposibles de pasar por alto.
export const vmPass = new RenderPass(vmScene, vmCam);
vmPass.clear = false;
vmPass.clearDepth = true;
composer.insertPass(vmPass, 1);

export let bobT = 0;
