// The atlas: everything I do, as a tree around one person.
// Top level: four disciplines (Software engineering, Brand building, Photography, Passion) and two early stops
// (Samsung, UNIMAS). Under a discipline sit the places I did it, and under each place what I did there.
// `parent` builds the tree; `links` adds a line that crosses it. One source for the sky on the home page,
// the /atlas pages and their links.
import { SITE } from "../config/site";

export type ClusterId = "lens" | "code" | "brand" | "road" | "start";
export type NodeKind = "discipline" | "role" | "project" | "skill" | "award" | "study";

export interface Cluster {
  id: ClusterId;
  label: string;
  line: string; // one sentence on what this part of the sky is
  color: string;
}

export const CLUSTERS: Cluster[] = [
  { id: "code", label: "Software engineering", line: "A decade of building software, from campaign sites to bank apps.", color: "#7fb2ff" },
  { id: "brand", label: "Brand building", line: "Turning what gets made into something people find, trust and choose.", color: "#f08a7c" },
  { id: "lens", label: "Photography", line: "Fifteen years behind the camera, from track days to gala dinners.", color: "#e8a25a" },
  { id: "road", label: "Passion", line: "The urge to make things, which ties the rest together.", color: "#8fe0c2" },
  { id: "start", label: "Beginnings", line: "Where it started: a degree in how people think, and a first taste of a big company.", color: "#cbbfae" },
];

export interface GraphNode {
  id: string;
  label: string;
  parent?: string; // the node this one hangs from; none for the top level, which hangs from me
  cluster: ClusterId;
  kind: NodeKind;
  hub?: boolean; // one of the four disciplines
  when?: string;
  blurb: string;
  tags?: string[]; // tools and skills, shown on the card rather than as stars
  links?: string[]; // lines that cross the tree
  href?: string;
  hrefLabel?: string;
}

export const KIND_LABELS: Record<NodeKind, string> = {
  discipline: "Discipline",
  role: "Role",
  project: "Project",
  skill: "Work",
  award: "Award",
  study: "Study",
};

