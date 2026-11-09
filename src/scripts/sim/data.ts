// Camera and lens data for the photographer simulator.
// Lens specs are modelled on a current pro full-frame mirrorless lens line-up.

export interface Lens {
  focal: number; // mm
  maxAperture: number; // widest f-number
  minAperture: number; // narrowest f-number
  minFocus: number; // metres, closest focusing distance
  blades: number; // aperture blades (shapes the bokeh when stopped down)
  name: string;
}

export const LENSES: Lens[] = [
  { focal: 16, maxAperture: 2.8, minAperture: 22, minFocus: 0.28, blades: 9, name: "16mm f/2.8" },
  { focal: 24, maxAperture: 1.4, minAperture: 16, minFocus: 0.18, blades: 11, name: "24mm f/1.4" },
  { focal: 35, maxAperture: 1.4, minAperture: 16, minFocus: 0.18, blades: 11, name: "35mm f/1.4" },
  { focal: 50, maxAperture: 1.2, minAperture: 16, minFocus: 0.4, blades: 10, name: "50mm f/1.2" },
  { focal: 85, maxAperture: 1.2, minAperture: 16, minFocus: 0.85, blades: 9, name: "85mm f/1.2" },
  { focal: 105, maxAperture: 2.8, minAperture: 22, minFocus: 0.45, blades: 11, name: "105mm f/2.8" },
  { focal: 200, maxAperture: 2.8, minAperture: 32, minFocus: 0.7, blades: 9, name: "200mm f/2.8" },
];

// Full-frame sensor, 36 x 24 mm.
export const SENSOR = { w: 0.036, h: 0.024 };

export const verticalFov = (focalMm: number) => (2 * Math.atan(SENSOR.h / 2 / (focalMm / 1000)) * 180) / Math.PI;
// Held in portrait, the sensor's long side runs vertically.
export const frameFov = (focalMm: number, portrait: boolean) =>
  (2 * Math.atan((portrait ? SENSOR.w : SENSOR.h) / 2 / (focalMm / 1000)) * 180) / Math.PI;

// One-third stop scales, as on a real camera dial.
export const APERTURES = [1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32];

export const SHUTTERS = [
  30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 13,
  1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 40, 1 / 50, 1 / 60, 1 / 80, 1 / 100, 1 / 125, 1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400,
  1 / 500, 1 / 640, 1 / 800, 1 / 1000, 1 / 1250, 1 / 1600, 1 / 2000, 1 / 2500, 1 / 3200, 1 / 4000, 1 / 5000, 1 / 6400, 1 / 8000,
];

export const ISOS = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600];

export const FLASH_SYNC = 1 / 250; // fastest shutter speed the flash can sync at
export const FLASH_GN = 60; // guide number in metres at ISO 100, full power
export const FLASH_POWERS = [1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32];

// Scene times. Each has its own sky (a real HDR photo) and light level in EV100:
// settings that match the EV give a "correct" exposure.
export type TimeOfDay = "day" | "noon" | "evening" | "night";
export interface TimePreset {
  id: TimeOfDay;
  label: string;
  sky: string; // HDR file in /public/sim, without the _1k/_2k suffix
  ev: number;
  blurb: string;
  lamp: boolean; // the lay-by street light is on
}
export const TIMES: TimePreset[] = [
  { id: "day", label: "Day", sky: "qwantani_mid_morning", ev: 14, blurb: "Mid-morning sun in a clear sky", lamp: false },
  { id: "noon", label: "Noon", sky: "qwantani_noon", ev: 15, blurb: "Hard light from a high sun", lamp: false },
  { id: "evening", label: "Evening", sky: "camdeboo_road", ev: 11.5, blurb: "Golden hour, the sun on the horizon", lamp: false },
  { id: "night", label: "Night", sky: "qwantani_night", ev: -4, blurb: "A moonless night under the lay-by light", lamp: true },
];
export const timePreset = (id: TimeOfDay) => TIMES.find((t) => t.id === id)!;

// The current light level. Changes with the scene time.
export const LIGHT = { ev: 11.5, time: "evening" as TimeOfDay };
/** @deprecated use LIGHT.ev */
export const SCENE_EV = 11.5;

export function ev100(aperture: number, shutter: number, iso: number) {
  return Math.log2((aperture * aperture) / shutter) - Math.log2(iso / 100);
}

// Linear multiplier applied to scene light for given camera settings.
export function exposureScale(aperture: number, shutter: number, iso: number) {
  return Math.pow(2, LIGHT.ev - ev100(aperture, shutter, iso));
}

// Real-world light units to scene units, where 0.18 is mid-grey at LIGHT.ev.
// Illuminance: an incident meter reads EV100 = log2(lux / 2.5). Luminance: a reflected meter reads EV100 = log2(8 x cd/m2).
// Capped well below the half-float limit of the render targets.
const CAP = 20000;
export const luxToScene = (lux: number) => Math.min(CAP, (Math.PI * lux) / (2.5 * 2 ** LIGHT.ev));
export const candelaToScene = (cd: number) => (Math.PI * cd) / (2.5 * 2 ** LIGHT.ev); // spot intensity, falls off with d^2
export const nitsToScene = (cdm2: number) => Math.min(CAP, (1.44 * cdm2) / 2 ** LIGHT.ev);

export function shutterLabel(s: number) {
  if (s >= 0.3) return `${Number(s.toFixed(1)).toString().replace(/\.0$/, "")}"`;
  return `1/${Math.round(1 / s)}`;
}
export const apertureLabel = (a: number) => `f/${a}`;
export const isoLabel = (i: number) => `ISO ${i}`;
export const powerLabel = (p: number) => (p === 1 ? "1/1" : `1/${Math.round(1 / p)}`);

export function nearestIndex(list: number[], v: number) {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(Math.log(list[i] / v)) < Math.abs(Math.log(list[best] / v))) best = i;
  return best;
}
