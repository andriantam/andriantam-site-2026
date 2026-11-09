// Portfolio projects that don't come from Flickr: web and software work.
// They are hidden until FLAGS.showDevProjects is true in src/config/site.ts.
// Hidden projects get no pages, no links and no sitemap entries.
export type ProjectType = "web" | "software";

export interface DevProject {
  slug: string;
  type: ProjectType;
  title: string;
  client?: string;
  year: string;
  summary: string; // one answer-first sentence: what it is and what it achieved
  stack: string[];
  url?: string;
  repo?: string;
  image?: string; // path under /public, e.g. /projects/foo.webp
  body?: string; // optional longer write-up (HTML)
}

export const DEV_PROJECTS: DevProject[] = [
  // Example. Replace with real projects, then switch FLAGS.showDevProjects on.
  {
    slug: "andriantam-com",
    type: "web",
    title: "andriantam.com",
    year: "2026",
    summary:
      "This site: a static Astro build that pulls articles from Blogger and photos from Flickr at build time, with a scroll-scrubbed video hero and a three.js photographer simulator.",
    stack: ["Astro", "TypeScript", "three.js", "WebGL", "Cloudflare Pages"],
  },
];
