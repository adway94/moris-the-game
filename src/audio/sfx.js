import { portal } from '../core/state.js';

/* ============================================================ audio (WebAudio procedural, sin assets) */
export const Sfx = {
  ctx: null, noiseBuf: null, master: null,
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.25;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  env(node, t0, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g); g.connect(this.master);
    return g;
  },
  noise(dur, peak, freq, q = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    src.connect(f); this.env(f, t0, peak, dur);
    src.start(t0); src.stop(t0 + dur + 0.02);
  },
  tone(type, f0, f1, dur, peak) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    this.env(o, t0, peak, dur);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  // E6b — curva de saturación LIGERA (tanh suave) para el sting del jefe: ensucia el
  // grave sin tapar el juego. Cacheada: la misma Float32Array para todos los shapers.
  _distCurve: null,
  distCurve() {
    if (!this._distCurve) {
      const n = 257, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 2.2); }
      this._distCurve = c;
    }
    return this._distCurve;
  },
  // E6b — como tone() pero pasa por el WaveShaper: grave "sucio" para el sting.
  distTone(type, f0, f1, dur, peak) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.distCurve(); ws.oversample = '2x';
    o.connect(ws); this.env(ws, t0, peak, dur);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  // E4a — disparo distintivo por arma (WebAudio corto, retro). `shoot` era el crack
  // genérico del rifle: pasa a llamarse shootVecinal y cada arma suma el suyo.
  shootVecinal(){ this.noise(0.09, 0.5, 1900, 0.8); this.tone('sine', 120, 40, 0.07, 0.4); },
  shootShotgun(){ this.noise(0.2, 0.62, 480, 0.5); this.noise(0.08, 0.4, 1500, 0.7);
                  this.tone('sawtooth', 95, 32, 0.22, 0.5); },                    // boom grave
  shootSmg()    { this.noise(0.05, 0.4, 2400, 1.1); this.tone('square', 240, 90, 0.045, 0.3); }, // staccato
  shootFist()   { this.noise(0.07, 0.3, 700, 0.6); this.tone('triangle', 200, 70, 0.06, 0.25); }, // soplo
  meleeHit()    { this.noise(0.04, 0.4, 1100, 1.2); this.tone('square', 320, 120, 0.04, 0.2);
                  this.tone('sine', 150, 52, 0.08, 0.32); }, // caricia + E11: whack CON cuerpo (el golpe grave abajo)
  flame()       { this.noise(0.13, 0.2, 260 + Math.random() * 200, 0.5);
                  this.tone('sine', 60, 40, 0.1, 0.12); },                          // ruido marrón filtrado (tic a tic)
  rocketFire()  { this.noise(0.3, 0.4, 900, 0.6); this.tone('sine', 700, 140, 0.28, 0.35); },     // whoosh
  explosion()   { this.noise(0.45, 0.7, 180, 0.4); this.tone('sawtooth', 110, 28, 0.4, 0.5);
                  this.noise(0.15, 0.4, 600, 0.6); },                               // boom
  // E4b — sonidos propios de los slots 6-9. railCharge dura lo mismo que W.chargeT: la
  // barra que se ve en el crosshair (#railring) es la misma barra AUDIBLE; sueltas antes
  // de la subida y no hay crack. shootTwin se dispara una vez POR CAÑÓN: el "doble boom"
  // del changó sale del burst real de dos escopetazos a 0.25 s.
  shootPlasma() { this.tone('sine', 1250, 260, 0.09, 0.28); this.noise(0.03, 0.12, 2600, 2); }, // bleep "pew"
  shootTwin()   { this.noise(0.18, 0.6, 430, 0.5); this.tone('sawtooth', 88, 30, 0.2, 0.48); }, // boom corto por cañón
  railCharge()  { this.tone('sawtooth', 90, 820, 0.35, 0.18);
                  this.noise(0.35, 0.1, 1200, 1.5); },                              // turbina que sube
  railFire()    { this.noise(0.12, 0.7, 3400, 1.8); this.tone('sawtooth', 1600, 70, 0.22, 0.5);
                  this.noise(0.25, 0.35, 500, 0.7); },                              // crack eléctrico
  bfgFire()     { this.noise(0.35, 0.22, 240, 0.5); this.tone('sine', 180, 40, 0.3, 0.14); }, // exhalación de humo
  bfgBoom()     { this.noise(0.8, 0.7, 110, 0.35); this.tone('sawtooth', 70, 16, 0.85, 0.55);
                  this.tone('sine', 44, 14, 0.95, 0.5); },                          // detonación grave
  weaponGet()   { [523, 659, 784, 1046].forEach((f, i) =>                           // OBTENIDA: fanfarria
                  setTimeout(() => this.tone('triangle', f, f, 0.12, 0.2), i * 70)); },
  // E11 — game feel de impacto (todos <120 ms, sin assets): hitTick es un tick seco con
  // pitch ±8% random (la cadencia de ametralladora no fatiga el oído); bossThud es el
  // "tick" del jefe: grave y sutil, el jefe COME los ticks normales. kill = crunch sordo
  // + blip ascendente (confirmation punch); killBoss = thud grave distinto. El anti-spam
  // (1 por frame + gap 50 ms) vive en feedbackHit, no acá.
  hitTick()  { const p = 1 + (Math.random() * 0.16 - 0.08);
               this.noise(0.03, 0.17, 2600 * p, 2.5); this.tone('square', 1350 * p, 950 * p, 0.03, 0.1); },
  bossThud() { this.tone('sine', 230, 96, 0.055, 0.12); this.noise(0.05, 0.09, 420, 1.2); },
  kill()     { this.noise(0.055, 0.42, 340, 0.7); this.tone('sine', 95, 42, 0.09, 0.4);
               setTimeout(() => this.tone('triangle', 430, 880, 0.08, 0.16), 40); },  // crunch + blip up
  killBoss() { this.tone('sine', 120, 26, 0.16, 0.5); this.noise(0.1, 0.34, 210, 0.6);
               setTimeout(() => this.tone('sawtooth', 180, 60, 0.1, 0.18), 60); },    // thud grave + arrastre
  hurt()   { this.tone('sine', 160, 50, 0.3, 0.35); this.noise(0.1, 0.25, 300, 0.7); },
  reload() { this.tone('triangle', 300, 300, 0.03, 0.2); setTimeout(() => this.tone('triangle', 480, 480, 0.03, 0.2), 160); },
  // E4a — troque de arma: clac retro de dos tiempos (cerrojo). deny: slot vacío/no owned.
  switchSnd(){ this.noise(0.02, 0.25, 2200, 2.5);
               setTimeout(() => this.tone('square', 520, 660, 0.035, 0.18), 45); },
  deny()   { this.tone('square', 190, 150, 0.09, 0.22); },                          // beep breve
  overheat(){ this.noise(0.5, 0.3, 2400, 0.8); this.tone('sine', 220, 60, 0.4, 0.22); }, // siseo de caldera
  // E3 — un blip por categoría de pickup (cortos, estilo retro, se distinguen con la música off):
  pickupLife()  { this.tone('sine', 523, 523, 0.06, 0.22); setTimeout(() => this.tone('sine', 784, 830, 0.1, 0.2), 70); },
  pickupArmor() { this.noise(0.03, 0.16, 2600, 3); this.tone('square', 196, 196, 0.04, 0.14); setTimeout(() => this.tone('square', 392, 392, 0.07, 0.14), 60); },
  pickupAmmo()  { this.noise(0.025, 0.18, 1500, 2); setTimeout(() => { this.noise(0.025, 0.15, 2000, 2); this.tone('triangle', 660, 660, 0.05, 0.18); }, 70); },
  dry()         { this.noise(0.02, 0.14, 2800, 3); this.tone('square', 150, 70, 0.03, 0.1); }, // aguja percutida: pool vacío
  wave()   { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.tone('triangle', f, f, 0.16, 0.18), i * 110)); },
  death()  { this.tone('sawtooth', 300, 30, 1.1, 0.3); this.noise(0.8, 0.25, 220, 0.5); },
  // E5 — campaña: el lamento grave del mini-jefe. E6b lo dejó en sting de 0.8 s con
  // distorsión ligera (distTone) y NOTA DISTINTA por jefe, de grave a más grave:
  // criopylot G1 arrancando · huerta C2 groan vegetal · fundidor E1 martillo de fragua ·
  // confesor A2 réquiem desafinado a dos voces · moris9 barrido digital 520→52.
  bossSpawn(id = 'elite') {
    if (id === 'criopylot') { // rotor criogénico que arranca y se muere + silbido de presión
      this.distTone('sawtooth', 98, 40, 0.8, 0.4);
      this.noise(0.55, 0.16, 900, 1.3);
    } else if (id === 'huerta') { // groan de tallo gigante + burbuja de savia a media queja
      this.distTone('sine', 65, 29, 0.8, 0.5);
      setTimeout(() => this.noise(0.18, 0.2, 420, 3), 320);
    } else if (id === 'fundidor') { // yanzuqueada: golpe grave + siseo de colada
      this.distTone('square', 82, 27, 0.7, 0.34);
      this.noise(0.7, 0.22, 200, 0.5);
      setTimeout(() => this.noise(0.16, 0.18, 2200, 1), 240);
    } else if (id === 'confesor') { // dos senos graves desafinados que baten (réquiem corto)
      this.distTone('sine', 110, 55, 0.8, 0.3);
      this.distTone('sine', 116, 52, 0.8, 0.26);
    } else if (id === 'moris9') { // barrido digital + sub-grave + chispa de datos final
      this.distTone('square', 520, 52, 0.8, 0.28);
      this.distTone('sine', 42, 30, 0.8, 0.45);
      setTimeout(() => this.noise(0.12, 0.15, 3200, 2), 480);
    } else { // elite genérico heredado de E5 (fallback: sin flujo propio en campaña)
      this.tone('sawtooth', 70, 46, 1.2, 0.4); this.noise(1.0, 0.2, 160, 0.5);
      setTimeout(() => this.tone('sawtooth', 58, 40, 1.0, 0.32), 240);
    }
  },
  // E6 — bestiario: sonidos cortos por conducta nueva (todos distinguibles del arsenal).
  boltFire()  { this.tone('triangle', 340, 120, 0.09, 0.16); this.noise(0.05, 0.1, 1200, 1.5); },   // bolt enemigo (lancellas/espectro/jefes)
  sporePop()  { this.noise(0.16, 0.2, 520, 0.7); this.tone('sine', 130, 55, 0.14, 0.14); },          // nube de esporas que estalla
  hazardTick(){ this.noise(0.12, 0.1, 700, 0.8); },                                                   // pisar veneno/lava (el hurt() pone el dolor)
  blink()     { this.tone('sine', 900, 180, 0.12, 0.16); this.noise(0.06, 0.14, 2600, 2.5); },        // teletransporte (posesivo/confesor)
  glitchZip() { this.noise(0.05, 0.16, 1700 + Math.random() * 1600, 3); },                            // saltito discreto del glitch
  phaseUp()   { this.tone('sawtooth', 220, 733, 0.35, 0.28); this.noise(0.25, 0.15, 1400, 1); },      // el jefe entra en fase
  dash()      { this.tone('sawtooth', 210, 48, 0.3, 0.38); this.noise(0.5, 0.3, 600, 1.6); },          // embestida: rugido corto de arranque (fix WIP: se llamaba sin definir)
  portal() { this.tone('triangle', 90, 460, 0.55, 0.3); this.noise(0.5, 0.22, 900, 1.2); },
  // E5 — respawn por vidas: "reinicio sectorial" (barrido corto de subida + clac).
  respawn() { this.tone('square', 140, 620, 0.22, 0.2); this.noise(0.18, 0.2, 1400, 1.5); },
};