export const NODES: GraphNode[] = [
  // ── Software engineering ────────────────────────────────────────────────
  {
    id: "engineering",
    label: "Software engineering",
    cluster: "code",
    kind: "discipline",
    hub: true,
    when: "Since 2015",
    blurb:
      "Nearly ten years of building for clients across Asia, Europe and Australia. I like the part where it becomes real: an interface people touch, a system a team relies on.",
    tags: ["JavaScript", "TypeScript", "Python", "C#/.NET", "PHP", "SQL"],
    href: "/resume",
    hrefLabel: "Read the resume",
  },
  {
    id: "dekatku",
    label: "Dekatku",
    parent: "engineering",
    cluster: "code",
    kind: "role",
    when: "2015 to 2016",
    blurb: "My first developer job: UI/UX and logo design for client websites, and a responsive website for the company's subsidiary.",
    tags: ["UI/UX", "Logo design", "Bootstrap"],
  },
  {
    id: "isobar",
    label: "Isobar",
    parent: "engineering",
    cluster: "code",
    kind: "role",
    when: "2016 to 2017",
    blurb:
      "Full-stack web developer at Isobar, part of Dentsu Aegis Network. Interactive campaign sites for brands, Laravel brought in on new builds, and a small photo and video studio set up in the office.",
    tags: ["Laravel", "PHP", "JavaScript", "SQL", "AWS S3"],
  },
  {
    id: "effie",
    label: "Goodbye, Good Buy",
    parent: "isobar",
    cluster: "code",
    kind: "award",
    when: "2017 to 2018",
    blurb: "A campaign I helped build. Two Silvers at the Malaysia Effie Awards 2017, and a Silver at the MDA d Awards 2018 for Best Use of Video.",
  },
  {
    id: "infrared",
    label: "Infrared trigger",
    parent: "isobar",
    cluster: "code",
    kind: "project",
    blurb: "An Arduino-based infrared trigger that turned an on-ground installation into something people could interact with.",
    tags: ["Arduino", "Human-computer interaction"],
  },
  {
    id: "vlt",
    label: "VLT Labs",
    parent: "engineering",
    cluster: "code",
    kind: "role",
    when: "2017 to 2018",
    blurb: "Junior software engineer: Node.js projects, Python scrapers feeding third-party data into an existing database, and an e-commerce fashion site.",
    tags: ["Node.js", "Hapi", "MongoDB", "Python", "Scrapy"],
  },
  {
    id: "vlt-node",
    label: "Node.js projects",
    parent: "vlt",
    cluster: "code",
    kind: "project",
    blurb: "Back-end projects on Node.js with Hapi and MongoDB (Mongoose).",
    tags: ["Node.js", "Hapi", "MongoDB"],
  },
  {
    id: "vlt-scrapers",
    label: "Web scrapers",
    parent: "vlt",
    cluster: "code",
    kind: "project",
    blurb: "Python Scrapy scrapers that collected third-party web data and loaded it into an existing database.",
    tags: ["Python", "Scrapy"],
  },
  {
    id: "mckinsey",
    label: "McKinsey & Company",
    parent: "engineering",
    cluster: "code",
    kind: "role",
    when: "2018 to 2024",
    blurb:
      "Six years as a software engineer in McKinsey's digital practice, much of it in financial services, for clients in Malaysia, Indonesia, Australia, Hong Kong, Thailand and Taiwan. Certified ScrumMaster.",
    tags: ["Angular", "React", "Next.js", "NestJS", "C#/.NET", "Node.js", "Agile"],
    href: "/resume",
    hrefLabel: "Read the resume",
  },
  {
    id: "bank-app",
    label: "Bank relationship-manager app",
    parent: "mckinsey",
    cluster: "code",
    kind: "project",
    blurb:
      "An Angular application for a Malaysian bank. I led and coached 15 engineers; it launched as the COVID-19 lockdown hit, so the bank kept taking applications online.",
    tags: ["Angular", "Team lead", "Design system"],
  },
  {
    id: "risk-monitor",
    label: "Risk monitor, Sydney",
    parent: "mckinsey",
    cluster: "code",
    kind: "project",
    blurb: "A digital risk-monitoring app for a financial services client in Sydney: React front end, C#/.NET APIs and the data ingestion behind them.",
    tags: ["React", "C#/.NET", "EF Core"],
  },
  {
    id: "lending",
    label: "Digital lending, Jakarta",
    parent: "mckinsey",
    cluster: "code",
    kind: "project",
    blurb: "A consumer-facing digital lending website, which I led, including the marketing-technology integration that tracked each applicant's journey.",
    tags: ["MarTech integration"],
  },
  {
    id: "asset-health",
    label: "Asset health monitoring",
    parent: "mckinsey",
    cluster: "code",
    kind: "project",
    blurb: "Monitoring the condition of heavy equipment so problems show up on a screen before they show up on site.",
  },
  {
    id: "carbon",
    label: "Carbon tracker, Taiwan",
    parent: "mckinsey",
    cluster: "code",
    kind: "project",
    blurb: "A carbon-emission tracking tool for a manufacturing client.",
    tags: ["Next.js", "NestJS"],
  },
  {
    id: "aviation",
    label: "Aviation prototype, Hong Kong",
    parent: "mckinsey",
    cluster: "code",
    kind: "project",
    blurb: "A dynamic e-commerce prototype with analytics tracking for an aviation client, delivered in one week and deployable both online and offline.",
  },

  // ── Brand building ──────────────────────────────────────────────────────
  {
    id: "brand",
    label: "Brand building",
    cluster: "brand",
    kind: "discipline",
    hub: true,
    blurb: "Brand is the sum of what people see and what they experience. I work on both: the content that gets attention and the systems that keep the promise.",
    tags: ["Digital marketing (HubSpot)", "Campaigns", "Content", "Customer data"],
  },
  {
    id: "toge",
    label: "Toge-Lifestyle",
    parent: "brand",
    cluster: "brand",
    kind: "role",
    when: "2024 to now",
    blurb:
      "My own media-driven marketing consultancy. The name comes from tōge (峠), the mountain pass: the road between one valley and the next. Official media for major automotive events, content for large brands, and brand joint ventures brokered.",
    tags: ["Founder", "Media", "Brand partnerships"],
    links: ["photography"],
    href: SITE.social.instagramToge,
    hrefLabel: "Toge-Lifestyle on Instagram",
  },
  {
    id: "official-media",
    label: "Official event media",
    parent: "toge",
    cluster: "brand",
    kind: "project",
    blurb: "Official media for Autoshow Malaysia, Super GT at Sepang and Tokyo Auto Salon Kuala Lumpur: full coverage, delivered while the event still mattered.",
    href: "/portfolio",
    hrefLabel: "See the event albums",
  },
  {
    id: "brand-content",
    label: "Brand content",
    parent: "toge",
    cluster: "brand",
    kind: "project",
    blurb: "Photo and video content for large brands, including Solarvest Group.",
  },
  {
    id: "cabinetry",
    label: "Cabinetry company",
    parent: "brand",
    cluster: "brand",
    kind: "role",
    when: "2025 to 2026",
    blurb: "Director of Business Development at a cabinetry and interiors company, taking a traditionally run business digital.",
    tags: ["Business development", "Digital transformation"],
  },
  {
    id: "viewership",
    label: "50× viewership",
    parent: "cabinetry",
    cluster: "brand",
    kind: "project",
    blurb: "Grew average marketing viewership from 200 to 10,000, which brought more people into the showroom.",
  },
  {
    id: "digital",
    label: "Going digital",
    parent: "cabinetry",
    cluster: "brand",
    kind: "project",
    blurb: "Moved the company onto cloud tools and introduced transparent tracking for every client.",
  },
  {
    id: "chatbot",
    label: "Product chatbot",
    parent: "cabinetry",
    cluster: "brand",
    kind: "project",
    blurb: "A chatbot on Google's Gemma model that answers customer and sales-team questions with product facts.",
    tags: ["Gemma", "Python", "LLM"],
  },
  {
    id: "troopers",
    label: "TROOPERS Singapore",
    parent: "brand",
    cluster: "brand",
    kind: "role",
    when: "2026 to now",
    blurb: "Head of Brand. I run campaigns and content, and I build the tech behind them.",
    tags: ["Head of Brand", "Talent campaigns", "Quality assurance"],
    href: "/resume",
    hrefLabel: "Read the resume",
  },
  {
    id: "cdp",
    label: "Customer data platform",
    parent: "troopers",
    cluster: "brand",
    kind: "project",
    blurb: "A single source of truth for talents, clients, visitors and partners. It drives retargeting and shows which campaigns bring good leads.",
    tags: ["Retargeting", "Lead quality"],
  },
  {
    id: "ai-video",
    label: "AI video editing",
    parent: "troopers",
    cluster: "brand",
    kind: "project",
    blurb: "A workflow that uses Claude to create and edit videos. It cut three days of editing down to three hours.",
    tags: ["Claude", "Video"],
  },
  {
    id: "xhs",
    label: "Xiaohongshu",
    parent: "troopers",
    cluster: "brand",
    kind: "project",
    blurb: "Running the brand on XHS, the Chinese social app, with Claude handling translation so the tone lands and leads convert.",
    tags: ["Claude", "Social"],
  },

  // ── Photography ─────────────────────────────────────────────────────────
  {
    id: "photography",
    label: "Photography",
    cluster: "lens",
    kind: "discipline",
    hub: true,
    when: "Since 2010",
    blurb:
      "Where it all started: a borrowed DSLR in high school, then a Canon 500D from my brother. It was a hobby, became a business, and is a passion again. I'm not taking regular jobs for now, but I'm open to creative projects.",
    tags: ["Canon", "35mm and medium format film", "Drone"],
    href: "/portfolio",
    hrefLabel: "See the portfolio",
  },
  {
    id: "automotive",
    label: "Automotive and motorsport",
    parent: "photography",
    cluster: "lens",
    kind: "skill",
    blurb: "Rolling shots, track days, launches and race weekends: Super GT, GT World Challenge and the Sepang 1000km, mostly on long lenses.",
    href: "/portfolio",
    hrefLabel: "See the albums",
  },
  {
    id: "events",
    label: "Events and corporate",
    parent: "photography",
    cluster: "lens",
    kind: "skill",
    blurb: "Gala dinners, conferences, launches and owners' gatherings for clients such as Solarvest, Scientex and MG.",
    href: "/portfolio",
    hrefLabel: "See the albums",
  },
  {
    id: "weddings",
    label: "Weddings and couples",
    parent: "photography",
    cluster: "lens",
    kind: "skill",
    blurb: "Weddings, registrations and proposals, some shot entirely on film. One chance at every moment, so preparation is most of the work.",
    href: "/portfolio",
    hrefLabel: "See the albums",
  },
  {
    id: "products",
    label: "Products and food",
    parent: "photography",
    cluster: "lens",
    kind: "skill",
    blurb: "Product shoots for brands and jewellers, and food for restaurants.",
    href: "/portfolio",
    hrefLabel: "See the albums",
  },
  {
    id: "videography",
    label: "Video and drone",
    parent: "photography",
    cluster: "lens",
    kind: "skill",
    blurb: "Event recaps, brand films and vertical reels, with gimbal, drone and helmet-camera footage.",
    href: "/portfolio/videography",
    hrefLabel: "Watch the videos",
  },

  // ── Passion ─────────────────────────────────────────────────────────────
  {
    id: "passion",
    label: "Passion",
    cluster: "road",
    kind: "discipline",
    hub: true,
    blurb:
      "The thread through everything else. I like making things with my own hands, and I care how they look. Software, brand and photography are the same urge in different materials, and on my own time it shows up as night-sky photography, working on my car, and building things like the photography simulator and this website.",
    links: ["engineering", "brand", "photography"],
    href: "/play",
    hrefLabel: "Play the photography simulator",
  },

  // ── Beginnings ──────────────────────────────────────────────────────────
  {
    id: "unimas",
    label: "UNIMAS",
    cluster: "start",
    kind: "study",
    when: "2012 to 2015",
    blurb:
      "Universiti Malaysia Sarawak, B.Sc. Cognitive Science: AI, knowledge-base design and neural networks, with how people perceive and decide at its core. I also photographed many of the faculty's and university's events.",
    tags: ["AI", "Neural networks", "Usability"],
  },
  {
    id: "samsung",
    label: "Samsung Electronics",
    cluster: "start",
    kind: "role",
    when: "2015",
    blurb:
      "An internship. I tested Samsung's business intelligence system against usability principles, gathered feedback from the people using it and recommended changes, and proposed sensory branding to lift sales in Samsung's retail stores.",
    tags: ["Usability testing", "Retail branding"],
  },
];

