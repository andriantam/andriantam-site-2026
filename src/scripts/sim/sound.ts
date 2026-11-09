// Sound for the photography simulator, built to cost almost nothing while you play.
//
// Everything is synthesised with Web Audio, but ahead of time: each time of day's scenery (wind, birds, insects,
// crickets, owls, passing cars) is rendered once into a seamless 36-second loop, and each effect (shutter,
// footsteps, ladder...) into a tiny clip. While playing, the scenery is one looping track and an effect is one
// buffer playing once. No filters or oscillators run continuously (except the engine while driving), and the
// audio engine is suspended whenever the game is minimised, hidden or muted.
import type { TimeOfDay } from "./data";

type Mix = { wind: number; birds: number; insects: number; crickets: number; traffic: number; owls: number };

const MIX: Record<TimeOfDay, Mix> = {
  day: { wind: 0.8, birds: 1, insects: 0.25, crickets: 0, traffic: 1, owls: 0 },
  noon: { wind: 0.7, birds: 0.35, insects: 1, crickets: 0, traffic: 0.8, owls: 0 },
  evening: { wind: 1, birds: 0.45, insects: 0.15, crickets: 0.6, traffic: 0.7, owls: 0 },
  night: { wind: 1.1, birds: 0, insects: 0, crickets: 1, traffic: 0.35, owls: 1 },
};

const STORE = "sim-sound";
const SR = 22050; // render rate: plenty for ambience and effects, half the work of 44.1 kHz
const LOOP = 36; // seconds of scenery before it repeats
const FADE = 3; // seconds of crossfade that make the loop seamless
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- Offline synthesis helpers (run once, never during play) ----------
type Ctx = BaseAudioContext;
type Draw = (ctx: Ctx, out: AudioNode, noise: AudioBuffer) => void;

function makeNoise(ctx: Ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029591;
    b1 = 0.985 * b1 + w * 0.032534;
    b2 = 0.95 * b2 + w * 0.048056;
    d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
  }
  return buf;
}

function noiseSource(ctx: Ctx, noise: AudioBuffer, t: number, len: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  s.start(t, Math.random() * noise.duration);
  s.stop(t + len);
  return s;
}

function panner(ctx: Ctx, out: AudioNode, v: number) {
  const p = ctx.createStereoPanner();
  p.pan.value = v;
  p.connect(out);
  return p;
}

function bird(ctx: Ctx, out: AudioNode, t: number) {
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(panner(ctx, out, rand(-0.9, 0.9)));
  const o = ctx.createOscillator();
  o.connect(g);
  const base = rand(2400, 4600), notes = Math.floor(rand(2, 7)), vol = rand(0.025, 0.06);
  let at = t;
  for (let i = 0; i < notes; i++) {
    const len = rand(0.05, 0.14), f0 = base * rand(0.8, 1.25), f1 = f0 * rand(0.7, 1.5);
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + len);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.012);
    g.gain.linearRampToValueAtTime(0, at + len);
    at += len + rand(0.02, 0.12);
  }
  o.start(t);
  o.stop(at + 0.05);
}

function cricket(ctx: Ctx, out: AudioNode, t: number) {
  const o = ctx.createOscillator();
  o.frequency.value = rand(4100, 4900);
  const g = ctx.createGain();
  g.gain.value = 0;
  o.connect(g).connect(panner(ctx, out, rand(-1, 1)));
  const vol = rand(0.012, 0.028), pulses = Math.floor(rand(2, 5));
  for (let i = 0; i < pulses; i++) {
    const a = t + i * 0.055;
    g.gain.setValueAtTime(0, a);
    g.gain.linearRampToValueAtTime(vol, a + 0.008);
    g.gain.linearRampToValueAtTime(0, a + 0.035);
  }
  o.start(t);
  o.stop(t + pulses * 0.055 + 0.05);
}

