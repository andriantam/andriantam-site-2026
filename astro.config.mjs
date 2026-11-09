// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import fs from "node:fs";
import path from "node:path";

const SITE = "https://www.andriantam.com";

// Writes Cloudflare Pages' _redirects file after the build, so every old URL
// (/article/<blogger id>, /portfolio/<flickr album id>, /web-development, /project/...)
// 301s to its new home and keeps its Google ranking.
/** @returns {import("astro").AstroIntegration} */
function legacyRedirects() {
  return {
    name: "legacy-redirects",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        /** @param {string} name */
        const read = (name) => {
          const f = path.resolve("src/data/snapshots", `${name}.json`);
          return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
        };
        const lines = [
          "# Generated at build time by astro.config.mjs",
          "/article /articles 301",
          "/web-development /portfolio 301",
          "/project/* /portfolio 301",
          "/journal/* /articles/:splat 301",
        ];
        const hidden = new Set(JSON.parse(fs.readFileSync(path.resolve("src/data/hidden-articles.json"), "utf8")).titles);
        for (const a of read("articles")) {
          if (hidden.has(a.title.trim())) lines.push(`/article/${a.id} /articles 301`, `/articles/${a.slug} /articles 301`);
          else lines.push(`/article/${a.id} /articles/${a.slug} 301`);
        }
        for (const a of read("albums")) lines.push(`/portfolio/${a.id} /portfolio/${a.slug} 301`);
        lines.push("/article/* /articles 301");
        const out = new URL("_redirects", dir);
        fs.writeFileSync(out, lines.join("\n") + "\n");
        logger.info(`wrote ${lines.length - 1} redirects`);
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/404"),
      changefreq: "weekly",
    }),
    legacyRedirects(),
  ],
  image: {
    responsiveStyles: false,
  },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
});
