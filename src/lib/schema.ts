// schema.org structured data. This is what search engines and AI answer engines read
// to understand who you are and what each page is.
import { SITE } from "../config/site";
import { RESUME } from "../data/resume";

const abs = (path: string) => new URL(path, SITE.url).toString();

// Where people can license a photo. Feeds the image "Licensable" fields Google reads (license, acquireLicensePage).
export const LICENSE_URL = abs("/licensing");

export const PERSON_ID = abs("/#person");
export const WEBSITE_ID = abs("/#website");

export function personSchema(full = false) {
  const base: Record<string, unknown> = {
    "@type": "Person",
    "@id": PERSON_ID,
    name: SITE.person,
    alternateName: SITE.name,
    url: SITE.url,
    image: abs("/og/andrian-tam.jpg"),
    jobTitle: ["Head of Brand", "Software engineer", "Photographer"],
    email: `mailto:${SITE.email}`,
    address: {
      "@type": "PostalAddress",
      addressLocality: SITE.location.city,
      addressCountry: SITE.location.countryCode,
    },
    sameAs: [
      SITE.social.instagram,
      SITE.social.instagramToge,
      SITE.social.youtube,
      SITE.social.linkedin,
      SITE.social.flickr,
      SITE.social.twitch,
    ],
    knowsAbout: [
      "Brand building",
      "Software engineering",
      "Web development",
      "UI/UX",
      "Digital marketing",
      "Customer data platforms",
      "Financial services technology",
      "Automotive photography",
      "Motorsport photography",
      "Event photography",
      "Film photography",
      "Videography",
    ],
  };
  if (!full) return base;
  return {
    ...base,
    description: RESUME.summary,
    worksFor: [
      { "@type": "Organization", name: "TROOPERS Singapore" },
      { "@type": "Organization", name: SITE.business.name },
    ],
    alumniOf: [
      ...RESUME.education.map((e) => ({ "@type": "EducationalOrganization", name: e.school })),
      // Unnamed employers ("A cabinetry company") are left out.
      ...RESUME.experience.filter((e) => e.end && !/^A /.test(e.org)).map((e) => ({ "@type": "Organization", name: e.org })),
    ],
    hasCredential: RESUME.awards
      .filter((a) => a.credential)
      .map((a) => ({ "@type": "EducationalOccupationalCredential", name: a.title, dateCreated: a.year })),
    award: RESUME.awards.filter((a) => !a.credential).map((a) => `${a.title}, ${a.detail} (${a.year})`),
  };
}

export function websiteSchema() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE.url,
    name: SITE.name,
    inLanguage: "en",
    publisher: { "@id": PERSON_ID },
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) })),
  };
}

export function faqSchema(faq: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function graph(...nodes: unknown[]) {
  return { "@context": "https://schema.org", "@graph": nodes.filter(Boolean) };
}

export { abs };