function passingCar(ctx: Ctx, out: AudioNode, noise: AudioBuffer, t: number) {
  const len = rand(5, 9), mid = t + len / 2, dir = Math.random() < 0.5 ? -1 : 1;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(180, t);
  f.frequency.exponentialRampToValueAtTime(rand(700, 1100), mid);
  f.frequency.exponentialRampToValueAtTime(160, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(rand(0.04, 0.08), mid);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(-dir * 0.9, t);
  p.pan.linearRampToValueAtTime(dir * 0.9, t + len);
  noiseSource(ctx, noise, t, len).connect(f).connect(g).connect(p).connect(out);
}

function owl(ctx: Ctx, out: AudioNode, t: number) {
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(panner(ctx, out, rand(-0.8, 0.8)));
  const o = ctx.createOscillator();
  o.connect(g);
  const f = rand(330, 420);
  for (const [at, len] of [[0, 0.35], [0.55, 0.18], [0.8, 0.5]]) {
    o.frequency.setValueAtTime(f * 1.04, t + at);
    o.frequency.linearRampToValueAtTime(f * 0.94, t + at + len);
    g.gain.setValueAtTime(0, t + at);
    g.gain.linearRampToValueAtTime(0.03, t + at + 0.06);
    g.gain.linearRampToValueAtTime(0, t + at + len);
  }
  o.start(t);
  o.stop(t + 1.4);
}

/** Renders one time of day's scenery into a seamless stereo loop. */
async function renderScenery(time: TimeOfDay): Promise<AudioBuffer> {
  const m = MIX[time];
  const total = LOOP + FADE;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * total), SR);
  const noise = makeNoise(ctx);
  const out = ctx.createGain();
  out.connect(ctx.destination);

  // Wind: band-passed noise drifting in gusts.
  const wf = ctx.createBiquadFilter();
  wf.type = "bandpass";
  wf.Q.value = 0.6;
  wf.frequency.value = 420;
  const wg = ctx.createGain();
  wg.gain.value = 0.09 * m.wind;
  noiseSource(ctx, noise, 0, total).connect(wf).connect(wg).connect(out);
  for (let t = 0; t < total; t += rand(2, 6)) {
    wg.gain.setTargetAtTime(0.09 * m.wind * rand(0.55, 1.5), t, rand(0.8, 2.2));
    wf.frequency.setTargetAtTime(rand(260, 700), t, rand(1, 2.5));
  }
  // Low valley rumble.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 140;
  const rg = ctx.createGain();
  rg.gain.value = 0.05;
  noiseSource(ctx, noise, 0, total).connect(lp).connect(rg).connect(out);
  // Cicadas: a narrow, throbbing band of noise.
  if (m.insects) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 5200;
    bp.Q.value = 6;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    lfo.start(0);
    const ig = ctx.createGain();
    ig.gain.value = 0.022 * m.insects;
    for (let t = 0; t < total; t += rand(3, 7)) ig.gain.setTargetAtTime(0.022 * m.insects * rand(0.6, 1.3), t, 1.5);
    noiseSource(ctx, noise, 0, total).connect(bp).connect(am).connect(ig).connect(out);
  }
  // Creatures and traffic, scattered through the loop (not in the crossfade tail, so nothing plays twice).
  const end = LOOP - 0.5;
  if (m.birds) for (let t = rand(0, 2); t < end; t += rand(0.6, 4.5) / m.birds) bird(ctx, out, t);
  if (m.crickets) for (let t = rand(0, 0.5); t < end; t += rand(0.35, 1.1) / m.crickets) cricket(ctx, out, t);
  if (m.traffic) for (let t = rand(3, 12); t < end - 6; t += rand(18, 40) / m.traffic) passingCar(ctx, out, noise, t);
  if (m.owls) for (let t = rand(4, 10); t < end - 1.5; t += rand(14, 26)) owl(ctx, out, t);

  const r = await ctx.startRendering();
  // Seamless loop: fade the tail into the start, then trim to LOOP seconds.
  const n = Math.floor(SR * LOOP), f = Math.floor(SR * FADE);
  const loop = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR });
  for (let c = 0; c < 2; c++) {
    const src = r.getChannelData(c), dst = loop.getChannelData(c);
    dst.set(src.subarray(0, n));
    for (let i = 0; i < f; i++) {
      const k = i / f;
      dst[i] = src[i] * Math.sqrt(k) + src[n + i] * Math.sqrt(1 - k);
    }
  }
  return loop;
}

/** Renders a short effect into a clip. */
async function renderClip(seconds: number, draw: Draw) {
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  draw(ctx, ctx.destination, makeNoise(ctx, 0.5));
  return ctx.startRendering();
}

