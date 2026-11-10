// The set: a mountain-pass lay-by at golden hour.
// Lighting comes from a real HDR photo of a mountain road (Poly Haven, CC0), projected onto the
// ground beyond the guardrail, plus a sun light matched to the sun's position in that photo.
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { GroundedSkybox } from "three/addons/objects/GroundedSkybox.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { CarRig, rigModel } from "./car";
import { candelaToScene, nitsToScene, type TimePreset } from "./data";
import type { Box2 } from "./geom";
export type { Box2 } from "./geom";

export interface Ladder {
  group: THREE.Group;
  top: number; // height of the standing platform
  box: Box2; // footprint when standing
  carried: boolean;
  // Knocked over by the car: it tips onto its side and slides to a stop.
  fallen: boolean;
  tilt: number; // 0 upright, PI/2 lying on its side
  tiltRate: number;
  tiltSign: 1 | -1;
  vx: number;
  vz: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface World {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  skybox: GroundedSkybox;
  carBox: Box2;
  car: CarRig;
  ladders: Ladder[];
  obstacles: Box2[]; // cones, the lamp post
  bounds: Bounds; // where you can walk
  carBounds: Bounds; // where the car can drive
  focusTargets: THREE.Object3D[];
  /** Scales the sky and sun so the scene meters at the current EV. */
  calibrate: (k: number) => void;
  /** Swaps the sky and sun for a scene time. Call calibrate and applyPractical afterwards. */
  setTime: (t: TimePreset) => Promise<void>;
  /** Street light and car lamps, in real units at the current EV. */
  applyPractical: (scale?: number) => void;
  /** For the flash pass: switch off every light source except the flash (or back on). */
  isolateFlash: (on: boolean) => void;
  carName: string;
  carIsPlaceholder: boolean;
}

const BASE = "/sim";

// ---------- helpers ----------
const tex = new THREE.TextureLoader();
const pending: Promise<unknown>[] = [];
function pbr(name: string, repeat: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const load = (m: string, srgb = false) => {
    let done: (v?: unknown) => void = () => {};
    pending.push(new Promise((r) => (done = r)));
    const t = tex.load(`${BASE}/tex/${name}_${m}.webp`, done, undefined, done);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const arm = load("arm");
  return new THREE.MeshStandardMaterial({
    map: load("diff", true),
    normalMap: load("nor_gl"),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
    metalness: 1, // metalness map's blue channel drives it
    ...opts,
  });
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let f = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 5; i++) {
    f += amp * noise2(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return f;
}

function uv2ToAo(geo: THREE.BufferGeometry) {
  // aoMap uses the first UV set in recent three.js, nothing to do; kept for clarity.
  return geo;
}

// ---------- main ----------
export async function buildWorld(
  renderer: THREE.WebGLRenderer,
  opts: { mobile: boolean; time: TimePreset; onProgress?: (s: string) => void },
): Promise<World> {
  const scene = new THREE.Scene();
  const { mobile, onProgress = () => {} } = opts;

  // Sky and sun, from a real HDR photo per scene time.
  onProgress("Loading the sky");
  const wantAz = Math.atan2(0.85, 0.35); // put the sun out over the valley (towards +Z, slightly +X): atan2(z, x)
  let current: Sky | null = await loadSky(opts.time.sky, mobile);
  const skybox = new GroundedSkybox(current.sky, 18, 420, mobile ? 64 : 128);
  skybox.position.y = 18 - 0.02;
  scene.add(skybox);

  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.target.position.set(0, 0, 0);
  sun.shadow.mapSize.setScalar(mobile ? 2048 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  let sunE = 0; // the sun's irradiance in the photo's units

  const applySky = (s: Sky) => {
    // Rotate the photo so its sun sits out over the valley.
    const rotY = s.sunFound ? -(wantAz - s.sunAz) : 0;
    scene.environment = s.env;
    scene.environmentRotation.set(0, rotY, 0);
    const mat = skybox.material as THREE.MeshBasicMaterial;
    mat.map = s.sky;
    mat.needsUpdate = true;
    skybox.rotation.y = rotY;
    const lat = Math.max(0.035, s.sunLat); // just above the horizon, so it still casts shadows
    const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(wantAz), Math.sin(lat), Math.cos(lat) * Math.sin(wantAz)).normalize();
    sun.position.copy(dir).multiplyScalar(60);
    sun.color.copy(s.sunColor);
    sunE = s.sunFound ? s.sunE : 0;
    sun.castShadow = s.sunFound;
  };
  applySky(current);

  // Materials
  onProgress("Laying the asphalt");
  const asphalt = pbr("asphalt_02", 6);
  const roadAsphalt = pbr("asphalt_02", 9);
  const gravel = pbr("gravel", 5);
  const hillside = pbr("aerial_grass_rock", 0.6);
  const rock = pbr("dark_rock_02", 2);

  const focusTargets: THREE.Object3D[] = [];
  const obstacles: Box2[] = [];
  const add = (m: THREE.Mesh, focus = true, cast = true, receive = true) => {
    m.castShadow = cast;
    m.receiveShadow = receive;
    scene.add(m);
    if (focus) focusTargets.push(m);
    return m;
  };

  // Lay-by: x -18..18, z -6..6 ; road: z -13..-6 ; verge: z 6..8.2 ; guardrail at z 8.2
  const plane = (w: number, d: number, mat: THREE.Material, x: number, z: number, y = 0, seg = 1) => {
    const g = new THREE.PlaneGeometry(w, d, seg, seg);
    g.rotateX(-Math.PI / 2);
    // scale UVs to world size so all materials share texel density
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 10, (uv.getY(i) * d) / 10);
    const m = new THREE.Mesh(uv2ToAo(g), mat);
    m.position.set(x, y, z);
    return add(m, true, false, true);
  };
  plane(44, 12, asphalt, 0, 0, 0.002);
  plane(140, 7, roadAsphalt, 0, -9.5, 0.001);
  plane(140, 2.6, gravel, 0, 7.3, 0.004);
  plane(140, 3, gravel, 0, -14.4, 0.004);

  // Road markings
  const paint = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.55 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a62a, roughness: 0.55 });
  const stripe = (x: number, z: number, w: number, d: number, mat: THREE.Material) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, 0.006, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  for (let x = -70; x < 70; x += 6) stripe(x, -9.5, 3, 0.12, yellow);
  stripe(0, -12.75, 140, 0.15, paint);
  for (let x = -70; x < 70; x += 2) if (x < -22 || x > 22) stripe(x, -6.15, 1, 0.15, paint);
  // Parking bay lines
  for (let x = -13; x <= 13; x += 3.25) stripe(x, 1.5, 0.12, 5, paint);

