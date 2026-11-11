// Sound for the hidden drive on the home page, all made live with Web Audio (nothing to download but the
// night ambience the simulator already has).
//
//  - The engine: a Subaru flat-four with unequal-length headers. Its exhaust pulses reach the collector
//    off-beat: a strong pulse (two merging) and then a weaker one. That uneven beat is the deep "boiling"
//    rumble. At start-up six seamless loops are built, one for each band of revs (idle to the red line): each
//    is a train of exhaust pulses in that strong-weak pattern, every pulse a deep, clean thump with a little
//    natural variation. While driving, the two loops either side of the current revs play, pitched to the
//    exact revs and cross-faded, the way racing games do it. Everything plays on the audio system's own
//    thread, so it stays steady whatever the graphics are doing, on any page. The revs, load and gear shifts
//    come from the car's gearbox (scene.ts).
//  - A turbo: a soft spool that rises with boost, and the blow-off valve's "pssh" when you lift off.
//  - Tyres: a squeal when the car slides or runs out of grip. Barriers: a metal scrape when you rub one.
//  - The mountain at night: the simulator's night scenery loop, and wind that rises with speed.
//  - The race: a start cue, a chime at each gate, a fanfare at the finish, a fall when time runs out, and a
//    tick for each of the last five seconds.
// The audio engine only starts from a key press (browsers allow sound only after one), and it is suspended
// whenever you stop driving. M mutes; the choice is remembered.

export type Cue = "go" | "gate" | "finish" | "fail" | "tick";
export interface DriveSound {
  speed: number; // m/s
  rpm: number; // engine revs
  throttle: number; // 0..1
  shifting: boolean; // the clutch is in for an upshift
  skid: number; // 0..1, how hard the tyres are sliding
  scrape: number; // 0..1, rubbing a barrier
}

const STORE = "pass-sound";
export const IDLE = 850, RED = 6900;

// The revs each loop is built at, and how many loops play at once (the two either side of the revs)
const BANDS = [900, 1800, 3000, 4300, 5600, 6900];

/** One seamless loop of exhaust pulses at a given rpm. Pulses that run past the end wrap round to the start. */
function renderLoop(rpm: number, sr: number, seed: number): Float32Array<ArrayBuffer> {
  let st = seed;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const cycle = 120 / rpm; // one engine cycle (two turns of the crank), seconds
  const n = Math.max(6, Math.round(1.6 / cycle));
  const len = Math.round(n * cycle * sr);
  const out = new Float32Array(len);
  const r = (rpm - BANDS[0]) / (BANDS[BANDS.length - 1] - BANDS[0]);
  // Where the four pulses of a cycle arrive (fraction of the cycle) and how strong each is: strong, weak, off-beat
  const at = [0, 0.29, 0.5, 0.79], amp = [1, 0.55, 0.88, 0.5];
  // The pulse: a deep thump (the exhaust pipe's body), a shorter mid "pop", and a hint of edge at the start
  const f1 = 88 + 60 * r, f2 = 330 + 160 * r;
  const tau1 = 0.011 - 0.005 * r, tau2 = 0.0032;
  const klen = Math.round(sr * tau1 * 6);
  const kernel = new Float32Array(klen);
  for (let i = 0; i < klen; i++) {
    const t = i / sr;
    kernel[i] = Math.exp(-t / tau1) * Math.sin(2 * Math.PI * f1 * t) + 0.42 * Math.exp(-t / tau2) * Math.sin(2 * Math.PI * f2 * t + 0.6);
  }
  const wobble = 0.12 - 0.07 * r, jitter = 0.012 - 0.008 * r; // a little life, a lot less at high revs
  for (let c = 0; c < n; c++) {
    for (let p = 0; p < 4; p++) {
      const t0 = (c + at[p] + (rnd() - 0.5) * jitter) * cycle;
      const a = amp[p] * (1 + (rnd() - 0.5) * 2 * wobble);
      const s0 = Math.round(t0 * sr);
      for (let i = 0; i < klen; i++) out[(s0 + i + len) % len] += a * kernel[i];
    }
  }
  // Level every loop to the same loudness, so the cross-fades are even
  let sum = 0;
  for (let i = 0; i < len; i++) sum += out[i] * out[i];
  const k = 0.32 / Math.sqrt(sum / len);
  for (let i = 0; i < len; i++) out[i] *= k;
  return out;
}

