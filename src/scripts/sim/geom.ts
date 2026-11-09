// 2D geometry on the ground plane (x, z) for collisions.
// A Box2's `rot` matches three.js `rotation.y`, so a box always lines up with the mesh it stands for.

export interface Box2 {
  cx: number;
  cz: number;
  hx: number; // half size along the box's local x
  hz: number; // half size along the box's local z
  rot: number;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function toLocal(b: Box2, x: number, z: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = x - b.cx, dz = z - b.cz;
  return [dx * c - dz * s, dx * s + dz * c];
}

export function toWorld(b: Box2, lx: number, lz: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [b.cx + lx * c + lz * s, b.cz - lx * s + lz * c];
}

export function inBox(b: Box2, x: number, z: number, margin = 0) {
  const [lx, lz] = toLocal(b, x, z);
  return Math.abs(lx) <= b.hx + margin && Math.abs(lz) <= b.hz + margin;
}

/** Pushes a circle of radius r at (x, z) out of the box. Returns the corrected position. */
export function pushOut(b: Box2, x: number, z: number, r: number): [number, number] {
  const [lx, lz] = toLocal(b, x, z);
  const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
  const ox = lx - qx, oz = lz - qz;
  const d = Math.hypot(ox, oz);
  if (d >= r) return [x, z];
  if (d < 1e-5) {
    // Centre is inside the box: leave by the nearest side.
    const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
    return px < pz ? toWorld(b, (Math.sign(lx) || 1) * (b.hx + r), lz) : toWorld(b, lx, (Math.sign(lz) || 1) * (b.hz + r));
  }
  const k = r / d;
  return toWorld(b, qx + ox * k, qz + oz * k);
}

/** Distance from a point to the box's edge (0 inside). */
export function distToBox(b: Box2, x: number, z: number) {
  const [lx, lz] = toLocal(b, x, z);
  return Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz));
}

export function corners(b: Box2): [number, number][] {
  return [
    toWorld(b, b.hx, b.hz),
    toWorld(b, -b.hx, b.hz),
    toWorld(b, -b.hx, -b.hz),
    toWorld(b, b.hx, -b.hz),
  ];
}

/** Separating-axis test for two oriented rectangles. */
export function boxesOverlap(a: Box2, b: Box2) {
  const axes: [number, number][] = [];
  for (const r of [a.rot, b.rot]) axes.push([Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]);
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of ca) {
      const p = x * ax + z * az;
      amin = Math.min(amin, p);
      amax = Math.max(amax, p);
    }
    for (const [x, z] of cb) {
      const p = x * ax + z * az;
      bmin = Math.min(bmin, p);
      bmax = Math.max(bmax, p);
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

/** Shortest signed angle from a to b. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