function burst(ctx: Ctx, out: AudioNode, noise: AudioBuffer, o: { len: number; vol: number; type?: BiquadFilterType; freq?: number; q?: number; at?: number }) {
  const t = o.at ?? 0;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.value = o.freq ?? 2000;
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
  noiseSource(ctx, noise, t, o.len + 0.02).connect(f).connect(g).connect(out);
}

function tone(ctx: Ctx, out: AudioNode, o: { freq: number; to?: number; len: number; vol: number; type?: OscillatorType; at?: number }) {
  const t = o.at ?? 0;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.len + 0.02);
}

// Each effect: [length in seconds, how many variants, how to draw it].
const CLIPS: Record<string, [number, number, Draw]> = {
  shutter: [0.12, 1, (c, o, n) => {
    burst(c, o, n, { len: 0.03, vol: 0.32, freq: 3400, q: 1.2 });
    burst(c, o, n, { len: 0.05, vol: 0.18, type: "lowpass", freq: 600, at: 0.004 });
    burst(c, o, n, { len: 0.025, vol: 0.22, freq: 2600, q: 1.4, at: 0.055 });
  }],
  shutterClose: [0.08, 1, (c, o, n) => {
    burst(c, o, n, { len: 0.03, vol: 0.32, freq: 3400, q: 1.2 });
    burst(c, o, n, { len: 0.05, vol: 0.18, type: "lowpass", freq: 600, at: 0.004 });
  }],
  flash: [1.6, 1, (c, o, n) => {
    burst(c, o, n, { len: 0.06, vol: 0.12, type: "highpass", freq: 5000 });
    tone(c, o, { freq: 1800, to: 7200, len: 1.4, vol: 0.012, at: 0.15 });
  }],
  beep: [0.16, 1, (c, o) => {
    tone(c, o, { freq: 2700, len: 0.05, vol: 0.05 });
    tone(c, o, { freq: 2700, len: 0.05, vol: 0.05, at: 0.08 });
  }],
  tick: [0.04, 1, (c, o, n) => burst(c, o, n, { len: 0.018, vol: 0.12, freq: 4200, q: 2 })],
  step: [0.12, 4, (c, o, n) => {
    burst(c, o, n, { len: 0.09, vol: 0.11, freq: rand(550, 850), q: 0.7 });
    burst(c, o, n, { len: 0.05, vol: 0.05, type: "highpass", freq: 3000, at: 0.01 });
  }],
  land: [0.2, 1, (c, o, n) => burst(c, o, n, { len: 0.16, vol: 0.22, type: "lowpass", freq: 420 })],
  ladder: [0.4, 1, (c, o, n) => {
    tone(c, o, { freq: 590, len: 0.3, vol: 0.05, type: "triangle" });
    tone(c, o, { freq: 1550, len: 0.2, vol: 0.025 });
    burst(c, o, n, { len: 0.08, vol: 0.1, type: "lowpass", freq: 900 });
  }],
  ladderHeavy: [0.7, 1, (c, o, n) => {
    tone(c, o, { freq: 560, len: 0.6, vol: 0.08, type: "triangle" });
    tone(c, o, { freq: 1500, len: 0.4, vol: 0.04 });
    burst(c, o, n, { len: 0.08, vol: 0.22, type: "lowpass", freq: 900 });
  }],
  door: [0.24, 1, (c, o, n) => {
    burst(c, o, n, { len: 0.18, vol: 0.28, type: "lowpass", freq: 300 });
    tone(c, o, { freq: 95, to: 60, len: 0.18, vol: 0.12 });
  }],
  relay: [0.04, 1, (c, o, n) => burst(c, o, n, { len: 0.02, vol: 0.1, freq: 1500, q: 3 })],
};

