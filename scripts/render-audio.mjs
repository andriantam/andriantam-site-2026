// Renders the simulator's sounds into public/sim/audio (run after changing src/scripts/sim/sound-synth.ts):
//   node scripts/render-audio.mjs
// Uses node-web-audio-api to run the same Web Audio recipes as a browser would, then macOS's afconvert to
// compress the scenery loops to AAC (.m4a). Effects stay as one small WAV so they start instantly.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as wa from "node-web-audio-api";

Object.assign(globalThis, { OfflineAudioContext: wa.OfflineAudioContext, AudioBuffer: wa.AudioBuffer });

const out = path.resolve("public/sim/audio");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sim-audio-"));
fs.mkdirSync(out, { recursive: true });

// Node 23+ runs the TypeScript recipes directly.
const { renderAll } = await import("../src/scripts/sim/sound-synth.ts");

const map = await renderAll(async (name, blob) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  if (name.startsWith("scenery-")) {
    const m4a = path.join(out, name.replace(/\.wav$/, ".m4a"));
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", file, m4a]);
    console.log("scenery", path.basename(m4a), `${Math.round(fs.statSync(m4a).size / 1024)} KB`);
  } else if (name === "effects.wav") {
    fs.copyFileSync(file, path.join(out, name));
    console.log("effects", `${Math.round(fs.statSync(file).size / 1024)} KB`);
  }
});
fs.writeFileSync("src/scripts/sim/audio-map.json", JSON.stringify(map) + "\n");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("done:", Object.keys(map).join(", "));
