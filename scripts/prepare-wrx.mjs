// Turns the Sketchfab "2018 Subaru WRX STI" download into public/sim/car.glb for the simulator.
//
//  - Puts a custom number plate on the back. Badges and emblems are kept; pass --no-badges to remove them.
//  - Splits the shared lamp glass so only the front lenses light up as headlamps.
//  - Gives the parts the material names the simulator already knows (Car_Paint, Window_Glass, Light_Bulb, ...)
//    while keeping the artist's own colours, metalness and roughness.
//  - Drops the refractive "transmission" glass, which costs a whole extra render pass on phones.
//  - Simplifies the hidden engine and the interior, compresses textures (WebP) and geometry (meshopt).
//
// Usage: node scripts/prepare-wrx.mjs path/to/2018_subaru_wrx_sti.glb public/sim/car.glb [--no-badges]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsClearcoat } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplifyPrimitive, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const args = process.argv.slice(2);
const NO_BADGES = args.includes("--no-badges");
const GUIDE_REACH = Number(args.find((a) => a.startsWith("--guide="))?.slice(8) ?? 0.024); // metres from the window edge
const [input, output] = args.filter((a) => !a.startsWith("--"));
if (!input || !output) {
  console.error("Usage: node scripts/prepare-wrx.mjs <in.glb> <out.glb>");
  process.exit(1);
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const short = (n) => n.replace(/^subSubaru_WRXSTITNR0_2018_?/, "");

const count = () => {
  let t = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? 0) / 3;
  return Math.round(t);
};
console.log("triangles before", count().toLocaleString());

// 1. Optional (--no-badges): remove the badges, the caliper logos and the emblems.
if (NO_BADGES) {
for (const node of root.listNodes()) {
  if (/Kit0_Badge_Geo|^CalliperBadge /.test(node.getName())) node.dispose();
}

// Emblems that are part of the trim mesh. On the grille the oval is cut out (the honeycomb shows behind it);
// the raised letters beside the plate are cut too (the boot panel continues under them). The boot-lid oval sits
// in a hole in the panel, so it is repainted in the body colour instead. Boxes in metres (x across, y up, z forward).
const EMBLEMS = [
  { cut: true, inside: (p) => Math.abs(p[0]) < 0.19 && p[1] > 0.6 && p[1] < 0.72 && p[2] > 2.14 }, // grille oval
  { cut: false, inside: (p) => Math.abs(p[0]) < 0.13 && p[1] > 0.95 && p[1] < 1.06 && p[2] < -2.2 }, // boot oval
  { cut: true, inside: (p) => Math.abs(p[0]) > 0.27 && Math.abs(p[0]) < 0.5 && p[1] > 0.66 && p[1] < 0.81 && p[2] < -2.25 }, // raised letters either side of the plate (the panel continues under them)
];
const toWorld = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]].map((x) => x * 100);
const paintMat = root.listMaterials().find((m) => /PaintTNR_Material1$/.test(m.getName()));
let cut = 0, painted = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const W = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    if (!/Coloured_Material/.test(prim.getMaterial()?.getName() ?? "")) continue;
    const pos = prim.getAttribute("POSITION"), idx = prim.getIndices();
    const v = [0, 0, 0];
    const P = (i) => (pos.getElement(i, v), toWorld(W, v));
    const keep = [], paint = [];
    for (let t = 0; t < idx.getCount(); t += 3) {
      const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
      const c = tri.map(P).reduce((s, q) => s.map((x, k) => x + q[k] / 3), [0, 0, 0]);
      const hit = EMBLEMS.find((e) => e.inside(c));
      if (!hit) keep.push(...tri);
      else if (hit.cut) cut++;
      else paint.push(...tri), painted++;
    }
    const IndexArray = idx.getArray().constructor;
    idx.setArray(new IndexArray(keep));
    if (paint.length && paintMat) {
      const copy = prim.clone();
      copy.setIndices(doc.createAccessor().setType("SCALAR").setArray(new IndexArray(paint)).setBuffer(idx.getBuffer()));
      copy.setMaterial(paintMat);
      mesh.addPrimitive(copy);
    }
  }
}
console.log(`emblems: cut ${cut} triangles, repainted ${painted}`);
} else console.log("badges kept");

