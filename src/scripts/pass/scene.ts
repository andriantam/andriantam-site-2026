// The Pass: the night sky first, then a drive up a mountain road, ending with a handbrake turn in a car park.
// Progress `f` is the section the page is on (0 = the sky, 1.. = chapters, last = contact).
// The terrain, road, barriers, streetlights and gates are built in code. The car is the simulator's WRX model.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PassSound, IDLE, RED } from "./sound";

export interface PassNode {
  id: string;
  label: string;
  cluster: string;
  hub: boolean; // one of the four disciplines
  parent: string | null; // null for the top level, which hangs from the centre
  level: number; // 1 top level, 2 a place, 3 what was done there
}
export interface PassOptions {
  canvas: HTMLCanvasElement;
  labels: HTMLElement; // layer the star labels are added to
  center: HTMLElement; // the name at the middle of the sky; it is kept on the centre star
  pointer: HTMLElement; // element that receives drags and taps while the sky is in view
  nodes: PassNode[];
  edges: [string, string, "tree" | "link"][];
  clusters: { id: string; color: string }[];
  years: string[]; // one gate per chapter
  onSelect: (id: string | null) => void;
  onDrive?: (on: boolean, stop: number) => void; // drive mode started or stopped; on stopping, the page stop nearest the car (1.. chapters, chapters + 1 contact)
  onRace?: (e: RaceEvent) => void; // the hidden time attack
  onGauge?: (kmh: number, gear: string) => void; // speed and gear while driving
  onSound?: (state: string) => void; // sound on, off, or why it can't play
  onReady?: () => void; // the car, every texture and the shaders are loaded, and a full frame has been drawn
  onFail?: (err: unknown) => void; // the car could not load: the page should show its picture story instead
}
export type RaceEvent =
  | { type: "go"; left: number; gates: number; dir: "down" | "up" }
  | { type: "tick"; left: number; gate: number; gates: number }
  | { type: "gate"; added: number; gate: number; gates: number }
  | { type: "fail"; total: number; dir: "down" | "up" }
  | { type: "finish"; total: number; dir: "down" | "up" }
  | { type: "reset" };
export interface PassApi {
  setProgress(f: number): void;
  setActive(on: boolean): void;
  select(id: string | null): void;
  canDrive(): boolean; // the car is on screen and the 3D is running
  drive(on: boolean): void; // start (from inside a tap or key press, so sound may play) or stop driving
  setStick(x: number, y: number): void; // touch controls: x -1 left .. 1 right, y -1 accelerate .. 1 brake
  raceAction(kind: "again" | "up" | "free"): void; // after a race: run it again, the uphill climb, or drive on
  dispose(): void; // stop drawing for good and free the GPU
}