export class PassSound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private eng: {
    loops: { src: AudioBufferSourceNode; gain: GainNode; rpm: number }[];
    level: GainNode;
    tone: BiquadFilterNode;
    spool: OscillatorNode;
    spoolLevel: GainNode;
  } | null = null;
  private skid!: { level: GainNode; band: BiquadFilterNode; tone: OscillatorNode };
  private scrape!: GainNode;
  private wind!: { level: GainNode; filter: BiquadFilterNode };
  private boost = 0;
  private lastThrottle = 0;
  private wasShifting = false;
  private stopTimer = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORE) === "off";
    } catch {
      /* storage blocked: sound on */
    }
  }

  /** Call from a key press. Builds the sound graph the first time, then fades in. Resolves to the state. */
  async start() {
    clearTimeout(this.stopTimer);
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, ctx.currentTime, 0.25);
    try {
      await ctx.resume();
    } catch {
      /* reported below */
    }
    return this.state();
  }

  /** From a later key press: restarts the audio if the browser paused it. Resolves to the new state, if it changed. */
  async wake() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running") return "";
    try {
      await ctx.resume();
    } catch {
      /* still blocked */
    }
    return this.state();
  }

  /** "on", "off" (muted), or "blocked" when the browser won't let the page play sound. */
  state() {
    if (this.muted) return "off";
    if (!this.ctx || this.ctx.state !== "running") return "blocked";
    return "on";
  }

  /** Fades out, then suspends the audio engine so it costs nothing. */
  stop() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => void this.ctx?.suspend(), 900);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORE, this.muted ? "off" : "on");
    } catch {
      /* not remembered */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  /** Every frame while driving. */
  update(s: DriveSound, dt: number) {
    const ctx = this.ctx, e = this.eng;
    if (!ctx || ctx.state !== "running" || !e) return;
    if (!Number.isFinite(s.rpm) || !Number.isFinite(s.speed)) return;
    const t = ctx.currentTime;
    const v = Math.abs(s.speed);
    const r = Math.min(1, Math.max(0, (s.rpm - IDLE) / (RED - IDLE)));
    const load = s.shifting ? 0.05 : s.throttle;

    // Turbo: boost builds with load and revs; lifting off at boost (or the clutch going in) vents it
    const boostTarget = load * Math.min(1, Math.max(0, (s.rpm - 2600) / 2200));
    this.boost += (boostTarget - this.boost) * Math.min(1, dt * (boostTarget > this.boost ? 2 : 7));
    const lifted = this.lastThrottle > 0.6 && s.throttle < 0.2;
    if ((lifted || (s.shifting && !this.wasShifting)) && s.rpm > 3400 && this.boost > 0.3) this.blowOff();
    this.lastThrottle = s.throttle;
    this.wasShifting = s.shifting;

    // The two loops either side of the revs, pitched to the revs and cross-faded (equal power)
    const rpm = Math.max(BANDS[0] * 0.8, Math.min(BANDS[BANDS.length - 1] * 1.08, s.rpm));
    let hi = BANDS.findIndex((b) => b >= rpm);
    if (hi <= 0) hi = hi === 0 ? 1 : BANDS.length - 1;
    const lo = hi - 1;
    const x = Math.min(1, Math.max(0, (rpm - BANDS[lo]) / (BANDS[hi] - BANDS[lo])));
    e.loops.forEach((l, i) => {
      const w = i === lo ? Math.cos((x * Math.PI) / 2) : i === hi ? Math.sin((x * Math.PI) / 2) : 0;
      l.gain.gain.setTargetAtTime(w, t, 0.03);
      l.src.playbackRate.setTargetAtTime(rpm / l.rpm, t, s.shifting ? 0.05 : 0.03);
    });
    e.level.gain.setTargetAtTime(0.55 + 0.35 * load + 0.15 * r, t, 0.06);
    e.tone.frequency.setTargetAtTime(1400 + 3200 * load * (0.4 + 0.6 * r) + 1200 * r, t, 0.08);
    e.spool.frequency.setTargetAtTime(900 + this.boost * 1700, t, 0.1);
    e.spoolLevel.gain.setTargetAtTime(this.boost * 0.004, t, 0.1);

    // Tyres, barrier, wind
    this.skid.level.gain.setTargetAtTime(s.skid * 0.18, t, 0.08);
    this.skid.band.frequency.setTargetAtTime(850 + s.skid * 450 + Math.sin(t * 23) * 60, t, 0.02);
    this.skid.tone.frequency.setTargetAtTime(600 + Math.sin(t * 17) * 25, t, 0.02);
    this.scrape.gain.setTargetAtTime(s.scrape * 0.2, t, 0.12); // eased in and out, never crackling on and off
    this.wind.level.gain.setTargetAtTime(0.025 + Math.min(1, v / 45) * 0.14, t, 0.2);
    this.wind.filter.frequency.setTargetAtTime(300 + v * 30, t, 0.2);
  }

  /** The race's sound cues. */
  play(cue: Cue) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (cue === "tick") this.tone(1900, t, 0.035, 0.1, "square");
    else if (cue === "go") {
      // two quick starting-light beeps rising into a bright hit and a whoosh
      this.tone(880, t, 0.09, 0.12, "square");
      this.tone(1760, t + 0.1, 0.42, 0.13, "sawtooth", 3200);
      this.whoosh(t + 0.08, 0.6, 400, 6000, 0.1);
    } else if (cue === "gate") {
      // a gold shimmer: a bell arpeggio and sparkle
      [1318.5, 1661.2, 1975.5, 2637].forEach((f, i) => this.bell(f, t + i * 0.045, 0.9, 0.08));
      this.whoosh(t, 0.5, 3000, 9000, 0.04);
    } else if (cue === "finish") {
      // a short fanfare that lands on a held major chord
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.11, 0.18, 0.09, "sawtooth", 2600));
      [523.3, 659.3, 784, 1046.5].forEach((f) => this.tone(f, t + 0.48, 1.6, 0.05, "sawtooth", 2200, true));
      [2093, 2637, 3136].forEach((f, i) => this.bell(f, t + 0.48 + i * 0.06, 1.4, 0.045));
      this.whoosh(t + 0.4, 1.4, 200, 3000, 0.06);
    } else if (cue === "fail") {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(82, t + 0.9);
      f.type = "lowpass";
      f.frequency.value = 1200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(f).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1.2);
      this.tone(55, t, 0.5, 0.22, "sine");
    }
  }

  // ── Building blocks ───────────────────────────────────────────────────────
  private build() {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); // keeps the engine, skids and cues from clipping together
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start();
      return s;
    };

    // Engine: the rev-band loops, through a little EQ (weight in the low end, a touch of bite in the mids)
    // and a low-pass that opens up under load
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 140;
    lowShelf.gain.value = 5;
    const bite = ctx.createBiquadFilter();
    bite.type = "peaking";
    bite.frequency.value = 650;
    bite.Q.value = 0.9;
    bite.gain.value = 2.5;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.Q.value = 0.5;
    tone.frequency.value = 1800;
    const level = ctx.createGain();
    level.gain.value = 0.6;
    lowShelf.connect(bite).connect(tone).connect(level).connect(this.master);
    const loops = BANDS.map((rpm, i) => {
      const data = renderLoop(rpm, ctx.sampleRate, 1234 + i * 977);
      const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 1 : 0;
      src.connect(gain).connect(lowShelf);
      src.start(ctx.currentTime + i * 0.137); // offset so the loops never line up their seams
      return { src, gain, rpm };
    });
    // turbo spool: soft, low
    const spool = ctx.createOscillator(), spoolLevel = ctx.createGain();
    spool.type = "sine";
    spoolLevel.gain.value = 0;
    spool.connect(spoolLevel).connect(this.master);
    spool.start();
    this.eng = { loops, level, tone, spool, spoolLevel };

    // Tyre squeal: narrow-band noise with a little tone in it
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 7;
    const skidLevel = ctx.createGain();
    skidLevel.gain.value = 0;
    noiseSrc().connect(band).connect(skidLevel).connect(this.master);
    const skidTone = ctx.createOscillator(), skidToneLevel = ctx.createGain();
    skidTone.type = "sawtooth";
    skidToneLevel.gain.value = 0.1;
    const skidToneFilter = ctx.createBiquadFilter();
    skidToneFilter.type = "bandpass";
    skidToneFilter.frequency.value = 1200;
    skidTone.connect(skidToneFilter).connect(skidToneLevel).connect(skidLevel);
    skidTone.start();
    this.skid = { level: skidLevel, band, tone: skidTone };

    // Barrier scrape: harsh high noise
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const ring = ctx.createBiquadFilter();
    ring.type = "peaking";
    ring.frequency.value = 3400;
    ring.gain.value = 10;
    ring.Q.value = 4;
    this.scrape = ctx.createGain();
    this.scrape.gain.value = 0;
    noiseSrc().connect(hp).connect(ring).connect(this.scrape).connect(this.master);

    // Wind
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 300;
    const windLevel = ctx.createGain();
    windLevel.gain.value = 0.025;
    noiseSrc().connect(windFilter).connect(windLevel).connect(this.master);
    this.wind = { level: windLevel, filter: windFilter };

    // The mountain at night: the simulator's night scenery, looped quietly underneath
    fetch("/sim/audio/scenery-night.m4a")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((buf) => {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf;
        src.loop = true;
        g.gain.value = 0.5;
        src.connect(g).connect(this.master);
        src.start();
      })
      .catch(() => {
        /* no ambience: the wind still plays */
      });
  }

  private tone(f: number, at: number, dur: number, vol: number, type: OscillatorType, cutoff = 0, hold = false) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    if (hold) g.gain.setValueAtTime(vol, at + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = o;
    if (cutoff) {
      const f2 = ctx.createBiquadFilter();
      f2.type = "lowpass";
      f2.frequency.value = cutoff;
      node = o.connect(f2);
    }
    node.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private bell(f: number, at: number, dur: number, vol: number) {
    this.tone(f, at, dur, vol, "sine");
    this.tone(f * 2.76, at, dur * 0.4, vol * 0.35, "sine"); // the bright, slightly inharmonic overtone
  }

  private whoosh(at: number, dur: number, from: number, to: number, vol: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(at);
    s.stop(at + dur + 0.05);
  }

  private blowOff() {
    const ctx = this.ctx!, t = ctx.currentTime;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    f.type = "bandpass";
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.45);
    const v = 0.1 * this.boost;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.55);
    this.boost = 0;
  }
}
