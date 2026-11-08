import type { SignalKind } from "@tot/shared";

/** A rough outline of mainland Great Britain as [lon, lat] points, clockwise from Dover: a backdrop, not a survey. */
export const GB_OUTLINE: [number, number][] = [
  [1.38, 51.13], [1.45, 51.38], [0.95, 51.55], [0.9, 51.75], [1.28, 51.85], [1.58, 52.1], [1.75, 52.48], [1.65, 52.75],
  [1.3, 52.95], [0.7, 52.97], [0.35, 52.82], [0.25, 53.1], [0.35, 53.45], [0.1, 53.6], [-0.2, 53.75], [-0.1, 54.1],
  [-0.4, 54.28], [-0.8, 54.55], [-1.15, 54.65], [-1.35, 54.95], [-1.45, 55.05], [-1.6, 55.45], [-2.0, 55.78],
  [-2.5, 56.0], [-3.0, 55.98], [-3.6, 56.05], [-3.0, 56.2], [-2.6, 56.3], [-2.8, 56.45], [-2.45, 56.6], [-2.1, 57.15],
  [-1.8, 57.5], [-2.0, 57.68], [-3.2, 57.7], [-4.2, 57.5], [-3.8, 57.85], [-3.05, 58.45], [-3.05, 58.65], [-3.6, 58.6],
  [-5.0, 58.62], [-5.35, 58.2], [-5.6, 57.85], [-5.5, 57.3], [-5.85, 56.8], [-6.2, 56.7], [-5.55, 56.4], [-5.65, 55.8],
  [-5.8, 55.3], [-5.45, 55.65], [-4.9, 55.85], [-4.65, 55.45], [-5.0, 55.0], [-5.15, 54.65], [-4.4, 54.75],
  [-3.6, 54.9], [-3.45, 54.6], [-3.2, 54.1], [-2.9, 54.0], [-3.05, 53.85], [-3.05, 53.5], [-3.0, 53.35], [-3.4, 53.33],
  [-4.1, 53.3], [-4.6, 53.3], [-4.75, 52.8], [-4.1, 52.9], [-4.1, 52.5], [-4.65, 52.1], [-5.3, 51.85], [-5.05, 51.65],
  [-4.3, 51.65], [-4.0, 51.55], [-3.2, 51.4], [-2.7, 51.55], [-3.0, 51.35], [-3.6, 51.2], [-4.2, 51.2], [-4.55, 51.0],
  [-4.55, 50.75], [-5.05, 50.5], [-5.7, 50.05], [-5.2, 49.97], [-4.2, 50.35], [-3.5, 50.4], [-3.4, 50.62],
  [-2.45, 50.6], [-1.95, 50.6], [-1.3, 50.78], [-0.8, 50.75], [0.25, 50.75], [0.95, 50.95], [1.38, 51.13],
];

/** Equirectangular projection scaled for ~54.5°N, in SVG units. */
const WEST = -6.4;
const NORTH = 58.8;
const SCALE = 100;
const COS = Math.cos((54.5 * Math.PI) / 180);
export const project = (lon: number, lat: number): [number, number] => [(lon - WEST) * COS * SCALE, (NORTH - lat) * SCALE];
export const MAP_WIDTH = (1.9 - WEST) * COS * SCALE;
export const MAP_HEIGHT = (NORTH - 49.85) * SCALE;

export const outlinePath = () => `M${GB_OUTLINE.map(([lon, lat]) => project(lon, lat).map((n) => n.toFixed(1)).join(",")).join("L")}Z`;

/**
 * Signal kinds take the categorical slots in a fixed order (dataviz reference palette, light mode), so a kind keeps
 * its colour whatever else is on screen. Colour is never alone: every mark carries the kind's icon and name too.
 */
export const KIND_COLOR: Record<SignalKind, string> = {
  weather: "#2a78d6",
  football: "#eb6834",
  concert: "#1baf7a",
  event: "#eda100",
  strike: "#e87ba4",
  engineering_works: "#008300",
  bank_holiday: "#6250d6",
  other: "#e34948",
};

export const KIND_LABEL: Record<SignalKind, string> = {
  weather: "Weather",
  football: "Football",
  concert: "Concerts",
  event: "Events",
  strike: "Strikes",
  engineering_works: "Engineering works",
  bank_holiday: "Bank holidays",
  other: "Other",
};