  // Hillside rising behind the road (away from the sun)
  onProgress("Shaping the hillside");
  {
    const w = 260, d = 70, sx = mobile ? 90 : 180, sz = mobile ? 30 : 60;
    const g = new THREE.PlaneGeometry(w, d, sx, sz);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // The mesh's +Z edge sits on the roadside, so distance from the road is d/2 - z.
      const x = pos.getX(i), zl = d / 2 - pos.getZ(i);
      const rise = Math.pow(Math.min(1, zl / 30), 1.4) * 22 + zl * 0.35;
      const h = rise + (fbm(x * 0.03, zl * 0.04) - 0.5) * 8 * Math.min(1, zl / 6) + (zl < 1.5 ? -0.3 : 0);
      pos.setY(i, Math.max(0, h));
      uv.setXY(i, (uv.getX(i) * w) / 10, (uv.getY(i) * d) / 10);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, hillside);
    m.position.set(0, 0, -15.8 - d / 2);
    add(m, true, true, true);

    // Rock outcrops along the cut
    const rg = new THREE.IcosahedronGeometry(1, mobile ? 3 : 4);
    for (let i = 0; i < 14; i++) {
      const r = rg.clone();
      const p = r.attributes.position as THREE.BufferAttribute;
      const seed = i * 13.7;
      for (let k = 0; k < p.count; k++) {
        const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k);
        const n = 0.75 + fbm(vx * 1.7 + seed, vz * 1.7 + vy) * 0.6;
        p.setXYZ(k, vx * n * 1.4, vy * n * 0.9, vz * n);
      }
      r.computeVertexNormals();
      const m2 = new THREE.Mesh(r, rock);
      const s = 0.8 + hash2(i, 3) * 2.2;
      m2.scale.setScalar(s);
      m2.position.set(-40 + i * 6 + hash2(i, 1) * 3, s * 0.35, -16.5 - hash2(i, 2) * 3);
      m2.rotation.set(hash2(i, 4), hash2(i, 5) * 6, hash2(i, 6));
      add(m2, true, true, true);
    }
  }

  // Guardrail (W-beam) on the valley side
  onProgress("Bolting up the guardrail");
  {
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 1, roughness: 0.42 });
    const shape = new THREE.Shape();
    // W-beam cross-section (metres), drawn in the Y-Z plane, extruded along X
    const prof = [
      [0, 0.0], [0.04, 0.03], [0.06, 0.08], [0.04, 0.13], [0.02, 0.16], [0.04, 0.19], [0.06, 0.24], [0.04, 0.29], [0, 0.32],
    ];
    shape.moveTo(prof[0][0], prof[0][1]);
    prof.forEach(([a, b]) => shape.lineTo(a, b));
    for (let i = prof.length - 1; i >= 0; i--) shape.lineTo(prof[i][0] + 0.004, prof[i][1]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 120, bevelEnabled: false, steps: 1 });
    g.rotateY(Math.PI / 2);
    const beam = new THREE.Mesh(g, steel);
    beam.position.set(-60, 0.48, 8.3);
    add(beam, true, true, true);
    const post = new THREE.BoxGeometry(0.1, 0.8, 0.15);
    for (let x = -60; x <= 60; x += 2) {
      const m = new THREE.Mesh(post, steel);
      m.position.set(x, 0.4, 8.45);
      add(m, false, true, true);
    }
  }

  // Concrete barriers closing the lay-by ends (these keep you on set)
  {
    const concrete = new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.85 });
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(-0.28, 0.08);
    s.lineTo(-0.2, 0.3);
    s.lineTo(-0.08, 0.81);
    s.lineTo(0.08, 0.81);
    s.lineTo(0.2, 0.3);
    s.lineTo(0.28, 0.08);
    s.lineTo(0.3, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 2.9, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    for (const x of [-18.6, 18.6]) {
      for (let z = -13; z < 8; z += 3) {
        const m = new THREE.Mesh(g, concrete);
        m.position.set(x, 0, z);
        add(m, true, true, true);
      }
    }
    // Cones
    const cone = new THREE.MeshStandardMaterial({ color: 0xe0561b, roughness: 0.6 });
    const band = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.4 });
    const cg = new THREE.ConeGeometry(0.16, 0.7, 24, 1, true);
    const bg = new THREE.CylinderGeometry(0.085, 0.105, 0.1, 24, 1, true);
    const baseG = new THREE.BoxGeometry(0.38, 0.03, 0.38);
    for (const [x, z] of [[-17.2, -11], [-17.2, -8], [17.2, -11], [17.2, -8], [16.8, -3]]) {
      obstacles.push({ cx: x, cz: z, hx: 0.2, hz: 0.2, rot: 0 });
      const grp = new THREE.Group();
      const c = new THREE.Mesh(cg, cone);
      c.position.y = 0.38;
      const b = new THREE.Mesh(bg, band);
      b.position.y = 0.46;
      const bs = new THREE.Mesh(baseG, cone);
      bs.position.y = 0.015;
      [c, b, bs].forEach((m) => ((m.castShadow = true), (m.receiveShadow = true)));
      grp.add(c, b, bs);
      grp.position.set(x, 0, z);
      scene.add(grp);
      focusTargets.push(c);
    }
  }

  // Ladders
  const ladders = [makeLadder(scene, 0.9, -8, 4.2, 0.3, focusTargets), makeLadder(scene, 1.5, 9.5, -3.8, -0.4, focusTargets), makeLadder(scene, 2.1, -12, -4.5, 1.2, focusTargets)];

  // Street light over the lay-by (on at night)
  const lamp = makeStreetLight(scene, -4.5, 7.55, focusTargets);
  obstacles.push({ cx: -4.5, cz: 7.55, hx: 0.16, hz: 0.16, rot: 0 });

  // The car
  onProgress("Rolling the car in");
  const loaded = await loadCar(focusTargets);
  scene.add(loaded.group);
  const carBox: Box2 = { cx: 0, cz: 0, hx: loaded.length / 2 + 0.12, hz: loaded.width / 2 + 0.12, rot: 0 };
  const car = new CarRig(rigModel(loaded.group, loaded.length, loaded.width), carBox);
  car.setPose(0, 0.6, 0.42);
  // Soft contact shadow: sky light is blocked under the car (ambient occlusion), which the sun's shadow map can't show.
  {
    // Rounded-rectangle falloff, darkest under the body, fading out past the wheels.
    const W = 256, H = 128;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const nx = Math.abs((x + 0.5) / W - 0.5) * 2, ny = Math.abs((y + 0.5) / H - 0.5) * 2;
        const d = Math.pow(Math.pow(nx, 4) + Math.pow(ny, 4), 0.25); // superellipse
        const v = 1 - THREE.MathUtils.smoothstep(d, 0.55, 1);
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255);
        data[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, W, H);
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    const ao = new THREE.Mesh(
      new THREE.PlaneGeometry(loaded.length * 1.08, loaded.width * 1.18),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    ao.renderOrder = 1;
    car.attachShadow(ao);
  }

  // Every texture must be on the GPU before the scene is metered for calibration.
  onProgress("Loading textures");
  await Promise.all(pending);
  pending.length = 0;
  renderer.compile(scene, new THREE.PerspectiveCamera());

  // Light calibration: scales the sky and sun so the scene meters at the current EV.
  let k = 1;
  const calibrate = (kk: number) => {
    k = kk;
    scene.environmentIntensity = k;
    sun.intensity = sunE * k;
    (skybox.material as THREE.MeshBasicMaterial).color.setScalar(k);
  };
  calibrate(1);

  let lampOn = opts.time.lamp;
  const applyPractical = (scale = 1) => {
    const on = lampOn ? scale : 0;
    lamp.spot.intensity = candelaToScene(1300) * on; // ~28 lux on the ground below, a typical car park
    lamp.panel.emissiveIntensity = nitsToScene(60000) * on;
    car.applyLightLevel(scale);
  };
  const setTime = async (t: TimePreset) => {
    const next = await loadSky(t.sky, mobile);
    const prev = current;
    current = next;
    applySky(next);
    lampOn = t.lamp;
    lamp.spot.castShadow = t.lamp;
    prev?.sky.dispose();
    prev?.env.dispose();
    renderer.compile(scene, new THREE.PerspectiveCamera());
  };
  lamp.spot.castShadow = lampOn;

  let saved: { env: number; sun: number } | null = null;
  const isolateFlash = (on: boolean) => {
    if (on) {
      saved = { env: scene.environmentIntensity, sun: sun.intensity };
      scene.environmentIntensity = 0;
      sun.intensity = 0;
      skybox.visible = false;
      applyPractical(0);
    } else if (saved) {
      scene.environmentIntensity = saved.env;
      sun.intensity = saved.sun;
      skybox.visible = true;
      applyPractical(1);
      saved = null;
    }
  };

  return {
    scene,
    sun,
    skybox,
    carBox,
    car,
    ladders,
    obstacles,
    bounds: { minX: -17.9, maxX: 17.9, minZ: -12.6, maxZ: 7.9 },
    carBounds: { minX: -18.2, maxX: 18.2, minZ: -13.6, maxZ: 8.1 },
    focusTargets,
    calibrate,
    setTime,
    applyPractical,
    isolateFlash,
    carName: loaded.name,
    carIsPlaceholder: loaded.placeholder,
  };
}

