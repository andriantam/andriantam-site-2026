// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import fs from "node:fs";
import path from "node:path";

const SITE = "https://andriantam.com";

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

        // Hosts without _redirects support (DigitalOcean App Platform): write a small redirect page at each
        // exact old URL, and teach the 404 page the wildcard rules.
        const root = decodeURIComponent(dir.pathname);
        const rules = lines.filter((l) => l.startsWith("/")).map((l) => l.split(" "));
        let stubs = 0;
        for (const [from, to] of rules) {
          if (from.includes("*")) continue;
          const file = path.join(root, from, "index.html");
          if (fs.existsSync(file)) continue;
          const url = new URL(to, SITE).toString();
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(
            file,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title>` +
              `<link rel="canonical" href="${url}"><meta name="robots" content="noindex">` +
              `<meta http-equiv="refresh" content="0; url=${to}"><script>location.replace(${JSON.stringify(to)})</script>` +
              `</head><body><a href="${to}">This page has moved.</a></body></html>`,
          );
          stubs++;
        }
        const wild = rules
          .filter(([from]) => from.endsWith("/*"))
          .map(([from, to]) => [from.slice(0, -1), to.replace(":splat", "")]);
        const notFound = path.join(root, "404.html");
        if (fs.existsSync(notFound)) {
          const script =
            `<script>(function(){var p=location.pathname,w=${JSON.stringify(wild)};` +
            `for(var i=0;i<w.length;i++){var f=w[i][0],t=w[i][1];if(p.indexOf(f)===0&&p.length>f.length){` +
            `location.replace(t.charAt(t.length-1)==="/"?t+p.slice(f.length):t);return}}})()</script>`;
          fs.writeFileSync(notFound, fs.readFileSync(notFound, "utf8").replace("</head>", script + "</head>"));
        }
        logger.info(`wrote ${stubs} redirect pages`);
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  trailingSlash: "never",
  // Folder-style output (play/index.html) so /play works on any static host, not only Cloudflare Pages.
  build: { format: "directory" },
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
