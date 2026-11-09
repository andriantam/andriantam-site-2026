// Sound for the photography simulator. Everything is synthesised with Web Audio: no files to download,
// and the scenery never repeats because each bird call, gust and passing car is generated as it happens.
import type { TimeOfDay } from "./data";

type Mix = { wind: number; birds: number; insects: number; crickets: number; traffic: number; owls: number };

// How busy each layer is at each time of day (0 = silent).
const MIX: Record<TimeOfDay, Mix> = {
  day: { wind: 0.8, birds: 1, insects: 0.25, crickets: 0, traffic: 1, owls: 0 },
  noon: { wind: 0.7, birds: 0.35, insects: 1, crickets: 0, traffic: 0.8, owls: 0 },
  evening: { wind: 1, birds: 0.45, insects: 0.15, crickets: 0.6, traffic: 0.7, owls: 0 },
  night: { wind: 1.1, birds: 0, insects: 0, crickets: 1, traffic: 0.35, owls: 1 },
};

const STORE = "sim-sound";
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private insectGain!: GainNode;
  private mix: Mix = MIX.evening;
  private time: TimeOfDay = "evening";
  private active = false;
  private timer = 0;
  private next = { gust: 0, bird: 0, cricket: 0, car: 0, owl: 0 };
  private eng: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORE) !== "off";
    } catch {
      /* storage blocked: default on */
    }
  }

  /** Creates the audio graph. Call from a click or tap (browsers only allow sound after a gesture). */
  unlock() {
    try {
      if (!this.ctx) this.build();
      if (this.ctx!.state === "suspended") this.ctx!.resume().catch(() => {});
    } catch {
      /* no Web Audio */
    }
  }

  private build() {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.9;
    this.amb.connect(this.master);

    // Two seconds of pink-ish noise, shared by every noisy sound.
    const n = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
    }

    // Wind: looping noise through a band-pass whose level and pitch drift in gusts.
    const wind = this.loop();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    // A low valley rumble under everything.
    const rumble = this.loop();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    const rg = ctx.createGain();
    rg.gain.value = 0.05;
    rumble.connect(lp).connect(rg).connect(this.amb);
    // Cicadas: a narrow band of noise, throbbing.
    const ins = this.loop();
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
    lfo.start();
    this.insectGain = ctx.createGain();
    this.insectGain.gain.value = 0;
    ins.connect(bp).connect(am).connect(this.insectGain).connect(this.amb);

    this.setTime(this.time, true);
    this.apply();
    this.timer = window.setInterval(() => this.schedule(), 120);
    document.addEventListener("visibilitychange", () => this.apply());
  }

  private loop() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 2);
    return s;
  }

  /** Whether the game is on screen and being played. Sound fades out otherwise. */
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

  private apply() {
    if (!this.ctx) return;
    const on = this.enabled && this.active && document.visibilityState === "visible";
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, on ? 0.4 : 0.12);
    if (on && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  private get live() {
    return !!this.ctx && this.ctx.state === "running" && this.enabled && this.active;
  }

  setTime(t: TimeOfDay, now = false) {
    this.time = t;
    this.mix = MIX[t];
    if (!this.ctx) return;
    const c = this.ctx.currentTime, k = now ? 0.05 : 2;
    this.windGain.gain.setTargetAtTime(0.09 * this.mix.wind, c, k);
    this.insectGain.gain.setTargetAtTime(0.022 * this.mix.insects, c, k);
  }

  // ---------- Ambience scheduler ----------
  private schedule() {
    if (!this.live) return;
    const ctx = this.ctx!, t = ctx.currentTime, m = this.mix, nx = this.next;
    if (t >= nx.gust) {
      const g = 0.09 * m.wind * rand(0.55, 1.5);
      this.windGain.gain.setTargetAtTime(g, t, rand(0.8, 2.2));
      this.windFilter.frequency.setTargetAtTime(rand(260, 700), t, rand(1, 2.5));
      nx.gust = t + rand(2, 6);
    }
    if (m.birds && t >= nx.bird) {
      this.bird(t + 0.05);
      nx.bird = t + rand(0.6, 4.5) / m.birds;
    }
    if (m.crickets && t >= nx.cricket) {
      this.cricket(t + 0.05);
      nx.cricket = t + rand(0.35, 1.1) / m.crickets;
    }
    if (m.traffic && t >= nx.car) {
      if (nx.car) this.passingCar(t + 0.05);
      nx.car = t + rand(20, 60) / m.traffic;
    }
    if (m.owls && t >= nx.owl) {
      if (nx.owl) this.owl(t + 0.05);
      nx.owl = t + rand(25, 70);
    }
  }

  private pan(v: number) {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = v;
    return p;
  }

  private bird(t: number) {
    const ctx = this.ctx!;
    const out = this.pan(rand(-0.9, 0.9));
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out).connect(this.amb);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.connect(g);
    // A short phrase of quick, rising or falling whistles.
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

  private cricket(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.value = rand(4100, 4900);
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(this.pan(rand(-1, 1))).connect(this.amb);
    const vol = rand(0.012, 0.028);
    const pulses = Math.floor(rand(2, 5));
    for (let i = 0; i < pulses; i++) {
      const a = t + i * 0.055;
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(vol, a + 0.008);
      g.gain.linearRampToValueAtTime(0, a + 0.035);
    }
    o.start(t);
    o.stop(t + pulses * 0.055 + 0.05);
  }

  private passingCar(t: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    const g = ctx.createGain();
    const dir = Math.random() < 0.5 ? -1 : 1;
    const p = this.pan(-dir);
    const len = rand(5, 9), mid = t + len / 2;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(rand(700, 1100), mid);
    f.frequency.exponentialRampToValueAtTime(160, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(rand(0.04, 0.08), mid);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    p.pan.setValueAtTime(-dir * 0.9, t);
    p.pan.linearRampToValueAtTime(dir * 0.9, t + len);
    s.connect(f).connect(g).connect(p).connect(this.amb);
    s.start(t, Math.random() * 2);
    s.stop(t + len + 0.1);
  }

  private owl(t: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.pan(rand(-0.8, 0.8))).connect(this.amb);
    const o = ctx.createOscillator();
    o.connect(g);
    const f = rand(330, 420);
    const hoots: [number, number][] = [[0, 0.35], [0.55, 0.18], [0.8, 0.5]];
    for (const [at, len] of hoots) {
      o.frequency.setValueAtTime(f * 1.04, t + at);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + at + len);
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.03, t + at + 0.06);
      g.gain.linearRampToValueAtTime(0, t + at + len);
    }
    o.start(t);
    o.stop(t + 1.4);
  }

  // ---------- Effects ----------
  /** A burst of filtered noise: the building block of clicks, steps and thumps. */
  private burst(o: { len: number; vol: number; type?: BiquadFilterType; freq?: number; q?: number; decay?: number; at?: number; pan?: number }) {
    if (!this.live) return;
    const ctx = this.ctx!, t = ctx.currentTime + (o.at ?? 0);
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? "bandpass";
    f.frequency.value = o.freq ?? 2000;
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.len * (o.decay ?? 1));
    s.connect(f).connect(g);
    if (o.pan) g.connect(this.pan(o.pan)).connect(this.sfx);
    else g.connect(this.sfx);
    s.start(t, Math.random() * 1.5);
    s.stop(t + o.len + 0.02);
  }

  private tone(o: { freq: number; to?: number; len: number; vol: number; type?: OscillatorType; at?: number }) {
    if (!this.live) return;
    const ctx = this.ctx!, t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + o.len + 0.02);
  }

  /** Shutter opening (curtain and mirror) or closing at the end of a long exposure. */
  shutter(closing = false) {
    this.burst({ len: 0.03, vol: 0.32, freq: 3400, q: 1.2 });
    this.burst({ len: 0.05, vol: 0.18, type: "lowpass", freq: 600, at: 0.004 });
    if (!closing) this.burst({ len: 0.025, vol: 0.22, freq: 2600, q: 1.4, at: 0.055 });
  }
  /** Flash: a bright pop, then the capacitor whining as it recharges. */
  flash() {
    this.burst({ len: 0.06, vol: 0.12, type: "highpass", freq: 5000 });
    this.tone({ freq: 1800, to: 7200, len: 1.4, vol: 0.012, at: 0.15 });
  }
  /** Focus confirmed (two quick beeps). */
  focusBeep() {
    this.tone({ freq: 2700, len: 0.05, vol: 0.05 });
    this.tone({ freq: 2700, len: 0.05, vol: 0.05, at: 0.08 });
  }
  /** Dials, lens changes and buttons. */
  tick() {
    this.burst({ len: 0.018, vol: 0.12, freq: 4200, q: 2 });
  }
  footstep(soft = false) {
    this.burst({ len: 0.09, vol: soft ? 0.05 : 0.11, freq: rand(500, 900), q: 0.7, pan: rand(-0.15, 0.15) });
    this.burst({ len: 0.05, vol: soft ? 0.02 : 0.05, type: "highpass", freq: 3000, at: 0.01 }); // grit
  }
  land(hard: number) {
    this.burst({ len: 0.16, vol: Math.min(0.3, 0.1 + hard * 0.04), type: "lowpass", freq: 420 });
  }
  /** Aluminium ladder: a ringing clank. */
  ladder(heavy = false) {
    this.tone({ freq: rand(540, 640), len: heavy ? 0.6 : 0.3, vol: heavy ? 0.08 : 0.05, type: "triangle" });
    this.tone({ freq: rand(1450, 1650), len: heavy ? 0.4 : 0.2, vol: heavy ? 0.04 : 0.025 });
    this.burst({ len: 0.08, vol: heavy ? 0.22 : 0.1, type: "lowpass", freq: 900 });
  }
  door() {
    this.burst({ len: 0.18, vol: 0.28, type: "lowpass", freq: 300 });
    this.tone({ freq: 95, to: 60, len: 0.18, vol: 0.12 });
  }
  relay() {
    this.burst({ len: 0.02, vol: 0.1, freq: 1500, q: 3 });
  }

  // ---------- Engine ----------
  engine(on: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
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
    const t = this.ctx.currentTime;
    this.eng.osc.forEach((o) => o.frequency.setTargetAtTime(38 + speed * 9 + throttle * 6, t, 0.1));
    this.eng.filter.frequency.setTargetAtTime(380 + speed * 60, t, 0.1);
  }
}