// ---------- Sky ----------
interface Sky {
  sky: THREE.DataTexture; // the photo as shot, sun included (for the backdrop)
  env: THREE.DataTexture; // the same with the sun taken out (it becomes the directional light instead)
  sunFound: boolean;
  sunAz: number;
  sunLat: number;
  sunE: number; // irradiance from the sun disc, facing it
  sunColor: THREE.Color;
}

async function loadSky(name: string, mobile: boolean): Promise<Sky> {
  const sky = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(`${BASE}/${name}_${mobile ? "1k" : "2k"}.hdr`);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  const img = sky.image as { data: Float32Array; width: number; height: number };
  const { width: W, height: H } = img;
  const data = new Float32Array(img.data); // copy for the environment
  const lum = (i: number) => data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  const latOf = (y: number) => (0.5 - (y + 0.5) / H) * Math.PI;
  const azOf = (x: number) => ((x + 0.5) / W - 0.5) * Math.PI * 2;
  const dirOf = (x: number, y: number) => {
    const la = latOf(y), az = azOf(x);
    return [Math.cos(la) * Math.cos(az), Math.sin(la), Math.cos(la) * Math.sin(az)];
  };
  const dOmega = (y: number) => ((2 * Math.PI) / W) * (Math.PI / H) * Math.cos(latOf(y));

  // Brightest pixel in the upper half: the sun (or the moon).
  let best = 0, bx = 0, by = 0;
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) {
      const l = lum((y * W + x) * 4);
      if (l > best) (best = l), (bx = x), (by = y);
    }
  }
  // Sky irradiance on the ground, to judge whether the disc matters (sampled coarsely).
  let skyE = 0;
  for (let y = 0; y < H / 2; y += 2) for (let x = 0; x < W; x += 2) skyE += lum((y * W + x) * 4) * Math.sin(Math.max(0, latOf(y))) * dOmega(y) * 4;

  // Disc within 3 degrees of the peak; ring from 3 to 4.5 degrees gives the sky behind it.
  const d0 = dirOf(bx, by);
  const R = THREE.MathUtils.degToRad(3), R2 = THREE.MathUtils.degToRad(4.5);
  const rows = Math.ceil((R2 / Math.PI) * H) + 1;
  const ring = [0, 0, 0];
  let ringN = 0;
  const visit = (fn: (i: number, ang: number, y: number) => void) => {
    for (let y = Math.max(0, by - rows); y <= Math.min(H - 1, by + rows); y++) {
      const c = Math.max(0.02, Math.cos(latOf(y)));
      const cols = Math.min(W / 2, Math.ceil((R2 / (2 * Math.PI)) * W / c) + 1);
      for (let dx = -cols; dx <= cols; dx++) {
        const x = (bx + dx + W) % W;
        const d = dirOf(x, y);
        const ang = Math.acos(Math.min(1, d[0] * d0[0] + d[1] * d0[1] + d[2] * d0[2]));
        fn((y * W + x) * 4, ang, y);
      }
    }
  };
  visit((i, ang) => {
    if (ang >= R && ang < R2) {
      ring[0] += data[i], ring[1] += data[i + 1], ring[2] += data[i + 2];
      ringN++;
    }
  });
  if (ringN) ring.forEach((_, j) => (ring[j] /= ringN));
  const E = [0, 0, 0];
  visit((i, ang, y) => {
    if (ang >= R) return;
    const w = dOmega(y);
    for (let j = 0; j < 3; j++) {
      const ex = Math.max(0, data[i + j] - ring[j]);
      E[j] += ex * w;
      data[i + j] = Math.min(data[i + j], ring[j]);
    }
  });
  const sunE = E[0] * 0.2126 + E[1] * 0.7152 + E[2] * 0.0722;
  const sunLat = latOf(by);
  const sunFound = sunE * Math.max(0.1, Math.sin(Math.max(0, sunLat))) > skyE * 0.15 && sunLat > -0.05;
  const sunColor = sunE > 0 ? new THREE.Color(E[0] / sunE, E[1] / sunE, E[2] / sunE) : new THREE.Color(1, 1, 1);

  const env = sky.clone();
  env.source = new THREE.Source({ data, width: W, height: H });
  env.needsUpdate = true;
  return { sky, env, sunFound, sunAz: azOf(bx), sunLat, sunE, sunColor };
}