export class Sound {
  ctx: AudioContext | null = null;
  enabled = true;
  private master!: GainNode;
  private sfx!: GainNode;
  private clips: Record<string, AudioBuffer[]> = {};
  private scenery = new Map<TimeOfDay, Promise<AudioBuffer>>();
  private bed: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private time: TimeOfDay = "evening";
  private active = false;
  private suspendTimer = 0;
  private lastEngine = 0;
  private eng: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORE) !== "off";
    } catch {
      /* storage blocked: default on */
    }
  }

  /** Creates the audio engine. Call from a click or tap (browsers only allow sound after a gesture). */
  unlock() {
    try {
      if (!this.ctx) this.build();
      else if (this.ctx.state === "suspended" && this.wanted) this.ctx.resume().catch(() => {});
    } catch {
      /* no Web Audio */
    }
  }

  private build() {
    // "playback" lets the browser use bigger audio buffers: fewer wake-ups, less CPU, no game lag.
    const ctx = (this.ctx = new AudioContext({ latencyHint: "playback" }));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    for (const [name, [len, variants, draw]] of Object.entries(CLIPS)) {
      Promise.all(Array.from({ length: variants }, () => renderClip(len, draw)))
        .then((b) => (this.clips[name] = b))
        .catch(() => {});
    }
    this.playScenery(true);
    this.apply();
    document.addEventListener("visibilitychange", () => this.apply());
  }

  private get wanted() {
    return this.enabled && this.active && document.visibilityState === "visible";
  }

  /** Whether the game is on screen and being played. */
  setActive(on: boolean) {
    this.active = on;
    this.apply();
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORE, this.enabled ? "on" : "off");
    } catch {
      /* ignore */
    }
    this.unlock();
    this.apply();
    return this.enabled;
  }

  /** Fades in or out; once faded out the engine is suspended so it uses no CPU at all. */
  private apply() {
    const ctx = this.ctx;
    if (!ctx) return;
    clearTimeout(this.suspendTimer);
    if (this.wanted) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(0.8, ctx.currentTime, 0.3);
    } else {
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      this.suspendTimer = window.setTimeout(() => {
        if (ctx.state === "running" && !this.wanted) ctx.suspend().catch(() => {});
      }, 600);
    }
  }

  setTime(t: TimeOfDay) {
    if (t === this.time) return;
    this.time = t;
    if (this.ctx) this.playScenery(false);
  }

  private sceneryFor(t: TimeOfDay) {
    let p = this.scenery.get(t);
    if (!p) this.scenery.set(t, (p = renderScenery(t)));
    return p;
  }

  /** Crossfades to the current time of day's loop. */
  private async playScenery(first: boolean) {
    const t = this.time;
    const buf = await this.sceneryFor(t).catch(() => null);
    const ctx = this.ctx;
    if (!buf || !ctx || t !== this.time) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.master);
    src.start(0, Math.random() * buf.duration);
    gain.gain.setTargetAtTime(1, ctx.currentTime, first ? 0.05 : 1);
    const old = this.bed;
    this.bed = { src, gain };
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 1);
      old.src.stop(ctx.currentTime + 5);
    }
  }

  private play(name: string, vol = 1, rate = 1) {
    const ctx = this.ctx, list = this.clips[name];
    if (!ctx || !list || !this.wanted) return;
    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = rate;
    if (vol === 1) src.connect(this.sfx);
    else {
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.sfx);
    }
    src.start();
  }

  // ---------- Effects ----------
  shutter(closing = false) {
    this.play(closing ? "shutterClose" : "shutter");
  }
  flash() {
    this.play("flash");
  }
  focusBeep() {
    this.play("beep");
  }
  tick() {
    this.play("tick");
  }
  footstep(soft = false) {
    this.play("step", soft ? 0.45 : 1, rand(0.9, 1.12));
  }
  land(hard: number) {
    this.play("land", Math.min(1.4, 0.45 + hard * 0.18));
  }
  ladder(heavy = false) {
    this.play(heavy ? "ladderHeavy" : "ladder", 1, rand(0.94, 1.06));
  }
  door() {
    this.play("door");
  }
  relay() {
    this.play("relay");
  }

  // ---------- Engine (only while driving) ----------
  engine(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.eng) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;
      const osc = [0, 7].map((d) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = 38;
        o.detune.value = d;
        o.connect(filter);
        o.start();
        return o;
      });
      filter.connect(gain).connect(this.sfx);
      gain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.2);
      this.eng = { osc, gain, filter };
    } else if (!on && this.eng) {
      const e = this.eng;
      this.eng = null;
      e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => e.osc.forEach((o) => o.stop()), 600);
    }
  }
  engineSpeed(speed: number, throttle: number) {
    if (!this.eng || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastEngine < 100) return; // ten updates a second is plenty
    this.lastEngine = now;
    const t = this.ctx.currentTime;
    this.eng.osc.forEach((o) => o.frequency.setTargetAtTime(38 + speed * 9 + throttle * 6, t, 0.1));
    this.eng.filter.frequency.setTargetAtTime(380 + speed * 60, t, 0.1);
  }
}
