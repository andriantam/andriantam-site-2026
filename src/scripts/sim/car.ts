// The drivable car: a kinematic bicycle model (steer the front axle, pivot about the rear),
// wheels that steer and roll, and working headlights and tail lights.
import * as THREE from "three";
import { candelaToScene, nitsToScene } from "./data";
import type { Box2 } from "./geom";

export interface Wheel {
  steer: THREE.Object3D; // turns about the vertical axis (front wheels only)
  spin: THREE.Object3D; // rolls about the axle
  front: boolean;
}

export interface CarParts {
  group: THREE.Group;
  length: number;
  width: number;
  frontSign: 1 | -1; // the car's nose points along local +x (1) or -x (-1)
  wheels: Wheel[];
  wheelRadius: number;
  wheelbase: number;
  rearAxle: number; // local x of the rear axle
  headlightMats: THREE.MeshStandardMaterial[];
  tailMats: THREE.MeshStandardMaterial[];
  headlightPos: THREE.Vector3[]; // local positions of the two headlamps
}

const MAX_STEER = 0.6; // rad at the road wheels
const V_FWD = 7; // m/s (25 km/h: it's a car park)
const V_REV = 3;

export class CarRig {
  parts: CarParts;
  box: Box2;
  x: number;
  z: number;
  yaw: number;
  v = 0;
  steer = 0;
  lightsOn = false;
  private spinAngle = 0;
  private spots: THREE.SpotLight[] = [];
  private shadow?: THREE.Mesh;

  constructor(parts: CarParts, box: Box2) {
    this.parts = parts;
    this.box = box;
    this.x = parts.group.position.x;
    this.z = parts.group.position.z;
    this.yaw = parts.group.rotation.y;

    // Low-beam headlamps. Always in the scene (intensity 0 when off) so toggling doesn't recompile shaders.
    for (const p of parts.headlightPos) {
      const s = new THREE.SpotLight(0xfff3e4, 0, 0, 0.42, 0.45, 2);
      s.position.copy(p);
      s.target.position.set(p.x + parts.frontSign * 12, -0.35, p.z);
      parts.group.add(s, s.target);
      this.spots.push(s);
    }
    // Remember each lamp's colour, then switch it off (tuneCarMaterial already zeroed most of them).
    for (const m of [...parts.headlightMats, ...parts.tailMats]) m.emissiveIntensity = 0;
  }

  /** The car's soft contact shadow rides along with it. */
  attachShadow(mesh: THREE.Mesh) {
    this.shadow = mesh;
    mesh.position.set(0, 0.012, 0);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    this.parts.group.add(mesh);
  }

  forward(): [number, number] {
    const f = this.parts.frontSign;
    return [Math.cos(this.yaw) * f, -Math.sin(this.yaw) * f];
  }

  /** Box for a candidate pose, for collision checks. */
  boxAt(x: number, z: number, yaw: number): Box2 {
    return { ...this.box, cx: x, cz: z, rot: yaw };
  }

  setPose(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.parts.group.position.set(x, 0, z);
    this.parts.group.rotation.y = yaw;
    this.box.cx = x;
    this.box.cz = z;
    this.box.rot = yaw;
  }

  /**
   * throttle -1..1 (negative brakes, then reverses), steer -1..1 (positive turns left).
   * `blocked` says whether a pose would hit something; the car stops dead if so.
   */
  step(dt: number, throttle: number, steerIn: number, handbrake: boolean, blocked: (b: Box2) => boolean) {
    const target = THREE.MathUtils.clamp(steerIn, -1, 1) * MAX_STEER;
    this.steer += (target - this.steer) * Math.min(1, dt * 5);

    let v = this.v;
    if (handbrake) v = approach(v, 0, 9 * dt);
    else if (throttle > 0.05) v = v < -0.05 ? approach(v, 0, 8 * dt) : Math.min(V_FWD, v + 2.6 * throttle * dt);
    else if (throttle < -0.05) v = v > 0.05 ? approach(v, 0, 8 * dt) : Math.max(-V_REV, v + 1.8 * throttle * dt);
    else v = approach(v, 0, 1.4 * dt); // rolling resistance and engine braking
    this.v = v;
    if (Math.abs(v) < 1e-4) return this.animate(0);

    // Move the rear axle along the heading, turn about it.
    const { rearAxle, wheelbase } = this.parts;
    const yawRate = (v / wheelbase) * Math.tan(this.steer);
    const yaw = this.yaw + yawRate * dt;
    const [fx, fz] = this.forward();
    const rx = this.x + Math.cos(this.yaw) * rearAxle, rz = this.z - Math.sin(this.yaw) * rearAxle; // rear axle, world
    const nrx = rx + fx * v * dt, nrz = rz + fz * v * dt;
    const nx = nrx - Math.cos(yaw) * rearAxle, nz = nrz + Math.sin(yaw) * rearAxle;
    if (blocked(this.boxAt(nx, nz, yaw)) && !blocked(this.box)) {
      this.v = 0;
      return this.animate(0);
    }
    this.setPose(nx, nz, yaw);
    this.animate(v * dt);
  }

  private animate(dist: number) {
    this.spinAngle -= (dist / this.parts.wheelRadius) * this.parts.frontSign;
    for (const w of this.parts.wheels) {
      w.spin.rotation.z = this.spinAngle;
      if (w.front) w.steer.rotation.y = this.steer;
    }
  }

