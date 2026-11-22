// The pose library for the wall game. Every pose is a handful of limb directions, so the cutout is drawn from the same numbers
// the judge compares your body against, and each pose is a shape a person can really hold, front-on to the camera.
//
// Angles are screen directions in degrees as the player sees themselves (mirrored, like a mirror):
//   0 = pointing right, 90 = down, 180 = left, 270 (or -90) = up.
// "l" limbs are the player's left, which a mirror shows on the screen's left.

export type Seg = "lUA" | "lFA" | "rUA" | "rFA" | "lT" | "lS" | "rT" | "rS" | "torso";
export type Joint = "head" | "mSh" | "mHip" | "lSh" | "rSh" | "lEl" | "rEl" | "lWr" | "rWr" | "lHip" | "rHip" | "lKn" | "rKn" | "lAn" | "rAn";
export type Limb = { UA: number; FA: number; T: number; S: number };

export interface PoseDef {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  angles: Record<Seg, number>;
  symmetric: boolean;
}

const mirror = (a: number) => (540 - a) % 360; // reflect a direction left to right (180 - a, kept positive)

/** A pose from the left arm and leg, with the right side mirrored; pass `r` for the ones that are not symmetrical. */
function pose(id: string, name: string, level: 1 | 2 | 3, l: { UA: number; FA: number; T: number; S: number }, opts: { r?: typeof l; torso?: number } = {}): PoseDef {
  const r = opts.r ?? { UA: mirror(l.UA), FA: mirror(l.FA), T: mirror(l.T), S: mirror(l.S) };
  return {
    id,
    name,
    level,
    symmetric: !opts.r && !opts.torso,
    angles: { torso: opts.torso ?? 270, lUA: l.UA, lFA: l.FA, lT: l.T, lS: l.S, rUA: r.UA, rFA: r.FA, rT: r.T, rS: r.S },
  };
}

export const POSES: PoseDef[] = [
  pose("attention", "Attention", 1, { UA: 98, FA: 95, T: 97, S: 93 }),
  pose("t", "T-pose", 1, { UA: 180, FA: 180, T: 98, S: 94 }),
  pose("y", "Reach up", 1, { UA: 262, FA: 262, T: 98, S: 94 }),
  pose("goalpost", "Goalpost", 1, { UA: 180, FA: 270, T: 98, S: 94 }),
  pose("hips", "Hands on hips", 1, { UA: 125, FA: 55, T: 98, S: 94 }),
  pose("star", "Star", 1, { UA: 225, FA: 225, T: 125, S: 115 }),
  pose("head", "Hands on head", 2, { UA: 200, FA: 330, T: 98, S: 94 }),
  pose("sumo", "Strongman squat", 2, { UA: 150, FA: 250, T: 142, S: 90 }),
  pose("diagonal", "Diagonal", 2, { UA: 225, FA: 225, T: 100, S: 95 }, { r: { UA: 25, FA: 25, T: 80, S: 85 } }),
  pose("flag", "One up, one on the hip", 2, { UA: 265, FA: 265, T: 98, S: 94 }, { r: { UA: 55, FA: 125, T: 82, S: 86 } }),
  pose("lean", "Side bend", 2, { UA: 270, FA: 330, T: 98, S: 94 }, { torso: 288, r: { UA: 70, FA: 80, T: 82, S: 86 } }),
  pose("tree", "Tree", 2, { UA: 262, FA: 310, T: 92, S: 90 }, { r: { UA: 278, FA: 230, T: 45, S: 135 } }),
  pose("warrior", "Warrior", 3, { UA: 180, FA: 180, T: 140, S: 85 }, { r: { UA: 0, FA: 0, T: 52, S: 52 } }),
  pose("legraise", "Side leg raise", 3, { UA: 180, FA: 180, T: 138, S: 138 }, { torso: 274, r: { UA: 0, FA: 0, T: 88, S: 90 } }),
];

/** The same pose reflected left to right, so asymmetrical poses can show up either way round. */
export function flipped(p: PoseDef): PoseDef {
  const a = p.angles;
  return {
    ...p,
    angles: {
      torso: mirror(a.torso),
      lUA: mirror(a.rUA), lFA: mirror(a.rFA), lT: mirror(a.rT), lS: mirror(a.rS),
      rUA: mirror(a.lUA), rFA: mirror(a.lFA), rT: mirror(a.lT), rS: mirror(a.lS),
    },
  };
}

// Body proportions, in torso lengths (shoulder middle to hip middle = 1).
export const BODY = { halfShoulder: 0.28, halfHip: 0.17, neck: 0.42, headR: 0.21, upperArm: 0.55, forearm: 0.5, hand: 0.1, thigh: 0.75, shin: 0.75, foot: 0.12 };

export type Fig = Record<Joint, [number, number]>;

const dir = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const add = (a: [number, number], d: [number, number], k: number): [number, number] => [a[0] + d[0] * k, a[1] + d[1] * k];

/** Builds the stick figure for a pose: mid-hip at (0,0), y pointing down, in torso lengths. */
export function build(p: PoseDef): Fig {
  const a = p.angles;
  const up = dir(a.torso);
  const leftDir = dir(a.torso - 90); // the player's left, on the screen's left
  const mHip: [number, number] = [0, 0];
  const mSh = add(mHip, up, 1);
  const lSh = add(mSh, leftDir, BODY.halfShoulder);
  const rSh = add(mSh, leftDir, -BODY.halfShoulder);
  const lHip = add(mHip, leftDir, BODY.halfHip);
  const rHip = add(mHip, leftDir, -BODY.halfHip);
  const lEl = add(lSh, dir(a.lUA), BODY.upperArm);
  const rEl = add(rSh, dir(a.rUA), BODY.upperArm);
  const lWr = add(lEl, dir(a.lFA), BODY.forearm);
  const rWr = add(rEl, dir(a.rFA), BODY.forearm);
  const lKn = add(lHip, dir(a.lT), BODY.thigh);
  const rKn = add(rHip, dir(a.rT), BODY.thigh);
  const lAn = add(lKn, dir(a.lS), BODY.shin);
  const rAn = add(rKn, dir(a.rS), BODY.shin);
  return { head: add(mSh, up, BODY.neck), mSh, mHip, lSh, rSh, lEl, rEl, lWr, rWr, lHip, rHip, lKn, rKn, lAn, rAn };
}

/** Checks that a pose is something a body can do: elbows and knees only bend so far, shoulders stay level-ish, feet are planted. Returns the problems. */
export function problems(p: PoseDef): string[] {
  const a = p.angles;
  const out: string[] = [];
  const bend = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);
  for (const s of ["l", "r"] as const) {
    if (bend(a[`${s}UA` as Seg], a[`${s}FA` as Seg]) > 150) out.push(`${s} elbow bends too far`);
    if (bend(a[`${s}T` as Seg], a[`${s}S` as Seg]) > 90) out.push(`${s} knee bends too far`);
  }
  const f = build(p);
  const tree = p.id === "tree";
  if (!tree && Math.abs(f.lAn[1] - f.rAn[1]) > (p.id === "legraise" || p.id === "warrior" || p.id === "sumo" ? 0.6 : 0.2)) out.push("feet at different heights");
  if (f.lAn[0] > f.rAn[0] + 0.02) out.push("legs cross");
  if (f.lWr[1] > f.lKn[1] + 0.3) out.push("hand below the knee");
  return out;
}
