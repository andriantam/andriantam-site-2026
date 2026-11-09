// Shrinks a downloaded car model for the web.
// Body panels (paint) are kept at full detail: simplifying them breaks their smooth shading
// and shows up as pale patches on the doors. Everything else (interior, wheels, underbody) is simplified.
//
// Usage: node scripts/optimize-car.mjs path/to/scene.gltf public/sim/car.glb [ratio]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplifyPrimitive, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const [input, output, ratioArg] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/optimize-car.mjs <in.gltf|glb> <out.glb> [ratio=0.06]");
  process.exit(1);
}
const RATIO = Number(ratioArg ?? 0.06);
const KEEP = /^(car_paint|window_glass|white_glass|brake_light_glass|white_stained_glass.*|emblem|logo.*)$/i; // left at full detail

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);

const count = () => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  return Math.round(t);
};
console.log("triangles before", count().toLocaleString());

await doc.transform(dedup(), weld());
let kept = 0, simplified = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? "";
    const tris = (prim.getIndices()?.getCount() ?? 0) / 3;
    if (KEEP.test(name) || tris < 2000) {
      kept += tris;
      continue;
    }
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.002, lockBorder: false });
    simplified += (prim.getIndices()?.getCount() ?? 0) / 3;
  }
}
console.log(`kept at full detail: ${Math.round(kept).toLocaleString()} triangles; simplified parts now ${Math.round(simplified).toLocaleString()}`);

await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
console.log("triangles after", count().toLocaleString());
await io.write(output, doc);
console.log("wrote", output);
