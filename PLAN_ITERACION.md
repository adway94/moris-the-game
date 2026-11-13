# MORIS // ARENA — Iteración "boomer shooter" (plan nocturno)

Pedido de Alejandro (madrugada 12→13/11): pasar el wave-shooter a un **shooter por niveles con historia**, estética **retro-pixelada estilo Doom / Warhammer 40k Boltgun** (sprites 2D pixelados para enemigos + entorno 3D low-poly crunchy), **5 niveles conectados** cada uno con mapa característico y enemigos propios, y **sistema de recursos tipo Doom**: ~10 armas coleccionables, vida/armadura/escudo, munición por tipo. Trabajar etapa por etapa, sin apuro, validar cada una.

## Referencia estética (investigada)
- Boltgun: sprites 2D pixelados para enemigos/manos/arma (render high-poly → bajado a sprite de baja resolución), entornos 3D de mayor fidelidad pero crunchy; banded depth-fog por pasos (no gradiente suave); partículas modernas encima del look retro.
- Implementación three.js: renderizar escena a target de baja resolución y escalar con nearest-neighbour = pixelación global barata y fiel. Enemigos como **sprites billboard** (canvas pixel-art, un plano facing-camera) en vez de meshes 3D → look Doom real.

## Historia conductual (hilo que conecta los 5 niveles)
"EL ÚLTIMO SECTOR": sos un centinela criogénico que despierta en una estación orbital invadida por una plaga biomecánica. Cada nivel es una sección de la estación que se destruye/abre al final → avanzás "hacia abajo" hacia el núcleo. Notas de terminal entre niveles (texto corto, sin cutscenes) dan contexto conductual: la IA de la estación (MORIS-9) te guía y mentiría al final.

| # | Nivel | Mapa característico | Enemigos propios | Arma que desbloquea |
|---|-------|--------------------|------------------|---------------------|
| 1 | Criopods / hangar destartalado, metal gris+cian | pasillo industrial, crio-cápsulas | Drones rojos (heredados) + Rastreadores | Pistola (inicial), Escopeta al final |
| 2 | Invernadero invadido: vegetación tóxica verde/magenta, enredaderas | bosque-jardín con pilares-orgánicos | Esporas voladoras + Bestias enredadera | Metralleta / Lanza llamas |
| 3 | Reactor: lava/energía naranja, pasarelas metálicas, calor | sector industrial fundido | Blindados pesados + torretas | Lanzacohetes / Cañón de plasma |
| 4 | Cripta arcaica: piedra+neón violeta, estátuas, oscuridad | templo alien | Espectros atravesables + Poseídos | Escopeta doble / Railgun |
| 5 | Núcleo MORIS-9: glitch digital cian/negro, geometría imposible | cyberspace con cubos flotantes | Clones del jugador + Jefe final MORIS-9 | BFG local ("Compilador") |

Cada nivel termina al matar la oleada+mini-boss → puerta se abre → nota de terminal → siguiente. Muerte = reinicia el nivel actual (checkpoint), no todo.

## Sistema de recursos tipo Doom
- **Vida** 0-100 (no regen; pickups +25/+50 y drops). **Armadura/escudo** 0-100 absorbe % del daño (pickups shard/helmet/chest).
- **Munición por tipo**: balas, cartuchos, cohetes, células — cada arma consume la suya; pickups y drops de enemigos. Sin munición = el puño/melee funciona siempre (respeta "1 arma" inicial: melee es el fallback).
- **~10 armas** desbloqueables en el camino (no todas disponibles desde 0): Pistola, Escopeta, Metralleta, Llama, Cohetes, Plasma, Doble escopeta, Railgun, BFG, + melee. Empiezas con Pistola+melee.

## Estética técnica (pipeline)
1. **Pixelación global**: WebGLRenderTarget a ~1/3 resolución + upscale nearest-neighbour en pase final → crunch Doom sin tocar assets.
2. **Enemigos sprite billboard**: cada tipo = canvas pixel-art generado (paleta limitada, ~48px de alto), plano que siempre mira a cámara, flip por lado, animación 2-3 frames por sprite-sheet canvas. Mantiene IA existente (steering) pero render flat → look Boltgun.
3. **Banded fog**: reemplazar FogExp2 suave por bandeo por pasos en el shader de entorno (o quantize del factor de niebla en material onBeforeCompile).
4. Arma en primera persona: viewmodel con textura pixelada + idle bob 2 frames (Doom).

## ETAPAS (una por una, commit al validar cada una)
- **E1 — Pipeline retro**: render-to-target + upscale nearest-neighbour (toggle R para comparar), banded fog. Validar visual + FPS no se hunde. NO toca gameplay.
- **E2 — Enemigos sprite billboard**: convertir los 3 tipos actuales a sprites pixel-art canvas con animación y flip. Mantener hitboxes/IA. Validar kills siguen funcionando.
- **E3 — Sistema de recursos**: vida/armadura/munición tipada + pickups + HUD Doom-like (barra doble, contador arma+munición). Quitar regen actual.
- **E4 — Arsenal 10 armas**: datos por arma (daño, cadencia, spread, tipo munición, retroceso, sprite viewmodel), desbloqueo, cambio con rueda/teclas 1-0/gamepad dpad. Rebalancear enemigos contra armas.
- **E5 — Motor de niveles + progresión**: reemplazar "oleadas infinitas" por LEVELS[] con spawn scriptado por nivel, mapa característico (paleta+geometría+cielo distintos), mini-boss, puerta de salida, checkpoint, transición con nota de terminal.
- **E6 — Enemigos por nivel**: tipos nuevos (esporas, blindados, torretas, espectros, clones, jefe) con sprites propios y conducta distinta; los heredados pueblan nivel 1.
- **E7 — Historia conductual**: notas de terminal MORIS-9 entre niveles (texto), título por nivel, final al matar MORIS-9 en nivel 5 → pantalla de crédito. Integrar con best score.
- **E8 — Pulido + QA**: balance, audio nuevo por arma, touch/gamepad mapeados a armas (dpad),回归 test headless completo (mover/disparar/cambiar arma/matar/pasar nivel/morir/retry), screenshot por nivel para que Alejandro vea los 5 mapas.

## Reglas de trabajo
- No romper lo verificado: touch, gamepad, bloom toggle+auto-degrade, __dbg, spawn yaw 0, lane despejado, hitbox DoubleSide, HTTPS server.
- Código → opencode por etapa (spec concreta + validación node --check + commit). Yo valido en navegador real con toques/mando sintético y screenshots antes de pasar de etapa.
- Cada etapa = un commit. Si una etapa queda trancada, la dejo marcada acá con el porqué y sigo con la siguiente independiente.

## Estado (ir actualizando)
- [ ] E1 pipeline retro
- [ ] E2 enemigos sprite
- [ ] E3 recursos vida/escudo/munición
- [ ] E4 arsenal 10 armas
- [ ] E5 niveles + progresión
- [ ] E6 enemigos por nivel
- [ ] E7 historia MORIS-9
- [ ] E8 pulido + QA
