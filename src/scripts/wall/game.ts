// Through the Wall: a wall with a person-shaped hole rushes at you. Strike the pose before it arrives.
// Your body is judged by the direction of each limb (not where you stand or how big you are), so it works at any distance from the camera.
import { startTracker, L, type Pt, type Tracker } from "../pose/tracker";
import { POSES, build, flipped, type PoseDef, type Fig, type Seg, BODY } from "./poses";

const COLORS = ["#e8a25a", "#6ec1e4"]; // player 1, player 2
const GOOD = "#5ee08a", OK = "#f2c14e", BAD = "#ff6b5e";
const LOST_AFTER = 1500; // ms before a person who left the picture is forgotten
const PASS_AT = 0.82; // match needed to fit through
const HOLD_MS = 350; // how long the match must be held inside the final window
const LIVES = 3;

// How far off (degrees) each limb may be and still count, and how much it matters.
const TOL: Record<Seg, number> = { torso: 16, lUA: 24, rUA: 24, lFA: 30, rFA: 30, lT: 24, rT: 24, lS: 30, rS: 30 };
const WEIGHT: Record<Seg, number> = { torso: 2, lUA: 1, rUA: 1, lFA: 1, rFA: 1, lT: 1, rT: 1, lS: 1, rS: 1 };
const SEG_JOINTS: Record<Seg, [number, number]> = {
  torso: [-1, -2], // special: mid-hip → mid-shoulder
  lUA: [L.lShoulder, L.lElbow], lFA: [L.lElbow, L.lWrist], rUA: [L.rShoulder, L.rElbow], rFA: [L.rElbow, L.rWrist],
  lT: [L.lHip, L.lKnee], lS: [L.lKnee, L.lAnkle], rT: [L.rHip, L.rKnee], rS: [L.rKnee, L.rAnkle],
};
const SEGS = Object.keys(SEG_JOINTS) as Seg[];
const FULL_BODY = [L.nose, L.lShoulder, L.rShoulder, L.lElbow, L.rElbow, L.lWrist, L.rWrist, L.lHip, L.rHip, L.lKnee, L.rKnee, L.lAnkle, L.rAnkle];

interface Slot {
  pts: Pt[] | null; // smoothed, mirrored, in canvas pixels
  cx: number; // last centre, as displayed (0..1)
  seenAt: number;
}
interface Match {
  score: number; // 0..1
  seg: Record<Seg, number>; // 0..1 per limb
  seen: boolean; // every limb visible
  pass: boolean; // good enough to fit through: a high overall match and no limb badly wrong
}
interface Lane {
  lives: number;
  score: number;
  hold: number; // ms matched so far in the final window
  ok: boolean;
  best: number;
  last: Match | null;
  verdict: { text: string; good: boolean } | null;
}
interface Round {
  pose: PoseDef;
  fig: Fig;
  wall: HTMLCanvasElement;
  origin: [number, number][]; // per lane: where the figure's mid-hip sits on the stage
  start: number;
  dur: number;
  resolved: boolean;
  resolvedAt: number;
}

