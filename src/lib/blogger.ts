// Articles come from Blogger, fetched once at build time (the API key never reaches the browser).
import { env, getJson, slugify, uniqueSlugs, withSnapshot } from "./snapshot";
import hidden from "../data/hidden-articles.json";

export interface Article {
  id: string;
  slug: string;
  title: string;
  published: string;
  updated: string;
  bloggerUrl: string;
  labels: string[];
  image: string | null;
  excerpt: string;
  html: string;
  wordCount: number;
}

interface BloggerPost {
  id: string;
  title: string;
  published: string;
  updated: string;
  url: string;
  labels?: string[];
  images?: { url: string }[];
  content?: string;
}

async function fetchAll(): Promise<Article[]> {
  const key = env("BLOGGER_API_KEY");
  const blogId = env("BLOGGER_BLOG_ID");
  if (!key || !blogId) throw new Error("BLOGGER_API_KEY or BLOGGER_BLOG_ID is not set");

  const posts: BloggerPost[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts`);
    url.searchParams.set("key", key);
    url.searchParams.set("fetchImages", "true");
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("status", "live");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await getJson<{ items?: BloggerPost[]; nextPageToken?: string }>(url.toString());
    posts.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  const slugs = uniqueSlugs(posts, (p) => slugify(p.title));
  return posts.map((p) => {
    const html = cleanHtml(p.content ?? "");
    const text = toText(html);
    return {
      id: p.id,
      slug: slugs.get(p) as string,
      title: p.title.trim(),
      published: p.published,
      updated: p.updated,
      bloggerUrl: p.url,
      labels: p.labels ?? [],
      image: p.images?.[0]?.url ? sizedBloggerImage(p.images[0].url, 1600) : firstImage(html),
      excerpt: excerpt(text),
      html,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  });
}

export function getArticles(): Promise<Article[]> {
  return withSnapshot("articles", fetchAll).then((list) =>
    list
      .filter((a) => !HIDDEN.has(a.title.trim()))
      .map((a) => ({ ...a, title: scrub(a.title), excerpt: scrub(a.excerpt), html: scrub(a.html) }))
      .sort((a, b) => +new Date(b.published) - +new Date(a.published)),
  );
}

// Posts kept off the site, and names that shouldn't appear on it.
const HIDDEN = new Set<string>(hidden.titles);
function scrub(s: string): string {
  return s
    .replace(/Hope this helps and check out <a[^>]*>ZBOM Malaysia<\/a> where we bring your interior design concepts to life!/gi, "Hope this helps!")
    .replace(/<i>ZBOM Andrian<\/i>/gi, "<i>Andrian</i>")
    .replace(/<a[^>]*>\s*ZBOM[^<]*<\/a>/gi, "a cabinetry company")
    .replace(/ZBOM( Malaysia| Manufacturing)?/gi, "a cabinetry company");
}

// Blogger image URLs carry their size in the path (s1600, s16000, w640-h480).
export function sizedBloggerImage(url: string, width: number): string {
  if (!url.includes("googleusercontent.com") && !url.includes("bp.blogspot.com")) return url;
  if (/\/[swh]\d+[^/]*\//.test(url)) return url.replace(/\/[swh]\d+[^/]*\//, `/w${width}/`);
  if (/=s\d+.*$/.test(url)) return url.replace(/=s\d+.*$/, `=w${width}`);
  return url;
}

function firstImage(html: string): string | null {
  const m = html.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}

function toText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(text: string, max = 160): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,.;:]$/, "") + "…";
}

// Blogger's editor produces messy HTML. Strip scripts, inline styles and layout junk,
// make images responsive and lazy, and keep external links safe.
function cleanHtml(html: string): string {
  let out = html
    .replace(/<(script|style|iframe(?![^>]*youtube))[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|link|meta)[^>]*>/gi, "")
    .replace(/\s(style|class|id|border|align|width|height|data-original-[a-z]+|imageanchor)="[^"]*"/gi, "")
    .replace(/\son[a-z]+="[^"]*"/gi, "")
    .replace(/<span>([\s\S]*?)<\/span>/gi, "$1")
    .replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "")
    .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");

  // Images: resize, lazy-load, keep alt text.
  out = out.replace(/<img([^>]*)>/gi, (_m, attrs: string) => {
    const src = attrs.match(/src="([^"]+)"/i)?.[1] ?? "";
    const alt = attrs.match(/alt="([^"]*)"/i)?.[1] ?? "";
    const w = sizedBloggerImage(src, 1200);
    const w2 = sizedBloggerImage(src, 2000);
    const srcset = w !== src ? ` srcset="${sizedBloggerImage(src, 720)} 720w, ${w} 1200w, ${w2} 2000w" sizes="(min-width: 860px) 760px, 100vw"` : "";
    return `<img src="${w}"${srcset} alt="${alt}" loading="lazy" decoding="async">`;
  });

  // Unwrap Blogger's <a href="big.jpg"><img></a> wrappers around images.
  out = out.replace(/<a[^>]+href="[^"]+\.(?:jpe?g|png|webp|gif)[^"]*"[^>]*>\s*(<img[^>]+>)\s*<\/a>/gi, "$1");

  // External links open in a new tab safely.
  out = out.replace(/<a([^>]*href="https?:\/\/(?!(?:www\.)?andriantam\.com)[^"]+"[^>]*)>/gi, (m, attrs: string) =>
    /target=/.test(attrs) ? m : `<a${attrs} target="_blank" rel="noopener">`,
  );

  // Instagram embeds become a plain link (the embed script is heavy and blocks rendering).
  out = out.replace(
    /<blockquote[^>]*instagram-media[^>]*data-instgrm-permalink="([^"]+)"[\s\S]*?<\/blockquote>/gi,
    (_m, url: string) => `<p><a class="ig-link" href="${url.split("?")[0]}" target="_blank" rel="noopener">View this post on Instagram</a></p>`,
  );

  return out.trim();
}