// ---------- Street light ----------
function makeStreetLight(scene: THREE.Scene, x: number, z: number, focusTargets: THREE.Object3D[]) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x8e9298, metalness: 1, roughness: 0.55 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.45 });
  const panel = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.2, emissive: new THREE.Color(1, 0.92, 0.8), emissiveIntensity: 0 });
  const g = new THREE.Group();
  const H = 7;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, H, 20), steel);
  pole.position.set(0, H / 2, 0);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.5, 20), steel);
  base.position.y = 0.25;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.1, 12), steel);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, H - 0.08, -1.05);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.72), housing);
  head.position.set(0, H - 0.1, -2.15);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.6), panel);
  lens.rotation.x = Math.PI / 2; // faces down
  lens.position.set(0, H - 0.152, -2.15);
  for (const m of [pole, base, arm, head]) {
    m.castShadow = true;
    m.receiveShadow = true;
    focusTargets.push(m);
  }
  g.add(pole, base, arm, head, lens);
  g.position.set(x, 0, z);
  scene.add(g);

  // 4000 K LED, wide car-park distribution.
  const spot = new THREE.SpotLight(new THREE.Color(1, 0.9, 0.78), 0, 0, 1.1, 0.65, 2);
  spot.position.set(x, H - 0.16, z - 2.15);
  spot.target.position.set(x + 0.6, 0, z - 6.5);
  spot.shadow.mapSize.setScalar(1024);
  spot.shadow.camera.near = 0.5;
  spot.shadow.camera.far = 30;
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.02;
  scene.add(spot, spot.target);
  return { spot, panel };
}