// 2. Plain number plate.
const plateSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256">
  <rect width="512" height="256" fill="#e9e9e6"/>
  <text x="256" y="160" font-family="Helvetica, Arial, sans-serif" font-size="58" font-weight="700" letter-spacing="4" text-anchor="middle" fill="#2a2a2a">ANDRIANTAM</text>
</svg>`;
// The plate's texture is mapped upside down, so the image is flipped to read the right way up.
const plate = await sharp(Buffer.from(plateSvg)).flip().png().toBuffer();
for (const mat of root.listMaterials()) {
  if (/ManufacturerPlate/.test(mat.getName())) mat.getBaseColorTexture()?.setImage(new Uint8Array(plate)).setMimeType("image/png");
}

// 3. Lamp glass: the front lenses become their own material, so headlamps can glow without the tail lamps going white.
const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
let frontLens = null;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const W = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (mat?.getName() !== "glass_light") continue;
    const pos = prim.getAttribute("POSITION"), idx = prim.getIndices();
    const v = [0, 0, 0];
    const zOf = (i) => (pos.getElement(i, v), apply(W, v)[2]);
    const keep = [], front = [];
    for (let t = 0; t < idx.getCount(); t += 3) {
      const a = idx.getScalar(t), b = idx.getScalar(t + 1), c = idx.getScalar(t + 2);
      ((zOf(a) + zOf(b) + zOf(c)) / 3 > 0.0145 ? front : keep).push(a, b, c); // model units: 0.0145 = 1.45 m forward
    }
    if (!front.length) continue;
    frontLens ??= mat.clone().setName("Light_Bulb");
    const IndexArray = idx.getArray().constructor;
    idx.setArray(new IndexArray(keep));
    const copy = prim.clone();
    copy.setIndices(doc.createAccessor().setType("SCALAR").setArray(new IndexArray(front)).setBuffer(idx.getBuffer()));
    copy.setMaterial(frontLens);
    mesh.addPrimitive(copy);
  }
}
console.log(frontLens ? "split the front headlamp lenses" : "WARNING: no front lens found");

const clearcoat = doc.createExtension(KHRMaterialsClearcoat);
// 3b. Tail lamp light guides. The real lamp has a C-shaped LED light guide around the reverse-light window that
// glows far brighter than the rest of the lamp. The model has no separate part for it, so the lamp-housing triangles
// in a band just outside the edge of each (smoked) reverse-light window become their own "Tail_Guide" material,
// which the simulator lights up. Positions in metres (model units x 100).
{
  const M = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]].map((x) => x * 100);
  const inTail = (c) => c[2] < -1.75 && Math.abs(c[0]) > 0.35 && c[1] > 0.7 && c[1] < 1.05;
  // Boundary edges of the reverse-light windows (edges used by one triangle only).
  const edges = [], windowTris = [];
  // Seen from behind (looking along z), is a point inside a reverse-light window's outline?
  const behindWindow = (p) =>
    windowTris.some(([a, b, c]) => {
      const d = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
      const s1 = d(a, b, p), s2 = d(b, c, p), s3 = d(c, a, p);
      return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    });
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() !== "glass_light") continue;
      const pos = prim.getAttribute("POSITION"), idx = prim.getIndices(), v = [0, 0, 0];
      const P = (i) => (pos.getElement(i, v), M(W, v));
      const count = new Map();
      for (let t = 0; t < idx.getCount(); t += 3) {
        const ids = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        const pts = ids.map(P);
        if (!inTail(pts.reduce((s, q) => s.map((x, k) => x + q[k] / 3), [0, 0, 0]))) continue;
        for (let e = 0; e < 3; e++) {
          const a = ids[e], b = ids[(e + 1) % 3], k = a < b ? `${a}_${b}` : `${b}_${a}`;
          const hit = count.get(k);
          if (hit) hit.n++;
          else count.set(k, { n: 1, seg: [pts[e], pts[(e + 1) % 3]] });
        }
      }
      for (const { n, seg } of count.values()) if (n === 1) edges.push(seg);
      for (let t = 0; t < idx.getCount(); t += 3) {
        const pts = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)].map(P);
        if (inTail(pts.reduce((s, q) => s.map((x, k) => x + q[k] / 3), [0, 0, 0]))) windowTris.push(pts);
      }
    }
  }
  const distToEdges = (p) => {
    let best = Infinity;
    for (const [a, b] of edges) {
      const ab = b.map((x, i) => x - a[i]), ap = p.map((x, i) => x - a[i]);
      const L = ab.reduce((s, x) => s + x * x, 0) || 1e-9;
      const t = Math.max(0, Math.min(1, ap.reduce((s, x, i) => s + x * ab[i], 0) / L));
      best = Math.min(best, Math.hypot(...p.map((x, i) => x - (a[i] + t * ab[i]))));
    }
    return best;
  };
  let guide = null, n = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of [...mesh.listPrimitives()]) {
      const mat = prim.getMaterial();
      if (!/LightA_Material1$/.test(mat?.getName() ?? "")) continue;
      const pos = prim.getAttribute("POSITION"), idx = prim.getIndices(), v = [0, 0, 0];
      const P = (i) => (pos.getElement(i, v), M(W, v));
      const keep = [], take = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        const c = tri.map(P).reduce((s, q) => s.map((x, k) => x + q[k] / 3), [0, 0, 0]);
        (inTail(c) && !behindWindow(c) && distToEdges(c) < GUIDE_REACH ? take : keep).push(...tri);
      }
      if (!take.length) continue;
      n += take.length / 3;
      const IndexArray = idx.getArray().constructor;
      idx.setArray(new IndexArray(keep));
      guide ??= mat.clone().setName("Tail_Guide").setExtras({ lightGuide: true }); // extras keep it from being merged back
      const copy = prim.clone();
      copy.setIndices(doc.createAccessor().setType("SCALAR").setArray(new IndexArray(take)).setBuffer(idx.getBuffer()));
      copy.setMaterial(guide);
      mesh.addPrimitive(copy);
    }
  }
  console.log(`tail light guides: ${n} triangles around ${edges.length} window edges`);
}

// 3c. Headlamps. Inside each headlamp everything is one textured part; its texture has the C-shaped LED light guide
// (the daytime running light) as a frame around the inner reflector, and the projector lens as a large circle.
// Those two become their own materials, "Head_Guide" and "Head_Projector", so the simulator lights only them,
// as on the real car, instead of the whole lens.
{
  const M = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]].map((x) => x * 100);
  const region = ([u, v]) => {
    if (u > 0.745 && v < 0.255) return "Head_Projector"; // the round lens
    const inner = u > 0.2 && u < 0.745 && v > 0.215 && v < 0.51; // the chrome reflector and indicator
    if (!inner && u > 0.01 && u < 0.94 && v > 0.17 && v < 0.58) return "Head_Guide"; // the C-shaped frame
    return null;
  };
  const made = {}, counts = { Head_Guide: 0, Head_Projector: 0 };
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of [...mesh.listPrimitives()]) {
      const mat = prim.getMaterial();
      if (!/LightA_Material1$/.test(mat?.getName() ?? "")) continue;
      const pos = prim.getAttribute("POSITION"), uv = prim.getAttribute("TEXCOORD_0"), idx = prim.getIndices();
      const v = [0, 0, 0], t = [0, 0];
      const keep = [], take = { Head_Guide: [], Head_Projector: [] };
      for (let i = 0; i < idx.getCount(); i += 3) {
        const tri = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
        const z = tri.reduce((sum, j) => (pos.getElement(j, v), sum + M(W, v)[2] / 3), 0);
        const c = tri.reduce((sum, j) => (uv.getElement(j, t), [sum[0] + t[0] / 3, sum[1] + t[1] / 3]), [0, 0]);
        const r = z > 1.6 ? region(c) : null;
        (r ? take[r] : keep).push(...tri);
      }
      const IndexArray = idx.getArray().constructor;
      for (const [name, list] of Object.entries(take)) {
        if (!list.length) continue;
        counts[name] += list.length / 3;
        made[name] ??= mat.clone().setName(name).setExtras({ lamp: name }); // extras keep it from being merged back
        const copy = prim.clone();
        copy.setIndices(doc.createAccessor().setType("SCALAR").setArray(new IndexArray(list)).setBuffer(idx.getBuffer()));
        copy.setMaterial(made[name]);
        mesh.addPrimitive(copy);
      }
      idx.setArray(new IndexArray(keep));
    }
  }
  console.log(`headlamps: ${counts.Head_Guide} light-guide and ${counts.Head_Projector} projector triangles`);
}

// 4. Materials: familiar names. The artist's colours, metalness and roughness are kept as they are.
for (const mat of root.listMaterials()) {
  const name = short(mat.getName());
  mat.setExtension("KHR_materials_transmission", null);
  if (/^PaintTNR/.test(name)) {
    // A clear top coat over the metallic base: the glossy, mirror-like reflections of real car paint.
    // (Without the clearcoat extension the material loads as a plain standard material.)
    mat.setName("Car_Paint");
    mat.setExtension("KHR_materials_clearcoat", clearcoat.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(0.03));
  }
  else if (/^Window_Material/.test(name)) mat.setName("Window_Glass");
  else if (/^red_glass$/.test(name)) mat.setName("Bright_Lights_Tail");
  else if (/TireBlur/.test(name)) mat.setName("Tire_Rubber");
  else if (/Rim89A/.test(name)) mat.setName("Rims");
  else if (/BrakeDisc/.test(name)) mat.setName("Striped_Brake_Disc");
  else if (/CalliperGloss/.test(name)) mat.setName("Caliper");
  else if (/^InteriorA/.test(name)) mat.setName("Interior");
  else if (mat.getName() !== "Light_Bulb") mat.setName(name);
  // Without the refractive pass, tinted glass is just a see-through colour layer, so its opacity sets how much
  // tint shows. Headlamp lenses: nearly clear, so the projector shows (the tail lamps keep their smoked section).
  if (mat.getName() === "Light_Bulb") {
    const c = mat.getBaseColorFactor();
    mat.setBaseColorFactor([c[0], c[1], c[2], 0.12]);
  }
  // (Tail lamp lenses are made into clear glass with a red tint in the simulator itself: see world.ts.)
  // Indicator lenses: amber.
  if (name === "orange_glass") mat.setBaseColorFactor([0.8, 0.22, 0.0, 0.6]);
  // Cut-outs, not see-through: blended surfaces are slow and draw in the wrong order.
  if (mat.getAlphaMode() === "BLEND" && /^(InteriorA|EngineA|Grille)/.test(name)) mat.setAlphaMode("MASK").setAlphaCutoff(0.5);
  // Glass: thin, slightly see-through, sharp reflections.
  if (/glass|^Window_Material/.test(name)) mat.setRoughnessFactor(0.02);
}

// 5. Lighter geometry where nobody looks: the engine under the bonnet. The cabin stays at full detail,
//    because the home page has a driver's-seat view (simplifying it made the dashboard look melted).
await doc.transform(dedup(), weld());
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? "";
    const ratio = /EngineA/.test(name) ? 0.15 : 0;
    if (ratio) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.003, lockBorder: false });
  }
}

await doc.transform(
  prune(),
  // Colour textures as high-quality WebP. Normal maps stay lossless: lossy compression smears their fine detail.
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 92, slots: /^(?!normalTexture).*$/ }),
  // Finer quantisation than the default, so close-up surfaces (the dashboard, the wheel) keep smooth shading.
  meshopt({ encoder: MeshoptEncoder, level: "medium", quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14 }),
);
console.log("triangles after", count().toLocaleString());
await io.write(output, doc);
console.log("wrote", output);