const byId = new Map(NODES.map((n) => [n.id, n]));
export const node = (id: string) => byId.get(id)!;

/** How deep a node sits: 1 for the top level, 2 for a place, 3 for what was done there. */
export const depth = (n: GraphNode): number => (n.parent ? depth(node(n.parent)) + 1 : 1);
export const childrenOf = (id: string) => NODES.filter((n) => n.parent === id);

// Edges: "tree" from each node to its parent, "link" for the lines that cross the tree.
export const EDGES: [string, string, "tree" | "link"][] = (() => {
  const seen = new Set<string>();
  const out: [string, string, "tree" | "link"][] = [];
  const add = (a: string, b: string, kind: "tree" | "link") => {
    if (!byId.has(b)) throw new Error(`graph.ts: "${a}" points to unknown node "${b}"`);
    const key = [a, b].sort().join("|");
    if (seen.has(key) || a === b) return;
    seen.add(key);
    out.push([a, b, kind]);
  };
  for (const n of NODES) if (n.parent) add(n.parent, n.id, "tree");
  for (const n of NODES) for (const t of n.links ?? []) add(n.id, t, "link");
  return out;
})();

/** Parent first, then children, then anything linked. */
export function related(id: string): GraphNode[] {
  const n = node(id);
  const ids: string[] = [];
  if (n.parent) ids.push(n.parent);
  for (const c of childrenOf(id)) ids.push(c.id);
  for (const [a, b, kind] of EDGES) if (kind === "link") ids.push(...(a === id ? [b] : b === id ? [a] : []));
  return [...new Set(ids)].map(node);
}
