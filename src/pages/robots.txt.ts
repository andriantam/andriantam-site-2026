import type { APIRoute } from "astro";
import { SITE } from "../config/site";

// Search engines and AI answer engines are all welcome: being cited is the point.
// To opt out of AI training only, add e.g. "User-agent: GPTBot\nDisallow: /" below.
export const GET: APIRoute = () =>
  new Response(
    `User-agent: *
Allow: /

Sitemap: ${SITE.url}/sitemap-index.xml
`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