  /** Headlights and tail lights, in real units for the current light level. */
  setLights(on: boolean) {
    this.lightsOn = on;
    this.applyLightLevel();
  }

  applyLightLevel(scale = 1) {
    const on = this.lightsOn ? scale : 0;
    for (const s of this.spots) s.intensity = candelaToScene(12000) * on; // ~12,000 cd per low beam
    for (const m of this.parts.headlightMats) {
      m.emissive.setRGB(1, 0.96, 0.9);
      m.emissiveIntensity = nitsToScene(40000) * on; // LED lamp, seen head-on
    }
    for (const m of this.parts.tailMats) {
      m.emissive.setRGB(1, 0.03, 0.02);
      m.emissiveIntensity = nitsToScene(1500) * on;
    }
  }
}

const approach = (v: number, t: number, d: number) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

/**
 * Splits a loaded car model into wheel pivots so the wheels can steer and roll.
 * `group` is the car's root (scale 1, centred, nose along ±x). Works on the Sketchfab WRX's node layout,
 * where each wheel is a cluster of sibling nodes (tyre, rim, disc...) and calipers are separate.
 */
export function rigModel(group: THREE.Group, length: number, width: number): CarParts {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const localCentre = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).applyMatrix4(inv);

  // Front: where the headlamp glass is.
  const meshesByMat = (re: RegExp) => {
    const out: THREE.Mesh[] = [];
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some((x) => re.test(x.name))) out.push(m);
    });
    return out;
  };
  const matsByName = (re: RegExp) => {
    const set = new Set<THREE.MeshStandardMaterial>();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => re.test(x.name) && set.add(x as THREE.MeshStandardMaterial));
    });
    return [...set];
  };
  const bulbs = meshesByMat(/^Light_Bulb$/);
  const frontX = bulbs.length ? localCentre(bulbs[0]).x : 1;
  const frontSign: 1 | -1 = frontX >= 0 ? 1 : -1;

  // Wheel parts: nodes named Tire/Rim/Brake_Disc/Drum/Cylinder/Logo that sit beside the body node.
  const wheelPart = /^(Tire|Rim|Brake_Disc|Drum|Cylinder|Logo)\d*_\d+$/;
  let container: THREE.Object3D = group;
  group.traverse((o) => {
    if (/^WRX-body/.test(o.name) && o.parent) container = o.parent;
  });
  const parts = container.children.filter((o) => wheelPart.test(o.name));
  const calipers = container.children.filter((o) => /wheelbrake/i.test(o.name));

  const clusters: { c: THREE.Vector3; objs: THREE.Object3D[] }[] = [];
  for (const p of parts) {
    const c = localCentre(p);
    let k = clusters.find((q) => Math.abs(q.c.x - c.x) < 0.5 && Math.sign(q.c.z) === Math.sign(c.z));
    if (!k) clusters.push((k = { c: c.clone(), objs: [] }));
    k.objs.push(p);
  }

  const wheels: Wheel[] = [];
  let radius = 0.33;
  for (const k of clusters) {
    // Centre on the tyre (the most reliable part), axle across the car.
    const tyre = k.objs.find((o) => /^Tire/.test(o.name)) ?? k.objs[0];
    const tb = new THREE.Box3().setFromObject(tyre);
    const centre = tb.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    radius = (tb.max.y - tb.min.y) / 2;
    const steer = new THREE.Object3D();
    steer.position.copy(centre);
    group.add(steer);
    const spin = new THREE.Object3D();
    steer.add(spin);
    steer.updateMatrixWorld(true);
    k.objs.forEach((o) => spin.attach(o));
    const front = Math.sign(centre.x) === frontSign;
    if (front) {
      for (const cal of calipers) {
        const cc = localCentre(cal);
        if (Math.abs(cc.x - centre.x) < 0.5 && Math.sign(cc.z) === Math.sign(centre.z)) steer.attach(cal);
      }
    }
    wheels.push({ steer, spin, front });
  }

  const fx = wheels.filter((w) => w.front).map((w) => w.steer.position.x);
  const rx = wheels.filter((w) => !w.front).map((w) => w.steer.position.x);
  const avg = (a: number[], d: number) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : d);
  const frontAxle = avg(fx, 1.3 * frontSign), rearAxle = avg(rx, -1.3 * frontSign);

  // Headlamp positions: either side of the bulbs' bounding box, just behind the lens.
  const headlightPos: THREE.Vector3[] = [];
  const hb = new THREE.Box3();
  bulbs.forEach((m) => hb.union(new THREE.Box3().setFromObject(m).applyMatrix4(inv)));
  for (const side of [-1, 1]) {
    if (!hb.isEmpty()) {
      headlightPos.push(new THREE.Vector3((frontSign > 0 ? hb.max.x : hb.min.x) - frontSign * 0.12, (hb.min.y + hb.max.y) / 2, (side > 0 ? hb.max.z : hb.min.z) * 0.72));
    } else headlightPos.push(new THREE.Vector3(frontSign * (length / 2 - 0.15), 0.75, side * width * 0.33));
  }

  return {
    group,
    length,
    width,
    frontSign,
    wheels,
    wheelRadius: radius,
    wheelbase: Math.abs(frontAxle - rearAxle) || 2.65,
    rearAxle,
    headlightMats: matsByName(/^(Light_Bulb|Front_Light_Strip)$/),
    tailMats: matsByName(/^Bright_Lights/),
    headlightPos,
  };
}
