import type { APIRoute } from "astro";
import { SITE } from "../config/site";
import { getArticles } from "../lib/blogger";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = async () => {
  const articles = await getArticles();
  const items = articles
    .map(
      (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE.url}/articles/${a.slug}</link>
      <guid isPermaLink="true">${SITE.url}/articles/${a.slug}</guid>
      <pubDate>${new Date(a.published).toUTCString()}</pubDate>
      <description>${esc(a.excerpt)}</description>
    </item>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Articles by ${esc(SITE.name)}</title>
    <link>${SITE.url}/articles</link>
    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Guides and notes on photography, cars, driving and tech.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
};
