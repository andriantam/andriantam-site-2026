// The registry behind /play. Add a game here and it appears in the grid; its page lives at src/pages/play/<slug>.astro.
import type { ImageMetadata } from "astro";
import automotive from "../assets/photos/automotive-header.jpg";
import events from "../assets/photos/events-header.jpg";

export interface Game {
  slug: string; // page is /play/<slug>
  title: string;
  tagline: string; // one line on the card
  description: string; // longer, for structured data and llms.txt
  kind: "Game" | "App" | "Toy";
  tags: string[];
  image: ImageMetadata;
  imageAlt: string;
  status: "live" | "soon";
  platforms: string; // "Desktop and phone"
  added: string; // ISO date, newest first in the grid
}

export const GAMES: Game[] = [
  {
    slug: "photography-simulator",
    title: "Photography Simulator",
    tagline: "Drive a car into position at a mountain pass, pick a lens and take real photos.",
    description:
      "A free 3D photography simulator in the browser: seven prime lenses, shutter, aperture, ISO and flash, with physically based exposure, depth of field and motion blur, from morning to night.",
    kind: "Game",
    tags: ["3D", "Photography", "Driving"],
    image: automotive,
    imageAlt: "A car at a mountain-pass lay-by at night",
    status: "live",
    platforms: "Desktop and phone",
    added: "2025-01-01",
  },
  {
    slug: "through-the-wall",
    title: "Through the Wall",
    tagline: "A wall with a person-shaped hole rushes at you. Strike the pose to fit through.",
    description:
      "A free webcam game for one or two players: a wall with a person-shaped hole rushes at you and you strike the pose to fit through. Body tracking runs in the browser and the video never leaves the device.",
    kind: "Game",
    tags: ["Webcam", "Body tracking", "1–2 players"],
    image: events,
    imageAlt: "A crowd of people in motion",
    status: "live",
    platforms: "Desktop and phone",
    added: "2026-11-17",
  },
];

export const liveGames = () => GAMES.filter((g) => g.status === "live").sort((a, b) => b.added.localeCompare(a.added));
export const gameUrl = (g: Game) => `/play/${g.slug}`;
