# DISEÑO — Arsenal y economía (insumo de E3/E4)

## Armas (10, desbloqueo en la historia; todas comparten viewmodel pixelado propio)
| # | Arma | Munición | Daño/shot | Cadencia | Notas | Desbloquea |
|---|------|----------|-----------|----------|-------|------------|
| 0 | Puños/Melee ∞ | — | 30 | 0.5s | siempre disponible, empujón a enemigos | inicial |
| 1 | Pistola "Vecinal" | balas | 22 | 0.22s | precisa, starter | inicial |
| 2 | Escopeta "MORIS-12" | cartuchos | 8×8 pellets | 0.85s | disperión alta, reina a corto | final N1 |
| 3 | Chauchera "Ametralladora Barrial" | balas | 15 | 0.09s | calor/heat como el rifle actual pero más bruto | N2 early |
| 4 | Lanzallamas "Asador" | células (flow, 2/s) | 9/tic corto | flujo | prende fuego: DoT 4s, los quema = drops de armadura (gloria Doom) | N2 final |
| 5 | Lanzacohetes "Kira" | cohetes | 95 splash r3m | 1.1s | splash; auto-knockback | N3 early |
| 6 | Rifle de Plasma "Mate" | células | 30 | 0.16s | proyectil lento-ish, no hitscan | N3 final |
| 7 | Escopeta Doble "Changó" | cartuchos | 14×10 | 1.2s (o 2 disparos 0.25) | dos balas por clic | N4 early |
| 8 | Railgun "Riel del Colastiné" | celdas especiales (limitada) | 160 perforante | 1.4s | atraviesa enemigos, carga 0.35s | N4 final |
| 9 | BFG local "Compilador" | argents | 300 onda | 2.0s | orbe que detona; el arma de MORIS contra MORIS | N5 medio (la da MORIS-9 — traicionera) |

Recuperables: cada arma es tuya para siempre una vez tomada; si te quedás sin mun de un tipo, el drop de enemigos cubre (~25% de los kills sueltan el tipo que más gastás — goma a prueba de pelotudos).

## Recursos (esqueleto Doom sin glory-kill; versión simple)
- **Vida** máx 100, SIN regen (sacar la actual). Pickup +25 (botiquín verde), +50 (caja roja grande, una por nivel).
- **Armadura** máx 100, absorbe 60% del daño hasta agotarse. Pickup shard +15, casco +35 (mini-boss drop).
- **Munición**: 3 pools — balas (cap 200), cartuchos (cap 60), células (cap 150) + cohetes (cap 12) + argents (cap 20, no sube). Pickups de piso por nivel + drops.
- **Drops por kill**: 35% nada, 40% bala/cartucho/célula aleatorio ponderado al gasto, 15% vida+10, 10% armadura+8. (Brutes: garantizan un pool.)
- **Muerte**: respawn en el checkpoint del nivel, conserva armas, mitad de munición, vida 100/armadura 0. 3 vidas por partida (etiqueta "SECTORES REINICIADOS"): se acaba el juego al agotarlas (game over definitivo → pantalla historia).

## Mini-boss por nivel (uno, antes de la puerta)
N1 Criopylot (droner gigante 3× droners de compañía) · N2 Padre Huerta (espántapolas, escupe enredaderas) · N3 Fundidor (brute con cañón de lava, fase 2 enloquece) · N4 El Confesor (espectro que se teletransporta + poseídos) · N5 MORIS-9 (jefe final: patrones de oleada + núcleo; la arena glitch entera es la arena del jefe).

## Niveles — geometría característica (E5)
1. **Criopods**: pasillo-losa gris+cian, cápsulas de cristal como pilares, luces parpadeantes. Niebla azulada densa.
2. **Invernadero**: verde tóxico, enredaderas (planos pixelados), charcos brillantes magenta, luz verde de dome roto. Niebla verde.
3. **Reactor**: naranjas, pasarelas angostas sobre lava emisiva (plano animado), chispas ambientales. Fog naranja.
4. **Cripta**: violeta/piedra, estátuas billboard, columnas, casi sin luz ambiente — linterna del arma (spotlight de la cámara). Fog violeta.
5. **Núcleo**: negro + grilla cian glitch, cubos flotantes que rotan, suelo tipo Tron, cielo = vacío con código. Fog cian.

Transición: matar mini-boss → puerta se abre (o ascensor) → overlay con terminal MORIS-9 (3-5 líneas, estética texto+cursor) → cargar nivel siguiente. Persistir nivel+armas en localStorage para retry.
