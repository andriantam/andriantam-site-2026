// Ladder physics: the car can knock a ladder over. It tips onto its side about its feet (a falling rod),
// slides to a stop on the asphalt, and can be picked back up and stood upright.
import type { Bounds, Ladder } from "./world";
import { type Box2, boxesOverlap, clamp } from "./geom";

const SIDE = 0.28; // half the ladder's width: how high its middle sits once it's lying on its side
const FRICTION = 4; // m/s^2 of sliding deceleration on asphalt

/** Footprint on the ground: the standing box, or the long box of a ladder lying down. */
export function footprint(l: Ladder): Box2 {
  if (!l.fallen) return l.box;
  const s = Math.sin(l.tilt);
  const dir = -l.tiltSign; // the top falls towards local +x when tiltSign is -1
  const ox = Math.cos(l.box.rot) * dir, oz = -Math.sin(l.box.rot) * dir; // local x in world
  const reach = (l.top / 2 + 0.05) * s;
  return {
    cx: l.group.position.x + ox * reach,
    cz: l.group.position.z + oz * reach,
    hx: Math.max(l.box.hx, reach + 0.1),
    hz: l.box.hz,
    rot: l.box.rot,
  };
}

/** The car (box, velocity) hits the ladder. Returns true if it knocked it over just now. */
export function hit(l: Ladder, car: Box2, vx: number, vz: number): boolean {
  const speed = Math.hypot(vx, vz);
  let dx = vx, dz = vz;
  if (speed < 0.3) {
    // Nudged slowly: push it away from the car's middle.
    dx = l.group.position.x - car.cx;
    dz = l.group.position.z - car.cz;
  }
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  let knocked = false;
  if (!l.fallen) {
    knocked = true;
    l.fallen = true;
    const lx = Math.cos(l.box.rot), lz = -Math.sin(l.box.rot);
    l.tiltSign = dx * lx + dz * lz > 0 ? -1 : 1;
    l.tilt = 0.05;
    l.tiltRate = 1 + speed * 0.7;
  }
  const push = Math.max(speed * 1.15, 0.6);
  l.vx = dx * push;
  l.vz = dz * push;
  // Move it clear of the car so the car keeps going.
  for (let i = 0; i < 30 && boxesOverlap(car, footprint(l)); i++) {
    l.group.position.x += dx * 0.06;
    l.group.position.z += dz * 0.06;
    l.box.cx = l.group.position.x;
    l.box.cz = l.group.position.z;
  }
  return knocked;
}

export function step(ladders: Ladder[], dt: number, bounds: Bounds) {
  for (const l of ladders) {
    if (l.carried) continue;
    const moving = l.vx !== 0 || l.vz !== 0 || (l.fallen && (l.tilt < Math.PI / 2 || l.tiltRate !== 0));
    if (!moving) continue;
    if (l.fallen) {
      // A rod falling about its base: angular acceleration ~ (3g / 2L) sin(theta).
      const L = l.top + 0.3;
      l.tiltRate += ((3 * 9.81) / (2 * L)) * Math.sin(Math.max(l.tilt, 0.05)) * dt;
      l.tilt += l.tiltRate * dt;
      if (l.tilt >= Math.PI / 2) {
        l.tilt = Math.PI / 2;
        l.tiltRate = Math.abs(l.tiltRate) > 0.6 ? -l.tiltRate * 0.22 : 0; // a small bounce, then still
      }
    }
    const sp = Math.hypot(l.vx, l.vz);
    if (sp > 0) {
      const nsp = Math.max(0, sp - FRICTION * dt);
      l.vx *= nsp / sp;
      l.vz *= nsp / sp;
      if (nsp === 0) l.vx = l.vz = 0;
    }
    l.group.position.x = clamp(l.group.position.x + l.vx * dt, bounds.minX + 0.4, bounds.maxX - 0.4);
    l.group.position.z = clamp(l.group.position.z + l.vz * dt, bounds.minZ + 0.4, bounds.maxZ - 0.4);
    apply(l);
  }
}

/** Writes the ladder's state to its mesh and standing box. */
export function apply(l: Ladder) {
  l.group.position.y = Math.sin(l.tilt) * SIDE;
  l.group.rotation.set(0, l.box.rot, l.tilt * l.tiltSign);
  l.box.cx = l.group.position.x;
  l.box.cz = l.group.position.z;
}

/** Picked up: upright again and still. */
export function upright(l: Ladder) {
  l.fallen = false;
  l.tilt = 0;
  l.tiltRate = 0;
  l.vx = l.vz = 0;
  l.group.rotation.set(0, l.box.rot, 0);
}
