// Portfolio photos come from Flickr, fetched once at build time.
// Album categories are read from the album description, comma-separated (e.g. "events,automotive"),
// the same convention the old site used.
import { env, getJson, slugify, uniqueSlugs, withSnapshot } from "./snapshot";

export interface FlickrPhoto {
  id: string;
  title: string;
  width: number;
  height: number;
  taken: string | null;
  base: string; // https://live.staticflickr.com/{server}/{id}_{secret}
  pageUrl: string;
}

export interface Album {
  id: string;
  slug: string;
  title: string;
  categories: string[];
  count: number;
  updated: number;
  taken: string | null;
  cover: FlickrPhoto | null;
  photos: FlickrPhoto[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  automotive: "Automotive and motorsport",
  events: "Events",
  corporate: "Corporate",
  couple: "Weddings and couples",
  products: "Products",
  food: "Food and beverage",
  personal: "Personal",
  travel: "Travel",
};

// Flickr size suffixes. Free accounts expose up to 1024px through the API.
export const SIZES = [
  { suffix: "w", width: 400 },
  { suffix: "z", width: 640 },
  { suffix: "c", width: 800 },
  { suffix: "b", width: 1024 },
] as const;

export function photoUrl(p: FlickrPhoto, width = 1024): string {
  const size = SIZES.find((s) => s.width >= width) ?? SIZES[SIZES.length - 1];
  return `${p.base}_${size.suffix}.jpg`;
}

export function photoSrcset(p: FlickrPhoto): string {
  const longest = Math.max(p.width, p.height) || 1024;
  return SIZES.map((s) => `${p.base}_${s.suffix}.jpg ${Math.round((p.width / longest) * s.width) || s.width}w`).join(", ");
}

const API = "https://www.flickr.com/services/rest/";

function call(method: string, params: Record<string, string>) {
  const key = env("FLICKR_API_KEY");
  if (!key) throw new Error("FLICKR_API_KEY is not set");
  const url = new URL(API);
  url.search = new URLSearchParams({ method, api_key: key, format: "json", nojsoncallback: "1", ...params }).toString();
  return getJson<any>(url.toString()).then((d) => {
    if (d.stat !== "ok") throw new Error(`Flickr ${method}: ${d.message}`);
    return d;
  });
}

function toPhoto(raw: any, owner: string): FlickrPhoto {
  return {
    id: raw.id,
    title: (raw.title ?? "").trim(),
    width: Number(raw.width_l) || 1024,
    height: Number(raw.height_l) || 683,
    taken: raw.datetaken ?? null,
    base: `https://live.staticflickr.com/${raw.server}/${raw.id}_${raw.secret}`,
    pageUrl: `https://www.flickr.com/photos/${owner}/${raw.id}/`,
  };
}

function inferCategories(title: string, description: string): string[] {
  const tags = description
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t !== "public" && t !== "video");
  if (tags.length) return tags;
  const t = title.toLowerCase();
  if (/travel|trip|tour/.test(t)) return ["travel"];
  if (/award|car|motor|auto|track|drive/.test(t)) return ["automotive", "events"];
  return ["events"];
}

async function fetchAlbums(): Promise<Album[]> {
  const user = env("FLICKR_USER_ID");
  if (!user) throw new Error("FLICKR_USER_ID is not set");
  const list = await call("flickr.photosets.getList", { user_id: user, per_page: "500" });
  const sets: any[] = list.photosets.photoset;
  const slugs = uniqueSlugs(sets, (s) => slugify(s.title._content));

  const albums: Album[] = [];
  // A few albums at a time to stay polite with the API.
  for (let i = 0; i < sets.length; i += 6) {
    const batch = await Promise.all(
      sets.slice(i, i + 6).map(async (s) => {
        const photos: FlickrPhoto[] = [];
        let page = 1;
        let pages = 1;
        do {
          const d = await call("flickr.photosets.getPhotos", {
            photoset_id: s.id,
            user_id: user,
            extras: "url_l,date_taken",
            per_page: "500",
            page: String(page),
          });
          photos.push(...d.photoset.photo.map((p: any) => toPhoto(p, user)));
          pages = d.photoset.pages;
          page++;
        } while (page <= pages);
        const primary = photos.find((p) => p.id === s.primary) ?? photos[0] ?? null;
        const taken = photos.map((p) => p.taken).filter(Boolean).sort()[0] ?? null;
        return {
          id: s.id,
          slug: slugs.get(s) as string,
          title: s.title._content.trim(),
          categories: inferCategories(s.title._content, s.description._content),
          count: photos.length,
          updated: Number(s.date_update) || 0,
          taken,
          cover: primary,
          photos,
        } satisfies Album;
      }),
    );
    albums.push(...batch);
  }
  return albums;
}

export function getAlbums(): Promise<Album[]> {
  return withSnapshot("albums", fetchAlbums);
}