// ---------- Ladders ----------
function makeLadder(scene: THREE.Scene, top: number, x: number, z: number, rot: number, focusTargets: THREE.Object3D[]): Ladder {
  const alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.32 });
  const fibre = new THREE.MeshStandardMaterial({ color: 0xd6631f, roughness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const g = new THREE.Group();
  const spreadFront = 0.32 + top * 0.18; // how far the legs splay out
  const w = 0.5;
  const rail = (sx: number, front: boolean) => {
    const len = Math.hypot(top + 0.05, spreadFront);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.025), alu);
    const ang = Math.atan2(spreadFront, top + 0.05);
    m.position.set(sx, (top + 0.05) / 2, front ? spreadFront / 2 : -spreadFront / 2);
    m.rotation.x = front ? -ang : ang;
    g.add(m);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.06), rubber);
    foot.position.set(sx, 0.02, front ? spreadFront : -spreadFront);
    g.add(foot);
  };
  rail(-w / 2, true), rail(w / 2, true), rail(-w / 2, false), rail(w / 2, false);
  const steps = Math.max(2, Math.round(top / 0.3));
  for (let i = 1; i < steps; i++) {
    const h = (top * i) / steps;
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, 0.09), alu);
    s.position.set(0, h, spreadFront * (1 - h / top) * 0.98);
    g.add(s);
  }
  const plat = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.04, 0.42), fibre);
  plat.position.set(0, top, 0);
  g.add(plat);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      focusTargets.push(o);
    }
  });
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  scene.add(g);
  return {
    group: g,
    top,
    box: { cx: x, cz: z, hx: w / 2 + 0.08, hz: spreadFront + 0.05, rot },
    carried: false,
    fallen: false,
    tilt: 0,
    tiltRate: 0,
    tiltSign: 1,
    vx: 0,
    vz: 0,
  };
}

