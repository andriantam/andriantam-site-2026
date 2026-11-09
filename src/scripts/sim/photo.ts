// Photo "development": renders the exposure the way a sensor records it.
// - Motion blur: the camera pose is sampled across the real shutter interval (recorded from your input).
// - Depth of field: each sample moves the camera across the lens aperture while keeping the focus plane fixed.
//   Bokeh takes the shape of the aperture blades when stopped down.
// - Exposure: scene light x 2^(sceneEV - EV(settings)). Flash adds light by inverse-square law and does not
//   depend on shutter speed. Highlights clip; high ISO adds shot noise.
import * as THREE from "three";

export interface Pose {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

export interface ShotSettings {
  focal: number; // mm
  aperture: number;
  shutter: number; // seconds
  iso: number;
  blades: number;
  maxAperture: number;
  focusDist: number; // metres
  exposure: number; // linear multiplier from settings
  flash: number; // 0 = off, otherwise power fraction
  flashGN: number;
  aspect: number;
  vfov: number; // degrees
}

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ACCUM_FRAG = /* glsl */ `
uniform sampler2D tSample;
uniform float weight;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tSample, vUv).rgb * weight, 1.0); }`;

const DEVELOP_FRAG = /* glsl */ `
uniform sampler2D tAccum;
uniform sampler2D tFlash;
uniform float exposure;
uniform float flashGain;
uniform float noise;
uniform float vignette;
uniform float seed;
uniform vec2 res;
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float gauss(vec2 p) {
  float u1 = max(hash(p), 1e-6), u2 = hash(p + 17.31);
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec3 c = texture2D(tAccum, vUv).rgb * exposure + texture2D(tFlash, vUv).rgb * flashGain;
  // Optical vignetting, in stops of light lost at the corners (strongest wide open).
  vec2 d = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
  float rn2 = dot(d, d) / dot(vec2(0.5 * res.x / res.y, 0.5), vec2(0.5 * res.x / res.y, 0.5)); // 1.0 at the corners
  c *= exp2(-vignette * pow(rn2, 1.6));
  // Sensor noise: photon shot noise (grows with signal) plus read noise, both amplified by ISO gain.
  vec2 px = vUv * res + seed;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sigma = noise * (0.55 * sqrt(max(lum, 0.0)) + 0.012);
  c += sigma * vec3(gauss(px), gauss(px + 3.1), gauss(px + 7.7)) * 0.6 + sigma * gauss(px + 11.3) * 0.8;
  c = max(c, 0.0);
  gl_FragColor = vec4(srgb(aces(c)), 1.0);
}`;

export class Darkroom {
  private renderer: THREE.WebGLRenderer;
  private width: number;
  private height: number;
  private sampleRT: THREE.WebGLRenderTarget;
  private accumRT: THREE.WebGLRenderTarget;
  private flashRT: THREE.WebGLRenderTarget;
  private outRT: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private accumMat: THREE.ShaderMaterial;
  private developMat: THREE.ShaderMaterial;
  private cam = new THREE.PerspectiveCamera();
  busy = false;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    // Additive blending into 32-bit float needs EXT_float_blend; otherwise accumulate in half float.
    const floatOK = renderer.extensions.has("EXT_color_buffer_float") && renderer.extensions.has("EXT_float_blend");
    const hdr = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, samples: 4 };
    this.sampleRT = new THREE.WebGLRenderTarget(width, height, hdr);
    this.flashRT = new THREE.WebGLRenderTarget(width, height, hdr);
    this.accumRT = new THREE.WebGLRenderTarget(width, height, { type: floatOK ? THREE.FloatType : THREE.HalfFloatType, depthBuffer: false });
    this.outRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.accumMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: ACCUM_FRAG,
      uniforms: { tSample: { value: null }, weight: { value: 1 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.developMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: DEVELOP_FRAG,
      uniforms: {
        tAccum: { value: this.accumRT.texture },
        tFlash: { value: this.flashRT.texture },
        exposure: { value: 1 },
        flashGain: { value: 0 },
        noise: { value: 0 },
        vignette: { value: 0 },
        seed: { value: 0 },
        res: { value: new THREE.Vector2(width, height) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * Develop one photo. `poseAt(t)` returns the camera pose at a time inside the exposure window.
   * Work is spread across animation frames so the page stays responsive; `onProgress` reports 0..1.
   */
  async develop(
    scene: THREE.Scene,
    s: ShotSettings,
    t0: number,
    poseAt: (t: number) => { p: THREE.Vector3; q: THREE.Quaternion },
    flashLight: THREE.PointLight,
    isolateFlash: (on: boolean) => void, // switches every other light source off for the flash pass
    samples: number,
    onProgress: (p: number) => void,
  ): Promise<HTMLCanvasElement> {
    this.busy = true;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevTone = r.toneMapping;
    const prevShadowAuto = r.shadowMap.autoUpdate;
    const prevAutoClear = r.autoClear;
    r.autoClear = false; // we clear explicitly; the accumulator must keep every sample
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;

    // Clear accumulator
    r.setRenderTarget(this.accumRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);

    const f = s.focal / 1000;
    const apertureRadius = f / s.aperture / 2; // entrance pupil radius, metres
    const stopsDown = Math.log2((s.aperture / s.maxAperture) ** 2);
    const polygon = stopsDown > 0.6; // blades show once stopped down
    const near = 0.05, far = 2000;
    const top = near * Math.tan(THREE.MathUtils.degToRad(s.vfov) / 2);
    const right = top * s.aspect;
    const pxW = (2 * right) / this.width, pxH = (2 * top) / this.height;

    const pts = aperturePoints(samples, s.blades, polygon);
    const order = shuffle(samples);
    flashLight.visible = false;
    const per = Math.max(1, Math.round(samples / 16));

    for (let i = 0; i < samples; i++) {
      const tt = t0 + s.shutter * 1000 * ((order[i] + 0.5) / samples);
      const pose = poseAt(tt);
      const [ax, ay] = pts[i];
      this.setLensCamera(pose, ax * apertureRadius, ay * apertureRadius, s.focusDist, near, far, top, right, (Math.random() - 0.5) * pxW, (Math.random() - 0.5) * pxH);
      r.setRenderTarget(this.sampleRT);
      r.clear();
      r.render(scene, this.cam);
      // add into accumulator
      this.quad.material = this.accumMat;
      this.accumMat.uniforms.tSample.value = this.sampleRT.texture;
      this.accumMat.uniforms.weight.value = 1 / samples;
      r.setRenderTarget(this.accumRT);
      r.render(this.quadScene, this.quadCam);
      if (i % per === per - 1) {
        onProgress((i + 1) / (samples + 2));
        await nextFrame();
      }
    }

    // Flash: a ~1/1000 s burst at the start of the exposure (first-curtain sync), so it freezes motion.
    r.setRenderTarget(this.flashRT);
    r.clear();
    if (s.flash > 0) {
      const pose = poseAt(t0);
      isolateFlash(true);
      flashLight.visible = true;
      // Flash head sits on the hot shoe, ~12 cm above the lens axis.
      flashLight.position.copy(new THREE.Vector3(0, 0.12, 0).applyQuaternion(pose.q).add(pose.p));
      // Intensity so that an 18% grey card at distance GN/N is correctly exposed (see flashGain).
      flashLight.intensity = Math.PI * s.flashGN * s.flashGN * s.flash;
      flashLight.distance = 0;
      flashLight.decay = 2;
      this.setLensCamera(pose, 0, 0, s.focusDist, near, far, top, right, 0, 0);
      r.render(scene, this.cam);
      flashLight.visible = false;
      isolateFlash(false);
    }

    // Develop: exposure, flash, vignetting, noise, tone curve.
    const u = this.developMat.uniforms;
    u.exposure.value = s.exposure;
    u.flashGain.value = s.flash > 0 ? (s.iso / 100) / (s.aperture * s.aperture) : 0;
    u.noise.value = 0.006 * Math.sqrt(s.iso / 100);
    // Corner fall-off in stops: about 2 stops wide open on a fast lens, settling to ~0.3 stops when stopped down.
    const wideOpen = Math.max(0.6, 2.2 - (s.maxAperture - 1.2) * 0.5) * (s.focal < 30 ? 1.15 : 1);
    u.vignette.value = Math.max(0.3, wideOpen - stopsDown * 0.65);
    u.seed.value = Math.random() * 1000;
    this.quad.material = this.developMat;
    r.setRenderTarget(this.outRT);
    r.render(this.quadScene, this.quadCam);

    const buf = new Uint8Array(this.width * this.height * 4);
    r.readRenderTargetPixels(this.outRT, 0, 0, this.width, this.height, buf);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    r.toneMapping = prevTone;
    r.shadowMap.autoUpdate = prevShadowAuto;
    onProgress(1);

    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(this.width, this.height);
    // WebGL rows are bottom-up
    const row = this.width * 4;
    for (let y = 0; y < this.height; y++) img.data.set(buf.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    this.busy = false;
    return canvas;
  }

  private setLensCamera(
    pose: { p: THREE.Vector3; q: THREE.Quaternion },
    ox: number,
    oy: number,
    focus: number,
    near: number,
    far: number,
    top: number,
    right: number,
    jx: number,
    jy: number,
  ) {
    const cam = this.cam;
    cam.quaternion.copy(pose.q);
    const offset = new THREE.Vector3(ox, oy, 0).applyQuaternion(pose.q);
    cam.position.copy(pose.p).add(offset);
    cam.updateMatrixWorld(true);
    // Shear the frustum so the plane at `focus` lands on the same pixels for every aperture position.
    const sx = (-ox * near) / focus + jx, sy = (-oy * near) / focus + jy;
    cam.projectionMatrix.makePerspective(-right + sx, right + sx, top + sy, -top + sy, near, far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  dispose() {
    [this.sampleRT, this.accumRT, this.flashRT, this.outRT].forEach((t) => t.dispose());
  }
}

// Evenly spread points over the aperture (disk, or an n-sided polygon when stopped down).
function aperturePoints(n: number, blades: number, polygon: boolean): [number, number][] {
  const out: [number, number][] = [];
  const g = 1.32471795724474602596; // plastic number, R2 sequence
  const a1 = 1 / g, a2 = 1 / (g * g);
  for (let i = 0; i < n; i++) {
    const u = (0.5 + a1 * (i + 1)) % 1;
    const v = (0.5 + a2 * (i + 1)) % 1;
    let r = Math.sqrt(u);
    const th = v * Math.PI * 2;
    if (polygon) {
      const seg = (Math.PI * 2) / blades;
      const local = ((th % seg) + seg) % seg - seg / 2;
      r *= Math.cos(seg / 2) / Math.cos(local);
    }
    out.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return out;
}

function shuffle(n: number) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Yield to the browser between batches (a timer, so developing also finishes in a background tab).
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

// Luminance histogram of a developed photo.
export function histogram(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bins = new Array(64).fill(0);
  for (let i = 0; i < data.length; i += 16) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    bins[Math.min(63, Math.floor(l / 4))]++;
  }
  const clipped = bins[63] / (data.length / 16);
  return { bins, clipped };
}
