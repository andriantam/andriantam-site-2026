// Photography simulator: walk the set, pick a lens, set exposure and take the shot.
import * as THREE from "three";
import { buildWorld, type Ladder, type World } from "./world";
import * as ladderPhysics from "./ladders";
import { Darkroom, histogram, type Pose } from "./photo";
import {
  LENSES, APERTURES, SHUTTERS, ISOS, FLASH_SYNC, FLASH_GN, FLASH_POWERS, LIGHT, TIMES, timePreset,
  frameFov, exposureScale, ev100, shutterLabel, apertureLabel, isoLabel, powerLabel, nearestIndex, type TimeOfDay,
} from "./data";
import { type Box2, angleDiff, boxesOverlap, clamp, corners, distToBox, inBox, pushOut, toLocal } from "./geom";
import { Gallery, type ShotMeta } from "./gallery";
import { Sound } from "./sound";

type Stance = "stand" | "crouch" | "prone";
const EYE: Record<Stance, number> = { stand: 1.62, crouch: 1.02, prone: 0.3 };
const SPEED: Record<Stance, number> = { stand: 1.5, crouch: 0.75, prone: 0.3 };
const RADIUS = 0.28;
const DRIVE_VFOV = 55;

export async function mountSim(root: HTMLElement, galleryRoot: HTMLElement) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const stage = $("[data-stage]");
  const canvas = $<HTMLCanvasElement>("[data-canvas]");
  const overlay = $("[data-overlay]");
  const status = $("[data-status]");
  const mobile = matchMedia("(pointer: coarse)").matches;
  root.classList.toggle("is-touch", mobile);

  // ---------- Renderer ----------
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    status.textContent = "Your browser can't run WebGL, so the simulator can't start.";
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const gallery = new Gallery(galleryRoot);
  const sound = new Sound();
  const galleryReady = gallery.init();
  let time: TimeOfDay = "evening";
  LIGHT.ev = timePreset(time).ev;
  LIGHT.time = time;
  const world: World = await buildWorld(renderer, { mobile, time: timePreset(time), onProgress: (s) => (status.textContent = `${s}…`) });
  const { scene, car } = world;
  const camera = new THREE.PerspectiveCamera(40, 3 / 2, 0.05, 2000);
  const flashLight = new THREE.PointLight(0xfff4e8, 0, 0, 2);
  flashLight.visible = false;
  scene.add(flashLight);
  // One darkroom per frame orientation, made when first needed.
  const LONG = mobile ? 1200 : 1800, SHORT = mobile ? 800 : 1200;
  const darkrooms: { landscape?: Darkroom; portrait?: Darkroom } = {};
  const darkroomFor = (portrait: boolean) =>
    portrait ? (darkrooms.portrait ??= new Darkroom(renderer, SHORT, LONG)) : (darkrooms.landscape ??= new Darkroom(renderer, LONG, SHORT));
  const developing = () => !!(darkrooms.landscape?.busy || darkrooms.portrait?.busy);

  // The canvas fills the frame element, which keeps the photo's aspect ratio inside the stage.
  const frameEl = $("[data-frame]");
  const resize = () => {
    const w = frameEl.clientWidth, h = frameEl.clientHeight;
    if (w && h) renderer.setSize(w, h, false);
  };
  new ResizeObserver(resize).observe(frameEl);
  resize();

  // ---------- Camera settings ----------
  const cam = {
    lens: 2, // 35mm
    ap: nearestIndex(APERTURES, 5.6),
    sh: nearestIndex(SHUTTERS, 1 / 60),
    iso: 0,
    flash: false,
    power: 0,
    portrait: false,
    roll: 0, // radians, camera tilted about the lens axis
    focusDist: 5,
    afLocked: false,
    afOk: true,
  };
  const lens = () => LENSES[cam.lens];
  const aperture = () => APERTURES[cam.ap];
  const shutter = () => SHUTTERS[cam.sh];
  const iso = () => ISOS[cam.iso];

  const clampAperture = () => {
    const L = lens();
    cam.ap = Math.min(Math.max(cam.ap, nearestIndex(APERTURES, L.maxAperture)), nearestIndex(APERTURES, L.minAperture));
  };
  const clampShutter = () => {
    if (cam.flash) cam.sh = Math.min(cam.sh, nearestIndex(SHUTTERS, FLASH_SYNC)); // can't be faster than sync
  };

  // ---------- Light calibration ----------
  // Meter a reference view of the front-lit car and scale the scene so it meters at the current EV.
  const meterRT = new THREE.WebGLRenderTarget(48, 32, { type: THREE.HalfFloatType });
  const meterBuf = new Uint16Array(48 * 32 * 4);
  const meter = (c: THREE.Camera) => {
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(meterRT);
    renderer.render(scene, c);
    renderer.setRenderTarget(null);
    renderer.toneMapping = prevTone;
    renderer.readRenderTargetPixels(meterRT, 0, 0, 48, 32, meterBuf);
    let sum = 0, wsum = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 48; x++) {
        const i = (y * 48 + x) * 4;
        const l = 0.2126 * THREE.DataUtils.fromHalfFloat(meterBuf[i]) + 0.7152 * THREE.DataUtils.fromHalfFloat(meterBuf[i + 1]) + 0.0722 * THREE.DataUtils.fromHalfFloat(meterBuf[i + 2]);
        const dx = (x - 23.5) / 24, dy = (y - 15.5) / 16;
        const w = Math.exp(-(dx * dx + dy * dy) * 2.2); // centre-weighted
        sum += Math.log(Math.max(l, 1e-4)) * w;
        wsum += w;
      }
    }
    return Math.exp(sum / wsum);
  };
  // Practical lights (street light, car lamps) are in real units, so they're off while metering.
  function calibrateScene() {
    world.calibrate(1);
    world.applyPractical(0);
    const ref = new THREE.PerspectiveCamera(40, 3 / 2, 0.05, 2000);
    const sunFlat = world.sun.position.clone().setY(0).normalize();
    ref.position.set(world.carBox.cx + sunFlat.x * 7, 1.5, world.carBox.cz + sunFlat.z * 7);
    ref.lookAt(world.carBox.cx, 0.7, world.carBox.cz);
    const lum = meter(ref);
    world.calibrate(0.18 / Math.max(lum, 1e-6));
    world.applyPractical(1);
  }
  calibrateScene();

  const aspect = () => (cam.portrait ? 2 / 3 : 3 / 2);

  // ---------- Player ----------
  const player = {
    x: 4.5,
    z: 4.8,
    feet: 0,
    vy: 0,
    yaw: 0,
    pitch: -0.05,
    stance: "stand" as Stance,
    eye: EYE.stand,
    onLadder: null as Ladder | null,
    carrying: null as Ladder | null,
  };
  // face the car
  player.yaw = Math.atan2(-(world.carBox.cx - player.x), -(world.carBox.cz - player.z));

  const keys = new Set<string>();
  let handbrakeTouch = false;
  let lookDX = 0, lookDY = 0;
  const joy = { x: 0, y: 0 };

  // ---------- Collision helpers ----------
  function pushOutOfBox(b: Box2, r: number) {
    [player.x, player.z] = pushOut(b, player.x, player.z, r);
  }
  const ladderPlatform = (l: Ladder): Box2 => ({ ...l.box, hx: 0.3, hz: 0.24 });
  // Standing ladders you could climb, or any ladder (standing or knocked over) within reach.
  const nearestLadder = (maxDist: number, anyState = false) => {
    let best: Ladder | null = null, bd = maxDist;
    for (const l of world.ladders) {
      if (l.carried || (l.fallen && !anyState)) continue;
      const d = l.fallen ? distToBox(ladderPhysics.footprint(l), player.x, player.z) + 0.3 : Math.hypot(l.box.cx - player.x, l.box.cz - player.z);
      if (d < bd) (bd = d), (best = l);
    }
    return best;
  };
  function groundAt(x: number, z: number, feet: number) {
    let g = 0;
    for (const l of world.ladders) {
      if (l.carried || l.fallen) continue;
      if (inBox(ladderPlatform(l), x, z, 0.05) && feet >= l.top - 0.35) g = Math.max(g, l.top);
    }
    return g;
  }
  function syncLadderBox(l: Ladder) {
    l.box.cx = l.group.position.x;
    l.box.cz = l.group.position.z;
    l.box.rot = l.group.rotation.y;
  }

  // ---------- Actions ----------
  const prompt = $("[data-prompt]");
  const setStance = (s: Stance) => {
    if (driving || (player.onLadder && s === "prone")) return;
    player.stance = player.stance === s ? "stand" : s;
  };
  const jump = () => {
    if (driving) return;
    if (player.onLadder) return stepOff();
    if (player.stance !== "stand") return (player.stance = "stand");
    if (player.feet <= groundAt(player.x, player.z, player.feet) + 0.01 && !player.carrying) (player.vy = 4.1), sound.footstep();
  };
  const climb = () => {
    if (driving) return;
    if (player.onLadder) return stepOff();
    if (player.carrying) return;
    const l = nearestLadder(1.3);
    if (!l) return;
    player.onLadder = l;
    player.x = l.box.cx;
    player.z = l.box.cz;
    player.feet = l.top;
    player.vy = 0;
    if (player.stance === "prone") player.stance = "crouch";
    sound.ladder();
  };
  function stepOff() {
    const l = player.onLadder!;
    player.onLadder = null;
    const fx = Math.sin(l.box.rot), fz = Math.cos(l.box.rot);
    player.x = l.box.cx + fx * (l.box.hz + 0.45);
    player.z = l.box.cz + fz * (l.box.hz + 0.45);
    player.feet = 0;
    sound.land(1);
  }
  const carry = () => {
    if (driving || player.onLadder) return;
    if (player.carrying) {
      const l = player.carrying;
      l.carried = false;
      l.group.position.y = 0;
      syncLadderBox(l);
      // keep it off the car and inside the set
      for (let i = 0; i < 20 && boxesOverlap(l.box, world.carBox); i++) {
        const dx = l.box.cx - world.carBox.cx, dz = l.box.cz - world.carBox.cz, d = Math.hypot(dx, dz) || 1;
        l.group.position.x += (dx / d) * 0.15;
        l.group.position.z += (dz / d) * 0.15;
        syncLadderBox(l);
      }
      l.group.position.x = clamp(l.group.position.x, world.bounds.minX + 0.6, world.bounds.maxX - 0.6);
      l.group.position.z = clamp(l.group.position.z, world.bounds.minZ + 0.6, world.bounds.maxZ - 0.6);
      syncLadderBox(l);
      player.carrying = null;
      sound.ladder(true);
      return;
    }
    const l = nearestLadder(1.4, true);
    if (!l) return;
    ladderPhysics.upright(l);
    l.carried = true;
    player.carrying = l;
    if (player.stance === "prone") player.stance = "stand";
    sound.ladder();
  };

  // ---------- Driving ----------
  // Get in to reposition the car. Third-person view; mouse or finger orbits the camera.
  let driving = false;
  let lastLookInput = 0;
  const nearCar = () => !player.onLadder && !player.carrying && distToBox(world.carBox, player.x, player.z) < 1.1;
  function carBlocked(b: Box2) {
    const B = world.carBounds;
    for (const [x, z] of corners(b)) if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) return true;
    for (const o of world.obstacles) if (boxesOverlap(b, o)) return true;
    return false;
  }
  function enterCar() {
    if (driving || !nearCar() || exposing || developing()) return;
    driving = true;
    root.classList.add("is-driving");
    player.stance = "stand";
    // Look along the car.
    const [fx, fz] = car.forward();
    player.yaw = Math.atan2(-fx, -fz);
    player.pitch = -0.22;
    sound.door();
    sound.engine(true);
  }
  function exitCar() {
    if (!driving) return;
    if (Math.abs(car.v) > 0.6) return; // stop first
    car.v = 0;
    // Step out of the driver's door (right-hand drive), else whichever side is clear.
    const b = world.carBox;
    const fs = car.parts.frontSign;
    const spots: [number, number][] = [
      [0.25 * fs, (b.hz + 0.45) * fs], [0.25 * fs, -(b.hz + 0.45) * fs], [-(b.hx + 0.5) * fs, 0], [(b.hx + 0.5) * fs, 0],
    ];
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    for (const [lx, lz] of spots) {
      const x = b.cx + lx * c + lz * s, z = b.cz - lx * s + lz * c;
      const B = world.bounds;
      if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) continue;
      if (world.ladders.some((l) => !l.carried && inBox(l.box, x, z, RADIUS)) || world.obstacles.some((o) => inBox(o, x, z, RADIUS))) continue;
      player.x = x;
      player.z = z;
      player.feet = 0;
      player.vy = 0;
      driving = false;
      root.classList.remove("is-driving");
      player.pitch = -0.05;
      sound.engine(false);
      sound.door();
      return;
    }
  }
  const toggleCar = () => (driving ? exitCar() : enterCar());
  function carHitsLadders() {
    const [fx, fz] = car.forward();
    const vx = fx * car.v, vz = fz * car.v;
    for (const l of world.ladders) {
      if (l.carried || !boxesOverlap(world.carBox, ladderPhysics.footprint(l))) continue;
      if (ladderPhysics.hit(l, world.carBox, vx, vz)) {
        clunk();
        if (player.onLadder === l) player.onLadder = null; // whoever was on it comes down with it
      }
    }
  }
  function toggleLights() {
    car.setLights(!car.lightsOn);
    sound.relay();
    render.ui();
  }

  // ---------- Input: desktop ----------
  // Drag on the view to look around; a click without a drag takes the photo. Right button holds focus.
  let drag: { id: number; x: number; y: number; t: number; moved: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (!started || e.pointerType === "touch") return;
    canvas.focus({ preventScroll: true });
    if (e.button === 2) return void ((cam.afLocked = true), sound.focusBeep());
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    canvas.setPointerCapture(e.pointerId);
    root.classList.add("is-dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    // Scale by the lens: a long lens turns slower, like a real camera.
    const k = 1.6 * Math.min(1, 35 / lens().focal + 0.25);
    lookDX += dx * k;
    lookDY += dy * k;
    lastLookInput = performance.now();
  });
  const endDrag = (e: PointerEvent) => {
    if (e.button === 2) cam.afLocked = false;
    if (!drag || e.pointerId !== drag.id) return;
    const click = drag.moved < 6 && performance.now() - drag.t < 450;
    drag = null;
    root.classList.remove("is-dragging");
    if (click && !driving) shoot();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!started) return;
      e.preventDefault();
      const d = e.deltaY > 0 ? 1 : -1;
      if (e.shiftKey) step("aperture", d);
      else if (e.altKey) step("iso", d);
      else step("shutter", d);
    },
    { passive: false },
  );
  addEventListener("keydown", (e) => {
    if (!started || !(full || root.contains(document.activeElement))) return;
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    keys.add(e.code);
    const k = e.code;
    if (/^Digit[1-7]$/.test(k)) setLens(Number(k.slice(5)) - 1);
    else if (k === "Space") (e.preventDefault(), jump());
    else if (k === "KeyC") setStance("crouch");
    else if (k === "KeyZ") setStance("prone");
    else if (k === "KeyE") interact();
    else if (k === "KeyH") toggleLights();
    else if (k === "KeyT") setTime(TIMES[(TIMES.findIndex((t) => t.id === time) + 1) % TIMES.length].id);
    else if (k === "KeyR") carry();
    else if (k === "KeyV") toggleOrientation();
    else if (k === "KeyQ") tilt(-1);
    else if (k === "KeyX") tilt(1);
    else if (k === "KeyL") level();
    else if (k === "KeyB") balance();
    else if (k === "Escape" && !preview.hidden) closePreview();
    else if (k === "Escape" && full && !document.fullscreenElement) exitFull();
    else if (k === "KeyF") toggleFlash();
    else if (k === "KeyM" && sound.supported) toggleSound();
    else if (k === "BracketLeft") step("aperture", -1);
    else if (k === "BracketRight") step("aperture", 1);
    else if (k === "Comma") step("shutter", -1);
    else if (k === "Period") step("shutter", 1);
    else if (k === "Minus") step("iso", -1);
    else if (k === "Equal") step("iso", 1);
    else if (k === "Enter") shoot();
  });
  // E: climb a ladder or get in the car, whichever is closer.
  function interact() {
    if (driving) return exitCar();
    if (player.onLadder) return stepOff();
    const l = !player.carrying ? nearestLadder(1.3) : null;
    const dl = l ? Math.hypot(l.box.cx - player.x, l.box.cz - player.z) : Infinity;
    const dc = nearCar() ? distToBox(world.carBox, player.x, player.z) + 0.4 : Infinity;
    if (dl < dc) climb();
    else if (dc < Infinity) enterCar();
  }
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  // ---------- Input: touch ----------
  // Left thumb on the joystick walks (or drives); one finger anywhere else looks; two fingers twist to tilt the camera.
  // A quick tap on the view takes the photo.
  setupTouch();
  function setupTouch() {
    const pad = $("[data-joy]");
    const knob = $("[data-knob]");
    let joyId: number | null = null;
    const looks = new Map<number, { x: number; y: number; t: number; moved: number }>();
    let twist: number | null = null;
    const padRect = () => pad.getBoundingClientRect();
    const ignore = (t: Touch) => !started || !!(t.target as HTMLElement).closest("button, a, input, [data-overlay], [data-panel], [data-chip], [data-preview]");
    const twistAngle = () => {
      const [a, b] = [...looks.values()];
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    stage.addEventListener("touchstart", (e) => {
      let handled = false;
      for (const t of e.changedTouches) {
        if (ignore(t)) continue;
        handled = true;
        const r = padRect();
        if (joyId === null && t.clientX < r.right + 40 && t.clientY > r.top - 40) {
          joyId = t.identifier;
          moveJoy(t);
        } else if (looks.size < 2) {
          looks.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 });
          if (looks.size === 2) twist = twistAngle();
        }
      }
      if (handled) e.preventDefault();
    }, { passive: false });
    stage.addEventListener("touchmove", (e) => {
      let handled = false;
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) (moveJoy(t), (handled = true));
        const l = looks.get(t.identifier);
        if (!l) continue;
        handled = true;
        const dx = t.clientX - l.x, dy = t.clientY - l.y;
        l.moved += Math.abs(dx) + Math.abs(dy);
        l.x = t.clientX;
        l.y = t.clientY;
        if (looks.size === 1) {
          const k = 1.7 * Math.min(1, 35 / lens().focal + 0.25);
          lookDX += dx * k;
          lookDY += dy * k;
          lastLookInput = performance.now();
        }
      }
      if (looks.size === 2 && twist !== null) {
        const a = twistAngle();
        let d = a - twist;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        cam.roll = clamp(cam.roll + d, -Math.PI / 2, Math.PI / 2);
        twist = a;
        render.ui();
      }
      if (handled) e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) (joyId = null), (joy.x = joy.y = 0), (knob.style.transform = "");
        const l = looks.get(t.identifier);
        if (l) {
          // Tapping the view doesn't shoot (too easy to do by accident): the Take photo button does.
          looks.delete(t.identifier);
          if (looks.size < 2) twist = looks.size ? twist : null;
          if (looks.size === 0) twist = null;
        }
      }
    };
    stage.addEventListener("touchend", end);
    stage.addEventListener("touchcancel", end);
    function moveJoy(t: Touch) {
      const r = padRect();
      let x = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(x, y);
      if (m > 1) (x /= m), (y /= m);
      joy.x = x;
      joy.y = y;
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
    }
    const act: Record<string, () => void> = {
      shutter: () => !driving && shoot(),
      drive: toggleCar,
      lights: toggleLights,
      brake: () => (handbrakeTouch = true),
      jump,
      crouch: () => setStance("crouch"),
      prone: () => setStance("prone"),
      ladder: climb,
      carry,
      af: () => ((cam.afLocked = !cam.afLocked) && sound.focusBeep()),
    };
    $$("[data-touch-btn]").forEach((b) => {
      b.addEventListener("touchstart", (e) => {
        e.preventDefault();
        e.stopPropagation();
        act[b.dataset.touchBtn!]?.();
      }, { passive: false });
      // Mouse users in a narrow window still get working buttons.
      b.addEventListener("click", () => act[b.dataset.touchBtn!]?.());
    });
    $$("[data-touch-btn=brake]").forEach((b) => b.addEventListener("touchend", () => (handbrakeTouch = false)));
  }

  // ---------- Controls panel ----------
  function setLens(i: number) {
    if (cam.lens !== i) sound.tick();
    cam.lens = i;
    clampAperture();
    render.ui();
  }
  function step(what: "aperture" | "shutter" | "iso" | "power", d: number) {
    if (what === "aperture") (cam.ap = cam.ap + d), clampAperture();
    if (what === "shutter") (cam.sh = clamp(cam.sh + d, 0, SHUTTERS.length - 1)), clampShutter();
    if (what === "iso") cam.iso = clamp(cam.iso + d, 0, ISOS.length - 1);
    if (what === "power") cam.power = clamp(cam.power + d, 0, FLASH_POWERS.length - 1);
    sound.tick();
    render.ui();
  }
  function toggleFlash() {
    cam.flash = !cam.flash;
    sound.tick();
    clampShutter();
    render.ui();
  }
  // On a phone the frame follows how you hold it, until you pick one yourself.
  let manualOrientation = false;
  const upright = matchMedia("(orientation: portrait)");
  const followPhone = () => {
    if (mobile && !manualOrientation && cam.portrait !== upright.matches) toggleOrientation(false);
  };
  upright.addEventListener("change", followPhone);
  function toggleOrientation(byUser = true) {
    if (byUser) manualOrientation = true;
    cam.portrait = !cam.portrait;
    root.classList.toggle("is-portrait", cam.portrait);
    root.style.setProperty("--ar", cam.portrait ? "2 / 3" : "3 / 2");
    if (byUser) sound.tick();
    render.ui();
  }
  const TILT_STEP = (2 * Math.PI) / 180;
  function tilt(d: number) {
    cam.roll = clamp(cam.roll + d * TILT_STEP, -Math.PI / 2, Math.PI / 2);
    sound.tick();
    render.ui();
  }
  function level() {
    cam.roll = 0;
    render.ui();
  }
  // Balanced exposure: like program mode with auto ISO. Keeps the aperture you chose, picks a shutter speed you can
  // hand-hold where possible (raising ISO first), and stops down only when it's too bright even at base ISO.
  function balance() {
    const target = ev100(aperture(), shutter(), iso()) + meterEV; // the EV the scene needs
    const handheld = 1 / Math.max(60, lens().focal);
    const tFor = (N: number, isoV: number) => (N * N) / Math.pow(2, target + Math.log2(isoV / 100));
    let isoI = 0;
    let t = tFor(aperture(), ISOS[isoI]);
    while (t > handheld && isoI < nearestIndex(ISOS, 6400)) t = tFor(aperture(), ISOS[++isoI]);
    const fastest = cam.flash ? FLASH_SYNC : SHUTTERS[SHUTTERS.length - 1];
    let apI = cam.ap;
    while (t < fastest && apI < nearestIndex(APERTURES, lens().minAperture)) t = tFor(APERTURES[++apI], ISOS[isoI]);
    cam.iso = isoI;
    cam.ap = apI;
    cam.sh = nearestIndex(SHUTTERS, clamp(t, fastest, SHUTTERS[0]));
    clampShutter();
    lastMeter = 0;
    render.ui();
  }
  $$<HTMLButtonElement>("[data-lens]").forEach((b) => b.addEventListener("click", () => setLens(Number(b.dataset.lens))));
  $$<HTMLButtonElement>("[data-step]").forEach((b) =>
    b.addEventListener("click", () => step(b.dataset.step as "aperture", Number(b.dataset.dir))),
  );
  $("[data-flash]").addEventListener("click", toggleFlash);
  $("[data-lights]").addEventListener("click", toggleLights);
  $("[data-orient]").addEventListener("click", () => toggleOrientation());
  $("[data-balance]").addEventListener("click", balance);
  $$<HTMLButtonElement>("[data-tilt]").forEach((b) => b.addEventListener("click", () => (b.dataset.tilt === "0" ? level() : tilt(Number(b.dataset.tilt)))));
  $$<HTMLButtonElement>("[data-time]").forEach((b) => b.addEventListener("click", () => setTime(b.dataset.time as TimeOfDay)));

  // ---------- Scene time ----------
  let changingTime = false;
  let pendingBalance = false;
  async function setTime(t: TimeOfDay) {
    if (t === time || changingTime || exposing || developing()) return;
    changingTime = true;
    root.classList.add("is-changing");
    $$("[data-time]").forEach((b) => b.setAttribute("aria-busy", String(b.dataset.time === t)));
    try {
      const p = timePreset(t);
      await world.setTime(p);
      time = t;
      LIGHT.ev = p.ev;
      LIGHT.time = t;
      sound.setTime(t);
      calibrateScene();
      pendingBalance = true; // once the meter has read the new light
      lastMeter = 0;
    } catch (err) {
      console.error(err);
      status.textContent = "That sky couldn't load. Check your connection.";
    } finally {
      changingTime = false;
      root.classList.remove("is-changing");
      $$("[data-time]").forEach((b) => b.removeAttribute("aria-busy"));
      render.ui();
    }
  }

  // ---------- Autofocus ----------
  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  let lastAF = 0;
  function autofocus(force = false) {
    if (cam.afLocked && !force) return;
    ray.setFromCamera(centre, camera);
    ray.far = 1500;
    const hit = ray.intersectObjects(world.focusTargets, false)[0];
    const d = hit ? hit.distance : 1000;
    cam.afOk = d >= lens().minFocus;
    cam.focusDist = Math.max(d, lens().minFocus);
  }

  // ---------- Pose recording (for motion blur) ----------
  const poses: Pose[] = [];
  function recordPose(now: number) {
    poses.push({ t: now, p: camera.position.clone(), q: camera.quaternion.clone() });
    while (poses.length && now - poses[0].t > 35000) poses.shift();
  }
  function poseAt(t: number) {
    if (!poses.length) return { p: camera.position.clone(), q: camera.quaternion.clone() };
    if (t <= poses[0].t) return poses[0];
    const last = poses[poses.length - 1];
    if (t >= last.t) return last;
    let lo = 0, hi = poses.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (poses[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = poses[lo], b = poses[hi];
    const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return { p: a.p.clone().lerp(b.p, k), q: a.q.clone().slerp(b.q, k) };
  }

  // ---------- Shooting ----------
  let exposing: { t0: number; end: number } | null = null;
  const rec = $("[data-rec]");
  const flashFx = $("[data-flashfx]");
  const devEl = $("[data-develop]");
  const devBar = $("[data-develop-bar]");



  function shoot() {
    if (!preview.hidden) return closePreview();
    if (!started || exposing || developing() || driving || changingTime) return;
    autofocus();
    const t0 = performance.now();
    exposing = { t0, end: t0 + shutter() * 1000 };
    sound.shutter();
    buzz(18);
    if (cam.flash) {
      sound.flash();
      flashFx.classList.remove("go");
      void flashFx.offsetWidth;
      flashFx.classList.add("go");
    }
    root.classList.add("is-exposing");
  }

  async function finishExposure() {
    const { t0 } = exposing!;
    const shotMeter = meterEV;
    const setup = describeSetup();
    exposing = null;
    root.classList.remove("is-exposing");
    if (shutter() >= 0.3) sound.shutter(true), buzz(12);
    const L = lens();
    const settings = {
      focal: L.focal,
      aperture: aperture(),
      shutter: shutter(),
      iso: iso(),
      blades: L.blades,
      maxAperture: L.maxAperture,
      focusDist: cam.focusDist,
      exposure: exposureScale(aperture(), shutter(), iso()),
      flash: cam.flash ? FLASH_POWERS[cam.power] : 0,
      flashGN: FLASH_GN,
      aspect: aspect(),
      vfov: frameFov(L.focal, cam.portrait),
    };
    // More samples when there's more to integrate: big apertures and long shutters.
    const blurPx = (L.focal / settings.aperture) * 2 + (settings.shutter > 1 / 60 ? 40 : 0);
    const samples = mobile ? clamp(Math.round(16 + blurPx * 0.4), 16, 40) : clamp(Math.round(24 + blurPx * 0.6), 24, 96);
    devEl.hidden = false;
    devBar.style.width = "0%";
    const photo = await darkroomFor(cam.portrait).develop(
      scene,
      settings,
      t0,
      poseAt,
      flashLight,
      world.isolateFlash,
      samples,
      (p) => (devBar.style.width = `${Math.round(p * 100)}%`),
    );
    devEl.hidden = true;
    const { bins, clipped } = histogram(photo);
    await galleryReady;
    const meta: ShotMeta = {
      n: gallery.nextNumber(),
      taken: Date.now(),
      lens: L.name,
      focal: L.focal,
      aperture: settings.aperture,
      shutter: settings.shutter,
      iso: settings.iso,
      flash: settings.flash,
      focusDist: settings.focusDist,
      time,
      sceneEV: LIGHT.ev,
      meterEV: shotMeter,
      clipped,
      bins,
      ...setup,
      headlights: car.lightsOn,
      w: photo.width,
      h: photo.height,
      roll: Math.round(cam.roll * (180 / Math.PI)),
    };
    await gallery.add(photo, meta, false);
    showChip();
    showPreview();
  }

  // After each shot: a preview of the photo with its settings. Tap Keep shooting (or anywhere on it) to carry on.
  const preview = $("[data-preview]");
  const previewImg = preview.querySelector("img")!;
  let previewUrl = "";
  function showPreview() {
    const r = gallery.latest();
    if (!r) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(r.blob);
    previewImg.src = previewUrl;
    const m = r.meta;
    const ev = Math.round(m.meterEV * 10) / 10;
    $("[data-preview-title]").textContent = `Shot ${m.n} · ${m.lens}`;
    $("[data-preview-meta]").textContent = [
      `${m.focal}mm`,
      shutterLabel(m.shutter),
      apertureLabel(m.aperture),
      isoLabel(m.iso),
      m.flash ? `Flash ${powerLabel(m.flash)}` : "No flash",
      `Focus ${m.focusDist >= 999 ? "∞" : `${m.focusDist.toFixed(1)} m`}`,
    ].join(" · ");
    $("[data-preview-ev]").textContent =
      Math.abs(ev) < 0.35 ? "Exposure: well balanced" : ev > 0 ? `Exposure: ${ev} stops bright` : `Exposure: ${-ev} stops dark`;
    preview.hidden = false;
    root.classList.add("previewing");
    $<HTMLButtonElement>("[data-preview-close]").focus({ preventScroll: true });
  }
  function closePreview() {
    if (preview.hidden) return;
    preview.hidden = true;
    root.classList.remove("previewing");
    canvas.focus({ preventScroll: true });
  }
  $("[data-preview-close]").addEventListener("click", closePreview);
  preview.addEventListener("click", (e) => {
    if (e.target === preview) closePreview(); // tap outside the card
  });
  $("[data-preview-open]").addEventListener("click", () => (closePreview(), gallery.open(0)));
  // The latest shot sits in the corner of the view; tap it to review.
  const chip = $<HTMLButtonElement>("[data-chip]");
  let chipUrl = "";
  function showChip() {
    const r = gallery.latest();
    if (!r) return;
    if (chipUrl) URL.revokeObjectURL(chipUrl);
    chipUrl = URL.createObjectURL(r.thumb);
    chip.querySelector("img")!.src = chipUrl;
    chip.hidden = false;
    chip.classList.remove("pop");
    void chip.offsetWidth;
    chip.classList.add("pop");
  }
  chip.addEventListener("click", () => gallery.open(0));

  // Where the camera was, in words, for the shoot guide.
  function describeSetup() {
    const [lx, lz] = toLocal(world.carBox, camera.position.x, camera.position.z);
    const fs = car.parts.frontSign;
    const ahead = lx * fs; // + in front of the car's middle
    const right = lz * fs; // + on the car's right
    const ang = Math.abs(Math.atan2(right, ahead) * (180 / Math.PI));
    const side = right >= 0 ? "car's right side" : "car's left side";
    const view =
      ang < 20 ? "straight on to the front" : ang < 70 ? `front three-quarter, ${side}` : ang < 110 ? `side profile, ${side}` : ang < 160 ? `rear three-quarter, ${side}` : "straight on to the back";
    const stance = player.onLadder ? `On the ${player.onLadder.top} m ladder` : { stand: "Standing", crouch: "Crouching", prone: "Lying flat" }[player.stance];
    return {
      stance,
      camHeight: camera.position.y,
      distance: Math.hypot(camera.position.x - world.carBox.cx, camera.position.z - world.carBox.cz),
      view,
      pitch: player.pitch * (180 / Math.PI),
    };
  }

  // A short buzz when the shutter fires (and again when a long exposure closes).
  // Android uses the Vibration API; iPhone has none, so we tap a hidden switch, which gives a haptic tick on iOS 18+.
  const haptic = root.querySelector<HTMLLabelElement>("[data-haptic]");
  function buzz(ms: number) {
    if (typeof navigator.vibrate === "function") navigator.vibrate(ms);
    else haptic?.click();
  }

  // A clang when the car knocks a ladder over.
  function clunk() {
    const now = performance.now();
    if (now - clunkAudio < 300) return;
    clunkAudio = now;
    sound.ladder(true);
  }

  // ---------- HUD ----------
  const hud = {
    lens: $("[data-vf-lens]"),
    sh: $("[data-vf-shutter]"),
    ap: $("[data-vf-ap]"),
    iso: $("[data-vf-iso]"),
    meter: $("[data-vf-meter]"),
    meterVal: $("[data-vf-meterval]"),
    flash: $("[data-vf-flash]"),
    focus: $("[data-vf-focus]"),
    af: $("[data-af]"),
    stance: $("[data-stance]"),
    boost: $("[data-vf-boost]"),
  };
  let meterEV = 0;
  const render = {
    ui() {
      clampAperture();
      hud.lens.textContent = lens().name;
      hud.sh.textContent = shutterLabel(shutter());
      hud.ap.textContent = apertureLabel(aperture());
      hud.iso.textContent = isoLabel(iso());
      hud.flash.textContent = cam.flash ? `Flash ${powerLabel(FLASH_POWERS[cam.power])}` : "Flash off";
      hud.flash.classList.toggle("on", cam.flash);
      $$("[data-lens]").forEach((b, i) => b.setAttribute("aria-pressed", String(i === cam.lens)));
      $("[data-val=shutter]").textContent = shutterLabel(shutter());
      $("[data-val=aperture]").textContent = apertureLabel(aperture());
      $("[data-val=iso]").textContent = String(iso());
      $("[data-val=power]").textContent = powerLabel(FLASH_POWERS[cam.power]);
      $("[data-flash]").setAttribute("aria-pressed", String(cam.flash));
      $("[data-flash]").textContent = cam.flash ? "Flash on" : "Flash off";
      $("[data-lights]").setAttribute("aria-pressed", String(car.lightsOn));
      $("[data-lights]").textContent = car.lightsOn ? "Car lights on" : "Car lights off";
      $$("[data-time]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.time === time)));
      $("[data-orient]").textContent = cam.portrait ? "Portrait" : "Landscape";
      $("[data-orient]").setAttribute("aria-pressed", String(cam.portrait));
      const deg = Math.round(cam.roll * (180 / Math.PI));
      $("[data-val=tilt]").textContent = `${deg > 0 ? "+" : ""}${deg}°`;
      root.style.setProperty("--roll", `${-cam.roll}rad`);
      root.classList.toggle("is-level", Math.abs(deg) === 0);
    },
    meter() {
      // Meter reading in stops relative to the settings; +3 / -3 saturate like a real scale.
      const v = clamp(meterEV, -3, 3);
      hud.meter.style.setProperty("--m", String(v / 3));
      hud.meterVal.textContent = `${meterEV > 0 ? "+" : ""}${meterEV.toFixed(1)}`;
    },
  };
  render.ui();

  // ---------- Main loop ----------
  let started = false;
  let clunkAudio = 0;
  let stride = 0;
  let last = performance.now();
  let lastMeter = 0;
  let eyeAdapt = 1;
  const fwd = new THREE.Vector3(), rightV = new THREE.Vector3();

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Look
    const sens = 0.0021;
    player.yaw -= lookDX * sens;
    player.pitch = clamp(player.pitch - lookDY * sens, -1.45, 1.45);
    lookDX = lookDY = 0;
    // Gyro: turning the phone turns the camera, one to one, like aiming a real camera.
    if (gyroYaw || gyroPitch) {
      if (!driving && started && preview.hidden) {
        player.yaw += gyroYaw;
        player.pitch = clamp(player.pitch + gyroPitch, -1.45, 1.45);
      }
      gyroYaw = gyroPitch = 0;
    }

    // Move
    let mx = 0, mz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) mz -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) mz += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
    mx += joy.x;
    mz += joy.y;
    const mag = Math.hypot(mx, mz);
    if (driving) {
      car.step(dt, clamp(-mz, -1, 1), clamp(-mx, -1, 1), keys.has("Space") || handbrakeTouch, carBlocked);
      player.x = car.x;
      player.z = car.z;
      carHitsLadders();
      sound.engineSpeed(Math.abs(car.v), Math.max(0, -mz));
    } else if (player.onLadder) {
      if (mag > 0.6) stepOff();
    } else if (mag > 0.05) {
      const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || (mobile && mag > 0.95);
      let sp = SPEED[player.stance] * (run && player.stance === "stand" ? 2.1 : 1);
      if (player.carrying) sp = Math.min(sp, 1.0);
      const k = (sp * dt) / Math.max(1, mag);
      const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      const ox = player.x, oz = player.z;
      player.x += (mx * cy + mz * sy) * k;
      player.z += (-mx * sy + mz * cy) * k;
      // Footsteps: one per stride while on the ground.
      if (player.feet <= groundAt(player.x, player.z, player.feet) + 0.02) {
        stride += Math.hypot(player.x - ox, player.z - oz);
        const len = player.stance === "stand" ? (run ? 0.95 : 0.7) : player.stance === "crouch" ? 0.5 : 0.45;
        if (stride > len) (stride = 0), sound.footstep(player.stance !== "stand");
      }
    }

    // Collide (not while standing on a ladder or driving)
    if (!player.onLadder && !driving) {
      const r = player.stance === "prone" ? RADIUS + 0.25 : RADIUS;
      pushOutOfBox(world.carBox, r);
      for (const l of world.ladders) if (!l.carried && player.feet < l.top - 0.35) pushOutOfBox(l.box, r);
      for (const o of world.obstacles) pushOutOfBox(o, r);
      player.x = clamp(player.x, world.bounds.minX, world.bounds.maxX);
      player.z = clamp(player.z, world.bounds.minZ, world.bounds.maxZ);

      // Gravity and ground
      player.vy -= 9.81 * dt;
      player.feet += player.vy * dt;
      const g = groundAt(player.x, player.z, player.feet);
      if (player.feet <= g) {
        if (player.vy < -2.5) sound.land(-player.vy);
        player.feet = g;
        player.vy = 0;
      }
    }

    // Carried ladder follows you
    if (player.carrying) {
      const l = player.carrying;
      l.group.position.set(player.x - Math.sin(player.yaw) * 1.1, 0.25, player.z - Math.cos(player.yaw) * 1.1);
      l.group.rotation.y = player.yaw;
    }

    // Eye height eases between stances
    player.eye += (EYE[player.stance] - player.eye) * Math.min(1, dt * 7);

    if (driving) {
      // Chase camera. Swings back behind the car when you drive and leave the view alone.
      const [fx, fz] = car.forward();
      if (Math.abs(car.v) > 0.8 && now - lastLookInput > 1500) {
        const behind = Math.atan2(-fx, -fz);
        player.yaw += angleDiff(player.yaw, behind) * Math.min(1, dt * 1.8);
      }
      player.pitch = clamp(player.pitch, -0.9, 0.15);
      const cp = Math.cos(player.pitch);
      const dir = new THREE.Vector3(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
      const target = new THREE.Vector3(car.x, 1.1, car.z);
      camera.position.copy(target).addScaledVector(dir, -7.2);
      camera.position.y = Math.max(0.5, camera.position.y);
    } else {
      camera.position.set(player.x, player.feet + player.eye, player.z);
    }
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, driving ? 0 : -cam.roll, "YXZ"));
    const targetFov = driving ? DRIVE_VFOV : frameFov(lens().focal, cam.portrait);
    const ar = driving ? frameEl.clientWidth / Math.max(1, frameEl.clientHeight) : aspect();
    if (Math.abs(camera.fov - targetFov) > 0.01 || Math.abs(camera.aspect - ar) > 0.001) {
      camera.fov = targetFov;
      camera.aspect = ar;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    recordPose(now);

    // Autofocus and metering a few times a second
    if (!driving && now - lastAF > 90) (autofocus(), (lastAF = now));
    if (now - lastMeter > 250 && !developing()) {
      lastMeter = now;
      const lum = meter(camera);
      const m = exposureScale(aperture(), shutter(), iso());
      meterEV = Math.log2((lum * m) / 0.18);
      render.meter();
      // What your eyes would adapt to, but only so far: below about EV -2 the world looks dark.
      eyeAdapt = Math.min(0.18 / Math.max(lum, 1e-6), Math.pow(2, LIGHT.ev + 2));
    }

    if (pendingBalance && lastMeter > 0 && !changingTime) (pendingBalance = false), balance();

    // The live view is an electronic viewfinder showing the camera's exposure (your eyes while driving).
    // Like a real mirrorless camera, it brightens itself in the dark so you can still compose; the meter and the photo don't.
    const evf = exposureScale(aperture(), shutter(), iso());
    const evfBoost = !driving && evf < eyeAdapt / 8;
    renderer.toneMappingExposure = driving ? eyeAdapt : Math.max(evf, evfBoost ? eyeAdapt / 8 : 0);
    hud.boost.hidden = !evfBoost;

    if (exposing && now >= exposing.end && poses[poses.length - 1].t >= exposing.end) finishExposure();

    // HUD
    hud.focus.textContent = cam.focusDist >= 999 ? "∞" : `${cam.focusDist.toFixed(1)} m`;
    hud.af.classList.toggle("bad", !cam.afOk);
    hud.af.classList.toggle("locked", cam.afLocked);
    hud.stance.textContent = driving
      ? `Driving · ${Math.round(Math.abs(car.v) * 3.6)} km/h${car.v < -0.1 ? " (reverse)" : ""}`
      : player.onLadder
      ? `On a ${player.onLadder.top} m ladder`
      : player.carrying
        ? "Carrying a ladder"
        : { stand: "Standing", crouch: "Crouching", prone: "Lying flat" }[player.stance];
    if (exposing) rec.textContent = shutter() >= 0.5 ? `Exposing ${Math.max(0, (exposing.end - now) / 1000).toFixed(1)}s, hold still` : "";

    // Context prompt
    const near = !player.onLadder && !player.carrying && !driving ? nearestLadder(1.3) : null;
    const downed = !near && !player.onLadder && !player.carrying && !driving ? nearestLadder(1.4, true) : null;
    const byCar = !driving && nearCar();
    prompt.textContent = driving
      ? Math.abs(car.v) > 0.6
        ? mobile ? "Stop to get out" : "Stop (S or Space) to get out"
        : mobile ? "Tap Get out to walk" : "E to get out · H lights"
      : player.onLadder
        ? mobile ? "Tap Ladder to step down" : "E to step down"
        : player.carrying
          ? mobile ? "Tap Carry to put it down" : "R to put the ladder down"
          : near
            ? mobile ? "Ladder: tap Ladder to climb, Carry to move it" : "E to climb · R to pick up"
            : downed
              ? mobile ? "Knocked over: tap Carry to pick it up" : "R to pick the ladder up"
            : byCar
              ? mobile ? "Tap Drive to move the car" : "E to get in and move the car"
              : "";

    ladderPhysics.step(world.ladders, dt, world.bounds);
    if (!developing()) renderer.render(scene, camera);
    schedule(frame);
  }
  const debug = new URLSearchParams(location.search).has("debug");
  // ?debug drives the loop with a timer so automated tests work in hidden tabs.
  const schedule = debug ? (f: (t: number) => void) => setTimeout(() => f(performance.now()), 33) : requestAnimationFrame;

  // ---------- Start ----------
  status.textContent = world.carIsPlaceholder ? "Ready. (Using a stand-in car.)" : "Ready.";
  const startBtn = $<HTMLButtonElement>("[data-start]");
  startBtn.disabled = false;
  startBtn.textContent = "Start shooting";
  startBtn.addEventListener("click", () => {
    started = true;
    sound.unlock();
    syncSound();
    overlay.hidden = true;
    startBtn.textContent = "Back to the shoot";
    if (mobile) enterFull();
    canvas.focus({ preventScroll: true });
  });

  // Full screen: on phones the game takes the whole screen so the page doesn't scroll under your thumbs.
  // The X button minimises it back into the page (to see the gallery).
  let full = false;
  function enterFull() {
    if (full) return;
    full = true;
    root.classList.add("is-full");
    document.documentElement.classList.add("sim-full");
    root.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {}); // Android and desktop; iPhone uses the fixed layout
    root.classList.toggle("panel-open", !mobile);
    $("[data-panel-toggle]").setAttribute("aria-expanded", String(!mobile));
    followPhone();
  }
  function exitFull() {
    if (!full) return;
    full = false;
    root.classList.remove("is-full", "panel-open");
    $("[data-panel-toggle]").setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("sim-full");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    keys.clear();
    if (mobile) {
      started = false; // tap "Back to the shoot" to carry on
      overlay.hidden = false;
      syncSound();
    }
  }
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && full && !mobile) exitFull();
  });
  $("[data-full]").addEventListener("click", () => (full ? exitFull() : enterFull()));
  $("[data-exit]").addEventListener("click", exitFull);
  $("[data-panel-toggle]").addEventListener("click", (e) => {
    const open = root.classList.toggle("panel-open");
    (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(open));
  });

  // ---------- Gyro ----------
  // Aim by moving the phone. Uses the gyroscope's rotation rate (not absolute orientation), so it adds to
  // dragging rather than fighting it, and works the same held upright or sideways.
  let gyroYaw = 0, gyroPitch = 0, gyroOn = false;
  const gyroBtn = $<HTMLButtonElement>("[data-gyro]");
  const DEG = Math.PI / 180;
  function onMotion(e: DeviceMotionEvent) {
    const r = e.rotationRate;
    if (!r || r.beta == null || r.gamma == null) return;
    const iv = e.interval || 0;
    const dt = Math.min(0.1, iv > 1 ? iv / 1000 : iv || 0.016); // milliseconds on most browsers, seconds on some
    const dead = (v: number) => (Math.abs(v) < 0.4 ? 0 : v); // ignore sensor noise when held still
    const bx = dead(r.beta) * DEG * dt, gy = dead(r.gamma) * DEG * dt; // about the device's x and y axes
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    // Map device axes to the screen: yaw turns about the screen's up axis, pitch about its right axis.
    if (angle === 90) (gyroYaw += bx), (gyroPitch -= gy);
    else if (angle === 270 || angle === -90) (gyroYaw -= bx), (gyroPitch += gy);
    else if (angle === 180) (gyroYaw -= gy), (gyroPitch -= bx);
    else (gyroYaw += gy), (gyroPitch += bx);
  }
  function showGyro(label?: string) {
    gyroBtn.setAttribute("aria-pressed", String(gyroOn));
    gyroBtn.textContent = label ?? (gyroOn ? "Gyro on" : "Gyro off");
  }
  async function toggleGyro() {
    if (gyroOn) {
      removeEventListener("devicemotion", onMotion);
      gyroOn = false;
      return showGyro();
    }
    // iPhone only gives motion data to secure (https) pages, after asking permission from a tap.
    if (!isSecureContext) return showGyro("Gyro needs https");
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DM) return showGyro("No gyro");
    try {
      if (typeof DM.requestPermission === "function" && (await DM.requestPermission()) !== "granted") return showGyro("Gyro blocked");
    } catch {
      return showGyro("Gyro blocked");
    }
    addEventListener("devicemotion", onMotion);
    gyroOn = true;
    showGyro();
  }
  gyroBtn.addEventListener("click", toggleGyro);
  showGyro();

  // ---------- Sound ----------
  // Plays only while the game is started and on screen; the speaker button (or M) mutes it, remembered per browser.
  const soundBtn = $<HTMLButtonElement>("[data-sound]");
  let onScreen = true;
  const syncSound = () => sound.setActive(started && (onScreen || full));
  function toggleSound() {
    const on = sound.toggle();
    syncSound();
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.setAttribute("aria-label", on ? "Sound on. Turn sound off" : "Sound off. Turn sound on");
    soundBtn.classList.toggle("off", !on);
  }
  soundBtn.setAttribute("aria-pressed", String(sound.enabled));
  soundBtn.classList.toggle("off", !sound.enabled);
  soundBtn.setAttribute("aria-label", sound.enabled ? "Sound on. Turn sound off" : "Sound off. Turn sound on");
  soundBtn.addEventListener("click", toggleSound);
  if (!sound.supported) soundBtn.remove(); // sound is Safari-only (see sound.ts)
  new IntersectionObserver(([e]) => ((onScreen = e.isIntersecting), syncSound()), { threshold: 0.3 }).observe(stage);
  schedule((t) => {
    last = t;
    frame(t);
  });

  // Test hook, only with ?debug in the URL.
  if (debug) {
    (window as unknown as Record<string, unknown>).__sim = {
      cam, player, shoot, setLens, step, toggleFlash, start: () => startBtn.click(), world, renderer, car, gallery,
      toggleOrientation, tilt, level, balance, enterFull, exitFull, ladders: world.ladders,
      setTime, enterCar, exitCar, toggleLights, keys, camera, toggleGyro, gyro: () => gyroOn,
      motion: onMotion, sound, toggleSound,
      driving: () => driving,
      look: (dx: number, dy: number) => ((lookDX += dx), (lookDY += dy)),
      meter: () => meterEV,
      busy: () => developing() || !!exposing || changingTime,
    };
  }
}

