// Build-time data with a backup.
// Every successful fetch is saved to src/data/snapshots/<name>.json and committed with the site.
// If Blogger or Flickr is down (or a key is missing), the build falls back to the last snapshot.
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve("src/data/snapshots");
const memo = new Map<string, Promise<unknown>>();

export function env(name: string): string | undefined {
  return (import.meta.env?.[name] as string | undefined) || process.env[name];
}

export function withSnapshot<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  if (!memo.has(name)) memo.set(name, load(name, fetcher));
  return memo.get(name) as Promise<T>;
}

async function load<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  const file = path.join(DIR, `${name}.json`);
  if (process.env.OFFLINE !== "1") {
    try {
      const data = await fetcher();
      // A fetch that "succeeds" with nothing (wrong key, wrong id, API hiccup) must never wipe out the content
      // the site already has: keep the committed snapshot instead of publishing an empty site.
      if (Array.isArray(data) && data.length === 0 && fs.existsSync(file)) {
        console.warn(`[data] ${name}: live fetch returned 0 items, keeping the committed snapshot.`);
        return JSON.parse(fs.readFileSync(file, "utf8")) as T;
      }
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 1));
      return data;
    } catch (err) {
      console.warn(`[data] ${name}: live fetch failed, using snapshot. ${(err as Error).message}`);
    }
  }
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  console.warn(`[data] ${name}: no snapshot available, continuing with empty data.`);
  return [] as unknown as T;
}

export async function getJson<T = any>(url: string, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "andriantam.com build" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function uniqueSlugs<T>(items: T[], base: (item: T) => string): Map<T, string> {
  const seen = new Map<string, number>();
  const out = new Map<T, string>();
  for (const item of items) {
    let slug = base(item) || "untitled";
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n + 1}`;
    out.set(item, slug);
  }
  return out;
}
