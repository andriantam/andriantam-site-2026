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

${SITE.name} no longer takes photography commissions. Photography is a personal passion again; he is happy to meet for a coffee to talk photography or share his experience.

## Photography he used to offer

${SERVICES.filter((s) => s.title !== "Tech consulting").map((s) => `- **${s.title}**: ${s.body}`).join("\n")}

## Background

${RESUME.summary}

${RESUME.experience.map((e) => `- ${e.title}, ${e.org} (${e.period})`).join("\n")}

## Frequently asked

${FAQ.map((f) => `### ${f.q}\n${f.a}`).join("\n\n")}

## Key pages

- [Home](${u("/")}): his story, from photography in school to software engineering, McKinsey, his own businesses and Head of Brand, plus contact
- [Photography](${u("/photography")}): what he shot, selected work, clients and testimonials
- [Portfolio](${u("/portfolio")}): ${albums.length} photo albums plus videography
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