// ---------- Car ----------
interface CarResult {
  group: THREE.Group;
  length: number;
  width: number;
  name: string;
  placeholder: boolean;
}

async function loadCar(focusTargets: THREE.Object3D[]): Promise<CarResult> {
  try {
    const head = await fetch(`${BASE}/car.glb`, { method: "HEAD" });
    if (head.ok && !(head.headers.get("content-type") ?? "").includes("text/html")) {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(`${BASE}/car.glb`);
      const root = gltf.scene;
      // Normalise: length along X = 4.6 m, wheels on the ground, centred.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.z);
      const s = 4.6 / longest;
      root.scale.setScalar(s);
      if (size.z > size.x) root.rotation.y = Math.PI / 2;
      const box2 = new THREE.Box3().setFromObject(root);
      const c = box2.getCenter(new THREE.Vector3());
      root.position.x -= c.x;
      root.position.z -= c.z;
      root.position.y -= box2.min.y;
      const group = new THREE.Group();
      group.add(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        focusTargets.push(m);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => tuneCarMaterial(mat as THREE.MeshPhysicalMaterial));
        // Glass shouldn't block the sun completely or cast hard shadows inside the cabin.
        if ((m.material as THREE.Material).transparent) m.castShadow = false;
      });
      tailLampGlass(root);
      const final = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
      return { group, length: final.x, width: final.z, name: "Model car", placeholder: false };
    }
  } catch {
    /* fall through to the stand-in */
  }
  return { ...makePlaceholderCar(focusTargets), name: "Stand-in car", placeholder: true };
}

