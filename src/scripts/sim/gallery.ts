// The shoot gallery: every photo you take, kept in this browser (IndexedDB).
// Grid with selection, a full-screen viewer, downloads with a settings frame, and the shoot guide export.
import { apertureLabel, isoLabel, powerLabel, shutterLabel, timePreset, type TimeOfDay } from "./data";

export interface ShotMeta {
  n: number; // shot number on this roll
  taken: number; // ms since epoch
  lens: string;
  focal: number;
  aperture: number;
  shutter: number;
  iso: number;
  flash: number; // 0 = off, otherwise the power fraction
  focusDist: number;
  time: TimeOfDay;
  sceneEV: number;
  meterEV: number; // what the meter said when you pressed the shutter (stops from correct)
  clipped: number; // share of the frame blown out
  bins: number[]; // 64-bin luminance histogram
  stance: string;
  camHeight: number; // metres above the ground
  distance: number; // metres from the middle of the car
  view: string; // which side of the car, in words
  pitch: number; // degrees, up is positive
  headlights: boolean;
  w: number;
  h: number;
  roll?: number; // degrees the camera was tilted
}

export interface PhotoRecord {
  id: number;
  blob: Blob;
  thumb: Blob;
  meta: ShotMeta;
}

const DB_NAME = "andriantam-sim";
const STORE = "photos";

// ---------- Storage ----------
class Store {
  private db: IDBDatabase | null = null;
  persistent = false;

  async open() {
    try {
      this.db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      this.persistent = true;
    } catch {
      this.db = null; // private browsing or storage blocked: keep photos in memory only
    }
  }

