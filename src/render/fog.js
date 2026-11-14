import { $ } from '../core/utils.js';

/* ============================================================ banded fog (E1)
   Profundidad por pasos estilo Doom/Boltgun: en vez del gradiente suave de FogExp2,
   el factor de niebla del material se cuantiza a FOG_BANDS bandas. onBeforeCompile
   reemplaza el chunk fog_fragment por la misma fórmula de three r160 (sigue usando
   los uniforms fogColor/fogDensity que provienen de scene.fog: la atmósfera y el
   color NO cambian — y en E5, scene.fog se retoca POR NIVEL en buildArena).
   E5: ya no se aplica con un scene.traverse de módulo — buildArena parcha el mundo
   recién construido al final (cielo+estrellas viven con fog:false y se saltan).
   Arma, FX, pickups y enemigos sprite (E2) NO se parchan. Ojo r160: el cache de
   programas NO distingue materiales por su onBeforeCompile, así que
   customProgramCacheKey aísla esta variante de cualquier material sin parchar que
   comparta defines. */
export const FOG_BANDS = 8; // 8 bandas en todo el rango de la niebla: pasos visibles, aún legible
export function bandedFog(mat) {
  if (!mat || mat.fog === false || mat.userData.bandedFog) return mat;
  mat.userData.bandedFog = true; // materiales compartidos (wallMat/obMat/trimMat): 1 parche
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        #endif
        fogFactor = floor( fogFactor * ${FOG_BANDS.toFixed(1)} ) / ${FOG_BANDS.toFixed(1)};
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      #endif`);
  };
  mat.customProgramCacheKey = () => 'bandfog' + FOG_BANDS;
  return mat;
}

