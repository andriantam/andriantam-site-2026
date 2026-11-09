// Sound for the photography simulator: plays ready-made audio files, so the phone does no sound synthesis.
//
// The sounds are designed in sound-synth.ts and rendered once into files in public/sim/audio:
//  - scenery-<time>.m4a: a seamless 36-second loop per time of day (wind, birds, insects, crickets, owls, cars).
//    Only the current time's file is downloaded (about 250 KB), the others when you switch.
//  - effects.wav: every effect back to back in one small file; effects.json says where each one starts.
// While playing, the scenery is one looping buffer and an effect is one buffer playing once. The audio engine
// uses its battery-friendly "playback" mode and is suspended whenever the game is muted, minimised or hidden.
import type { TimeOfDay } from "./data";
import EFFECTS from "./audio-map.json";

const STORE = "sim-sound";
const BASE = "/sim/audio/";
type Effect = keyof typeof EFFECTS;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Sound {
  ctx: AudioContext | null = null;
  enabled = true;
  private master!: GainNode;
  private sfx!: GainNode;
  private effects: AudioBuffer | null = null;
  private scenery = new Map<TimeOfDay, Promise<{ buf: AudioBuffer; start: number; end: number } | null>>();
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
    const ctx = (this.ctx = new AudioContext({ latencyHint: "playback" }));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.load(`${BASE}effects.wav`).then((b) => (this.effects = b));
    this.playScenery(true);
    this.apply();
    document.addEventListener("visibilitychange", () => this.apply());
  }

  private async load(url: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
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

  /** Downloads and decodes a time of day's loop (once). AAC files start with a few silent "priming" samples
   *  and may end with padding; skipping them keeps the loop seamless. */
  private sceneryFor(t: TimeOfDay) {
    let p = this.scenery.get(t);
    if (!p) {
      p = this.load(`${BASE}scenery-${t}.m4a`).then((buf) => {
        if (!buf) return null;
        const d = buf.getChannelData(0);
        let a = 0, b = d.length - 1;
        while (a < d.length && Math.abs(d[a]) < 1e-5) a++;
        while (b > a && Math.abs(d[b]) < 1e-5) b--;
        return { buf, start: a / buf.sampleRate, end: (b + 1) / buf.sampleRate };
      });
      this.scenery.set(t, p);
    }
    return p;
  }

  /** Crossfades to the current time of day's loop. */
  private async playScenery(first: boolean) {
    const t = this.time;
    const s = await this.sceneryFor(t);
    const ctx = this.ctx;
    if (!s || !ctx || t !== this.time) return;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.loop = true;
    src.loopStart = s.start;
    src.loopEnd = s.end;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.master);
    src.start(0, rand(s.start, s.end));
    gain.gain.setTargetAtTime(1, ctx.currentTime, first ? 0.05 : 1);
    const old = this.bed;
    this.bed = { src, gain };
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 1);
      old.src.stop(ctx.currentTime + 5);
    }
  }

  private play(name: Effect, vol = 1, rate = 1) {
    const ctx = this.ctx, list = EFFECTS[name];
    if (!ctx || !this.effects || !list || !this.wanted) return;
    const [at, len] = list[(Math.random() * list.length) | 0];
    const src = ctx.createBufferSource();
    src.buffer = this.effects;
    src.playbackRate.value = rate;
    if (vol === 1) src.connect(this.sfx);
    else {
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.sfx);
    }
    src.start(0, at, len / rate);
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