const diff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function mountWall(root: HTMLElement) {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const video = $<HTMLVideoElement>("[data-video]");
  const canvas = $<HTMLCanvasElement>("[data-canvas]");
  const ctx = canvas.getContext("2d")!;
  const stage = $("[data-stage]");
  const status = $("[data-status]");
  const startBtn = $<HTMLButtonElement>("[data-start]");
  const stopBtn = $<HTMLButtonElement>("[data-stop]");
  const modeBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-mode]")];
  const over = $("[data-over]");
  const guide = $<HTMLCanvasElement>("[data-guide]");
  const guideName = $("[data-guide-name]");

  let W = 960, H = 720;
  let players = 1;
  let tracker: Tracker | null = null;
  let phase: "idle" | "find" | "count" | "play" | "over" = "idle";
  let phaseAt = 0;
  let raf = 0;
  let wave = 0;
  let round: Round | null = null;
  let lastPoseId = "";
  let readySince = 0;
  const slots: Slot[] = [0, 1].map(() => ({ pts: null, cx: 0.5, seenAt: -1e9 }));
  let lanes: Lane[] = [];
  const newLane = (): Lane => ({ lives: LIVES, score: 0, hold: 0, ok: false, best: 0, last: null, verdict: null });

  const setStatus = (msg: string, err = false) => {
    status.textContent = msg;
    status.classList.toggle("err", err);
  };
  const best = () => {
    try { return Number(localStorage.getItem("wall-best") ?? 0); } catch { return 0; }
  };
  const saveBest = (n: number) => {
    try { if (n > best()) localStorage.setItem("wall-best", String(n)); } catch { /* private mode */ }
  };

  // ---- Geometry ----------------------------------------------------------------------------------------------------

  const unit = () => (players === 2 ? 0.19 : 0.25) * H; // pixels per torso length
  const laneX = (i: number) => (players === 2 ? W * (i === 0 ? 0.25 : 0.75) : W / 2);

  // ---- Reading the player ------------------------------------------------------------------------------------------

  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const hipMid = (p: Pt[]) => mid(p[L.lHip], p[L.rHip]);
  const shMid = (p: Pt[]) => mid(p[L.lShoulder], p[L.rShoulder]);
  const torsoLen = (p: Pt[]) => Math.hypot(shMid(p).x - hipMid(p).x, shMid(p).y - hipMid(p).y);
  const fullBody = (p: Pt[]) => FULL_BODY.every((i) => p[i].v >= 0.5);

  /** Direction of a limb on the mirrored screen, in the pose library's convention (0 = right, 90 = down). */
  function dirOf(p: Pt[], s: Seg): number | null {
    let a: { x: number; y: number }, b: { x: number; y: number };
    if (s === "torso") {
      if (p[L.lHip].v < 0.45 || p[L.rHip].v < 0.45 || p[L.lShoulder].v < 0.45 || p[L.rShoulder].v < 0.45) return null;
      a = hipMid(p); b = shMid(p);
    } else {
      const [i, j] = SEG_JOINTS[s];
      if (p[i].v < 0.45 || p[j].v < 0.45) return null;
      a = p[i]; b = p[j];
    }
    return ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
  }

  function match(p: Pt[] | null, pose: PoseDef): Match {
    const seg = {} as Record<Seg, number>;
    if (!p) {
      for (const s of SEGS) seg[s] = 0;
      return { score: 0, seg, seen: false, pass: false };
    }
    let sum = 0, wsum = 0, seen = true;
    for (const s of SEGS) {
      const d = dirOf(p, s);
      let v = 0;
      if (d === null) seen = false;
      else {
        const e = diff(d, pose.angles[s]);
        v = e <= TOL[s] ? 1 : e >= 2 * TOL[s] ? 0 : 1 - (e - TOL[s]) / TOL[s];
      }
      seg[s] = v;
      sum += v * WEIGHT[s];
      wsum += WEIGHT[s];
    }
    const score = seen ? sum / wsum : 0;
    const worst = Math.min(...SEGS.map((s) => seg[s]));
    return { score, seg, seen, pass: seen && score >= PASS_AT && worst >= 0.5 };
  }

  // ---- Frames from the camera --------------------------------------------------------------------------------------

  function onFrame(people: Pt[][], now: number) {
    // Mirror into canvas pixels so everything (angles included) is what the player sees on screen.
    let ppl = people.map((p) => p.map((q) => ({ x: (1 - q.x) * W, y: q.y * H, z: q.z, v: q.v })));
    if (players === 1) {
      ppl.sort((a, b) => torsoLen(b) - torsoLen(a)); // the biggest (nearest) person is the player
      ppl = ppl.slice(0, 1);
    }
    const items = ppl
      .filter((p) => torsoLen(p) > 8)
      .map((p) => ({ p, cx: hipMid(p).x / W }))
      .sort((a, b) => a.cx - b.cx); // left to right on screen
    const live = (i: number) => now - slots[i].seenAt < LOST_AFTER;
    const taken = new Set<number>();
    for (const it of items) {
      let pick = -1, bestD = 0.3;
      slots.forEach((s, i) => {
        if (i >= players || taken.has(i) || !live(i)) return;
        const d = Math.abs(s.cx - it.cx);
        if (d < bestD) { bestD = d; pick = i; }
      });
      if (pick < 0 && players === 2) {
        const pref = it.cx < 0.5 ? 0 : 1;
        pick = [pref, 1 - pref].find((i) => !taken.has(i) && !live(i)) ?? -1;
      }
      if (pick < 0 && players === 1) pick = 0;
      if (pick < 0) continue;
      taken.add(pick);
      const s = slots[pick];
      const old = s.pts;
      s.pts = old && live(pick) ? it.p.map((q, k) => ({ x: old[k].x + (q.x - old[k].x) * 0.6, y: old[k].y + (q.y - old[k].y) * 0.6, z: q.z, v: q.v })) : it.p;
      s.cx = it.cx;
      s.seenAt = now;
    }
  }

  const present = (i: number, now: number) => !!slots[i].pts && now - slots[i].seenAt < 500;
  const pts = (i: number, now: number) => (present(i, now) ? slots[i].pts : null);

  // ---- Walls -------------------------------------------------------------------------------------------------------

  function silhouette(c: CanvasRenderingContext2D, f: Fig, ox: number, oy: number, T: number, pad: number) {
    const P = (j: [number, number]): [number, number] => [ox + j[0] * T, oy + j[1] * T];
    const line = (pts: [number, number][], w: number) => {
      c.lineWidth = w;
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    };
    const ext = (a: [number, number], b: [number, number], k: number): [number, number] => {
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      return [b[0] + (dx / d) * k, b[1] + (dy / d) * k];
    };
    c.lineCap = "round";
    c.lineJoin = "round";
    // Torso
    const torso = [f.lSh, f.rSh, f.rHip, f.lHip].map(P);
    c.beginPath();
    torso.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
    line([...torso, torso[0]], 0.1 * T + pad);
    // Head
    const [hx, hy] = P(f.head);
    c.beginPath();
    c.arc(hx, hy, BODY.headR * T + pad / 2, 0, Math.PI * 2);
    c.fill();
    line([P(f.mSh), P(f.head)], 0.16 * T + pad);
    // Arms and legs
    for (const s of ["l", "r"] as const) {
      const sh = P(f[`${s}Sh` as const]), el = P(f[`${s}El` as const]), wr = P(f[`${s}Wr` as const]);
      line([sh, el, ext(el, wr, BODY.hand * T)], 0.2 * T + pad);
      const hip = P(f[`${s}Hip` as const]), kn = P(f[`${s}Kn` as const]), an = P(f[`${s}An` as const]);
      line([hip, kn, an], 0.26 * T + pad);
    }
  }

  function bounds(f: Fig) {
    const xs = Object.values(f).map((v) => v[0]), ys = Object.values(f).map((v) => v[1]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }

  function makeRound(now: number): Round {
    wave++;
    const maxLevel = wave < 3 ? 1 : wave < 8 ? 2 : 3;
    let pool = POSES.filter((p) => p.level <= maxLevel && p.id !== "attention" && p.id !== lastPoseId);
    if (wave === 1) pool = POSES.filter((p) => p.id === "t");
    let pose = pool[Math.floor(Math.random() * pool.length)];
    lastPoseId = pose.id;
    if (!pose.symmetric && Math.random() < 0.5) pose = flipped(pose);
    const fig = build(pose);
    const T = unit();
    const b = bounds(fig);
    const origin = lanes.map((_, i) => [laneX(i) - b.cx * T, H / 2 - b.cy * T] as [number, number]);

    const wall = document.createElement("canvas");
    wall.width = W;
    wall.height = H;
    const c = wall.getContext("2d")!;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#d9d3c8");
    g.addColorStop(1, "#bdb5a8");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(0,0,0,.14)";
    c.lineWidth = 2;
    const bh = H / 9;
    for (let r = 0; r <= 9; r++) {
      c.beginPath(); c.moveTo(0, r * bh); c.lineTo(W, r * bh); c.stroke();
      for (let x = (r % 2) * bh * 0.9; x < W; x += bh * 1.8) { c.beginPath(); c.moveTo(x, r * bh); c.lineTo(x, (r + 1) * bh); c.stroke(); }
    }
    c.strokeStyle = "rgba(232,162,90,.9)";
    c.lineWidth = 6;
    c.strokeRect(3, 3, W - 6, H - 6);
    lanes.forEach((ln, i) => {
      if (ln.lives <= 0) return;
      // Glowing rim, then cut the hole itself.
      c.fillStyle = c.strokeStyle = COLORS[i];
      silhouette(c, fig, origin[i][0], origin[i][1], T, 0.1 * T + 14);
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = c.strokeStyle = "#000";
      silhouette(c, fig, origin[i][0], origin[i][1], T, 0.1 * T);
      c.globalCompositeOperation = "source-over";
    });
    lanes.forEach((l) => { l.hold = 0; l.ok = false; l.best = 0; l.verdict = null; });
    drawGuide(pose);
    const dur = Math.max(3.4, 6.2 - wave * 0.22) * 1000;
    return { pose, fig, wall, origin, start: now, dur, resolved: false, resolvedAt: 0 };
  }

  /** The side panel: the pose to strike, drawn big and plain. */
  function drawGuide(pose: PoseDef | null) {
    const g = guide.getContext("2d")!;
    g.clearRect(0, 0, guide.width, guide.height);
    guideName.textContent = pose ? pose.name : "Waiting for the first wall";
    if (!pose) return;
    const f = build(pose);
    const xs = Object.values(f).map((v) => v[0]), ys = Object.values(f).map((v) => v[1]);
    const minX = Math.min(...xs) - 0.3, maxX = Math.max(...xs) + 0.3, minY = Math.min(...ys) - 0.3, maxY = Math.max(...ys) + 0.3;
    const T = Math.min(guide.width / (maxX - minX), guide.height / (maxY - minY));
    const ox = guide.width / 2 - ((minX + maxX) / 2) * T, oy = guide.height / 2 - ((minY + maxY) / 2) * T;
    g.fillStyle = g.strokeStyle = "#e8a25a";
    silhouette(g, f, ox, oy, T, 0.05 * T);
    // The bones on top, so the limb angles read clearly.
    g.strokeStyle = "#1a1620";
    g.lineWidth = Math.max(2, T * 0.035);
    g.lineCap = "round";
    const P = (j: [number, number]): [number, number] => [ox + j[0] * T, oy + j[1] * T];
    g.beginPath();
    for (const [a, b] of [["lSh", "lEl"], ["lEl", "lWr"], ["rSh", "rEl"], ["rEl", "rWr"], ["lHip", "lKn"], ["lKn", "lAn"], ["rHip", "rKn"], ["rKn", "rAn"], ["mHip", "mSh"], ["lSh", "rSh"], ["lHip", "rHip"]] as [keyof Fig, keyof Fig][]) {
      const [x1, y1] = P(f[a]), [x2, y2] = P(f[b]);
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    }
    g.stroke();
  }

  // ---- Game flow ---------------------------------------------------------------------------------------------------

  function hud() {
    root.querySelectorAll<HTMLElement>("[data-hud]").forEach((el) => {
      const i = Number(el.dataset.hud);
      el.hidden = i >= players;
      const l = lanes[i];
      if (!l) return;
      el.querySelector("[data-score]")!.textContent = String(l.score);
      el.querySelector("[data-lives]")!.textContent = "♥".repeat(l.lives) + "♡".repeat(LIVES - l.lives);
    });
    $("[data-wave]").textContent = wave ? `Wall ${wave}` : "";
    $("[data-pose]").textContent = round && phase === "play" ? round.pose.name : "";
  }

  function begin() {
    lanes = Array.from({ length: players }, newLane);
    wave = 0;
    round = null;
    lastPoseId = "";
    readySince = 0;
    phase = "find";
    phaseAt = performance.now();
    over.hidden = true;
    root.classList.add("live");
    drawGuide(null);
    hud();
  }

  function finish(now: number) {
    phase = "over";
    phaseAt = now;
    round = null;
    const top = Math.max(...lanes.map((l) => l.score));
    const prev = best();
    saveBest(top);
    const rows = lanes.map((l, i) => `<li style="--c:${COLORS[i]}"><i></i>${players === 2 ? `Player ${i + 1}` : "You"}<b>${l.score}</b></li>`).join("");
    let headline = `You cleared ${wave - 1} wall${wave - 1 === 1 ? "" : "s"}`;
    if (players === 2 && lanes[0].score !== lanes[1].score) headline = `Player ${lanes[0].score > lanes[1].score ? 1 : 2} wins`;
    else if (players === 2) headline = "A tie";
    over.innerHTML = `<h2>${headline}</h2><ul>${rows}</ul><p>${top > prev && prev > 0 ? "New best score!" : `Best: ${Math.max(prev, top)}`}</p><button type="button" class="btn btn-primary" data-again>Play again</button>`;
    over.hidden = false;
    over.querySelector("[data-again]")!.addEventListener("click", begin);
  }

  let lastStepAt = 0;
  function step(now: number) {
    const dt = Math.min(250, lastStepAt ? now - lastStepAt : 16);
    lastStepAt = now;
    // Waiting for everyone to be fully in view.
    if (phase === "find") {
      const ready = lanes.every((_, i) => { const p = pts(i, now); return p && fullBody(p) && torsoLen(p) > H * 0.08; });
      if (ready) {
        readySince ||= now;
        if (now - readySince > 1000) { phase = "count"; phaseAt = now; }
      } else readySince = 0;
    } else if (phase === "count") {
      if (now - phaseAt > 3000) {
        phase = "play";
        round = makeRound(now);
        hud();
      }
    } else if (phase === "play" && round) {
      const t = (now - round.start) / round.dur;
      const inWindow = t >= 1 - 1000 / round.dur && t < 1; // the last second
      if (!round.resolved) {
        lanes.forEach((ln, i) => {
          if (ln.lives <= 0) return;
          ln.last = match(pts(i, now), round!.pose);
          if (inWindow) {
            ln.best = Math.max(ln.best, ln.last.score);
            if (ln.last.pass) ln.hold += dt;
            else ln.hold = 0;
            if (ln.hold >= HOLD_MS) ln.ok = true;
          }
        });
        if (t >= 1) {
          round.resolved = true;
          round.resolvedAt = now;
          lanes.forEach((ln) => {
            if (ln.lives <= 0) return;
            if (ln.ok) {
              const gain = 100 + Math.round(50 * ln.best);
              ln.score += gain;
              ln.verdict = { text: `Through! +${gain}`, good: true };
            } else {
              ln.lives--;
              ln.verdict = { text: ln.lives ? "Smashed!" : "Out!", good: false };
            }
          });
          hud();
        }
      } else if (now - round.resolvedAt > 1400) {
        if (lanes.every((l) => l.lives <= 0)) finish(now);
        else round = makeRound(now);
        hud();
      }
    }
  }

  // ---- Drawing -----------------------------------------------------------------------------------------------------

  function text(msg: string, x: number, y: number, size: number, color = "#fff", align: CanvasTextAlign = "center") {
    ctx.font = `700 ${size}px "Avenir Next", Avenir, "Raleway Variable", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.lineWidth = size / 7;
    ctx.strokeStyle = "rgba(0,0,0,.65)";
    ctx.strokeText(msg, x, y);
    ctx.fillStyle = color;
    ctx.fillText(msg, x, y);
  }

  /** The player's own skeleton, shrunk or grown to the cutout's size and placed on its hips, coloured by how well each limb matches. */
  function ghost(i: number, origin: [number, number], m: Match | null, now: number) {
    const p = pts(i, now);
    if (!p) return;
    const T = unit();
    const k = T / Math.max(torsoLen(p), 1);
    const hip = hipMid(p);
    const map = (q: { x: number; y: number }): [number, number] => [origin[0] + (q.x - hip.x) * k, origin[1] + (q.y - hip.y) * k];
    const col = (s: Seg) => (!m ? COLORS[i] : !m.seen && m.seg[s] === 0 ? BAD : m.seg[s] >= 1 ? GOOD : m.seg[s] > 0.4 ? OK : BAD);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(5, T * 0.09);
    const seg = (s: Seg, a: { x: number; y: number }, b: { x: number; y: number }) => {
      ctx.strokeStyle = col(s);
      ctx.beginPath();
      const [x1, y1] = map(a), [x2, y2] = map(b);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    for (const s of SEGS) {
      if (s === "torso") continue;
      const [a, b] = SEG_JOINTS[s];
      if (p[a].v > 0.3 && p[b].v > 0.3) seg(s, p[a], p[b]);
    }
    seg("torso", hipMid(p), shMid(p));
    ctx.strokeStyle = col("torso");
    ctx.beginPath(); // shoulder and hip bars
    for (const [a, b] of [[L.lShoulder, L.rShoulder], [L.lHip, L.rHip]]) { const [x1, y1] = map(p[a]), [x2, y2] = map(p[b]); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    // Head
    const [hx, hy] = map(p[L.nose]);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(3, T * 0.04);
    ctx.beginPath();
    ctx.arc(hx, hy, BODY.headR * T * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const j of [L.lShoulder, L.rShoulder, L.lElbow, L.rElbow, L.lWrist, L.rWrist, L.lHip, L.rHip, L.lKnee, L.rKnee, L.lAnkle, L.rAnkle]) {
      if (p[j].v < 0.3) continue;
      const [x, y] = map(p[j]);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(4, T * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(now: number) {
    ctx.clearRect(0, 0, W, H);
    const T = unit();
    if (phase === "find" || phase === "count") {
      lanes.forEach((_, i) => {
        const o: [number, number] = [laneX(i), H * 0.52];
        ghost(i, o, null, now);
        if (!present(i, now)) text(players === 2 ? `Player ${i + 1}: step in` : "Step into view", laneX(i), H / 2, T * 0.32, "#fff");
        else if (phase === "find" && !fullBody(slots[i].pts!)) text("Step back: show your whole body", laneX(i), H * 0.92, T * 0.2, OK);
      });
      if (phase === "count") {
        const left = 3 - Math.floor((now - phaseAt) / 1000);
        text(String(Math.max(left, 1)), W / 2, H * 0.2, T * 0.7, COLORS[0]);
        text("Fit the hole in the wall", W / 2, H * 0.3, T * 0.2);
      }
    } else if ((phase === "play" || phase === "over") && round) {
      const t = (now - round.start) / round.dur;
      if (t < 1) {
        const s = 1 / (1 + 1.5 * (1 - t)); // grows from 40% to full size
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(s, s);
        ctx.translate(-W / 2, -H / 2);
        ctx.drawImage(round.wall, 0, 0);
        ctx.restore();
      } else {
        const u = Math.min(1, (now - round.resolvedAt) / 700);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(1 + u * 0.9, 1 + u * 0.9);
        ctx.translate(-W / 2, -H / 2);
        ctx.globalAlpha = 1 - u;
        ctx.drawImage(round.wall, 0, 0);
        ctx.restore();
      }
      lanes.forEach((ln, i) => {
        if (ln.lives <= 0 && !ln.verdict) return;
        ghost(i, round!.origin[i], ln.lives > 0 ? ln.last : null, now);
        if (ln.last && !round!.resolved && ln.lives > 0) text(`${Math.round(ln.last.score * 100)}%`, laneX(i), H - T * 0.2, T * 0.26, ln.last.pass ? GOOD : "#fff");
        if (ln.verdict && now - round!.resolvedAt < 1400) text(ln.verdict.text, laneX(i), H * 0.2, T * 0.42, ln.verdict.good ? GOOD : BAD);
        else if (ln.lives <= 0 && players === 2) text("Out", laneX(i), H / 2, T * 0.4, "#aaa");
      });
    }
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (phase !== "idle") {
      step(now);
      draw(now);
    }
  }

  // ---- Buttons -----------------------------------------------------------------------------------------------------

  async function start() {
    startBtn.disabled = true;
    try {
      tracker = await startTracker(video, onFrame, setStatus);
      // Some browsers report the size a moment late; wait briefly, then fall back to 4:3.
      for (let i = 0; i < 20 && video.videoWidth < 64; i++) await new Promise((r) => setTimeout(r, 100));
      const ok = video.videoWidth >= 64 && video.videoHeight >= 64;
      W = canvas.width = ok ? video.videoWidth : 960;
      H = canvas.height = ok ? video.videoHeight : 720;
      stage.style.setProperty("--ar", `${W} / ${H}`);
      stage.style.setProperty("--arn", String(W / H));
      stopBtn.disabled = false;
      begin();
      cancelAnimationFrame(raf);
      loop();
    } catch (err: any) {
      setStatus(err?.message ?? String(err), true);
      tracker?.stop();
      tracker = null;
      startBtn.disabled = false;
    }
  }

  function stop() {
    tracker?.stop();
    tracker = null;
    cancelAnimationFrame(raf);
    phase = "idle";
    round = null;
    ctx.clearRect(0, 0, W, H);
    slots.forEach((s) => (s.pts = null));
    root.classList.remove("live");
    drawGuide(null);
    over.hidden = true;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Stopped. Press Start to play again.");
  }

  modeBtns.forEach((b) =>
    b.addEventListener("click", () => {
      players = Number(b.dataset.mode);
      modeBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }),
  );
  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stop);
  document.addEventListener("visibilitychange", () => document.hidden && tracker && stop());
  $("[data-best]").textContent = String(best());
  if (new URLSearchParams(location.search).has("debug")) (window as any).__wall = { match, POSES, build, slots, feed: onFrame, get round() { return round; }, get phase() { return phase; }, get lanes() { return lanes; } };
}
