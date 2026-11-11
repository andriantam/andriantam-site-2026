// llms.txt: a plain-language summary of the site for AI assistants and answer engines.
import type { APIRoute } from "astro";
import { SITE } from "../config/site";
import { SERVICES, FAQ } from "../data/content";
import { RESUME } from "../data/resume";
import { getArticles } from "../lib/blogger";
import { getAlbums, CATEGORY_LABELS } from "../lib/flickr";

export const GET: APIRoute = async () => {
  const [articles, albums] = await Promise.all([getArticles(), getAlbums()]);
  const u = (p: string) => `${SITE.url}${p}`;
  const body = `# ${SITE.name}

> ${SITE.description}

${SITE.name} (${SITE.person}) is based in ${SITE.location.city}. Contact: ${SITE.email}.

"${SITE.tagline}"

${SITE.availability}

## Photography and video work

${SERVICES.filter((s) => s.title !== "Tech consulting").map((s) => `- **${s.title}**: ${s.body}`).join("\n")}

## Background

${RESUME.summary}

${RESUME.experience.map((e) => `- ${e.title}, ${e.org} (${e.period})`).join("\n")}

## Frequently asked

${FAQ.map((f) => `### ${f.q}\n${f.a}`).join("\n\n")}

## Key pages

- [Home](${u("/")}): his story as a night drive up a mountain pass, from a first camera to software engineering, McKinsey, his own brand and Head of Brand, ending at the atlas
- [Atlas](${u("/atlas")}): every skill, role, project and place, and how they connect
- [Portfolio](${u("/portfolio")}): client work, clients and testimonials; ${albums.length} photo albums plus videography
- [Gallery](${u("/gallery")}): personal photography, with no clients or briefs
- [Videography](${u("/portfolio/videography")})
- [Resume](${u("/resume")})
- [Articles](${u("/articles")})
- [Photography Simulator](${u("/play")}): a free 3D photography simulator game in the browser with seven lenses and physically based exposure, depth of field and motion blur

## Portfolio albums

${albums.map((a) => `- [${a.title}](${u(`/portfolio/${a.slug}`)}): ${a.categories.map((c) => CATEGORY_LABELS[c] ?? c).join(", ")}, ${a.count} photos`).join("\n")}

## Articles

${articles.map((a) => `- [${a.title}](${u(`/articles/${a.slug}`)}): ${a.excerpt}`).join("\n")}
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