// Make the downloaded model behave physically under our calibrated light.
// glTF treats an unset metalness as fully metallic, and the model ships with its lamps switched on.
function tuneCarMaterial(mat: THREE.MeshPhysicalMaterial) {
  if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  const name = mat.name.toLowerCase();
  mat.envMapIntensity = 1;
  // Parked car: lamps off. Emissive light is absolute and would ignore exposure entirely.
  if (/light|bulb/.test(name) && !/backdrop/.test(name)) {
    mat.emissiveIntensity = 0;
    mat.emissive.setRGB(0, 0, 0);
    // Lamp glass is smooth (the textured lamp housing of the newer model keeps its own finish).
    if (!mat.transparent && !/^lighta/.test(name)) mat.roughness = 0.08;
  }
  if (/plastic|rubber|tire|tyre|carbon|logo|emblem|material\.01|brake_light|glass/.test(name) && !/surr/.test(name)) mat.metalness = 0;
  if (/rubber|tire|tyre/.test(name)) mat.roughness = Math.max(mat.roughness, 0.85);
  if (name === "car_paint") {
    // Metallic paint under clearcoat: coloured, partly metallic base, mirror-like top coat.
    // A model whose paint is already glossy keeps its own base; a rough one gets a typical metallic base.
    if (mat.roughness > 0.2) {
      mat.metalness = 0.55;
      mat.roughness = 0.38;
    }
    mat.clearcoat = 1;
    mat.clearcoatRoughness = 0.03;
  }
  // Sharper textures on surfaces seen at a slant (the grille, tyres, the cabin through the glass).
  for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"] as const) {
    const t = mat[key];
    if (t) t.anisotropy = 8;
  }
  if (/window_glass/.test(name)) {
    mat.roughness = 0.03;
    mat.depthWrite = false;
  }
  if (/mirror|chrome|reflective_metal/.test(name)) mat.metalness = 1;
  mat.needsUpdate = true;
}

// Tail lamps as real glass: a clear, glossy outer lens with the parts behind it tinted red, the way light passing
// through red glass looks (without the cost of a refraction pass). Two layers share the lens geometry:
//  - a tint layer that multiplies whatever is behind it by red, so the reflectors keep their detail but turn red;
//  - the lens itself, which only adds its reflections (and, when the lamps are on, its red glow).
function tailLampGlass(root: THREE.Object3D) {
  const lenses: THREE.Mesh[] = [], guides: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.material as THREE.Material).name;
    if (name === "Bright_Lights_Tail") lenses.push(m);
    // Lit parts (the tail lamps' light guides, the headlamps' light guides and projectors) get a glow layer.
    if (/^(Tail_Guide|Head_Guide|Head_Projector)$/.test(name)) guides.push(m);
  });
  // Lit parts: the housing keeps its own surface, and a glow-only copy of the same shape is added on top. It is
  // drawn last and ignores depth by a hair (polygon offset), so the lens in front can't hide it; it shines through
  // the glass like the real lamp does, and is invisible while the lamps are off. The glow follows the part's own
  // texture, so the LED strip's facets and the projector's lens pattern show in the light.
  for (const guide of guides) {
    const base = guide.material as THREE.MeshStandardMaterial;
    const glow = new THREE.MeshStandardMaterial({
      name: base.name,
      color: 0x000000,
      emissive: 0x000000,
      emissiveMap: base.map ?? null,
      roughness: 1,
      metalness: 0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -40,
    });
    base.name = `${base.name}_Housing`;
    const copy = new THREE.Mesh(guide.geometry, glow);
    copy.renderOrder = 3;
    copy.position.copy(guide.position);
    copy.quaternion.copy(guide.quaternion);
    copy.scale.copy(guide.scale);
    copy.castShadow = false;
    guide.parent?.add(copy);
  }
  for (const lens of lenses) {
    const mat = lens.material as THREE.MeshPhysicalMaterial;
    mat.color.setRGB(0, 0, 0);
    mat.opacity = 1;
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    mat.roughness = 0.03;
    if (mat.isMeshPhysicalMaterial) mat.specularIntensity = 1;
    mat.needsUpdate = true;
    lens.renderOrder = 2;
    lens.castShadow = false;
    const tint = new THREE.Mesh(
      lens.geometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1, 0.03, 0.02),
        blending: THREE.MultiplyBlending,
        premultipliedAlpha: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    tint.renderOrder = 1;
    tint.position.copy(lens.position);
    tint.quaternion.copy(lens.quaternion);
    tint.scale.copy(lens.scale);
    lens.parent?.add(tint);
  }
}

