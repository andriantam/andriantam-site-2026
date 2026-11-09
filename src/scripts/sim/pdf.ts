// "Export shoot guide": a printable A4 PDF of the shoot, built in the browser.
// Cover with the event details and a contact sheet, then two shots per page with full settings and setup.
import { jsPDF } from "jspdf";
import { LENSES } from "./data";
import {
  dateLine, exposureLine, flashLine, focusLine, setupLine, settingsLine, timeLabel, type PhotoRecord, type ShotMeta,
} from "./gallery";
import { apertureLabel, isoLabel, shutterLabel, timePreset } from "./data";

interface Guide {
  event: string;
  description: string;
  notes: string;
  photos: PhotoRecord[];
}

const PAGE = { w: 210, h: 297, m: 16 };
const INK: [number, number, number] = [22, 20, 26];
const MUTED: [number, number, number] = [107, 102, 112];
const GOLD: [number, number, number] = [176, 132, 58];
const LINE: [number, number, number] = [222, 218, 210];

// The PDF's built-in fonts cover Western European text only; swap anything else for a close match.
const safe = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ–—•€]/g, "?");

export async function exportShootGuide(g: Guide, onProgress: (p: number) => void) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = PAGE.w - PAGE.m * 2;
  const title = g.event || "Untitled shoot";
  doc.setProperties({ title: `${title} - shoot guide`, subject: "Shoot guide", creator: "Photography Simulator, andriantam.com/play" });

  const imgData = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
  const text = (s: string, x: number, y: number, size: number, style: "normal" | "bold" = "normal", color = INK, opts: Record<string, unknown> = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(safe(s), x, y, opts);
  };
  const wrap = (s: string, width: number, size: number) => {
    doc.setFontSize(size);
    return doc.splitTextToSize(safe(s), width) as string[];
  };
  const lh = (size: number) => size * 0.3528 * 1.35; // line height in mm

  // ---------- Cover ----------
  let y = PAGE.m + 4;
  text("SHOOT GUIDE", PAGE.m, y, 9, "bold", GOLD, { charSpace: 0.8 });
  y += 11;
  for (const line of wrap(title, W, 28)) {
    text(line, PAGE.m, y, 28, "bold");
    y += lh(28);
  }
  const first = g.photos[0].meta, last = g.photos[g.photos.length - 1].meta;
  const times = [...new Set(g.photos.map((p) => timeLabel(p.meta.time)))];
  const lenses = [...new Set(g.photos.map((p) => p.meta.focal))].sort((a, b) => a - b);
  text(`${g.photos.length} shot${g.photos.length === 1 ? "" : "s"}  ·  ${times.join(", ")}  ·  ${dateLine(first.taken)}${last.taken - first.taken > 60000 ? ` to ${dateLine(last.taken)}` : ""}`, PAGE.m, y + 1, 10, "normal", MUTED);
  y += 6;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(PAGE.m, y, PAGE.m + W, y);
  y += 8;

  const block = (label: string, body: string) => {
    if (!body) return;
    text(label.toUpperCase(), PAGE.m, y, 8, "bold", MUTED, { charSpace: 0.6 });
    y += 5;
    for (const line of wrap(body, W, 10.5)) {
      if (y > PAGE.h - 40) break;
      text(line, PAGE.m, y, 10.5);
      y += lh(10.5);
    }
    y += 5;
  };
  block("Description", g.description);
  block("Notes", g.notes);
  block("Location", "Mountain-pass lay-by: a 36 x 12 m bay beside the road, guardrail and valley to one side, a rock cut and hillside across the road.");
  block("Kit", `Full-frame body. Lenses: ${lenses.map((f) => LENSES.find((l) => l.focal === f)?.name ?? `${f}mm`).join(", ")}.${g.photos.some((p) => p.meta.flash) ? " On-camera flash, guide number 60." : ""}`);

  // Contact sheet
  const cols = 4, gap = 3, cw = (W - gap * (cols - 1)) / cols, ch = cw / 1.5;
  const sheet = g.photos.slice(0, 24);
  const rowsFit = Math.max(0, Math.floor((PAGE.h - PAGE.m - 12 - y - 8) / (ch + 7)));
  if (rowsFit > 0) {
    text("CONTACT SHEET", PAGE.m, y, 8, "bold", MUTED, { charSpace: 0.6 });
    y += 4;
    const shown = sheet.slice(0, rowsFit * cols);
    for (let i = 0; i < shown.length; i++) {
      const r = shown[i];
      const x = PAGE.m + (i % cols) * (cw + gap), yy = y + Math.floor(i / cols) * (ch + 7);
      // Fit each thumbnail (landscape or portrait) inside its cell.
      const ar = r.meta.w / r.meta.h;
      const tw = ar >= cw / ch ? cw : ch * ar, th = tw / ar;
      doc.setFillColor(242, 239, 233);
      doc.rect(x, yy, cw, ch, "F");
      doc.addImage(await imgData(r.thumb), "JPEG", x + (cw - tw) / 2, yy + (ch - th) / 2, tw, th, `t${r.id}`, "FAST");
      text(`#${r.meta.n}  ${r.meta.focal}mm  ${apertureLabel(r.meta.aperture)}  ${shutterLabel(r.meta.shutter)}`, x, yy + ch + 3.6, 6.5, "normal", MUTED);
    }
    if (g.photos.length > shown.length) text(`+ ${g.photos.length - shown.length} more in the shot list`, PAGE.m, y + Math.ceil(shown.length / cols) * (ch + 7) + 1, 8, "normal", MUTED);
  }

  // ---------- Shot list: two per page ----------
  const slotH = (PAGE.h - PAGE.m * 2 - 10) / 2;
  const imgW = 118, imgH = imgW / 1.5, colX = PAGE.m + imgW + 6, colW = W - imgW - 6;
  for (let i = 0; i < g.photos.length; i++) {
    if (i % 2 === 0) doc.addPage();
    const r = g.photos[i], m = r.meta;
    const top = PAGE.m + 4 + (i % 2) * slotH;
    text(`SHOT ${m.n}`, PAGE.m, top, 8, "bold", GOLD, { charSpace: 0.6 });
    text(`${timeLabel(m.time)}  ·  ${dateLine(m.taken)}`, PAGE.m + W, top, 8, "normal", MUTED, { align: "right" });
    const iy = top + 3;
    // Portrait frames keep their height and sit centred in the photo column.
    const par = m.w / m.h;
    const pw = par >= imgW / imgH ? imgW : imgH * par, ph = pw / par;
    doc.addImage(await imgData(r.blob), "JPEG", PAGE.m + (imgW - pw) / 2, iy + (imgH - ph) / 2, pw, ph, `p${r.id}`, "MEDIUM");

    // Settings table
    let ty = iy + 3;
    const row = (k: string, v: string) => {
      text(k.toUpperCase(), colX, ty, 6.5, "bold", MUTED, { charSpace: 0.4 });
      ty += 3.8;
      for (const line of wrap(v, colW, 10)) {
        text(line, colX, ty, 10, "bold");
        ty += lh(10);
      }
      ty += 1.8;
    };
    row("Lens", m.lens);
    row("Aperture", apertureLabel(m.aperture));
    row("Shutter", `${shutterLabel(m.shutter)}${m.shutter >= 0.3 ? "" : " s"}`);
    row("ISO", isoLabel(m.iso).replace("ISO ", ""));
    row("Flash", flashLine(m).replace("No flash", "Off"));
    row("Focus", focusLine(m).replace("Focused at ", ""));

    // Setup and notes under the photo
    let by = iy + imgH + 6;
    const para = (k: string, v: string) => {
      text(k.toUpperCase(), PAGE.m, by, 6.5, "bold", MUTED, { charSpace: 0.4 });
      by += 3.8;
      for (const line of wrap(v, W, 9.5)) {
        text(line, PAGE.m, by, 9.5);
        by += lh(9.5);
      }
      by += 1.6;
    };
    para("Camera position", sentence(setupLine(m) + (m.h > m.w ? ", portrait frame" : "") + (m.roll ? `, camera tilted ${Math.abs(m.roll)}° ${m.roll > 0 ? "right" : "left"}` : "")));
    para("Light", `${timePreset(m.time).blurb}, about EV ${m.sceneEV}${m.headlights ? ", with the car's lights on" : ""}. Exposure: ${exposureLine(m)}.`);
    const tips = tipsFor(m);
    if (tips) para("To recreate", tips);
    if (i % 2 === 0 && i < g.photos.length - 1) {
      doc.setDrawColor(...LINE);
      doc.line(PAGE.m, top + slotH - 5, PAGE.m + W, top + slotH - 5);
    }
    onProgress((i + 1) / g.photos.length);
    await new Promise((res) => setTimeout(res, 0));
  }

  // Footers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    text(`${title}  ·  Shoot guide`, PAGE.m, PAGE.h - 9, 7.5, "normal", MUTED);
    text(`Photography Simulator  ·  andriantam.com/play  ·  ${p} / ${pages}`, PAGE.m + W, PAGE.h - 9, 7.5, "normal", MUTED, { align: "right" });
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shoot";
  doc.save(`${slug}-shoot-guide.pdf`);
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + ".";