// ── Helpers ────────────────────────────────────────────────────────────────
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x: number, y: number, oct = 4) => {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(x * f, y * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return v;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const glowTexture = (inner: string, outer: string) => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export function initPass(o: PassOptions): PassApi {
  const phone = Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: !phone, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color("#0a0d18");
  scene.fog = new THREE.FogExp2(FOG, 0.0046);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2600);
  // Soft studio reflections so paint, glass and metal read at night.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  // Everything the scene fetches goes through one manager, so the page knows when all of it has arrived.
  const manager = new THREE.LoadingManager();
  const texturesLoaded = new Promise<void>((resolve) => {
    manager.onLoad = resolve;
    manager.onError = (url) => console.warn("Did not load", url); // a missing texture is not worth failing over
  });
  const tex = new THREE.TextureLoader(manager);
  const load = (file: string, repeat: [number, number], srgb = false) => {
    const t = tex.load(`/sim/tex/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = phone ? 4 : 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  // ── Progress landmarks ───────────────────────────────────────────────────
  const CHAPTERS = o.years.length;
  const F_SKY_END = 0.2; // the camera starts to come down from the sky
  const F_ROAD0 = 0.7; // the car pulls away
  const F_ROAD1 = CHAPTERS + 0.45; // the car reaches the car park
  const F_DRIFT1 = CHAPTERS + 0.82; // ...and has slid to a stop
  const F_END = CHAPTERS + 1;
  const uAt = (f: number) => clamp01((f - F_ROAD0) / (F_ROAD1 - F_ROAD0));

  // ── The road: switchbacks up a slope, ending at a car park ───────────────
  const LEGS = 9, W = 62, D = 46, SLOPE = 0.17;
  const Z_END = LEGS * D;
  const baseH = (x: number, z: number) => {
    const climb = z < Z_END ? z * SLOPE : Z_END * SLOPE - (z - Z_END) * 0.3;
    return climb + (fbm(x * 0.006 + 3, z * 0.006 + 7, 3) - 0.5) * 14;
  };
  // The road's layout, corner to corner: a run up from the valley, then long straights across the slope,
  // each joined to the next by a U-turn at alternating ends (two right-angle corners, rounded below into
  // one hairpin), and a last turn up into the car park.
  const corners: THREE.Vector3[] = [];
  const at = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  corners.push(at(-10, -70), at(-10, 0));
  for (let k = 0; k < LEGS; k++) {
    const x = (k % 2 ? -1 : 1) * W * (1.05 + 0.3 * hash(k, 9)); // where this straight ends and the hairpin turns
    corners.push(at(x, k * D));
    corners.push(at(x, k < LEGS - 1 ? (k + 1) * D : Z_END - 16));
  }
  corners.push(at(0, Z_END - 16), at(0, Z_END + 14));
  const END_Y = baseH(0, Z_END);
  // ...but every corner is rounded into a true circular arc (a hairpin up to 22 m in radius), joined by
  // straights, so the bends sweep round instead of snapping. Heights follow the zigzag's own climb.
  corners.forEach((c, i) => (c.y = i)); // placeholder heights; the climb is set by distance below
  const ctrl: THREE.Vector3[] = [corners[0].clone()];
  {
    const flat = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z);
    const along = (A: THREE.Vector3, B: THREE.Vector3, p: THREE.Vector3) => {
      const ab = flat(B).sub(flat(A));
      const f = Math.max(0, Math.min(1, flat(p).sub(flat(A)).dot(ab) / ab.lengthSq()));
      return A.y + (B.y - A.y) * f;
    };
    const straight = (from: THREE.Vector3, to: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3) => {
      const n = Math.max(1, Math.floor(from.distanceTo(to) / 10));
      for (let i = 1; i < n; i++) {
        const p = from.clone().lerp(to, i / n);
        p.y = along(A, B, p);
        ctrl.push(p);
      }
    };
    let prevEnd = corners[0].clone();
    for (let i = 1; i < corners.length - 1; i++) {
      const A = corners[i - 1], P = corners[i], B = corners[i + 1];
      const a = flat(P).sub(flat(A)), b = flat(B).sub(flat(P));
      const la = a.length(), lb = b.length();
      a.divideScalar(la);
      b.divideScalar(lb);
      const dev = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))); // how far the road turns here
      if (dev < 0.05) {
        straight(prevEnd, P, A, P);
        ctrl.push(P.clone());
        prevEnd = P.clone();
        continue;
      }
      const R = Math.min(22, (0.48 * Math.min(la, lb)) / Math.tan(dev / 2));
      const t = R * Math.tan(dev / 2);
      const p1 = flat(P).addScaledVector(a, -t), p2 = flat(P).addScaledVector(b, t);
      // The arc's centre sits on the inside of the bend
      let nrm = new THREE.Vector3(-a.z, 0, a.x);
      if (nrm.dot(b) < 0) nrm.negate();
      const C = p1.clone().addScaledVector(nrm, R);
      const r1 = p1.clone().sub(C), r2 = p2.clone().sub(C);
      const sign = r1.x * r2.z - r1.z * r2.x > 0 ? -1 : 1; // which way round
      p1.y = along(A, P, p1);
      p2.y = along(P, B, p2);
      straight(prevEnd, p1, A, P);
      ctrl.push(p1);
      // round the arc the road climbs evenly from where the bend starts to where it ends
      const steps = Math.max(2, Math.ceil((R * dev) / 3));
      for (let k = 1; k < steps; k++) {
        const q = r1.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sign * dev * (k / steps)).add(C);
        q.y = p1.y + (p2.y - p1.y) * (k / steps);
        ctrl.push(q);
      }
      ctrl.push(p2);
      prevEnd = p2;
    }
    const last = corners[corners.length - 1];
    straight(prevEnd, last, corners[corners.length - 2], last);
    ctrl.push(last.clone());
  }
  // An even climb from the valley floor to the car park, by distance along the road
  {
    const y0 = baseH(-10, -70);
    let total = 0;
    const dist = [0];
    for (let i = 1; i < ctrl.length; i++) dist.push((total += Math.hypot(ctrl[i].x - ctrl[i - 1].x, ctrl[i].z - ctrl[i - 1].z)));
    ctrl.forEach((p, i) => (p.y = y0 + (END_Y - y0) * (dist[i] / total)));
  }
  const road = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
  const ROAD_LEN = road.getLength();
  const roadPts = road.getSpacedPoints(360);
  const endPt = road.getPointAt(1);
  const endDir = road.getTangentAt(1).setY(0).normalize();
  const endSide = new THREE.Vector3(endDir.z, 0, -endDir.x);
  const LOT_LEN = 58, LOT_WID = 46, LOT_R = 40;
  const lotC = endPt.clone().addScaledVector(endDir, LOT_LEN / 2 - 4);

  const heightAt = (x: number, z: number) => {
    // The exact nearest point on the road (projected onto each short segment), and the road's height there.
    let best = Infinity, by = 0;
    for (let j = 0; j < roadPts.length - 1; j++) {
      const a = roadPts[j], b = roadPts[j + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const px = a.x + dx * t - x, pz = a.z + dz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) (best = d2), (by = a.y + (b.y - a.y) * t);
    }
    const d = Math.sqrt(best);
    const ridged = 1 - Math.abs(2 * fbm(x * 0.012 + 11, z * 0.012 + 5, 4) - 1);
    const near = ridged * ridged * 24 - 7;
    const far = smooth(95, 290, d) * 170 * fbm(x * 0.005 + 40, z * 0.005 + 20, 3);
    // Under the road and its verge the ground sits just below the asphalt, so no rock can come through;
    // beyond the barriers it rises (or falls) into the mountainside.
    // The ground around the car park is levelled first; then the road is cut in, so the road always wins.
    const wild = mix(END_Y - 0.3, baseH(x, z) + near + far, smooth(LOT_R, LOT_R + 38, Math.hypot(x - lotC.x, z - lotC.z)));
    return mix(by - 0.45, wild, smooth(5.6, 40, d));
  };

  // ── Terrain ──────────────────────────────────────────────────────────────
  {
    const SX = phone ? 120 : 200, SZ = phone ? 150 : 250;
    const TW = 680, TD = Z_END + 480;
    const geo = new THREE.PlaneGeometry(TW, TD, SX, SZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, TD / 2 - 170);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const rock = new THREE.Color("#8f95a3"), rock2 = new THREE.Color("#c3c8d4"), snow = new THREE.Color("#ffffff");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      uv.setXY(i, x / 26, z / 26);
      const rel = h - baseH(x, z);
      c.copy(rock).lerp(rock2, clamp01(fbm(x * 0.03, z * 0.03, 2) * 1.2));
      const snowy = smooth(30, 70, rel + fbm(x * 0.05, z * 0.05, 2) * 18);
      c.lerp(snow, snowy);
      col.set([c.r * (1 + snowy * 2.2), c.g * (1 + snowy * 2.2), c.b * (1 + snowy * 2.4)], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: load("dark_rock_02_diff.webp", [1, 1], true),
      normalMap: phone ? null : load("dark_rock_02_nor_gl.webp", [1, 1]),
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0.2,
    });
    scene.add(new THREE.Mesh(geo, mat));
  }
  const moon = new THREE.DirectionalLight("#b9c8ff", 2.4);
  moon.position.set(-0.6, 0.8, -0.35);
  scene.add(moon, new THREE.HemisphereLight("#46527a", "#0a0b10", 0.8));

  // ── Road surface, markings and barriers ──────────────────────────────────
  // Frames every half metre: position, sideways direction and distance along the road.
  const STEP = 0.5;
  const FN = Math.floor(ROAD_LEN / STEP);
  const fp = road.getSpacedPoints(FN);
  const fs: THREE.Vector3[] = [];
  {
    const up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3();
    for (let i = 0; i <= FN; i++) fs.push(new THREE.Vector3().crossVectors(up, road.getTangentAt(i / FN, t)).normalize());
  }
  // Signed curvature at each frame (positive = turning towards +x when heading +z), for steering, lean and braking.
  const curv = new Float32Array(FN + 1);
  {
    const head: number[] = [], t = new THREE.Vector3();
    for (let i = 0; i <= FN; i++) {
      road.getTangentAt(i / FN, t);
      head.push(Math.atan2(t.x, t.z));
    }
    const K = 8;
    for (let i = 0; i <= FN; i++) {
      const a = head[Math.max(0, i - K)], b = head[Math.min(FN, i + K)];
      let d = b - a;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      curv[i] = d / ((Math.min(FN, i + K) - Math.max(0, i - K)) * STEP);
    }
  }
  const curvAt = (u: number) => curv[Math.max(0, Math.min(FN, Math.round(u * FN)))];
  const HALF = 3.6; // half the road width
  /** A flat strip along the road between two sideways offsets. `on` chooses which metres are drawn (for dashes). */
  const strip = (a: number, b: number, y: number, uScale: number, on?: (dist: number) => boolean) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let n = 0;
    for (let i = 0; i < FN; i++) {
      if (on && !on(i * STEP)) continue;
      for (const j of [i, i + 1]) {
        const p = fp[j], s = fs[j];
        pos.push(p.x + s.x * a, p.y + y, p.z + s.z * a, p.x + s.x * b, p.y + y, p.z + s.z * b);
        uv.push(0, (j * STEP) / uScale, Math.abs(b - a) / uScale, (j * STEP) / uScale);
      }
      idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      n += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const asphalt = new THREE.MeshStandardMaterial({
    map: load("asphalt_02_diff.webp", [1, 1], true),
    normalMap: load("asphalt_02_nor_gl.webp", [1, 1]),
    roughnessMap: phone ? null : load("asphalt_02_arm.webp", [1, 1]),
    color: "#8d8f96",
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.5,
  });
  asphalt.normalScale.set(1.4, 1.4);
  scene.add(new THREE.Mesh(strip(HALF + 0.9, -HALF - 0.9, 0.02, 4.2), asphalt));
  const paint = (color: string) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, envMapIntensity: 0.4 });
  const white = paint("#cfd0cb"), yellow = paint("#d9a93a");
  scene.add(
    new THREE.Mesh(strip(HALF - 0.1, HALF - 0.26, 0.035, 1), white),
    new THREE.Mesh(strip(-HALF + 0.26, -HALF + 0.1, 0.035, 1), white),
    new THREE.Mesh(strip(0.08, -0.08, 0.035, 1, (d) => d % 9 < 3.5), yellow),
  );

  // W-beam guardrails: the rail profile swept along both edges, on posts, with amber reflectors.
  {
    const steel = new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.42, metalness: 0.85, side: THREE.DoubleSide, envMapIntensity: 1.6 });
    const profile: [number, number][] = [[0.02, 0.43], [0.09, 0.47], [0.09, 0.53], [0.0, 0.6], [0.09, 0.67], [0.09, 0.73], [0.02, 0.77]];
    const RAIL = HALF + 0.75;
    const posts: THREE.Matrix4[] = [], dots: THREE.Vector3[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
    for (const sign of [1, -1]) {
      const pos: number[] = [], idx: number[] = [];
      const P = profile.length;
      let row = 0;
      for (let i = 0; i <= FN; i += 2) {
        const p = fp[i], s = fs[i];
        for (const [n, y] of profile) pos.push(p.x + s.x * sign * (RAIL - n), p.y + y, p.z + s.z * sign * (RAIL - n));
        if (row > 0)
          for (let k = 0; k < P - 1; k++) {
            const a = (row - 1) * P + k, b = row * P + k;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        row++;
        if (i % 8 === 0) {
          q.setFromAxisAngle(yAxis, Math.atan2(s.x, s.z));
          posts.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + s.x * sign * (RAIL + 0.09), p.y + 0.36, p.z + s.z * sign * (RAIL + 0.09)), q, new THREE.Vector3(1, 1, 1)));
        }
        if (i % 32 === 0) dots.push(new THREE.Vector3(p.x + s.x * sign * (RAIL - 0.11), p.y + 0.6, p.z + s.z * sign * (RAIL - 0.11)));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, steel));
    }
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.86, 0.1), steel, posts.length);
    posts.forEach((mm, i) => postMesh.setMatrixAt(i, mm));
    const dotMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffa23a" }), dots.length);
    dots.forEach((p, i) => dotMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    scene.add(postMesh, dotMesh);
  }

  // ── Car park ─────────────────────────────────────────────────────────────
  {
    const lot = new THREE.Group();
    lot.position.set(lotC.x, END_Y + 0.02, lotC.z);
    lot.rotation.y = Math.atan2(endDir.x, endDir.z);
    const lotMat = asphalt.clone();
    lotMat.map = load("asphalt_02_diff.webp", [LOT_WID / 4.2, LOT_LEN / 4.2], true);
    lotMat.normalMap = load("asphalt_02_nor_gl.webp", [LOT_WID / 4.2, LOT_LEN / 4.2]);
    lotMat.roughnessMap = null;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(LOT_WID, LOT_LEN), lotMat);
    ground.rotation.x = -Math.PI / 2;
    lot.add(ground);
    // Bays down both long sides, and a kerb around three edges
    const bays: THREE.Matrix4[] = [];
    for (const sx of [-1, 1])
      for (let k = 0; k <= 16; k++) bays.push(new THREE.Matrix4().makeTranslation(sx * (LOT_WID / 2 - 3.4), 0.02, -LOT_LEN / 2 + 5 + k * 2.9));
    const bayMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(5.2, 0.012, 0.12), white, bays.length);
    bays.forEach((b, i) => bayMesh.setMatrixAt(i, b));
    lot.add(bayMesh);
    const kerbMat = new THREE.MeshStandardMaterial({ color: "#6f7278", roughness: 0.9, envMapIntensity: 0.3 });
    for (const [w, d, x, z] of [[LOT_WID, 0.3, 0, LOT_LEN / 2], [0.3, LOT_LEN, -LOT_WID / 2, 0], [0.3, LOT_LEN, LOT_WID / 2, 0]] as const) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), kerbMat);
      k.position.set(x, 0.1, z);
      lot.add(k);
    }
    scene.add(lot);
  }

  // More W-beam barrier: across the start of the road, and round the car park (open where the road comes in).
  {
    const steel = new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.42, metalness: 0.85, side: THREE.DoubleSide, envMapIntensity: 1.6 });
    const profile: [number, number][] = [[0.02, 0.43], [0.09, 0.47], [0.09, 0.53], [0.0, 0.6], [0.09, 0.67], [0.09, 0.73], [0.02, 0.77]];
    const posts: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const pos: number[] = [], idx: number[] = [];
    /** A straight run of barrier from a to b; `inward` points to the side the rail faces. */
    const run = (a: THREE.Vector3, b: THREE.Vector3, inward: THREE.Vector3) => {
      const base = pos.length / 3, P = profile.length;
      for (const p of [a, b]) for (const [n, y] of profile) pos.push(p.x + inward.x * n, p.y + y, p.z + inward.z * n);
      for (let k = 0; k < P - 1; k++) idx.push(base + k, base + P + k, base + k + 1, base + k + 1, base + P + k, base + P + k + 1);
      const len = a.distanceTo(b), count = Math.max(1, Math.round(len / 4));
      q.setFromAxisAngle(yAxis, Math.atan2(inward.x, inward.z));
      for (let i = 0; i <= count; i++) {
        const p = a.clone().lerp(b, i / count).addScaledVector(inward, -0.09);
        p.y += 0.36;
        posts.push(new THREE.Matrix4().compose(p, q, one));
      }
    };
    // Start of the road: a rail straight across, just behind where the asphalt begins
    const s0 = road.getPointAt(0), t0 = road.getTangentAt(0).setY(0).normalize();
    const n0 = new THREE.Vector3(t0.z, 0, -t0.x);
    const c0 = s0.clone().addScaledVector(t0, -0.4);
    run(c0.clone().addScaledVector(n0, HALF + 0.85), c0.clone().addScaledVector(n0, -HALF - 0.85), t0);
    // The car park: three closed sides, and the near side either side of the road
    const L = (along: number, across: number) => lotC.clone().addScaledVector(endDir, along).addScaledVector(endSide, across).setY(END_Y + 0.02);
    const hl = LOT_LEN / 2 - 0.3, hw = LOT_WID / 2 - 0.3, gap = HALF + 0.9;
    const back = endDir.clone().negate(), fromLeft = endSide.clone().negate();
    run(L(hl, -hw), L(hl, hw), back);
    run(L(-hl, hw), L(hl, hw), fromLeft);
    run(L(-hl, -hw), L(hl, -hw), endSide);
    run(L(-hl, -hw), L(-hl, -gap), endDir);
    run(L(-hl, gap), L(-hl, hw), endDir);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, steel));
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.86, 0.1), steel, posts.length);
    posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
    scene.add(postMesh);
  }

  // ── Streetlights ─────────────────────────────────────────────────────────
  const lamps: THREE.Vector3[] = []; // world position of each lamp head
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.8, envMapIntensity: 1.2 });
    const lensMat = new THREE.MeshBasicMaterial({ color: "#ffe2b0" });
    const haloTex = glowTexture("rgba(255,232,190,1)", "rgba(255,200,120,0.32)");
    const poolTex = glowTexture("rgba(255,214,150,0.55)", "rgba(255,196,120,0.22)");
    const arm = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 8.6, 0), new THREE.Vector3(0, 9.5, 0), new THREE.Vector3(0, 9.4, 2.6)), 14, 0.07, 8);
    const pole = new THREE.CylinderGeometry(0.075, 0.13, 8.6, 12);
    pole.translate(0, 4.3, 0);
    const foot = new THREE.CylinderGeometry(0.22, 0.26, 0.5, 12);
    foot.translate(0, 0.25, 0);
    const head = new THREE.BoxGeometry(0.34, 0.12, 0.95);
    const lens = new THREE.PlaneGeometry(0.24, 0.7);
    lens.rotateX(Math.PI / 2);
    /** A lamp at `base`, its arm reaching towards `towards`. */
    const add = (base: THREE.Vector3, towards: THREE.Vector3) => {
      const g = new THREE.Group();
      g.position.copy(base);
      g.rotation.y = Math.atan2(towards.x - base.x, towards.z - base.z);
      const h = new THREE.Mesh(head, poleMat);
      h.position.set(0, 9.38, 2.95);
      const l = new THREE.Mesh(lens, lensMat);
      l.position.set(0, 9.31, 2.95);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      halo.position.set(0, 9.25, 2.95);
      halo.scale.setScalar(3.4);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: poolTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0.16, 3.4);
      g.add(new THREE.Mesh(pole, poleMat), new THREE.Mesh(foot, poleMat), new THREE.Mesh(arm, poleMat), h, l, halo, pool);
      scene.add(g);
      g.updateMatrixWorld();
      lamps.push(new THREE.Vector3(0, 9.2, 2.95).applyMatrix4(g.matrixWorld));
    };
    // One before each gate, on alternating sides; four around the car park.
    o.years.forEach((_, i) => {
      const k = Math.round((uAt(i + 1) - 15 / ROAD_LEN) * FN);
      const p = fp[k], s = fs[k], sign = i % 2 ? 1 : -1;
      add(new THREE.Vector3(p.x + s.x * sign * (HALF + 1.5), p.y, p.z + s.z * sign * (HALF + 1.5)), p);
    });
    for (const [sx, sz] of [[-1, -0.55], [1, -0.1], [-1, 0.45], [1, 0.8]]) {
      const b = lotC.clone().addScaledVector(endSide, sx * (LOT_WID / 2 + 0.6)).addScaledVector(endDir, (sz * LOT_LEN) / 2);
      b.y = END_Y;
      add(b, new THREE.Vector3(lotC.x, END_Y, lotC.z).addScaledVector(endDir, (sz * LOT_LEN) / 2));
    }
  }
  // One real light that sits at whichever lamp the car is nearest, so the car and gates catch its light.
  const lampLight = new THREE.PointLight("#ffd9a0", 0, 46, 1.7);
  scene.add(lampLight);

  // ── Torii gates ──────────────────────────────────────────────────────────
  {
    const wood = new THREE.MeshStandardMaterial({ color: "#4a1410", roughness: 0.62, metalness: 0.05, envMapIntensity: 0.9 });
    const black = new THREE.MeshStandardMaterial({ color: "#0d0d0f", roughness: 0.5, metalness: 0.1, envMapIntensity: 1 });
    const stone = new THREE.MeshStandardMaterial({ color: "#5a5c60", roughness: 0.95, envMapIntensity: 0.3 });
    const SPAN = HALF + 1.9, H = 7.2;
    // The lintels curve up at both ends.
    const lintel = (len: number, thick: number, depth: number, rise: number) => {
      const s = new THREE.Shape();
      const N = 28, half = len / 2;
      const y = (x: number) => rise * Math.pow(Math.abs(x) / half, 2.4);
      s.moveTo(-half, y(-half));
      for (let i = 1; i <= N; i++) s.lineTo(-half + (len * i) / N, y(-half + (len * i) / N));
      s.lineTo(half + 0.12, y(half) + thick);
      for (let i = N - 1; i >= 0; i--) s.lineTo(-half + (len * i) / N, y(-half + (len * i) / N) + thick);
      s.lineTo(-half - 0.12, y(-half) + thick);
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 4 });
      g.translate(0, 0, -depth / 2);
      return g;
    };
    const pillar = new THREE.CylinderGeometry(0.3, 0.38, H, 28, 4);
    pillar.translate(0, H / 2, 0);
    const band = new THREE.CylinderGeometry(0.4, 0.42, 0.85, 28);
    band.translate(0, 0.72, 0);
    const base = new THREE.CylinderGeometry(0.56, 0.66, 0.34, 28);
    base.translate(0, 0.17, 0);
    const kasagi = lintel(SPAN * 2 + 3.2, 0.3, 0.95, 0.5);
    const shimaki = lintel(SPAN * 2 + 2.5, 0.42, 0.62, 0.42);
    const nuki = new THREE.BoxGeometry(SPAN * 2 + 1.5, 0.44, 0.34);
    const strut = new THREE.BoxGeometry(0.46, 0.86, 0.3);
    const wedge = new THREE.BoxGeometry(0.16, 0.5, 0.5);
    o.years.forEach((year, i) => {
      const u = Math.min(0.985, uAt(i + 1) + 34 / ROAD_LEN);
      const p = road.getPointAt(u), t = road.getTangentAt(u).setY(0).normalize();
      const gate = new THREE.Group();
      for (const sx of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.x = sx * SPAN;
        leg.rotation.z = sx * 0.028; // pillars lean in slightly
        leg.add(new THREE.Mesh(pillar, wood), new THREE.Mesh(band, black), new THREE.Mesh(base, stone));
        gate.add(leg);
        for (const dx of [-0.42, 0.42]) {
          const w = new THREE.Mesh(wedge, black);
          w.position.set(sx * (SPAN - 0.16) + dx, H - 1.75, 0);
          gate.add(w);
        }
      }
      const a = new THREE.Mesh(kasagi, black);
      a.position.y = H + 0.4;
      const b = new THREE.Mesh(shimaki, wood);
      b.position.y = H - 0.02;
      const c = new THREE.Mesh(nuki, wood);
      c.position.y = H - 1.75;
      const d = new THREE.Mesh(strut, wood);
      d.position.y = H - 1.1;
      gate.add(a, b, c, d);
      // The year on a plaque, facing the oncoming car
      const cv = document.createElement("canvas");
      cv.width = 256;
      cv.height = 160;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#0b0b0c";
      g.fillRect(0, 0, 256, 160);
      g.strokeStyle = "#b8893a";
      g.lineWidth = 6;
      g.strokeRect(8, 8, 240, 144);
      g.font = "600 86px 'Avenir Next', Avenir, system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#e8b565";
      g.fillText(year, 128, 86);
      const tx = new THREE.CanvasTexture(cv);
      tx.colorSpace = THREE.SRGBColorSpace;
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), new THREE.MeshStandardMaterial({ map: tx, emissiveMap: tx, emissive: "#ffffff", emissiveIntensity: 0.55, roughness: 0.6 }));
      plaque.position.set(0, H - 1.1, -0.18);
      plaque.rotation.y = Math.PI;
      gate.add(plaque);
      gate.position.copy(p);
      gate.position.y -= 0.1;
      gate.rotation.y = Math.atan2(t.x, t.z);
      scene.add(gate);
    });
  }

  // ── Chevron boards round the outside of every hairpin ────────────────────
  // Black boards with yellow chevrons pointing the way the road bends, as on real mountain passes: they say
  // "brake now" before each tight corner. Seen from the other direction the board's back shows the chevron
  // mirrored, which points the right way for that direction too.
  {
    const board = (dir: 1 | -1) => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 160;
      const g = c.getContext("2d")!;
      g.fillStyle = "#0b0b0b";
      g.fillRect(0, 0, 128, 160);
      g.strokeStyle = "#e9e9e9";
      g.lineWidth = 6;
      g.strokeRect(5, 5, 118, 150);
      g.fillStyle = "#ffd000";
      g.beginPath();
      // a thick chevron pointing left (dir 1) or right (dir -1)
      const cx = 64, s = dir;
      g.moveTo(cx + s * 30, 20);
      g.lineTo(cx - s * 28, 80);
      g.lineTo(cx + s * 30, 140);
      g.lineTo(cx + s * 30 - s * 30, 140);
      g.lineTo(cx - s * 28 - s * 30, 80);
      g.lineTo(cx + s * 30 - s * 30, 20);
      g.closePath();
      g.fill();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: "#ffffff", emissiveIntensity: 0.22, roughness: 0.5, side: THREE.DoubleSide });
    };
    const left = board(1), right = board(-1);
    const plate = new THREE.PlaneGeometry(0.62, 0.78);
    const post = new THREE.BoxGeometry(0.07, 1.25, 0.07);
    post.translate(0, 0.62, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: "#6d7178", roughness: 0.6, metalness: 0.6 });
    const t = new THREE.Vector3();
    // Find each tight bend (a run of curvature over 1/40 m), and line its outside with boards every 9 m
    for (let i = 0; i <= FN; i++) {
      if (Math.abs(curv[i]) < 1 / 40) continue;
      let j = i;
      while (j < FN && Math.abs(curv[j + 1]) >= 1 / 40) j++;
      const sgn = Math.sign(curv[(i + j) >> 1]);
      for (let k = i; k <= j; k += 18) {
        const p = fp[k], sd = fs[k];
        road.getTangentAt(k / FN, t);
        const out = -sgn * (HALF + 1.25);
        const g = new THREE.Group();
        g.position.set(p.x + sd.x * out, p.y, p.z + sd.z * out);
        const b = new THREE.Mesh(plate, sgn > 0 ? left : right);
        b.position.y = 1.55;
        g.add(new THREE.Mesh(post, postMat), b);
        g.rotation.y = Math.atan2(-t.x, -t.z); // the face looks down the road at oncoming (uphill) traffic
        scene.add(g);
      }
      i = j;
    }
  }

  // ── The car ──────────────────────────────────────────────────────────────
  // `car` follows the road. `chassis` is the sprung body: it rolls, pitches and bobs on top of the wheels,
  // which stay on the ground. There is no stand-in: if the WRX model can't load, the page shows its
  // picture story instead of the 3D.
  const car = new THREE.Group(), chassis = new THREE.Group();
  car.add(chassis);
  scene.add(car);
  const redGlow = glowTexture("rgba(255,90,60,1)", "rgba(255,30,10,0.35)");
  const whiteGlow = glowTexture("rgba(255,250,235,1)", "rgba(255,236,200,0.3)");
  const lampSprite = (map: THREE.Texture, x: number, y: number, z: number, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    chassis.add(s);
    return s;
  };
  // No glow sprites at the back: the tail lamps are the model's own C-shaped LED guides, lit (see tailMats).
  const headGlows = [lampSprite(whiteGlow, -0.7, 0.68, 2.2, 1.5), lampSprite(whiteGlow, 0.7, 0.68, 2.2, 1.5)];
  // Two headlamps, two beams, each aimed slightly outwards like real low beams.
  const beams = [-1, 1].map((sx) => {
    const b = new THREE.SpotLight("#fff1dc", 240, 90, 0.36, 0.7, 1.6);
    b.position.set(sx * 0.7, 0.8, 1.9);
    b.target.position.set(sx * 2.4, -0.6, 22);
    chassis.add(b, b.target);
    return b;
  });
  const tailMats: THREE.MeshStandardMaterial[] = [], tailLens: THREE.MeshStandardMaterial[] = [];
  // The third (high-mounted) brake light on the rear shelf, behind the back window. The model only paints it
  // into a texture, so a real lamp is placed there once the model has loaded.
  const stopLamp = new THREE.Group();
  const stopLed = new THREE.MeshBasicMaterial({ color: "#0a0a0a", toneMapped: false, transparent: true });
  const stopGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: redGlow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  const stopCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: redGlow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  {
    const led = new THREE.SphereGeometry(0.016, 10, 8);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(led, stopLed);
      m.position.x = (i - 1.5) * 0.05;
      stopLamp.add(m);
    }
    stopGlow.scale.set(0.55, 0.22, 1);
    // A lit strip behind the LEDs, and a second, tighter glow: together as bright as the tail lamps.
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.03), stopLed);
    strip.rotation.y = Math.PI;
    strip.position.z = -0.012;
    stopCore.position.z = -0.06;
    stopLamp.add(strip, stopGlow, stopCore);
    // Drawn after the tinted back window, so the glass doesn't dim it (a real lamp shines through it).
    stopLamp.traverse((o) => (o.renderOrder = 10));
    stopGlow.renderOrder = stopCore.renderOrder = 11;
    stopLamp.visible = false;
  }
  // Reversing lamps: a white glow in each tail lamp and a soft white wash on the road behind, only while
  // the car rolls backwards. Placed beside the tail lamps once the model has loaded.
  const reverseGlows = [-1, 1].map((sx) => {
    const s = lampSprite(whiteGlow, sx * 0.55, 0.78, -2.15, 0.5);
    s.material.opacity = 0;
    s.renderOrder = 11;
    return s;
  });
  const reverseHalos = [-1, 1].map((sx) => {
    const s = lampSprite(whiteGlow, sx * 0.55, 0.78, -2.2, 1.2);
    s.material.opacity = 0;
    s.renderOrder = 11;
    return s;
  });
  const reverseBeam = new THREE.SpotLight("#f4f6ff", 0, 16, 0.9, 0.85, 1.6);
  reverseBeam.position.set(0, 0.75, -2.1);
  reverseBeam.target.position.set(0, -0.4, -9);
  chassis.add(reverseBeam, reverseBeam.target);
  interface Wheel {
    steer: THREE.Object3D; // turns about the vertical axis (front wheels)
    spin: THREE.Object3D; // rolls about the axle
    front: boolean;
  }
  const wheels: Wheel[] = [];
  let wheelRadius = 0.33, wheelbase = 2.65;

  // ── Cockpit: a steering wheel that turns, and live dials ─────────────────
  // The model's interior is one mesh, with the steering wheel and both dials (needles and all) part of it.
  // The wheel is cut out of it by shape and hung on the column, so it turns with the front wheels. Over each
  // printed dial sits a new, lit face of our own, drawn live: the rev counter (with the gear in its middle)
  // and the speedometer. Positions are in the interior mesh's own frame, measured from the model.
  const WHEEL_C = new THREE.Vector3(0.2104, 0.0358, 0.5587); // the middle of the steering wheel
  const WHEEL_AX = new THREE.Vector3(0.0017, -0.4339, 0.901).normalize(); // down the column, towards the dash
  const STEER_RATIO = 4.2; // steering wheel turns per front wheel turn: about 160° at full lock
  let steeringWheel: THREE.Object3D | null = null;
  // Everything inside the wheel's outline (rim, spokes, hub and the badge on it, which is a separate part of
  // the model) is cut out of its mesh and hung from one pivot on the column.
  const splitSteeringWheel = (interior: THREE.Mesh, root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    const toInterior = new THREE.Matrix4().copy(interior.matrixWorld).invert();
    const pivot = new THREE.Object3D();
    pivot.position.copy(WHEEL_C);
    const q = new THREE.Vector3(), M = new THREE.Matrix4();
    const parts: THREE.Mesh[] = [];
    root.traverse((obj) => void ((obj as THREE.Mesh).isMesh && !Array.isArray((obj as THREE.Mesh).material) && parts.push(obj as THREE.Mesh)));
    let taken = 0;
    for (const m of parts) {
      const g = m.geometry, pos = g.attributes.position;
      if (!pos || g.groups.length > 1 || (m as THREE.SkinnedMesh).isSkinnedMesh) continue;
      M.multiplyMatrices(toInterior, m.matrixWorld); // this part's frame -> the interior's frame
      // Each vertex in the wheel's own terms: how far down the column, and how far out from it
      const AX = new Float32Array(pos.count), RAD = new Float32Array(pos.count);
      let any = false;
      for (let i = 0; i < pos.count; i++) {
        q.fromBufferAttribute(pos, i).applyMatrix4(M).sub(WHEEL_C);
        AX[i] = q.dot(WHEEL_AX);
        RAD[i] = q.addScaledVector(WHEEL_AX, -AX[i]).length();
        any ||= RAD[i] < 0.118 && Math.abs(AX[i]) < 0.1;
      }
      if (!any) continue;
      const idx = g.index;
      const tri = (t: number) => (idx ? idx.getX(t) : t);
      const count = idx ? idx.count : pos.count;
      const keep: number[] = [], wheel: number[] = [];
      // A triangle is the wheel's if all of it is inside the rim and its middle is in the wheel's slab (the hub's
      // sides reach back towards the column, so a test on every corner would leave the hub behind)
      for (let t = 0; t < count; t += 3) {
        const a = tri(t), b = tri(t + 1), c = tri(t + 2);
        const mid = (AX[a] + AX[b] + AX[c]) / 3;
        const inside = RAD[a] < 0.118 && RAD[b] < 0.118 && RAD[c] < 0.118 && mid > -0.08 && mid < 0.045 && Math.max(AX[a], AX[b], AX[c]) < 0.09;
        (inside ? wheel : keep).push(a, b, c);
      }
      if (!wheel.length) continue;
      const wg = new THREE.BufferGeometry();
      for (const [k, v] of Object.entries(g.attributes)) wg.setAttribute(k, v);
      wg.setIndex(wheel);
      wg.computeBoundingSphere();
      g.setIndex(keep);
      g.clearGroups();
      g.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, m.material);
      wm.matrixAutoUpdate = false;
      wm.matrix.makeTranslation(-WHEEL_C.x, -WHEEL_C.y, -WHEEL_C.z).multiply(M); // same place as before, now on the pivot
      pivot.add(wm);
      taken += wheel.length / 3;
    }
    if (taken < 100) return;
    interior.add(pivot);
    steeringWheel = pivot;
  };
  // Where a point of the texture lands on the mesh: the triangle that holds it in texture space, nearest `near`
  const uvPoint = (m: THREE.Mesh, u: number, v: number, near: THREE.Vector3) => {
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
    if (!uv || !idx) return null;
    let best: THREE.Vector3 | null = null, bd = Infinity;
    const p = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const ax = uv.getX(a), ay = uv.getY(a), bx = uv.getX(b), by = uv.getY(b), cx = uv.getX(c), cy = uv.getY(c);
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / det;
      const l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      A.fromBufferAttribute(pos, a);
      B.fromBufferAttribute(pos, b);
      C.fromBufferAttribute(pos, c);
      p.set(0, 0, 0).addScaledVector(A, l1).addScaledVector(B, l2).addScaledVector(C, l3);
      const d = p.distanceToSquared(near);
      if (d < bd) (bd = d), (best = p.clone());
    }
    return best;
  };
  // The dials, as drawn: [kind, centre in the texture (px of 512), max value, labels every, red from]
  type Dial = { kind: "rev" | "speed"; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; shown: string };
  const dials: Dial[] = [];
  const DIAL_PX = 512, DIAL_R_TEX = 83 / 512;
  const SWEEP = (Math.PI * 4) / 3; // 240°, clockwise from 9 o'clock
  const drawDial = (d: Dial, value: number) => {
    const g = d.g, S = DIAL_PX, c = S / 2, R = S / 2 - 4;
    const rev = d.kind === "rev";
    const max = rev ? 8 : 260, step = rev ? 1 : 20, minor = rev ? 0.5 : 10, red = rev ? 7 : Infinity;
    const ang = (x: number) => Math.PI + (Math.min(max, Math.max(0, x)) / max) * SWEEP;
    g.save();
    g.clearRect(0, 0, S, S);
    // Face: deep black, a thin chrome edge, a lit ring of ticks
    const face = g.createRadialGradient(c, c * 0.9, R * 0.1, c, c, R);
    face.addColorStop(0, "#1a1b1f");
    face.addColorStop(1, "#060607");
    g.fillStyle = face;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = "#8b8e95";
    g.stroke();
    if (red < max) {
      g.beginPath();
      g.arc(c, c, R * 0.9, ang(red), ang(max));
      g.lineWidth = R * 0.09;
      g.strokeStyle = "#d4161b";
      g.stroke();
    }
    g.lineCap = "butt";
    for (let x = 0; x <= max + 1e-6; x += minor) {
      const a = ang(x), major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      const r0 = R * (major ? 0.78 : 0.84), r1 = R * 0.95;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.lineWidth = major ? 7 : 3.5;
      g.strokeStyle = x >= red ? "#ff3b30" : "#f4f1ea";
      g.stroke();
      if (major) {
        g.fillStyle = x >= red ? "#ff3b30" : "#f4f1ea";
        g.font = `600 ${rev ? 50 : 29}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const rt = R * (rev ? 0.6 : 0.64);
        g.fillText(String(x), c + Math.cos(a) * rt, c + Math.sin(a) * rt);
      }
    }
    g.fillStyle = "#9a9ca3";
    g.font = `500 22px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.fillText(rev ? "×1000 r/min" : "km/h", c, c + R * 0.36);
    // Needle: a tapered red blade with a soft glow, and a black cap
    const a = ang(value);
    g.translate(c, c);
    g.rotate(a);
    g.shadowColor = "rgba(255, 60, 30, 0.85)";
    g.shadowBlur = 14;
    g.fillStyle = "#ff3a1e";
    g.beginPath();
    g.moveTo(-R * 0.16, -8);
    g.lineTo(R * 0.86, -2.5);
    g.lineTo(R * 0.86, 2.5);
    g.lineTo(-R * 0.16, 8);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#121316";
    g.beginPath();
    g.arc(0, 0, R * 0.1, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#55585f";
    g.stroke();
    g.restore();
    d.tex.needsUpdate = true;
  };
  // The display between the dials: the gear, big, and the speed in figures
  let display: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; shown: string } | null = null;
  const drawDisplay = (kmh: number, gear: string) => {
    if (!display) return;
    const g = display.g, W = 512, H = 256;
    g.fillStyle = "#050607";
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#ffb13b";
    g.shadowColor = "rgba(255, 177, 59, 0.6)";
    g.shadowBlur = 12;
    g.font = `700 150px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.fillText(gear, W * 0.3, H * 0.74);
    g.shadowBlur = 0;
    g.fillStyle = "#f4f1ea";
    g.font = `600 92px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "right";
    g.fillText(String(Math.round(kmh)), W * 0.9, H * 0.6);
    g.fillStyle = "#9a9ca3";
    g.font = `500 36px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.fillText("km/h", W * 0.9, H * 0.84);
    g.fillStyle = "#6b6e75";
    g.font = `500 30px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.fillText("GEAR", W * 0.3, H * 0.2);
    display.tex.needsUpdate = true;
  };
  const makeDials = (m: THREE.Mesh) => {
    const eye = new THREE.Vector3(0.221, 0.19, 0.122); // the driver's eyes, in this mesh's frame
    for (const [kind, px] of [["rev", 92.5], ["speed", 261.25]] as const) {
      const u = px / 512, v = 358.75 / 512;
      const guess = new THREE.Vector3(kind === "rev" ? 0.259 : 0.158, 0.04, 0.748);
      // The centre, and points half a radius across and down the dial (the very edge is off the dial's face)
      const o = uvPoint(m, u, v, guess), ex = uvPoint(m, u + DIAL_R_TEX / 2, v, guess), ey = uvPoint(m, u, v + DIAL_R_TEX / 2, guess);
      if (!o || !ex || !ey || o.distanceTo(guess) > 0.06) continue;
      ex.sub(o).multiplyScalar(2);
      ey.sub(o).multiplyScalar(2);
      const n = new THREE.Vector3().crossVectors(ex, ey).normalize();
      if (n.dot(eye.clone().sub(o)) < 0) n.negate();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = DIAL_PX;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 72),
        // Unlit, so it reads as a backlit dial at night; a little under full brightness
        new THREE.MeshBasicMaterial({ map: tex, color: "#d9d9d9", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeBasis(ex, ey, n.clone().multiplyScalar(0.01)).setPosition(o.addScaledVector(n, 0.0012));
      m.add(mesh);
      const d: Dial = { kind, g: canvas.getContext("2d")!, tex, shown: "" };
      drawDial(d, 0);
      dials.push(d);
      if (kind === "rev") {
        // The display sits between the dials, a little higher, facing the same way as the dials
        const canvas2 = document.createElement("canvas");
        canvas2.width = 512;
        canvas2.height = 256;
        const tex2 = new THREE.CanvasTexture(canvas2);
        tex2.colorSpace = THREE.SRGBColorSpace;
        tex2.anisotropy = 8;
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex2, color: "#d9d9d9", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
        screen.matrixAutoUpdate = false;
        const ux = ex.clone().normalize(), uy = ey.clone().normalize(), r = ex.length();
        const at = new THREE.Vector3(0.2087, 0.0533, 0.7524).addScaledVector(n, 0.0015);
        screen.matrix.makeBasis(ux.multiplyScalar(r * 0.86), uy.multiplyScalar(r * 0.43), n.clone().multiplyScalar(0.01)).setPosition(at);
        m.add(screen);
        display = { g: canvas2.getContext("2d")!, tex: tex2, shown: "" };
        drawDisplay(0, "1");
      }
    }
  };
  const cockpit = (root: THREE.Object3D) => {
    let interior: THREE.Mesh | null = null;
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material)?.name === "Interior") interior = m;
    });
    if (!interior) return;
    try {
      makeDials(interior); // before the wheel is cut out: it shares the texture search
      splitSteeringWheel(interior, root);
    } catch (e) {
      console.warn("Cockpit details skipped", e);
    }
  };

  const carLoaded = new GLTFLoader(manager)
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync("/sim/car.glb")
    .then((gltf) => {
      const root = gltf.scene;
      let box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      root.scale.setScalar(4.6 / Math.max(size.x, size.z));
      if (size.x > size.z) root.rotation.y = Math.PI / 2; // length along z
      root.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(root);
      const centre = box.getCenter(new THREE.Vector3());
      root.position.x -= centre.x;
      root.position.z -= centre.z;
      root.position.y -= box.min.y;
      const holder = new THREE.Group();
      holder.add(root);
      holder.updateMatrixWorld(true);
      // Lamps: they say which end is the front, and where the glows sit.
      const head = new THREE.Box3(), tail = new THREE.Box3(), tailOne = new THREE.Box3();
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshPhysicalMaterial[]) {
          if (!mat?.isMeshStandardMaterial) continue;
          const name = mat.name;
          const lower = name.toLowerCase();
          if (/^Head_(Guide|Projector)$/.test(name)) {
            head.expandByObject(m);
            mat.emissive.set("#fff4e0");
            mat.emissiveMap = mat.map;
            mat.emissiveIntensity = 5;
          } else if (name === "Tail_Guide") {
            // The C-shaped LED light guide in each tail lamp
            tail.expandByObject(m);
            // One lamp's C on its own (the +x side): the reversing lamp sits inside it
            const pos = m.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
              if (p.x > 0) tailOne.expandByPoint(p);
            }
            mat.color.set("#2a0604");
            mat.emissive.set("#ff3a12");
            mat.emissiveMap = mat.map;
            mat.emissiveIntensity = 2.2;
            if (!tailMats.includes(mat)) tailMats.push(mat);
          } else if (name === "Bright_Lights_Tail") {
            // The red lens over the tail lamps
            mat.emissive.set("#ff1206");
            mat.emissiveIntensity = 0.12;
            if (!tailLens.includes(mat)) tailLens.push(mat);
          } else if (/light|bulb/.test(lower) && !/backdrop/.test(lower)) {
            mat.emissiveIntensity = 0;
          }
          if (/plastic|rubber|tire|tyre|carbon|logo|emblem|material\.01|brake_light|glass/.test(lower) && !/surr/.test(lower)) mat.metalness = 0;
          if (/rubber|tire|tyre/.test(lower)) mat.roughness = Math.max(mat.roughness, 0.85);
          if (lower === "car_paint") {
            if (mat.roughness > 0.2) (mat.metalness = 0.55), (mat.roughness = 0.38);
            mat.clearcoat = 1;
            mat.clearcoatRoughness = 0.03;
            mat.envMapIntensity = 2.2;
          }
          if (/window_glass/.test(lower)) (mat.roughness = 0.03), (mat.depthWrite = false);
          if (/mirror|chrome|reflective_metal/.test(lower)) mat.metalness = 1;
          mat.needsUpdate = true;
        }
      });
      const hc = head.isEmpty() ? null : head.getCenter(new THREE.Vector3());
      const tc = tail.isEmpty() ? null : tail.getCenter(new THREE.Vector3());
      const frontZ = hc ? Math.sign(hc.z) : tc ? -Math.sign(tc.z) : 1;
      if (frontZ < 0) holder.rotation.y = Math.PI; // nose towards +z
      // Third brake light: centred, at the foot of the back window, just inside the glass. The foot of the
      // window is the lowest point of the glass near the car's rear end.
      const rear: THREE.Vector3[] = [];
      const pt = new THREE.Vector3();
      let rearMost = frontZ > 0 ? Infinity : -Infinity;
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh || (m.material as THREE.Material)?.name !== "Window_Glass") return;
        const pos = m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          pt.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          if (Math.abs(pt.x) > 0.25) continue; // the middle of the window only
          rear.push(pt.clone());
          rearMost = frontZ > 0 ? Math.min(rearMost, pt.z) : Math.max(rearMost, pt.z);
        }
      });
      const foot = rear.filter((p) => Math.abs(p.z - rearMost) < 0.12).sort((a, b) => a.y - b.y)[0];
      if (foot) {
        stopLamp.position.set(0, foot.y + 0.03, foot.z + frontZ * 0.07);
        if (frontZ < 0) stopLamp.rotation.y = Math.PI;
        stopGlow.position.z = -0.08; // the glow sits on the glass, so it reads from behind
        holder.add(stopLamp);
        stopLamp.visible = true;
      }
      chassis.add(holder);
      if (tc) {
        // Just inboard of the C-shaped LEDs, at the same height, sitting on the lens
        // The clear section inside each lamp's C-shaped LED guide
        const one = tailOne.getCenter(new THREE.Vector3());
        // (the C wraps round the corner of the car, so the part seen from behind is a little inboard of its middle)
        const tw = tailOne.isEmpty() ? tail.max.x - 0.14 : one.x - 0.03;
        const rz = -Math.max(Math.abs(tail.min.z), Math.abs(tail.max.z)); // the back of the lamps
        // A little behind the lens (so the boot lid doesn't hide them) and a little higher, so from the
        // chase camera, looking down, they still sit on the lamps.
        reverseGlows.forEach((s, i) => s.position.set((i ? 1 : -1) * tw, tc.y + 0.06, rz - 0.12));
        reverseHalos.forEach((s, i) => s.position.set((i ? 1 : -1) * tw, tc.y + 0.08, rz - 0.16));
        reverseBeam.position.set(0, tc.y, rz);
        reverseBeam.target.position.set(0, -0.4, rz - 7);
      }
      if (hc) {
        const hw = Math.max(0.5, (head.max.x - head.min.x) / 2 - 0.18);
        headGlows.forEach((s, i) => s.position.set((i ? 1 : -1) * hw, hc.y, Math.abs(hc.z) + 0.12));
        beams.forEach((b, i) => {
          const sx = i ? 1 : -1;
          b.position.set(sx * hw, hc.y, Math.abs(hc.z));
          b.target.position.set(sx * (hw + 1.7), -0.6, 22);
        });
      }

      // Wheels: take each one off the body and hang it from the car itself, on a steering pivot and an axle,
      // so the body can lean without the tyres leaving the road.
      const saved = [car.position.clone(), car.quaternion.clone(), chassis.position.clone(), chassis.rotation.clone()] as const;
      car.position.set(0, 0, 0);
      car.quaternion.identity();
      chassis.position.set(0, 0, 0);
      chassis.rotation.set(0, 0, 0);
      car.updateMatrixWorld(true);
      const named = (re: RegExp) => {
        const out: THREE.Object3D[] = [];
        root.traverse((obj) => void (re.test(obj.name) && out.push(obj)));
        return out;
      };
      const centreOf = (obj: THREE.Object3D) => new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      const calipers = named(/^Calliper[ _](Front|Rear)[ _][LR]_\d+$/);
      const frontZs: number[] = [], rearZs: number[] = [];
      for (const node of named(/^3DWheel[ _](Front|Rear)[ _][LR]/)) {
        let tyre: THREE.Object3D = node;
        node.traverse((obj) => void (/^Tire[ _]/.test(obj.name) && (tyre = obj)));
        const tb = new THREE.Box3().setFromObject(tyre);
        const c = tb.getCenter(new THREE.Vector3());
        wheelRadius = (tb.max.y - tb.min.y) / 2;
        const steer = new THREE.Object3D();
        steer.position.copy(c);
        car.add(steer);
        const spin = new THREE.Object3D();
        steer.add(spin);
        steer.updateMatrixWorld(true);
        spin.attach(node);
        const front = c.z > 0;
        (front ? frontZs : rearZs).push(c.z);
        // Brake callipers turn with the front wheels but do not roll.
        for (const cal of calipers) {
          const cc = centreOf(cal);
          if (Math.abs(cc.z - c.z) < 0.5 && Math.sign(cc.x) === Math.sign(c.x)) steer.attach(cal);
        }
        wheels.push({ steer, spin, front });
      }
      if (frontZs.length && rearZs.length) wheelbase = frontZs[0] - rearZs[0];
      o.canvas.dataset.wheels = String(wheels.length);
      cockpit(root);
      car.position.copy(saved[0]);
      car.quaternion.copy(saved[1]);
      chassis.position.copy(saved[2]);
      chassis.rotation.copy(saved[3]);
    });
  // Ready once the car and every texture are in, and the shaders are compiled (so the first moments
  // after the loader don't stutter). The next drawn frame then tells the page.
  let readyToTell = false, told = false, dead = false;
  Promise.all([carLoaded, texturesLoaded])
    .then(() => renderer.compileAsync(scene, camera).catch(() => {}))
    .then(() => void (readyToTell = true))
    .catch((e) => {
      if (told || dead) return;
      told = true;
      console.warn("Car model did not load; showing the picture story", e);
      o.onFail?.(e);
    });

  // Tyre smoke for the handbrake turn
  const smokeTex = glowTexture("rgba(210,214,224,0.5)", "rgba(190,195,208,0.2)");
  const smoke: { s: THREE.Sprite; at: number; placed: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    scene.add(s);
    smoke.push({ s, at: 0.22 + i * 0.1, placed: false });
  }

  // ── Sky: gradient dome, stars and a Milky Way band ───────────────────────
  const sky = new THREE.Group();
  scene.add(sky);
  const startDir = road.getTangentAt(0);
  const BASE_YAW = Math.atan2(startDir.x, startDir.z);
  const skyDir = (yaw: number, pitch: number, out = new THREE.Vector3()) =>
    out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uHorizon: { value: new THREE.Color("#121829") }, uZenith: { value: new THREE.Color("#010208") } },
      vertexShader: "varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 uHorizon; uniform vec3 uZenith; varying float vY; void main(){ float t = pow(clamp(vY*1.25,0.0,1.0),0.55); gl_FragColor = vec4(mix(uHorizon,uZenith,t),1.0); }",
    }),
  );
  dome.renderOrder = -2;
  sky.add(dome);
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader:
      "attribute float aSize; attribute float aPhase; attribute vec3 aColor; uniform float uTime; uniform float uPx; varying vec3 vC; varying float vA;" +
      "void main(){ vC = aColor; float tw = 0.72 + 0.28*sin(uTime*(0.6+fract(aPhase)*1.8)+aPhase*6.283); vA = tw; gl_PointSize = aSize*uPx*(0.85+0.3*tw); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.05,d); gl_FragColor = vec4(vC, a*vA); }",
  });
  {
    const N = phone ? 3600 : 8000;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N), colr = new Float32Array(N * 3);
    const rnd = seeded(20100);
    const a = skyDir(BASE_YAW - 1.25, 0.06), b = skyDir(BASE_YAW + 0.75, 1.05);
    const nrm = new THREE.Vector3().crossVectors(a, b).normalize();
    const e1 = a.clone().normalize(), e2 = new THREE.Vector3().crossVectors(nrm, e1).normalize();
    const v = new THREE.Vector3(), c = new THREE.Color();
    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.9;
    for (let i = 0; i < N; i++) {
      if (i < N * 0.55) {
        const th = rnd() * Math.PI * 2;
        v.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th)).addScaledVector(nrm, gauss() * 0.16).normalize();
        c.setHSL(rnd() < 0.5 ? 0.09 : 0.62, 0.45, 0.62 + rnd() * 0.2);
        size[i] = 0.9 + rnd() * 1.2;
      } else {
        const y = rnd() * 1.1 - 0.1, th = rnd() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - y * y));
        v.set(Math.cos(th) * r, y, Math.sin(th) * r);
        c.setHSL(rnd() < 0.3 ? 0.08 : 0.6, 0.3 * rnd(), 0.75 + rnd() * 0.25);
        size[i] = 1.1 + Math.pow(rnd(), 6) * 3.4;
      }
      if (v.y < -0.08) v.y = -v.y;
      pos.set([v.x * 1200, v.y * 1200, v.z * 1200], i * 3);
      colr.set([c.r, c.g, c.b], i * 3);
      phase[i] = rnd() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colr, 3));
    const points = new THREE.Points(geo, starMat);
    points.frustumCulled = false;
    points.renderOrder = -1;
    sky.add(points);
    const haze = glowTexture("rgba(150,170,255,0.5)", "rgba(110,120,220,0.16)");
    for (let k = -3; k <= 3; k++) {
      const th = 0.75 + k * 0.2;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haze, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.11 }));
      v.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th)).normalize();
      if (v.y < 0) v.negate();
      s.position.copy(v).multiplyScalar(1150);
      s.scale.setScalar(520 - Math.abs(k) * 40);
      s.renderOrder = -1;
      sky.add(s);
    }
  }

  // ── The constellation: a tree around the centre star ─────────────────────
  // The centre star is the person. Around it sit the top-level stars (the four disciplines, Samsung and UNIMAS);
  // each place fans out beyond its discipline, and each piece of work beyond its place. Positions are
  // offsets (right, up) in radians from the centre of the map.
  const R = 420;
  const PITCH0 = phone ? 0.86 : 0.8; // how high the centre of the map sits
  const tall = innerHeight > innerWidth;
  const TOP_AT: Record<string, [number, number]> = tall
    ? { passion: [0, 0.45], engineering: [-0.15, 0.27], brand: [0.15, 0.27], photography: [0, -0.19], samsung: [-0.22, 0.07], unimas: [0.22, 0.07] }
    : { passion: [0, 0.28], engineering: [-0.36, 0.02], brand: [0.36, 0.02], photography: [0, -0.15], samsung: [-0.21, 0.17], unimas: [0.21, 0.17] };
  const colorOf = new Map(o.clusters.map((c) => [c.id, new THREE.Color(c.color)]));
  const C0 = skyDir(BASE_YAW, PITCH0);
  const EAST = new THREE.Vector3(-Math.cos(BASE_YAW), 0, Math.sin(BASE_YAW)); // screen right
  const NORTH = new THREE.Vector3(-Math.sin(BASE_YAW) * Math.sin(PITCH0), Math.cos(PITCH0), -Math.cos(BASE_YAW) * Math.sin(PITCH0));
  const place = (x: number, y: number) => C0.clone().addScaledVector(EAST, Math.tan(x)).addScaledVector(NORTH, Math.tan(y)).normalize().multiplyScalar(R);
  interface Star extends PassNode {
    x: number;
    y: number;
    sprite: THREE.Sprite;
    el: HTMLElement;
    sx: number;
    sy: number;
    vis: boolean;
    size: number;
    side: number; // projects list out to this side of their place (-1 left, 1 right)
    nb: Set<string>;
  }
  const stars: Star[] = [];
  const starGlow = glowTexture("rgba(255,255,255,1)", "rgba(255,255,255,0.28)");
  const constellation = new THREE.Group();
  scene.add(constellation);
  const star = (color: THREE.ColorRepresentation | undefined, x: number, y: number, size: number) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: starGlow, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, opacity: 0 }),
    );
    sprite.position.copy(place(x, y));
    sprite.scale.setScalar(size);
    constellation.add(sprite);
    return sprite;
  };
  const centreStar = star("#ffffff", 0, 0, 20);
  {
    // Lay the tree out: children fan out on the far side of their parent, away from where the line came in.
    const kids = new Map<string, PassNode[]>();
    for (const n of o.nodes) kids.set(n.parent ?? "", [...(kids.get(n.parent ?? "") ?? []), n]);
    const at = new Map<string, [number, number]>();
    const side = new Map<string, number>();
    const fan = (id: string, x: number, y: number, dir: number, level: number) => {
      const list = kids.get(id) ?? [];
      if (level === 1) {
        // Places fan out beyond their discipline. A discipline whose places have nothing under them
        // (Photography) fans wider, so the names sit side by side.
        const leafy = list.every((k) => !(kids.get(k.id) ?? []).length);
        if (leafy && Math.abs(x) < 0.05) {
          // A discipline straight below (or above) the centre: its places hang in a short column, names
          // alternating left and right so they never collide.
          const sgnY = y < 0 ? -1 : 1, gap = tall ? 0.04 : 0.03;
          list.forEach((k, i) => {
            const sd = i % 2 ? 1 : -1;
            at.set(k.id, [x + sd * 0.012, y + sgnY * ((tall ? 0.075 : 0.058) + i * gap)]);
            side.set(k.id, sd);
          });
          return;
        }
        const r = tall ? 0.13 : 0.16;
        const step = tall ? 0.62 : 0.6;
        list.forEach((k, i) => {
          const a = dir + (i - (list.length - 1) / 2) * step;
          const kx = x + Math.cos(a) * r, ky = y + Math.sin(a) * r;
          at.set(k.id, [kx, ky]);
          fan(k.id, kx, ky, a, 2);
        });
      } else {
        // Projects list in a column on the outer side of their place, names facing outwards.
        const sgn = x < 0 ? -1 : 1;
        const gap = tall ? 0.04 : 0.034;
        list.forEach((k, i) => {
          at.set(k.id, [x + sgn * (tall ? 0.06 : 0.085), y + ((list.length - 1) / 2 - i) * gap]);
          side.set(k.id, sgn);
        });
      }
    };
    const top = kids.get("") ?? [];
    top.forEach((n, i) => {
      const [x, y] = TOP_AT[n.id] ?? [Math.cos((i / top.length) * Math.PI * 2) * 0.3, Math.sin((i / top.length) * Math.PI * 2) * 0.3];
      at.set(n.id, [x, y]);
      fan(n.id, x, y, Math.atan2(y, x), 1);
    });
    for (const n of o.nodes) {
      const [x, y] = at.get(n.id) ?? [0, 0];
      const size = n.hub ? 30 : n.level === 3 ? 10 : 17;
      const sprite = star(colorOf.get(n.cluster), x, y, size);
      const el = document.createElement("span");
      el.className = "lab" + (n.hub ? " hub" : n.level === 3 ? " l3" : " l2");
      el.textContent = n.label;
      el.style.setProperty("--c", o.clusters.find((c) => c.id === n.cluster)?.color ?? "#fff");
      o.labels.appendChild(el);
      stars.push({ ...n, x, y, sprite, el, sx: 0, sy: 0, vis: false, size, side: side.get(n.id) ?? 0, nb: new Set() });
    }
  }
  const starById = new Map(stars.map((s) => [s.id, s]));
  // Lines: the tree (and the Passion links, which bridge the disciplines) always; other cross links only
  // when one of their stars is selected.
  const lineGeo = new THREE.BufferGeometry(), hotGeo = new THREE.BufferGeometry(), spokeGeo = new THREE.BufferGeometry();
  {
    const pos: number[] = [], col: number[] = [];
    for (const [a, b, kind] of o.edges) {
      const A = starById.get(a), B = starById.get(b);
      if (!A || !B) continue;
      A.nb.add(b);
      B.nb.add(a);
      if (kind === "link" && !A.hub) continue;
      pos.push(...A.sprite.position.toArray(), ...B.sprite.position.toArray());
      const ca = colorOf.get(A.cluster)!, cb = colorOf.get(B.cluster)!;
      const k = kind === "link" ? 0.55 : B.level === 3 ? 0.55 : 1;
      col.push(ca.r * k, ca.g * k, ca.b * k, cb.r * k, cb.g * k, cb.b * k);
    }
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    hotGeo.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    // Spokes from the centre to each top-level star
    const sp: number[] = [], sc: number[] = [];
    for (const s of stars) {
      if (s.level !== 1) continue;
      const c = colorOf.get(s.cluster)!, k = s.hub ? 1 : 0.5;
      sp.push(...centreStar.position.toArray(), ...s.sprite.position.toArray());
      sc.push(k, k, k, c.r * k, c.g * k, c.b * k);
    }
    spokeGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    spokeGeo.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
  }
  const lineOpts = { transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending };
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, ...lineOpts });
  const spokeMat = new THREE.LineBasicMaterial({ vertexColors: true, ...lineOpts });
  const hotMat = new THREE.LineBasicMaterial({ color: "#fff3dc", ...lineOpts });
  const lines = new THREE.LineSegments(lineGeo, lineMat), hot = new THREE.LineSegments(hotGeo, hotMat), spokes = new THREE.LineSegments(spokeGeo, spokeMat);
  lines.frustumCulled = hot.frustumCulled = spokes.frustumCulled = false;
  constellation.add(lines, spokes, hot);

  // ── State ────────────────────────────────────────────────────────────────
  let progress = 0, eased = 0;
  let active = true;
  let selected: Star | null = null, hover: Star | null = null;
  let opened: Star | null = null; // the place whose projects are showing (hovered last, with a mouse)
  let yaw = 0, yawTo = 0; // looking around, as offsets from the centre of the map
  const AIM = PITCH0 - 0.05; // look a little below the centre star, so the map sits clear of the hints at the bottom
  let pitch = AIM, pitchTo = AIM;
  const YAW_LIMIT = tall ? 0.6 : 0.5, LOOK_X = 0.24, LOOK_Y = 0.17;
  // Where you stand to look at the sky: beside the road, just behind the car.
  const startPt = road.getPointAt(0);
  const skyPos = startPt.clone().addScaledVector(startDir, -7).add(new THREE.Vector3(1.6, 0, 0));
  skyPos.y = heightAt(skyPos.x, skyPos.z) + 1.9;
  constellation.position.copy(skyPos);
  let first = true;
  let W_ = 1, H_ = 1;

  const resize = () => {
    const w = o.canvas.clientWidth, h = o.canvas.clientHeight;
    if (!w || !h) return;
    W_ = w;
    H_ = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 74 : w / h < 1.2 ? 64 : 55;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(o.canvas);
  resize();

  const select = (id: string | null, notify = true, recentre = false) => {
    selected = id ? (starById.get(id) ?? null) : null;
    const pos: number[] = [];
    if (selected) for (const nb of selected.nb) pos.push(...selected.sprite.position.toArray(), ...starById.get(nb)!.sprite.position.toArray());
    hotGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (selected && recentre) yawTo = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, -selected.x));
    if (notify) o.onSelect(selected?.id ?? null);
  };

  // ── Looking around and picking stars while the sky is in view ────────────
  // With a mouse the view follows the pointer; on touch you drag sideways (up and down scrolls the page).
  const inSky = () => eased < F_SKY_END + 0.12;
  const pick = (x: number, y: number, radius: number) => {
    let best: Star | null = null, bd = radius * radius;
    for (const s of stars) {
      if (!s.vis) continue;
      const d = (s.sx - x) * (s.sx - x) + (s.sy - y) * (s.sy - y);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  };
  let drag: { x: number; y: number; yaw: number; moved: number; id: number; touch: boolean } | null = null;
  const local = (e: PointerEvent) => {
    const r = o.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const interactive = (t: EventTarget | null) => t instanceof Element && !!t.closest("a,button,[data-card]");
  o.pointer.addEventListener("pointerdown", (e) => {
    if (!inSky() || interactive(e.target)) return;
    drag = { x: e.clientX, y: e.clientY, yaw: yawTo, moved: 0, id: e.pointerId, touch: e.pointerType !== "mouse" };
  });
  // With a mouse, the pointer also steers the camera on the drive: it swings around the car towards
  // where you point, and back to the planned shot when the pointer leaves the window.
  let lookToX = 0, lookToY = 0, lookX = 0, lookY = 0;
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    lookToX = Math.max(-1, Math.min(1, (e.clientX / innerWidth) * 2 - 1));
    lookToY = Math.max(-1, Math.min(1, (e.clientY / innerHeight) * 2 - 1));
  });
  document.documentElement.addEventListener("mouseleave", () => ((lookToX = 0), (lookToY = 0)));
  addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
    if (drag?.touch && e.pointerId === drag.id) {
      const k = (camera.fov * Math.PI) / 180 / H_;
      yawTo = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, drag.yaw + (e.clientX - drag.x) * k * 1.1));
    } else if (e.pointerType === "mouse" && inSky()) {
      const [x, y] = local(e);
      yawTo = -((x / W_) * 2 - 1) * LOOK_X;
      pitchTo = AIM - ((y / H_) * 2 - 1) * LOOK_Y;
      hover = interactive(e.target) ? null : pick(x, y, 30);
      // Hovering a place opens it; it stays open while the pointer is near, so you can reach its projects.
      if (hover?.level === 2) opened = hover;
      else if (hover?.level === 1) opened = null;
      else if (opened && !hover && Math.hypot(x - opened.sx, y - opened.sy) > 0.24 * Math.min(W_, H_)) opened = null;
      o.pointer.style.cursor = hover ? "pointer" : "";
    }
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasTap = drag.moved < 8, touch = drag.touch;
    drag = null;
    if (!wasTap || e.type === "pointercancel") return;
    const [x, y] = local(e);
    const s = pick(x, y, touch ? 44 : 30);
    select(s ? s.id : null, true, touch);
  };
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);

  // ── Camera shots: one per chapter, as offsets in the car's own frame ─────
  // [right, up, forward] for the camera, then for the point it looks at.
  const SHOTS: [number, number, number, number, number, number][] = [
    [0, 3.4, -10.5, 0, 1.4, 6], // chase
    [8.5, 2.7, 3.5, 0, 0.7, 0.6], // tracking alongside, over the barrier
    [-7, 24, -22, 0, 0, 7], // high above
    [-2.9, 0.85, 10.5, 0, 0.9, 0], // low, in front
    [3.1, 0.8, -6.8, 0, 1.0, 3.5], // low rear quarter
    [2.6, 4.6, 14, 0, 0.8, -1], // leading the car, looking back
  ];
  while (SHOTS.length < CHAPTERS) SHOTS.push(SHOTS[SHOTS.length % 6]);
  const shot = new Float32Array(6);

  // ── Frame ────────────────────────────────────────────────────────────────
  const clock = new THREE.Timer();
  const carPos = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const lastPos = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const endYaw = Math.atan2(endDir.x, endDir.z);
  // Sprung body: each value chases its target like a damped spring, so it leans in and settles.
  const spring = { roll: 0, rollV: 0, dive: 0, diveV: 0 };
  const chase = (key: "roll" | "dive", target: number, dt: number, k = 60, c = 9) => {
    const vk = (key + "V") as "rollV" | "diveV";
    spring[vk] += (k * (target - spring[key]) - c * spring[vk]) * dt;
    spring[key] += spring[vk] * dt;
  };
  let wheelSpin = 0, steerNow = 0, brakeNow = 0, reverseNow = 0, travelled = 0, speed = 0, lastSpeed = 0;

  // ── Drive the car yourself ───────────────────────────────────────────────
  // Anywhere once the car is on screen, pressing W, A, S, D or Space (or the engine button, with a joystick on
  // phones) hands it over where it is: a chase camera drops in behind it and you can drive anywhere on the
  // mountain. Esc or the engine button ends it, and the page comes back at the part of the story nearest the car.
  let driving = false, handbrakeOn = false;
  const keys = new Set<string>();
  // The car: a six-speed WRX STI, geared for this mountain. Top speed in each gear at the red line (m/s),
  // and how hard it pulls in each gear (m/s²). Each upshift cuts the drive for a moment. The tyres give about
  // 1 g of cornering: arrive at a bend too fast and the car won't turn tighter, it runs wide.
  const GEAR_TOP = [12, 19, 26, 33, 40, 47];
  const GEAR_PULL = [7.4, 6.2, 5, 3.9, 3, 2.3];
  const GRIP = 11.5, BRAKE = 9.8, SHIFT_TIME = 0.3; // grip: sticky sports tyres, about 1.17 g
  const dragAt = (v: number) => 0.15 + 0.00042 * v * v; // rolling resistance and air
  const pullAt = (v: number, gear: number) => GEAR_PULL[gear] * (v >= GEAR_TOP[gear] ? 0 : 1 - 0.25 * (v / GEAR_TOP[gear]) ** 4);
  const drv = { x: 0, z: 0, yaw: 0, v: 0, steer: 0, pitch: 0, roll: 0, gear: 0, shift: 0, rpm: IDLE };
  let gaugeAt = 0;
  const groundEuler = new THREE.Euler();
  const chaseCam = new THREE.Vector3(), chaseLook = new THREE.Vector3();
  // The chase camera sits close and low behind the car, like a racing game's: the car fills the lower middle
  // of the screen and the road runs on to the horizon above its roof.
  // A portrait phone sees a narrow slice, so there it stands a little further back.
  let CHASE_BACK = 4.6, CHASE_UP = 1.55;
  const CHASE_AHEAD = 10, CHASE_AIM = 0.95;
  const chaseFit = () => ([CHASE_BACK, CHASE_UP] = W_ < H_ ? [6.2, 1.85] : [4.6, 1.55]);
  const DRIVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "Space"];
  const sound = new PassSound();
  // A problem in the sound (an old browser, a blocked audio device) must never freeze the picture.
  let soundBroken = false;
  const soundSafe = (fn: () => void) => {
    if (soundBroken) return;
    try {
      fn();
    } catch (err) {
      soundBroken = true;
      console.error("Sound stopped", err);
      o.onSound?.("unavailable");
    }
  };
  let lastTick = 0;
  // Camera views, cycled with C: behind the car, over the bonnet, and from the driver's seat (the model is left-hand drive).
  const VIEWS = ["chase", "hood", "seat"] as const;
  let view = 0;
  const canDrive = () => active && !dead && told && eased > 0.75 && progress > 0.75;
  let stickX = 0, stickY = 0, snap = false, sweepAt = -9;
  // The page stop nearest the car: the chapter whose stretch of road it is on, or contact in the car park.
  const stopNear = () => {
    const dx = drv.x - lotC.x, dz = drv.z - lotC.z;
    if (Math.abs(dx * endDir.x + dz * endDir.z) < LOT_LEN / 2 + 1 && Math.abs(dx * endSide.x + dz * endSide.z) < LOT_WID / 2 + 1) return CHAPTERS + 1;
    const f = F_ROAD0 + confine(drv.x, drv.z).u * (F_ROAD1 - F_ROAD0);
    return Math.max(1, Math.min(CHAPTERS, Math.round(f)));
  };

  // ── Hidden: the time attack, downhill from the car park ──────────────────
  // A chequered line where the car park meets the road starts it; a second one near the bottom ends it.
  // Each torii gate on the way adds time to a countdown. The time for each stretch is worked out from a
  // reference run down this exact road: as fast as the bends allow (about 0.9 g of cornering), accelerating
  // and braking like a real car, through the six gears. The allowance is only a little over that reference.
  const U_START = 1 - 4.5 / ROAD_LEN, U_FINISH = 30 / ROAD_LEN;
  const gateU = o.years.map((_, i) => Math.min(0.985, uAt(i + 1) + 34 / ROAD_LEN)).sort((a, b) => b - a); // in driving order
  // Two races on the same road: downhill from the car park (the original), and the uphill climb from the
  // bottom line to the car park. Each has its checkpoints in driving order and its own time allowances.
  type RaceDir = "down" | "up";
  const route: Record<RaceDir, { checkpoints: number[]; times: number[] }> = {
    down: { checkpoints: [...gateU, U_FINISH], times: [] },
    up: { checkpoints: [...gateU].reverse().concat(U_START), times: [] },
  };
  // The reference run: as fast as the bends allow, accelerating through the gears from a standstill at the
  // start line and braking for what's ahead. Each stretch's allowance is 10% over it, plus half a second.
  for (const dir of ["down", "up"] as RaceDir[]) {
    const i0 = Math.round((dir === "down" ? U_START : U_FINISH) * FN), i1 = Math.round((dir === "down" ? U_FINISH : U_START) * FN);
    const stepI = Math.sign(i1 - i0), n = Math.abs(i1 - i0) + 1;
    const vMax = new Float32Array(n), v = new Float32Array(n);
    for (let k = 0; k < n; k++) vMax[k] = Math.min(GEAR_TOP[5], Math.sqrt(GRIP / Math.max(Math.abs(curv[i0 + stepI * k]), 1e-4)));
    const gearFor = (sp: number) => Math.max(0, GEAR_TOP.findIndex((t) => sp < t * 0.985));
    for (let k = 1; k < n; k++) {
      const a = pullAt(v[k - 1], gearFor(v[k - 1]) === -1 ? 5 : gearFor(v[k - 1])) - dragAt(v[k - 1]);
      v[k] = Math.min(vMax[k], Math.sqrt(Math.max(0, v[k - 1] ** 2 + 2 * a * STEP)));
    }
    for (let k = n - 2; k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * BRAKE * 0.9 * STEP));
    let tAcc = 0, k = 0;
    for (const cu of route[dir].checkpoints) {
      const kEnd = Math.min(n - 1, Math.abs(Math.round(cu * FN) - i0));
      for (; k < kEnd; k++) tAcc += STEP / Math.max(0.5, (v[k] + v[k + 1]) / 2);
      route[dir].times.push(Math.ceil((tAcc * 1.1 + 0.5) * 2) / 2);
      tAcc = 0;
    }
  }
  // The chequered lines across the road
  {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const g = c.getContext("2d")!;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) ((g.fillStyle = (x + y) % 2 ? "#111111" : "#f2f2f2"), g.fillRect(x * 16, y * 16, 16, 16));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    for (const lu of [U_START, U_FINISH]) {
      const i = Math.round(lu * FN), p = fp[i], sd = fs[i];
      const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2 * (32 / 256)), mat);
      line.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(line);
      holder.position.set(p.x, p.y + 0.04, p.z);
      holder.rotation.y = Math.atan2(sd.x, sd.z) - Math.PI / 2;
      scene.add(holder);
    }
  }
  // A burst of gold light at a torii gate as the car goes through it: a flash, a light, and sparks
  const burstN = phone ? 140 : 260;
  const burstPos = new Float32Array(burstN * 3), burstVel = new Float32Array(burstN * 3);
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute("position", new THREE.BufferAttribute(burstPos, 3));
  const burstMat = new THREE.PointsMaterial({ map: glowTexture("rgba(255,236,170,1)", "rgba(255,190,70,0.45)"), color: "#ffd27a", size: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const sparks = new THREE.Points(burstGeo, burstMat);
  sparks.frustumCulled = false;
  const burstFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,244,200,1)", "rgba(255,190,60,0.4)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  const burstLight = new THREE.PointLight("#ffc560", 0, 60, 1.6);
  scene.add(sparks, burstFlash, burstLight);
  let burstAge = 99;
  const burst = (u: number) => {
    const at = road.getPointAt(u).add(new THREE.Vector3(0, 4.2, 0));
    const rnd = seeded(Math.floor(u * 1e6));
    for (let i = 0; i < burstN; i++) {
      // A ring of sparks thrown outwards in the plane of the gate, plus some spray
      const a = rnd() * Math.PI * 2, sp = 6 + rnd() * 10;
      burstPos.set([at.x, at.y, at.z], i * 3);
      burstVel.set([Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + 3, (rnd() - 0.5) * 8], i * 3);
    }
    // turn the spray to face along the road
    const t = road.getTangentAt(u).setY(0).normalize(), sx = t.z, sz = -t.x;
    for (let i = 0; i < burstN; i++) {
      const vx = burstVel[i * 3], vz = burstVel[i * 3 + 2];
      burstVel[i * 3] = vx * sx + vz * t.x;
      burstVel[i * 3 + 2] = vx * sz + vz * t.z;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burstFlash.position.copy(at);
    burstLight.position.copy(at);
    burstAge = 0;
  };
  const burstStep = (dt: number) => {
    if (burstAge > 2) return;
    burstAge += dt;
    const k = burstAge;
    for (let i = 0; i < burstN; i++) {
      burstVel[i * 3 + 1] -= 9 * dt; // they fall
      const drag = Math.exp(-dt * 1.6);
      burstVel[i * 3] *= drag;
      burstVel[i * 3 + 2] *= drag;
      burstPos[i * 3] += burstVel[i * 3] * dt;
      burstPos[i * 3 + 1] += burstVel[i * 3 + 1] * dt;
      burstPos[i * 3 + 2] += burstVel[i * 3 + 2] * dt;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burstMat.opacity = Math.max(0, 1 - k / 1.6);
    burstMat.size = 0.55 * (1 - k * 0.3);
    burstFlash.material.opacity = Math.max(0, 1 - k / 0.5);
    burstFlash.scale.setScalar(4 + k * 40);
    burstLight.intensity = 900 * Math.max(0, 1 - k / 0.8);
  };
  type RaceState = "ready" | "racing" | "failed" | "finished";
  let race: RaceState = "ready", raceLeft = 0, raceTotal = 0, raceNext = 0, lastU = NaN;
  let raceDir: RaceDir = "down", lastDir: RaceDir | null = null;
  // After the finish line: the car brakes to a stop by itself and the camera circles it, until you choose
  let finale = false, orbitA = 0;
  const startPose = { x: 0, z: 0, yaw: 0 };
  const resetRace = () => {
    race = "ready";
    raceNext = 0;
    lastU = NaN; // a fresh start: a line only counts once the car has been seen on both sides of it
    finale = false;
    o.onRace?.({ type: "reset" });
  };
  const raceStep = (u: number, dt: number) => {
    const near = Math.abs(u - lastU) < 0.01; // moved along the road, not across a hairpin
    if (race === "ready") {
      // Down through the line at the car park, or up through the line at the bottom
      const down = lastU >= U_START && u < U_START && near, up = lastU <= U_FINISH && u > U_FINISH && near;
      if (down || up) {
        raceDir = lastDir = down ? "down" : "up";
        race = "racing";
        raceNext = 0;
        raceLeft = route[raceDir].times[0];
        raceTotal = 0;
        o.onRace?.({ type: "go", left: raceLeft, gates: gateU.length, dir: raceDir });
        soundSafe(() => sound.play("go"));
        lastTick = Math.ceil(raceLeft);
      }
    } else if (race === "racing") {
      raceTotal += dt;
      raceLeft -= dt;
      const { checkpoints, times } = route[raceDir];
      const cu = checkpoints[raceNext];
      const crossed = raceDir === "down" ? lastU > cu && u <= cu : lastU < cu && u >= cu;
      if (crossed && near) {
        raceNext++;
        if (raceNext === checkpoints.length) {
          race = "finished";
          finale = true;
          orbitA = Math.atan2(chaseCam.x - car.position.x, chaseCam.z - car.position.z); // start the circle from where the camera is
          o.onRace?.({ type: "finish", total: raceTotal, dir: raceDir });
          soundSafe(() => sound.play("finish"));
        } else {
          raceLeft += times[raceNext];
          burst(checkpoints[raceNext - 1]);
          soundSafe(() => sound.play("gate"));
          o.onRace?.({ type: "gate", added: times[raceNext], gate: raceNext, gates: gateU.length });
        }
      }
      if (race === "racing" && raceLeft <= 0) {
        raceLeft = 0;
        race = "failed";
        o.onRace?.({ type: "fail", total: raceTotal, dir: raceDir });
        soundSafe(() => sound.play("fail"));
      } else if (race === "racing") {
        o.onRace?.({ type: "tick", left: raceLeft, gate: raceNext, gates: gateU.length });
        // a tick for each of the last five seconds
        const sec = Math.ceil(raceLeft);
        if (sec !== lastTick) {
          if (sec < lastTick && sec <= 5) soundSafe(() => sound.play("tick"));
          lastTick = sec;
        }
      }
    }
    lastU = u;
  };
  // Put the car on the road, stopped, at `u` (0 = the bottom, 1 = the car park), facing up or down the hill
  const placeAt = (u: number, facing: RaceDir) => {
    const p = road.getPointAt(u), t = road.getTangentAt(u);
    const yaw = facing === "up" ? Math.atan2(t.x, t.z) : Math.atan2(-t.x, -t.z);
    Object.assign(drv, { x: p.x, z: p.z, yaw, v: 0, steer: 0, pitch: 0, roll: 0, gear: 0, shift: 0, rpm: IDLE });
    chaseCam.set(p.x - Math.sin(yaw) * CHASE_BACK, p.y + CHASE_UP, p.z - Math.cos(yaw) * CHASE_BACK);
    chaseLook.set(p.x, p.y + 0.9, p.z);
  };
  // What happens after a race. "again": that race from its start line. "up": the uphill climb, from just below
  // its line at the bottom. "free": carry on driving from where the car stopped.
  const raceAction = (kind: "again" | "up" | "free") => {
    if (!driving) return;
    if (kind === "free") return void resetRace();
    const dir: RaceDir = kind === "up" ? "up" : lastDir ?? "down";
    if (dir === "up") placeAt(Math.max(0.002, U_FINISH - 9 / ROAD_LEN), "up");
    else placeAt(1, "down"); // the end of the road, at the car park: the start line is just ahead
    resetRace();
  };
  const setDriving = (on: boolean) => {
    if (on === driving) return;
    driving = on;
    if (on) {
      chaseFit();
      sweepAt = clock.getElapsed();
      v1.set(0, 0, 1).applyQuaternion(car.quaternion); // the way the car faces, wherever the film left it
      Object.assign(drv, { x: car.position.x, z: car.position.z, yaw: Math.atan2(v1.x, v1.z), v: 0, steer: 0, pitch: 0, roll: 0, gear: 0, shift: 0, rpm: IDLE });
      Object.assign(startPose, { x: drv.x, z: drv.z, yaw: drv.yaw });
      resetRace();
      soundSafe(() => void sound.start().then((st) => o.onSound?.(st))); // inside the key press, so the browser allows sound
      // Drop the camera straight in behind the car (no long glide from wherever the film left it)
      chaseCam.set(car.position.x - Math.sin(drv.yaw) * CHASE_BACK, car.position.y + CHASE_UP, car.position.z - Math.cos(drv.yaw) * CHASE_BACK);
      chaseLook.copy(car.position).setY(car.position.y + 0.9);
    } else {
      keys.clear();
      stickX = stickY = 0;
      snap = true; // the film picks up at the page's new place straight away, without gliding along the road
      resetRace();
      soundSafe(() => sound.stop());
      view = 0;
      camera.near = 0.3;
      camera.updateProjectionMatrix();
    }
    o.onDrive?.(on, on ? 0 : stopNear());
  };
  addEventListener(
    "keydown",
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.code === "Escape" && driving) return setDriving(false);
      if (e.code === "KeyM" && driving) {
        soundSafe(() => o.onSound?.(sound.toggleMute() ? "off" : sound.state()));
        e.preventDefault();
        return;
      }
      if (e.code === "KeyR" && driving) {
        // After (or during) a race: that race again from its start line. Otherwise back to where you took over.
        if (race !== "ready" || finale) raceAction("again");
        else {
          Object.assign(drv, { x: startPose.x, z: startPose.z, yaw: startPose.yaw, v: 0, steer: 0, pitch: 0, roll: 0, gear: 0, shift: 0, rpm: IDLE });
          chaseCam.set(startPose.x - Math.sin(startPose.yaw) * CHASE_BACK, car.position.y + CHASE_UP, startPose.z - Math.cos(startPose.yaw) * CHASE_BACK);
          resetRace();
        }
        e.preventDefault();
        return;
      }
      if (e.code === "KeyU" && driving) {
        raceAction("up"); // the uphill climb, from the bottom of the mountain
        e.preventDefault();
        return;
      }
      if (e.code === "KeyC" && driving) {
        view = (view + 1) % VIEWS.length;
        camera.near = VIEWS[view] === "chase" ? 0.3 : 0.05; // close enough to see the dashboard
        camera.updateProjectionMatrix();
        e.preventDefault();
        return;
      }
      if (!DRIVE_KEYS.includes(e.code)) return;
      if (!driving) {
        if (!canDrive()) return;
        setDriving(true);
      }
      // In the finish scene the car stops by itself; once it has, any driving key drives on from there
      if (finale && Math.abs(drv.v) < 0.5 && !e.repeat) raceAction("free");
      keys.add(e.code);
      if (!e.repeat) soundSafe(() => void sound.wake().then((st) => st && o.onSound?.(st))); // if the browser paused the audio, this key press can restart it
      e.preventDefault();
      e.stopImmediatePropagation(); // the page's own keys (Space to scroll) stay out of it
    },
    { capture: true },
  );
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  // Where the car may be: on the road between its barriers (and not past its start), or inside the car park.
  // Returns the nearest allowed position, so the car slides along a barrier instead of going through it.
  const CAR_HALF_W = 0.95, CAR_HALF_L = 2.3;
  // A much finer copy of the centre line (about 1.1 m pieces) for keeping the car on the road and under its
  // wheels, so the line hugs even the tightest hairpin
  const finePts = road.getSpacedPoints(1440);
  const confine = (x: number, z: number) => {
    // On the road: nearest point on the centre line
    let best = Infinity, bj = 0, bk = 0, kRaw0 = 0;
    for (let j = 0; j < finePts.length - 1; j++) {
      const a = finePts[j], b = finePts[j + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const raw = ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1);
      const k = Math.max(0, Math.min(1, raw));
      const px = a.x + ex * k - x, pz = a.z + ez * k - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) (best = d2), (bj = j), (bk = k), (kRaw0 = raw);
    }
    const a = finePts[bj], b = finePts[bj + 1];
    const ex = b.x - a.x, ez = b.z - a.z, el = Math.hypot(ex, ez) || 1;
    const tx = ex / el, tz = ez / el;
    const qx = a.x + ex * bk, qz = a.z + ez * bk;
    // How far the car is from the nearest point on the centre line, measured straight to it. (Measuring only
    // sideways to one short piece of the line went wrong just past each joint on the outside of a bend, and
    // shoved the car along the road: invisible walls.) Too far, and it is pulled straight back in.
    const LIM = HALF + 0.75 - 0.12 - CAR_HALF_W;
    const ox = x - qx, oz = z - qz, od = Math.hypot(ox, oz);
    let rx = x, rz = z;
    if (od > LIM) (rx = qx + (ox * LIM) / od), (rz = qz + (oz * LIM) / od);
    if (bj === 0) {
      // Not past the barrier across the start of the road
      const along = kRaw0 * el;
      const minAlong = CAR_HALF_L - 0.2;
      if (along < minAlong) (rx += tx * (minAlong - along)), (rz += tz * (minAlong - along));
    }
    const onRoad = Math.hypot(rx - x, rz - z) < 1e-3;
    // In the car park: inside its barriers
    const dx = x - lotC.x, dz = z - lotC.z;
    const al = dx * endDir.x + dz * endDir.z, ac = dx * endSide.x + dz * endSide.z;
    const AL = LOT_LEN / 2 - 0.45 - CAR_HALF_W, AC = LOT_WID / 2 - 0.45 - CAR_HALF_W;
    const cal = Math.max(-AL, Math.min(AL, al)), cac = Math.max(-AC, Math.min(AC, ac));
    const lx = lotC.x + endDir.x * cal + endSide.x * cac, lz = lotC.z + endDir.z * cal + endSide.z * cac;
    const inLot = Math.hypot(lx - x, lz - z) < 1e-3;
    const u = (bj + bk) / (finePts.length - 1); // how far along the road (0 = its start, 1 = the car park)
    if (onRoad || inLot) return { x, z, hit: false, tx, tz, u };
    const dRoad = Math.hypot(rx - x, rz - z), dLot = Math.hypot(lx - x, lz - z);
    return dRoad <= dLot ? { x: rx, z: rz, hit: true, tx, tz, u } : { x: lx, z: lz, hit: true, tx: 0, tz: 0, u };
  };
  const approach = (v: number, to: number, by: number) => (v < to ? Math.min(to, v + by) : Math.max(to, v - by));
  // The ground under the wheels: the asphalt on the road and in the car park, the hillside anywhere else.
  const surfaceAt = (x: number, z: number) => {
    const dx = x - lotC.x, dz = z - lotC.z;
    if (Math.abs(dx * endDir.x + dz * endDir.z) < LOT_LEN / 2 && Math.abs(dx * endSide.x + dz * endSide.z) < LOT_WID / 2) return END_Y + 0.02;
    let best = Infinity, by = 0;
    for (let j = 0; j < finePts.length - 1; j++) {
      const a = finePts[j], b = finePts[j + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const k = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
      const px = a.x + ex * k - x, pz = a.z + ez * k - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) (best = d2), (by = a.y + (b.y - a.y) * k);
    }
    // The road's height carries on over the verge to the barriers and eases into the hillside beyond, so the
    // wheels never drop off an edge (that made the car twitch when running near the outside of a bend)
    const dd = Math.sqrt(best);
    return dd < HALF + 1.6 ? by + 0.04 : mix(by + 0.04, heightAt(x, z), smooth(HALF + 1.6, HALF + 4.5, dd));
  };
  const frame = () => {
    if (dead) return;
    requestAnimationFrame(frame);
    if (!active || document.hidden) {
      // Off screen (say, a reload that lands partway down before the page settles): still tell the page
      // once everything is in, so the loader never waits on a scene nobody is looking at.
      if (readyToTell && !told && !document.hidden) {
        renderer.render(scene, camera);
        told = true;
        o.onReady?.();
      }
      return;
    }
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.getElapsed();
    if (!driving) eased = first || snap ? progress : eased + (progress - eased) * (1 - Math.exp(-dt * 4));
    snap = false;
    const f = eased;
    const skyK = 1 - smooth(F_SKY_END, F_SKY_END + 0.7, f); // 1 while looking at the sky
    const u = uAt(f);
    const t = clamp01((f - F_ROAD1) / (F_DRIFT1 - F_ROAD1)); // handbrake turn
    const fly = smooth(F_DRIFT1 - 0.1, F_END, f); // pulling away at the end

    // Car: on the road, then sliding to a stop in the car park (or, in the hidden mode, wherever you drive it)
    let steerTo = 0, rollTo = 0, braking = 0, reversing = 0;
    if (driving) {
      // Keys, or the touch joystick: how much throttle, brake and steering (0..1, -1..1)
      const thr = Math.max(keys.has("KeyW") ? 1 : 0, clamp01((-stickY - 0.12) / 0.75));
      const brk = Math.max(keys.has("KeyS") ? 1 : 0, clamp01((stickY - 0.12) / 0.75));
      const steerIn = Math.max(-1, Math.min(1, (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0) - Math.sign(stickX) * clamp01((Math.abs(stickX) - 0.06) / 0.8)));
      const W = thr > 0 && !finale, S = brk > 0 && !finale;
      handbrakeOn = keys.has("Space") && !finale;
      const spd = Math.abs(drv.v);
      // Speed-sensitive steering: at speed, full lock asks for just a little more than the tyres can hold
      const maxSteer = Math.min(0.7, Math.atan((wheelbase * GRIP * 2.2) / Math.max(1, spd * spd)));
      drv.steer += ((finale ? 0 : steerIn) * maxSteer - drv.steer) * Math.min(1, dt * (finale ? 3 : 8));
      let v = drv.v;
      // Gearbox: up at the red line (with a moment of no drive while the clutch is in), down as you slow
      if (drv.shift > 0) drv.shift -= dt;
      if (v > 0.5) {
        if (drv.gear < 5 && v >= GEAR_TOP[drv.gear] * 0.985 && drv.shift <= 0) {
          drv.gear++;
          drv.shift = SHIFT_TIME;
        } else if (drv.gear > 0 && v < GEAR_TOP[drv.gear - 1] * (W ? 0.72 : 0.55)) drv.gear--;
      } else drv.gear = 0;
      if (finale) v = approach(v, 0, BRAKE * 0.7 * dt); // past the finish: a firm, smooth stop
      else if (handbrakeOn) v = approach(v, 0, 7 * dt);
      else if (W) {
        if (v < -0.3) v = approach(v, 0, BRAKE * dt);
        else if (drv.shift <= 0) v += pullAt(Math.max(0, v), drv.gear) * thr * dt;
      } else if (S) v = v > 0.3 ? approach(v, 0, BRAKE * brk * dt) : Math.max(-7, v - 3 * brk * dt);
      else v = approach(v, 0, 0.9 * dt); // engine braking
      v = v > 0 ? Math.max(0, v - dragAt(v) * dt) : Math.min(0, v + dragAt(v) * dt);
      v = Math.min(v, GEAR_TOP[5]);
      // Revs follow the wheels in gear; after an upshift they fall to the next gear's revs
      const inGear = IDLE + (Math.abs(v) / GEAR_TOP[drv.gear]) * (RED - IDLE);
      const rpmTo = Math.min(RED, Math.max(inGear, W && Math.abs(v) < 3 ? 1900 : IDLE));
      drv.rpm += (rpmTo - drv.rpm) * Math.min(1, dt * (drv.shift > 0 ? 9 : 14));
      // Steering, within what the tyres can hold
      let yawRate = (v / wheelbase) * Math.tan(drv.steer);
      if (handbrakeOn && Math.abs(v) > 3) yawRate *= 1.8; // the rear steps out under the handbrake
      const limit = (GRIP * (handbrakeOn ? 1.3 : 1)) / Math.max(1, Math.abs(v));
      let slip = 0;
      if (Math.abs(yawRate) > limit) {
        slip = (Math.abs(yawRate) - limit) / limit;
        if (!handbrakeOn) yawRate = Math.sign(yawRate) * limit; // too fast for the bend: it runs wide
        v = approach(v, 0, Math.min(3, 0.8 + 0.6 * slip) * dt); // and the tyres scrub off a little speed
      }
      drv.v = v;
      drv.yaw += yawRate * dt;
      const px = drv.x + Math.sin(drv.yaw) * v * dt, pz = drv.z + Math.cos(drv.yaw) * v * dt;
      const c = confine(px, pz);
      // How hard the car is pushing into the barrier: the part of its motion that points through it.
      // Resting against it, or running along it, doesn't count, so the contact can't flicker on and off.
      let into = 0;
      if (c.hit) {
        const ox = px - c.x, oz = pz - c.z, ol = Math.hypot(ox, oz);
        if (ol > 1e-6) into = Math.max(0, (Math.sin(drv.yaw) * Math.sign(v) * ox + Math.cos(drv.yaw) * Math.sign(v) * oz) / ol);
      }
      drv.x = c.x;
      drv.z = c.z;
      raceStep(c.u, dt);
      const lateral = Math.abs(yawRate * v); // sideways acceleration, m/s²
      soundSafe(() => sound.update(
        {
          speed: v,
          rpm: drv.rpm,
          throttle: W ? thr : S && v < 0.3 ? 0.6 * brk : 0,
          shifting: drv.shift > 0,
          // squeal: sliding past the grip, near the limit, the handbrake, or braking hard
          skid: Math.max(clamp01(slip * 2), smooth(GRIP * 0.82, GRIP, lateral) * 0.45, handbrakeOn ? clamp01((Math.abs(v) - 3) / 6) : 0, S && v > 14 ? 0.35 : 0),
          scrape: into > 0.02 ? clamp01(Math.abs(v) / 12) * clamp01(0.4 + into) : 0,
        },
        dt,
      ));
      if (time - gaugeAt > 0.1) {
        gaugeAt = time;
        o.onGauge?.(Math.round(Math.abs(v) * 3.6), v < -0.3 ? "R" : String(drv.gear + 1));
      }
      if (c.hit) {
        // Rubbing a barrier: a glancing scrape costs a little speed, hitting it nose-first costs a lot,
        // and the car is turned to run along the road
        if (into > 0.02) {
          if (c.tx || c.tz) {
            const along = Math.atan2(c.tx, c.tz), back = along + Math.PI;
            const target = Math.abs(Math.atan2(Math.sin(along - drv.yaw), Math.cos(along - drv.yaw))) < Math.PI / 2 ? along : back;
            const off = Math.atan2(Math.sin(target - drv.yaw), Math.cos(target - drv.yaw));
            drv.v = approach(drv.v, 0, (1 + 16 * into) * dt);
            drv.yaw += off * Math.min(1, dt * 3 * (0.3 + into)); // eases the nose round to run along the barrier
          } else drv.v = approach(drv.v, 0, (2 + 12 * into) * dt); // the car park's barriers
        }
      }
      carPos.set(drv.x, surfaceAt(drv.x, drv.z), drv.z);
      fwd.set(Math.sin(drv.yaw), 0, Math.cos(drv.yaw));
      car.position.copy(carPos);
      // Sit on the slope: pitch from the ground under the front and back wheels, roll from left and right
      const sx = Math.cos(drv.yaw), sz = -Math.sin(drv.yaw); // the car's left
      const hF = surfaceAt(drv.x + fwd.x * 1.3, drv.z + fwd.z * 1.3), hB = surfaceAt(drv.x - fwd.x * 1.3, drv.z - fwd.z * 1.3);
      const hL = surfaceAt(drv.x + sx * 0.75, drv.z + sz * 0.75), hR = surfaceAt(drv.x - sx * 0.75, drv.z - sz * 0.75);
      const pitchTo = -Math.atan2(hF - hB, 2.6), rollGround = Math.atan2(hL - hR, 1.5);
      drv.pitch += (pitchTo - drv.pitch) * Math.min(1, dt * 10);
      drv.roll += (rollGround - drv.roll) * Math.min(1, dt * 10);
      car.position.y = (hF + hB) / 2;
      car.quaternion.setFromEuler(groundEuler.set(drv.pitch, drv.yaw, drv.roll, "YXZ"));
      fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
      steerTo = drv.steer;
      rollTo = Math.max(-0.05, Math.min(0.05, (Math.tan(drv.steer) / wheelbase) * 0.62 * clamp01(Math.abs(v) / 10)));
      braking = finale || handbrakeOn || (S && v > 0.3) ? 1 : 0;
      reversing = v < -0.15 ? 1 : 0;
    } else if (t <= 0) {
      road.getPointAt(u, carPos);
      road.getTangentAt(u, fwd);
      car.position.copy(carPos);
      car.lookAt(v1.copy(carPos).add(fwd));
      const k = curvAt(u), ahead = Math.abs(curvAt(u + 20 / ROAD_LEN));
      steerTo = Math.atan(wheelbase * k) * 1.25;
      rollTo = Math.max(-0.045, Math.min(0.045, k * 0.62)); // the body leans away from the turn
      // Brake on the way into a corner: the bend ahead is tighter than the road under the car
      braking = smooth(0.016, 0.04, ahead) * (1 - smooth(0.022, 0.045, Math.abs(k))) * (u > 0.002 && u < 0.985 ? 1 : 0);
      if (u >= 0.985) braking = 1;
    } else {
      const e = 1 - (1 - t) * (1 - t);
      const turn = smooth(0.1, 0.9, t);
      carPos.copy(endPt).addScaledVector(endDir, 27 * e).addScaledVector(endSide, -5.5 * turn * turn);
      carPos.y = END_Y + 0.02;
      fwd.copy(endDir);
      car.position.copy(carPos);
      car.rotation.set(0, endYaw + turn * 2.75, 0);
      steerTo = -0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15)); // opposite lock through the slide
      rollTo = -Math.sin(Math.PI * t) * 0.06;
      braking = 1;
      handbrakeOn = false;
    }
    right.crossVectors(fwd, UP).normalize();

    // Motion this frame drives the wheels and the suspension
    const moved = first ? 0 : v1.copy(carPos).sub(lastPos).dot(v2.set(0, 0, 1).applyQuaternion(car.quaternion)); // metres forward
    lastPos.copy(carPos);
    travelled += moved;
    speed += ((dt > 0 ? moved / dt : 0) - speed) * Math.min(1, dt * 6);
    const accel = dt > 0 ? (speed - lastSpeed) / dt : 0;
    lastSpeed = speed;
    const rolling = clamp01(Math.abs(speed) / 4); // lean and dive only while moving
    steerNow += (steerTo - steerNow) * Math.min(1, dt * 7);
    brakeNow += (braking * (t > 0 ? 1 : rolling) - brakeNow) * Math.min(1, dt * 9);
    chase("roll", rollTo * rolling, dt);
    chase("dive", (0.016 * brakeNow - Math.max(-0.014, Math.min(0.014, accel * 0.0012))) * (t > 0 ? 1 : rolling), dt, 70, 10);
    chassis.rotation.z = spring.roll;
    chassis.rotation.x = spring.dive;
    chassis.position.y = (Math.sin(travelled * 1.9) * 0.004 + Math.sin(travelled * 0.63 + 1.3) * 0.006) * rolling - Math.abs(spring.roll) * 0.12;
    wheelSpin += moved / wheelRadius;
    for (const w of wheels) {
      const locked = !w.front && (driving ? handbrakeOn : t > 0.05 && t < 1); // rear wheels lock under the handbrake
      if (!locked) w.spin.rotation.x = wheelSpin;
      if (w.front) w.steer.rotation.y = steerNow;
    }
    // The steering wheel follows the front wheels, turned by the steering ratio
    steeringWheel?.quaternion.setFromAxisAngle(WHEEL_AX, -steerNow * STEER_RATIO); // turning left turns the wheel anticlockwise, as the driver sees it
    // Tail lamps: the C-shaped LEDs glow at rest and blaze under braking; the red lens around them lights
    // up only a little, so the C stays the brightest thing.
    for (const m of tailMats) m.emissiveIntensity = 3.2 + brakeNow * 7;
    for (const m of tailLens) m.emissiveIntensity = 0.12 + brakeNow * 0.55;
    // The third brake light follows the tail lamps exactly: dim red at rest, full brightness on the brakes.
    // Off, it is an unlit lamp (no red at all); on, full brightness.
    stopLed.color.setRGB(0.04 + brakeNow * 2.6, 0.04 + brakeNow * 0.31, 0.04 + brakeNow * 0.16);
    stopGlow.material.opacity = brakeNow;
    stopGlow.scale.set(0.5 + brakeNow * 0.75, 0.2 + brakeNow * 0.28, 1);
    stopCore.material.opacity = brakeNow;
    stopCore.scale.set(0.3 + brakeNow * 0.25, 0.1 + brakeNow * 0.08, 1);
    // Reversing lamps: come on quickly, fade off a little slower, like a bulb
    reverseNow += (reversing - reverseNow) * Math.min(1, dt * (reversing ? 14 : 7));
    for (const s of reverseGlows) s.material.opacity = reverseNow;
    for (const s of reverseHalos) s.material.opacity = reverseNow * 0.45;
    reverseBeam.intensity = reverseNow * 26;

    // Camera on the journey: blend from one chapter's shot to the next between chapters
    const cf = Math.max(0, Math.min(CHAPTERS - 1, f - 1));
    const ci = Math.min(CHAPTERS - 2, Math.floor(cf));
    const cw = smooth(0.28, 0.72, cf - ci);
    // Swing round the car from one shot to the next (around it, not through it): blend the angle,
    // distance and height of the camera, and the point it looks at.
    {
      const A = SHOTS[ci], B = SHOTS[ci + 1];
      const aA = Math.atan2(A[0], A[2]), aB = Math.atan2(B[0], B[2]);
      const turn = Math.atan2(Math.sin(aB - aA), Math.cos(aB - aA));
      const ang = aA + turn * cw, dist = mix(Math.hypot(A[0], A[2]), Math.hypot(B[0], B[2]), cw);
      shot[0] = Math.sin(ang) * dist;
      shot[2] = Math.cos(ang) * dist;
      shot[1] = mix(A[1], B[1], cw);
      for (let k = 3; k < 6; k++) shot[k] = mix(A[k], B[k], cw);
    }
    camPos.copy(carPos).addScaledVector(right, shot[0]).addScaledVector(fwd, shot[2]);
    camPos.y += shot[1];
    camLook.copy(carPos).addScaledVector(right, shot[3]).addScaledVector(fwd, shot[5]);
    camLook.y += shot[4];
    if (t > 0) {
      // Swing around the car as it slides, then pull back and up
      const a0 = Math.atan2(camPos.x - carPos.x, camPos.z - carPos.z);
      const a = a0 + 2.3 * smooth(0, 1, t);
      const swing = smooth(0, 0.3, t);
      v1.set(Math.sin(a) * 12.5, 3.1, Math.cos(a) * 12.5).add(carPos);
      camPos.lerp(v1, swing);
      camLook.lerp(v2.copy(carPos).setY(carPos.y + 0.9), swing);
      v1.set(Math.sin(a) * 34, 6.5, Math.cos(a) * 34).add(carPos);
      camPos.lerp(v1, fly);
      camLook.lerp(v2.copy(carPos).setY(carPos.y + (W_ < 700 ? 15 : 10)), fly);
    }
    const inside = driving && !finale && VIEWS[view] !== "chase";
    // The dials, redrawn only from the driver's seat (the only view that sees them) and only when they change.
    // Starting the engine sweeps both needles to the end and back, as the real car does.
    if (driving && VIEWS[view] === "seat" && dials.length) {
      const sw = time - sweepAt, k = sw < 1.5 ? Math.sin(Math.PI * clamp01(sw / 1.5)) : 0;
      const gear = drv.v < -0.3 ? "R" : String(drv.gear + 1);
      for (const d of dials) {
        // The rev counter reads the engine's note: its softest (idle) at 2,000 and its peak (the shift) at 8,000
        const revs = 2 + ((drv.rpm - IDLE) / (RED - IDLE)) * 6;
        const val = d.kind === "rev" ? Math.max(revs, k * 8) : Math.max(Math.abs(drv.v) * 3.6, k * 260);
        const key = val.toFixed(d.kind === "rev" ? 2 : 1) + gear;
        if (key !== d.shown) (d.shown = key), drawDial(d, val);
      }
      const kmh = Math.abs(drv.v) * 3.6, key = Math.round(kmh) + gear;
      if (display && key !== display.shown) (display.shown = key), drawDisplay(kmh, gear);
    }
    if (driving && finale) {
      // The finish: the camera eases out of the chase into a slow circle around the car
      orbitA += dt * 0.22;
      // (aimed above the car, so it sits low in the frame, under the finish text)
      const tall = W_ < H_, orbitR = tall ? 7.4 : 8.6;
      v1.set(carPos.x + Math.sin(orbitA) * orbitR, carPos.y + (tall ? 1.9 : 2.3), carPos.z + Math.cos(orbitA) * orbitR);
      chaseCam.lerp(v1, 1 - Math.exp(-dt * 1.6));
      chaseLook.lerp(v2.copy(carPos).setY(carPos.y + (tall ? 1.9 : 3.6)), 1 - Math.exp(-dt * 3));
      camPos.copy(chaseCam);
      camLook.copy(chaseLook);
    } else if (driving && !inside) {
      // Chase camera: behind and above the car, lagging a little so turns and slides read
      chaseFit();
      v1.copy(carPos).addScaledVector(fwd, -CHASE_BACK);
      v1.y += CHASE_UP;
      chaseCam.lerp(v1, 1 - Math.exp(-dt * 8)); // a short lag, so turns and slides still read
      chaseLook.lerp(v2.copy(carPos).addScaledVector(fwd, CHASE_AHEAD).setY(carPos.y + CHASE_AIM), 1 - Math.exp(-dt * 6));
      camPos.copy(chaseCam);
      camLook.copy(chaseLook);
    } else if (inside) {
      // Mounted cameras ride with the body (lean and all). Over the bonnet, or the driver's eyes.
      chassis.updateWorldMatrix(true, false);
      const seat = VIEWS[view] === "seat";
      chassis.localToWorld(camPos.set(seat ? 0.37 : 0, seat ? 1.16 : 1.24, seat ? -0.32 : 1.12));
      chassis.localToWorld(camLook.set(seat ? 0.37 : 0, 0.95, 14));
      chaseCam.copy(camPos);
      chaseLook.copy(camLook);
      // The mouse turns your head instead of moving the camera
      v1.copy(camLook).sub(camPos);
      v1.applyAxisAngle(UP, -lookX * 0.7);
      v1.y -= lookY * 0.35 * v1.length();
      camLook.copy(camPos).add(v1);
    }
    // Mouse look on the drive: orbit around the point the shot is aimed at
    lookX += (lookToX - lookX) * (1 - Math.exp(-dt * 2.5));
    lookY += (lookToY - lookY) * (1 - Math.exp(-dt * 2.5));
    const steerCam = inside ? 0 : (1 - skyK) * (Math.abs(lookX) + Math.abs(lookY) > 0.001 ? 1 : 0);
    if (steerCam) {
      v1.copy(camPos).sub(camLook);
      const dist = v1.length();
      v2.crossVectors(v1, UP).normalize(); // points to the camera's right
      camPos.addScaledVector(v2, lookX * 0.42 * dist * steerCam);
      camPos.y += lookY * 0.22 * dist * steerCam;
      v1.copy(camPos).sub(camLook).setLength(dist);
      camPos.copy(camLook).add(v1);
    }
    // Keep the camera out of the hillside
    const ground = heightAt(camPos.x, camPos.z) + 0.75;
    if (camPos.y < ground && !inside) camPos.y = ground;

    // Coming down from the sky
    yaw += (yawTo - yaw) * (1 - Math.exp(-dt * 3.2));
    pitch += (pitchTo - pitch) * (1 - Math.exp(-dt * 3.2));
    if (skyK > 0) {
      skyDir(BASE_YAW + yaw + Math.sin(time * 0.12) * 0.012, pitch + Math.sin(time * 0.09) * 0.006, v1);
      camPos.lerp(skyPos, skyK);
      camLook.lerp(v2.copy(skyPos).addScaledVector(v1, 100), skyK);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // On wide screens, slide the frame sideways so the car sits beside the chapter text, not under it.
    const side = mix(ci % 2 ? 1 : -1, (ci + 1) % 2 ? 1 : -1, cw);
    const shift = W_ > 900 && !driving ? side * 0.17 * W_ * (1 - skyK) * (1 - smooth(0, 0.3, t)) : 0;
    if (Math.abs(shift) > 0.5) camera.setViewOffset(W_, H_, shift, 0, W_, H_);
    else if (camera.view) camera.clearViewOffset();
    sky.position.copy(camera.position);
    starMat.uniforms.uTime.value = time;

    // Streetlight: the real light sits at the lamp nearest the car
    let near = lamps[0], nd = Infinity;
    for (const l of lamps) {
      const d = l.distanceToSquared(carPos);
      if (d < nd) (nd = d), (near = l);
    }
    lampLight.position.copy(near);
    lampLight.intensity = 420 * (1 - smooth(16, 44, Math.sqrt(nd)));

    burstStep(dt);
    // Tyre smoke: each puff is left where the rear of the car was, then swells and fades
    for (const p of smoke) {
      if (t < p.at) p.placed = false;
      else if (!p.placed) {
        p.placed = true;
        p.s.position.copy(carPos).addScaledVector(v1.set(Math.sin(car.rotation.y), 0, Math.cos(car.rotation.y)), -1.7);
        p.s.position.y = END_Y + 0.7;
      }
      const age = t - p.at;
      p.s.material.opacity = p.placed ? 0.5 * clamp01(1 - age * 2.2) * (1 - fly) : 0;
      p.s.scale.setScalar(3 + clamp01(age * 2) * 9);
    }

    // Constellation
    constellation.visible = skyK > 0.01;
    lineMat.opacity = skyK * (selected ? 0.1 : 0.24);
    spokeMat.opacity = skyK * 0.5;
    hotMat.opacity = skyK * 0.95;
    centreStar.material.opacity = skyK;
    centreStar.scale.setScalar(20 + Math.sin(time * 1.3) * 1.5);
    if (skyK > 0.01) {
      v1.copy(centreStar.position).add(constellation.position).project(camera);
      o.center.style.transform = `translate(${((v1.x * 0.5 + 0.5) * W_).toFixed(1)}px,${((-v1.y * 0.5 + 0.5) * H_).toFixed(1)}px)`;
    }
    o.center.style.opacity = String(skyK);
    o.center.style.visibility = skyK > 0.01 ? "visible" : "hidden";
    // A place's projects show when the place (or one of its projects) is selected, or the place is hovered.
    const focus = selected ? (selected.level === 3 ? starById.get(selected.parent!) ?? null : selected) : opened;
    for (const s of stars) {
      const isSel = s === selected, isNb = !!selected && selected.nb.has(s.id), isHover = s === hover;
      const open = s.level === 3 && !!focus && s.parent === focus.id;
      const lit = !selected || isSel || isNb || open;
      s.sprite.material.opacity = skyK * (lit ? 1 : 0.3) * (s.level === 3 && !open && !isSel && !isHover ? 0.7 : 1);
      s.sprite.scale.setScalar(s.size * (isSel ? 1.7 + Math.sin(time * 3) * 0.15 : isHover ? 1.35 : isNb || open ? 1.2 : 1));
      if (skyK > 0.01) {
        v1.copy(s.sprite.position).add(constellation.position).project(camera);
        s.vis = v1.z < 1 && Math.abs(v1.x) < 1.05 && Math.abs(v1.y) < 1.05;
        s.sx = (v1.x * 0.5 + 0.5) * W_;
        s.sy = (-v1.y * 0.5 + 0.5) * H_;
        // Top-level stars and places are always named; projects only when their place is open.
        const on = s.vis && (s.level < 3 || isSel || isNb || isHover || open);
        s.el.style.opacity = on ? String(skyK * (lit ? (s.level === 3 ? 0.85 : 1) : 0.35)) : "0";
        if (on)
          s.el.style.transform = s.side
            ? `translate(${(s.sx + s.side * 9).toFixed(1)}px,${s.sy.toFixed(1)}px) translate(${s.side < 0 ? "-100%" : "0"},-50%)`
            : `translate(${s.sx.toFixed(1)}px,${(s.sy + s.size * 0.5 + 5).toFixed(1)}px) translateX(-50%)`;
        s.el.classList.toggle("sel", isSel);
      } else if (s.vis) {
        s.vis = false;
        s.el.style.opacity = "0";
      }
    }
    renderer.render(scene, camera);
    if (first) {
      first = false;
      o.canvas.dataset.ready = "";
    }
    if (readyToTell && !told) {
      told = true;
      o.onReady?.();
    }
  };
  frame();

  return {
    setProgress: (f) => (progress = f),
    setActive: (on) => {
      active = on && !dead;
      if (active) clock.update();
    },
    select: (id) => select(id, false),
    canDrive: () => canDrive() || driving,
    drive: (on) => {
      if (on && !driving && !canDrive()) return;
      setDriving(on);
    },
    setStick: (x, y) => ((stickX = x), (stickY = y)),
    raceAction: (kind) => raceAction(kind),
    dispose: () => {
      dead = true;
      active = false;
      told = true;
      if (driving) setDriving(false);
      soundSafe(() => sound.stop());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
