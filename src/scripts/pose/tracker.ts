// Webcam + MediaPipe pose tracking, up to two people. Everything runs in the browser; the video never leaves the device.
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM = "/pose/wasm";
const MODEL = "/pose/pose_landmarker_lite.task";

export interface Pt {
  x: number; // 0..1 across the camera image (not mirrored)
  y: number; // 0..1 down
  z: number;
  v: number; // visibility 0..1
}

// MediaPipe BlazePose landmark indices.
export const L = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lFoot: 31, rFoot: 32,
} as const;

let landmarker: PoseLandmarker | null = null;

async function loadModel() {
  if (landmarker) return landmarker;
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const make = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 2,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    landmarker = await make("GPU");
  } catch {
    landmarker = await make("CPU");
  }
  return landmarker;
}

export interface Tracker {
  stop(): void;
  /** Latest people seen (empty when nobody), updated every time the camera produces a new frame. */
  people: Pt[][];
}

/** Loads the model, opens the camera and calls onFrame for every new camera frame with the people in it. Throws a friendly Error if it can't start. */
export async function startTracker(video: HTMLVideoElement, onFrame: (people: Pt[][], now: number) => void, onStatus?: (msg: string) => void): Promise<Tracker> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here. Try Chrome, Safari or Firefox over https.");
  onStatus?.("Loading the pose model…");
  const lm = await loadModel();
  onStatus?.("Waiting for the camera…");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
  } catch (err: any) {
    if (err?.name === "NotAllowedError" || err?.name === "SecurityError") throw new Error("Camera access was blocked. Allow it in your browser's address bar, then press Start again.");
    if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") throw new Error("No camera found on this device.");
    throw err;
  }
  video.srcObject = stream;
  await video.play();
  let running = true;
  let last = -1;
  let raf = 0;
  const tracker: Tracker = {
    people: [],
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      tracker.people = [];
    },
  };
  const loop = () => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (video.readyState < 2 || video.currentTime === last) return;
    last = video.currentTime;
    const now = performance.now();
    const res = lm.detectForVideo(video, now);
    tracker.people = res.landmarks.map((l) => l.map((q) => ({ x: q.x, y: q.y, z: q.z, v: q.visibility ?? 0 })));
    onFrame(tracker.people, now);
  };
  loop();
  return tracker;
}