// A few practical notes for getting the same frame again.
function tipsFor(m: ShotMeta) {
  const t: string[] = [];
  const lens = LENSES.find((l) => l.focal === m.focal);
  if (lens && m.aperture <= lens.maxAperture * 1.2 && m.aperture <= 2.8) t.push("Shot near wide open: focus carefully, the depth of field is thin");
  else if (m.aperture >= 11) t.push("Stopped down for depth of field from front to back");
  if (m.shutter >= 1 / 15) t.push(m.shutter >= 1 ? "Long exposure: use a tripod or brace the camera, and keep still until the shutter closes" : "Slow shutter: brace yourself or the camera to avoid shake");
  if (m.flash) t.push(`Flash at ${flashLine(m).replace("Flash ", "")} power fires at the start of the exposure`);
  if (m.iso >= 3200) t.push("High ISO adds visible grain");
  if (m.clipped > 0.05) t.push(`About ${Math.round(m.clipped * 100)}% of the frame clipped; drop the exposure for more highlight detail`);
  if (Math.abs(m.meterEV) >= 1 && m.clipped <= 0.05) t.push(`Deliberately ${m.meterEV > 0 ? "brighter" : "darker"} than the meter`);
  return t.length ? t.join(". ") + "." : "";
}

export { settingsLine };
