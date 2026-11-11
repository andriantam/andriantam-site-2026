# andriantam.com

Static Astro site for Andrian Tam: photographer, software engineer and brand builder.

- **Home:** "The Pass", a real-time 3D scene (three.js). It opens on the night sky, where every star is a node of the atlas; scrolling brings the camera down to the car for a drive up a mountain road, one chapter and one camera angle per stretch, ending with a handbrake turn in a car park and the contact details. The road, barriers, streetlights, gates and terrain are built in code; the car is the simulator's WRX model. Falls back to a still image without WebGL, on low-memory devices and with reduced motion.
- **Atlas:** every skill, role, project and place as a node in `src/data/graph.ts`. That one file drives the constellation, the `/atlas` pages and their links.
- **Portfolio:** client work, clients and testimonials on one page. **Gallery:** personal albums (Flickr categories personal, travel, astro, landscape, street, film).
- **Portfolio:** Flickr albums, fetched at build time. Web and software projects are supported but hidden (`FLAGS.showDevProjects`).
- **Articles:** Blogger posts, fetched at build time, with AdSense on article pages only.
- **Resume**, the **Photographer Simulator** at `/play`, `llms.txt`, RSS, a sitemap and 301s for every old URL.

## Run it

```bash
cp .env.example .env   # add your Blogger and Flickr keys
npm install
npm run dev            # http://localhost:4321
npm run build          # outputs dist/
```

`OFFLINE=1 npm run build` builds from the saved snapshots without calling any API.

## Where things live

| What | File |
|---|---|
| Name, contact, socials, flags, ad and analytics ids | `src/config/site.ts` |
| Services, clients, testimonials, FAQ, videos, featured albums | `src/data/content.ts` |
| Resume | `src/data/resume.ts` |
| Atlas nodes and links | `src/data/graph.ts` |
| 3D landing scene | `src/scripts/pass/scene.ts`, `src/components/Pass.astro` |
| Web and software projects (hidden for now) | `src/data/projects.ts` |
| Blogger and Flickr connectors | `src/lib/blogger.ts`, `src/lib/flickr.ts` |
| Data backups (committed) | `src/data/snapshots/*.json` |
| Structured data (schema.org) | `src/lib/schema.ts` |
| Home intro still | `public/media/hero-poster-*.webp` |

## Data and backup

Blogger and Flickr are read once per build, on the server, so API keys never reach the browser.
Every successful fetch is saved to `src/data/snapshots/`. If an API fails, the build uses the last snapshot.
`.github/workflows/daily-rebuild.yml` refreshes them daily; add the four keys as repository secrets.

Flickr album categories come from each album's description, comma-separated: `events,automotive`.
Known categories: automotive, events, corporate, couple, products, food, and the personal ones that send an album to the gallery: personal, travel, astro, landscape, street, film.

## Deploying (Cloudflare Pages)

Build command `npm run build`, output directory `dist`, Node 22, and the four API keys as environment variables.
`dist/_redirects` (generated) maps old URLs to new ones. `public/sw.js` removes the old Monetag service worker from returning visitors.

## Photographer Simulator (`/play`)

A three.js scene in `src/scripts/sim/`:

| File | What it does |
|---|---|
| `data.ts` | Lenses (focal length, max/min aperture, closest focus, blade count), shutter/aperture/ISO scales, flash, scene EV |
| `world.ts` | The mountain-pass lay-by: HDR sky, sun, terrain, guardrail, barriers, ladders, and the car |
| `photo.ts` | Develops photos: accumulates many renders across the shutter interval and lens aperture, then applies exposure, flash, vignetting, ISO noise and the tone curve |
| `index.ts` | Player movement, stances, ladders, autofocus, metering, controls and touch input |

Assets in `public/sim/` are CC0 from [Poly Haven](https://polyhaven.com): the "Camdeboo Road" HDRI (Dario Barresi, Jarod Guest) and the asphalt_02, gravel, aerial_grass_rock and dark_rock_02 textures.

### The car

`public/sim/car.glb` is "Subaru WRX STI" by skyfaltus (Skyborg) on Sketchfab, CC BY 4.0. The credit is on the `/play` page and must stay there.
The original is about 7.8 million triangles (236 MB). `scripts/optimize-car.mjs` shrinks it to about 1.7 million (10.6 MB):
body paint, glass and badges stay at full detail (simplifying the paint breaks its shading and shows pale patches on the doors),
and everything else is simplified to 6%.

```bash
node scripts/optimize-car.mjs ~/Downloads/subaru_wrx_sti/scene.gltf public/sim/car.glb 0.06
```

`world.ts` then scales it to 4.6 m, puts the wheels on the ground, switches the lamps off and tunes the paint and plastics
(`tuneCarMaterial`). If `car.glb` is missing, a stand-in car built from primitives is used.

`/play?debug` exposes `window.__sim` for automated testing.