  private req<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((res, rej) => {
      const t = this.db!.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => res(r.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  async all(): Promise<PhotoRecord[]> {
    if (!this.db) return [];
    return this.req("readonly", (s) => s.getAll() as IDBRequest<PhotoRecord[]>);
  }
  private memId = 1;
  async put(rec: Omit<PhotoRecord, "id"> & { id?: number }): Promise<number> {
    if (!this.db) return rec.id ?? this.memId++;
    return Number(await this.req("readwrite", (s) => s.put(rec)));
  }
  async remove(ids: number[]) {
    if (!this.db || !ids.length) return;
    await new Promise<void>((res, rej) => {
      const t = this.db!.transaction(STORE, "readwrite");
      const s = t.objectStore(STORE);
      ids.forEach((id) => s.delete(id));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
}

// ---------- Formatting ----------
export const settingsLine = (m: ShotMeta) =>
  [`${m.focal}mm`, apertureLabel(m.aperture), shutterLabel(m.shutter), isoLabel(m.iso)].join("  ");
export const flashLine = (m: ShotMeta) => (m.flash ? `Flash ${powerLabel(m.flash)}` : "No flash");
export const focusLine = (m: ShotMeta) => (m.focusDist >= 999 ? "Focused at infinity" : `Focused at ${m.focusDist.toFixed(1)} m`);
export const timeLabel = (t: TimeOfDay) => timePreset(t).label;
export const dateLine = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const setupLine = (m: ShotMeta) =>
  `${m.stance}, camera ${m.camHeight.toFixed(1)} m high, ${m.distance.toFixed(1)} m from the car, ${m.view}` +
  (Math.abs(m.pitch) >= 3 ? `, tilted ${m.pitch > 0 ? "up" : "down"} ${Math.round(Math.abs(m.pitch))}°` : "");
export const exposureLine = (m: ShotMeta) => {
  const ev = Math.round(m.meterEV * 10) / 10;
  const meter = Math.abs(ev) < 0.15 ? "metered exposure" : `${ev > 0 ? "+" : ""}${ev.toFixed(1)} EV from the meter`;
  return `${meter}${m.clipped > 0.02 ? `, ${Math.round(m.clipped * 100)}% blown out` : ""}`;
};
const fileName = (m: ShotMeta, framed: boolean) =>
  `andriantam-sim-${String(m.n).padStart(3, "0")}-${m.focal}mm-${m.time}${framed ? "-framed" : ""}.jpg`;

// The settings frame: the photo on a white mat with the exposure printed underneath, like a contact print.
export async function framed(blob: Blob, m: ShotMeta): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const W = img.width, H = img.height;
  const pad = Math.round(W * 0.03), strip = Math.round(H * 0.13);
  const c = document.createElement("canvas");
  c.width = W + pad * 2;
  c.height = H + pad + strip;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fbfaf7";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, pad, pad);
  img.close();
  try {
    await document.fonts.load(`600 ${Math.round(strip * 0.24)}px "Nunito Sans Variable"`);
  } catch {
    /* fall back to the system font */
  }
  const font = `"Avenir Next", Avenir, "Nunito Sans Variable", system-ui, sans-serif`;
  const big = Math.round(strip * 0.24), small = Math.round(strip * 0.16);
  const y1 = H + pad + strip * 0.44, y2 = y1 + big * 1.25;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#16141a";
  ctx.font = `600 ${big}px ${font}`;
  ctx.textAlign = "left";
  ctx.fillText(settingsLine(m).replace(/ {2}/g, "   "), pad, y1);
  ctx.fillStyle = "#6b6670";
  ctx.font = `400 ${small}px ${font}`;
  ctx.fillText(`${flashLine(m)}  ·  ${focusLine(m)}  ·  ${m.lens} lens`, pad, y2);
  ctx.textAlign = "right";
  ctx.fillStyle = "#16141a";
  ctx.font = `600 ${small * 1.1}px ${font}`;
  ctx.fillText(`#${m.n}  ·  ${timeLabel(m.time)}`, pad + W, y1);
  ctx.fillStyle = "#6b6670";
  ctx.font = `400 ${small}px ${font}`;
  ctx.fillText(`Photography Simulator  ·  andriantam.com/play`, pad + W, y2);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.92));
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const ICON = {
  dl: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  del: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

// ---------- Gallery ----------
export class Gallery {
  private root: HTMLElement;
  private store = new Store();
  private items: PhotoRecord[] = []; // newest first
  private urls = new Map<number, string>(); // thumbnail object URLs
  private selected = new Set<number>();
  private lbIndex = -1;
  private lbUrl = "";
  private undo: PhotoRecord[] = [];
  private toastTimer = 0;
  private $ = <T extends HTMLElement = HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
  /** Called before the viewer opens, so the game can release the mouse. */
  onOpen: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async init() {
    await this.store.open();
    this.items = (await this.store.all()).sort((a, b) => b.meta.taken - a.meta.taken);
    if (!this.store.persistent) this.$("[data-g-note]").textContent = "This browser isn't letting the page store photos, so they'll be gone when you leave. Download the ones you want to keep.";
    this.bind();
    this.render();
  }

  latest(): PhotoRecord | undefined {
    return this.items[0];
  }

  nextNumber() {
    return this.items.reduce((m, r) => Math.max(m, r.meta.n), 0) + 1;
  }

  async add(photo: HTMLCanvasElement, meta: ShotMeta, open = true) {
    const blob = await new Promise<Blob>((res) => photo.toBlob((b) => res(b!), "image/jpeg", 0.92));
    const t = document.createElement("canvas");
    // 480 px on the long side.
    const sc = 480 / Math.max(photo.width, photo.height);
    t.width = Math.round(photo.width * sc);
    t.height = Math.round(photo.height * sc);
    const tctx = t.getContext("2d")!;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(photo, 0, 0, t.width, t.height);
    const thumb = await new Promise<Blob>((res) => t.toBlob((b) => res(b!), "image/jpeg", 0.85));
    let id: number;
    try {
      id = await this.store.put({ blob, thumb, meta });
    } catch {
      this.toast("Your browser's storage is full. Download or delete some photos to keep shooting.");
      return;
    }
    this.items.unshift({ id, blob, thumb, meta });
    this.render();
    if (open) this.open(0);
  }

  // ---------- Grid ----------
  private thumbUrl(r: PhotoRecord) {
    let u = this.urls.get(r.id);
    if (!u) this.urls.set(r.id, (u = URL.createObjectURL(r.thumb)));
    return u;
  }

  private render() {
    const grid = this.$("[data-g-grid]");
    const n = this.items.length;
    this.$("[data-g-empty]").hidden = n > 0;
    this.root.classList.toggle("has-photos", n > 0);
    this.$("[data-g-count]").textContent = n ? `${n} photo${n === 1 ? "" : "s"}` : "";
    // Reuse existing cards so images don't reload.
    const existing = new Map([...grid.children].map((li) => [Number((li as HTMLElement).dataset.id), li as HTMLElement]));
    const frag = document.createDocumentFragment();
    for (const r of this.items) {
      let li = existing.get(r.id);
      if (!li) li = this.card(r);
      existing.delete(r.id);
      li.classList.toggle("sel", this.selected.has(r.id));
      li.querySelector<HTMLInputElement>("input")!.checked = this.selected.has(r.id);
      frag.append(li);
    }
    existing.forEach((li, id) => {
      li.remove();
      const u = this.urls.get(id);
      if (u) URL.revokeObjectURL(u), this.urls.delete(id);
    });
    grid.append(frag);
    this.renderSelection();
  }

  private card(r: PhotoRecord) {
    const m = r.meta;
    const li = document.createElement("li");
    li.className = "g-item";
    li.dataset.id = String(r.id);
    li.innerHTML = `
      <figure class="print">
        <button type="button" class="g-open" aria-label="Open photo ${m.n}"><img src="${this.thumbUrl(r)}" alt="Photo ${m.n}: ${settingsLine(m)}, ${timeLabel(m.time).toLowerCase()}" width="${m.w}" height="${m.h}" loading="lazy" decoding="async"></button>
        <figcaption><span class="set">${settingsLine(m).split("  ").map((x) => `<span>${x}</span>`).join("")}</span><span class="sub">#${m.n} · ${timeLabel(m.time)}${m.flash ? ` · Flash ${powerLabel(m.flash)}` : ""}</span></figcaption>
      </figure>
      <label class="g-check"><input type="checkbox" aria-label="Select photo ${m.n}"><span aria-hidden="true"></span></label>
      <div class="g-acts">
        <button type="button" data-act="dl" aria-label="Download photo ${m.n}" title="Download">${ICON.dl}</button>
        <button type="button" data-act="del" aria-label="Delete photo ${m.n}" title="Delete">${ICON.del}</button>
      </div>`;
    return li;
  }

  private renderSelection() {
    const n = this.selected.size, total = this.items.length;
    const all = this.$<HTMLInputElement>("[data-g-all]");
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
    all.disabled = total === 0;
    this.$("[data-g-selcount]").textContent = n ? `${n} selected` : "";
    this.$<HTMLButtonElement>("[data-g-download]").disabled = n === 0;
    this.$<HTMLButtonElement>("[data-g-delete]").disabled = n === 0;
    this.$<HTMLButtonElement>("[data-g-export]").disabled = total === 0;
    this.root.classList.toggle("selecting", n > 0);
  }

  private bind() {
    const grid = this.$("[data-g-grid]");
    grid.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const li = t.closest<HTMLElement>(".g-item");
      if (!li) return;
      const id = Number(li.dataset.id);
      const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
      if (act === "dl") return void this.download([id]);
      if (act === "del") return void this.remove([id]);
      if (t.closest(".g-open")) {
        // While selecting, a tap on a photo toggles it, like a phone's photo app.
        if (this.selected.size) return this.toggle(id);
        return this.open(this.items.findIndex((r) => r.id === id));
      }
    });
    grid.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const li = input.closest<HTMLElement>(".g-item");
      if (li) this.toggle(Number(li.dataset.id), input.checked);
    });
    this.$<HTMLInputElement>("[data-g-all]").addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.selected = new Set(on ? this.items.map((r) => r.id) : []);
      this.render();
    });
    this.$("[data-g-download]").addEventListener("click", () => this.download([...this.selected]));
    this.$("[data-g-delete]").addEventListener("click", () => this.remove([...this.selected]));
    this.$("[data-g-export]").addEventListener("click", () => this.openExport());
    this.$("[data-toast-undo]").addEventListener("click", () => this.restore());
    this.bindViewer();
    this.bindExport();
  }

  private toggle(id: number, on = !this.selected.has(id)) {
    if (on) this.selected.add(id);
    else this.selected.delete(id);
    this.render();
  }

  private frameOn() {
    return this.$<HTMLInputElement>("[data-g-frame]").checked;
  }

  async download(ids: number[]) {
    const framedOn = this.frameOn();
    const recs = this.items.filter((r) => ids.includes(r.id)).sort((a, b) => a.meta.n - b.meta.n);
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      save(framedOn ? await framed(r.blob, r.meta) : r.blob, fileName(r.meta, framedOn));
      if (i < recs.length - 1) await new Promise((res) => setTimeout(res, 350)); // browsers drop rapid-fire downloads
    }
    if (recs.length > 1) this.toast(`Downloading ${recs.length} photos. Your browser may ask to allow multiple downloads.`);
  }

  async remove(ids: number[]) {
    if (!ids.length) return;
    if (ids.length > 1 && !confirm(`Delete ${ids.length} photos? You can undo straight after.`)) return;
    const gone = this.items.filter((r) => ids.includes(r.id));
    await this.store.remove(ids);
    this.items = this.items.filter((r) => !ids.includes(r.id));
    ids.forEach((id) => this.selected.delete(id));
    this.undo = gone;
    this.render();
    this.toast(gone.length === 1 ? `Photo ${gone[0].meta.n} deleted.` : `${gone.length} photos deleted.`, true);
  }

  private async restore() {
    const back = this.undo;
    this.undo = [];
    this.hideToast();
    for (const r of back) await this.store.put(r);
    this.items = [...this.items, ...back].sort((a, b) => b.meta.taken - a.meta.taken);
    this.render();
    if ((this.$("[data-lb]") as HTMLDialogElement).open && back.length === 1) this.show(this.items.findIndex((r) => r.id === back[0].id));
  }

  private toast(msg: string, canUndo = false) {
    const t = this.$("[data-toast]");
    this.$("[data-toast-msg]").textContent = msg;
    this.$("[data-toast-undo]").hidden = !canUndo;
    t.hidden = false;
    // Show it inside the viewer when that's open (a modal dialog sits above the page).
    const lb = this.$<HTMLDialogElement>("[data-lb]");
    (lb.open ? lb : this.root).append(t);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.hideToast(), canUndo ? 7000 : 5000);
  }
  private hideToast() {
    this.$("[data-toast]").hidden = true;
  }

  // ---------- Viewer ----------
  open(index: number) {
    if (index < 0) return;
    this.onOpen();
    const lb = this.$<HTMLDialogElement>("[data-lb]");
    if (!lb.open) lb.showModal();
    this.show(index);
  }

  private show(index: number) {
    const lb = this.$<HTMLDialogElement>("[data-lb]");
    if (!this.items.length) return lb.close();
    this.lbIndex = Math.max(0, Math.min(this.items.length - 1, index));
    const r = this.items[this.lbIndex];
    const m = r.meta;
    if (this.lbUrl) URL.revokeObjectURL(this.lbUrl);
    this.lbUrl = URL.createObjectURL(r.blob);
    const img = this.$<HTMLImageElement>("[data-lb-img]");
    img.src = this.lbUrl;
    img.alt = `Photo ${m.n}: ${settingsLine(m)}`;
    this.$("[data-lb-count]").textContent = `${this.lbIndex + 1} / ${this.items.length}`;
    this.$("[data-lb-cap]").innerHTML = `<span class="set">${settingsLine(m).split("  ").map((x) => `<span>${x}</span>`).join("")}</span><span class="sub">#${m.n} · ${timeLabel(m.time)} · ${flashLine(m)} · ${focusLine(m)}</span>`;
    this.$("[data-lb-meta]").innerHTML = `
      <dt>Lens</dt><dd>${m.lens}</dd>
      <dt>Exposure</dt><dd>${exposureLine(m)}</dd>
      <dt>Light</dt><dd>${timePreset(m.time).blurb} (EV ${m.sceneEV})${m.headlights ? ", car lights on" : ""}</dd>
      <dt>Setup</dt><dd>${setupLine(m)}${m.h > m.w ? ", portrait frame" : ""}${m.roll ? `, camera tilted ${Math.abs(m.roll)}° ${m.roll > 0 ? "right" : "left"}` : ""}</dd>
      <dt>Taken</dt><dd>${dateLine(m.taken)}</dd>`;
    this.$("[data-lb-clip]").textContent = m.clipped > 0.02 ? `${Math.round(m.clipped * 100)}% of the frame is blown out.` : "";
    const hc = this.$<HTMLCanvasElement>("[data-lb-hist]");
    const ctx = hc.getContext("2d")!;
    ctx.clearRect(0, 0, hc.width, hc.height);
    const max = Math.max(...m.bins.slice(1, 63), 1);
    ctx.fillStyle = "rgba(236,230,220,0.85)";
    m.bins.forEach((b, i) => {
      const h = Math.min(1, b / max) * hc.height;
      ctx.fillRect((i / 64) * hc.width, hc.height - h, hc.width / 64 - 1, h);
    });
    this.$<HTMLButtonElement>("[data-lb-prev]").disabled = this.lbIndex === 0;
    this.$<HTMLButtonElement>("[data-lb-next]").disabled = this.lbIndex === this.items.length - 1;
  }

  private bindViewer() {
    const lb = this.$<HTMLDialogElement>("[data-lb]");
    const cur = () => this.items[this.lbIndex];
    this.$("[data-lb-prev]").addEventListener("click", () => this.show(this.lbIndex - 1));
    this.$("[data-lb-next]").addEventListener("click", () => this.show(this.lbIndex + 1));
    this.$("[data-lb-close]").addEventListener("click", () => lb.close());
    this.$("[data-lb-dl]").addEventListener("click", () => cur() && this.download([cur().id]));
    this.$("[data-lb-del]").addEventListener("click", async () => {
      const r = cur();
      if (!r) return;
      const i = this.lbIndex;
      await this.remove([r.id]);
      if (!this.items.length) lb.close();
      else this.show(Math.min(i, this.items.length - 1));
    });
    const info = this.$("[data-lb-info]");
    info.addEventListener("click", () => {
      const on = !lb.classList.contains("show-info");
      lb.classList.toggle("show-info", on);
      info.setAttribute("aria-pressed", String(on));
    });
    const fs = this.$<HTMLButtonElement>("[data-lb-fs]");
    if (!document.fullscreenEnabled) fs.hidden = true;
    fs.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else lb.requestFullscreen?.().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => fs.setAttribute("aria-pressed", String(!!document.fullscreenElement)));
    lb.addEventListener("close", () => {
      if (document.fullscreenElement === lb) document.exitFullscreen();
      if (this.lbUrl) URL.revokeObjectURL(this.lbUrl), (this.lbUrl = "");
      this.$<HTMLImageElement>("[data-lb-img]").removeAttribute("src");
      this.hideToast();
      this.root.append(this.$("[data-toast]"));
    });
    lb.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") (e.preventDefault(), this.show(this.lbIndex - 1));
      else if (e.key === "ArrowRight") (e.preventDefault(), this.show(this.lbIndex + 1));
      else if (e.key === "Delete" || e.key === "Backspace") (e.preventDefault(), this.$("[data-lb-del]").click());
      else if (e.key === "i") info.click();
    });
    // Swipe between photos.
    const stage = this.$("[data-lb-stage]");
    let sx = 0, sy = 0, sid = -1;
    stage.addEventListener("pointerdown", (e) => ((sx = e.clientX), (sy = e.clientY), (sid = e.pointerId)));
    stage.addEventListener("pointerup", (e) => {
      if (e.pointerId !== sid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.show(this.lbIndex + (dx < 0 ? 1 : -1));
      sid = -1;
    });
  }

  // ---------- Shoot guide export ----------
  private openExport() {
    const d = this.$<HTMLDialogElement>("[data-ex]");
    const sel = this.selected.size;
    const opt = this.$<HTMLInputElement>("[data-ex-scope=selected]");
    opt.disabled = sel === 0;
    this.$("[data-ex-selcount]").textContent = String(sel);
    this.$("[data-ex-allcount]").textContent = String(this.items.length);
    (sel ? opt : this.$<HTMLInputElement>("[data-ex-scope=all]")).checked = true;
    this.$("[data-ex-status]").textContent = "";
    try {
      const saved = JSON.parse(localStorage.getItem("sim-guide") ?? "{}");
      const f = this.$<HTMLFormElement>("[data-ex-form]");
      for (const k of ["event", "description", "notes"] as const) if (saved[k] && !(f.elements.namedItem(k) as HTMLInputElement).value) (f.elements.namedItem(k) as HTMLInputElement).value = saved[k];
    } catch {
      /* no saved draft */
    }
    this.onOpen();
    d.showModal();
  }

  private bindExport() {
    const d = this.$<HTMLDialogElement>("[data-ex]");
    const f = this.$<HTMLFormElement>("[data-ex-form]");
    const status = this.$("[data-ex-status]");
    const submit = this.$<HTMLButtonElement>("[data-ex-go]");
    this.$("[data-ex-cancel]").addEventListener("click", () => d.close());
    const val = (k: string) => ((f.elements.namedItem(k) as HTMLInputElement).value ?? "").trim();
    f.addEventListener("input", () => {
      try {
        localStorage.setItem("sim-guide", JSON.stringify({ event: val("event"), description: val("description"), notes: val("notes") }));
      } catch {
        /* storage blocked */
      }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const scope = (f.elements.namedItem("scope") as RadioNodeList).value;
      const photos = (scope === "selected" ? this.items.filter((r) => this.selected.has(r.id)) : this.items).slice().sort((a, b) => a.meta.n - b.meta.n);
      if (!photos.length) return;
      submit.disabled = true;
      status.textContent = "Building the PDF…";
      try {
        const { exportShootGuide } = await import("./pdf");
        await exportShootGuide({ event: val("event"), description: val("description"), notes: val("notes"), photos }, (p) => (status.textContent = `Building the PDF… ${Math.round(p * 100)}%`));
        status.textContent = "Done. Check your downloads.";
        setTimeout(() => d.close(), 900);
      } catch (err) {
        console.error(err);
        status.textContent = "Sorry, the PDF couldn't be built. Try fewer photos.";
      } finally {
        submit.disabled = false;
      }
    });
  }
}