// A stand-in sports sedan built from primitives, used until a real model is dropped in at /public/sim/car.glb.
function makePlaceholderCar(focusTargets: THREE.Object3D[]) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x1d4fa3, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.55 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.9, roughness: 0.35 });
  const caliper = new THREE.MeshStandardMaterial({ color: 0xc8a515, roughness: 0.4 });
  const lamp = new THREE.MeshPhysicalMaterial({ name: "Light_Bulb", color: 0xdfe6ee, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const tail = new THREE.MeshPhysicalMaterial({ name: "Bright_Lights", color: 0x7a0b0b, roughness: 0.1, clearcoat: 1 });

  const L = 4.6, W = 1.8;
  // Side profile of the body (x along length, y up), extruded across the width.
  const body = new THREE.Shape();
  const pts: [number, number][] = [
    [-2.3, 0.32], [-2.33, 0.62], [-2.25, 0.86], [-1.95, 0.95], [-1.25, 0.98], [-0.95, 1.38], [-0.55, 1.44], [0.35, 1.44],
    [0.95, 1.06], [1.85, 0.98], [2.25, 0.86], [2.32, 0.6], [2.28, 0.34], [1.75, 0.3], [1.68, 0.5], [1.42, 0.68], [1.03, 0.68],
    [0.82, 0.5], [0.76, 0.3], [-0.84, 0.3], [-0.9, 0.5], [-1.13, 0.68], [-1.52, 0.68], [-1.76, 0.5], [-1.84, 0.32],
  ];
  body.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) body.lineTo(x, y);
  const bg = new THREE.ExtrudeGeometry(body, { depth: W - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 6, curveSegments: 4 });
  bg.translate(0, 0, -(W - 0.16) / 2);
  const bodyMesh = new THREE.Mesh(bg, paint);
  group.add(bodyMesh);

  // Glasshouse
  const gs = new THREE.Shape();
  [[-1.2, 0.99], [-0.93, 1.36], [-0.55, 1.41], [0.33, 1.41], [0.9, 1.04]].forEach(([x, y], i) => (i ? gs.lineTo(x, y) : gs.moveTo(x, y)));
  const gg = new THREE.ExtrudeGeometry(gs, { depth: W - 0.12, bevelEnabled: false });
  gg.translate(0, 0.005, -(W - 0.12) / 2);
  group.add(new THREE.Mesh(gg, glass));

  // Bonnet scoop, wing, lights, grille
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.62), paint);
  scoop.position.set(1.45, 1.0, 0);
  scoop.rotation.z = -0.08;
  group.add(scoop);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 1.5), paint);
  wing.position.set(-2.12, 1.2, 0);
  group.add(wing);
  for (const z of [-0.62, 0.62]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.04), paint);
    st.position.set(-2.1, 1.06, z);
    group.add(st);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.42), lamp);
    hl.position.set(2.3, 0.78, z * 1.05);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.38), tail);
    tl.position.set(-2.34, 0.84, z * 1.05);
    group.add(tl);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 1.0), black);
  grille.position.set(2.33, 0.5, 0);
  group.add(grille);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.12, W + 0.02), black);
  sill.position.set(0, 0.3, 0);
  group.add(sill);

  // Wheels
  const tg = new THREE.CylinderGeometry(0.33, 0.33, 0.245, 48);
  tg.rotateX(Math.PI / 2);
  const rg = new THREE.CylinderGeometry(0.235, 0.235, 0.25, 48);
  rg.rotateX(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.04, 0.21, 0.03);
  for (const [i, [x, z]] of [[1.3, W / 2 - 0.1], [1.3, -W / 2 + 0.1], [-1.35, W / 2 - 0.1], [-1.35, -W / 2 + 0.1]].entries()) {
    const wg = new THREE.Group();
    wg.name = `Tire${i}_${i}`; // so rigModel finds it
    wg.add(new THREE.Mesh(tg, tyre));
    const r = new THREE.Mesh(rg, black);
    wg.add(r);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(spoke, rim);
      s.position.z = Math.sign(z) * 0.115;
      s.rotation.z = (i / 10) * Math.PI * 2;
      s.translateY(0.11);
      wg.add(s);
    }
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), caliper);
    cal.position.set(0.12, 0.08, Math.sign(z) * 0.07);
    wg.add(cal);
    wg.position.set(x, 0.33, z);
    group.add(wg);
  }

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      focusTargets.push(o);
    }
  });
  return { group, length: L, width: W };
}
