import * as THREE from '../three.js';
import { maxDpr } from '../core/mode.js';

/* ============================================================ renderer / scene */
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(maxDpr());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
// niebla azulada: los objetos lejanos se funden con el horizonte del cielo
scene.fog = new THREE.FogExp2(0x081327, 0.016);

export const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 200);

