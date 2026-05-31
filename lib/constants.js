export const WIDTH = 64;
export const HEIGHT = 64;
export const CHANNELS = 4;
export const OUT_DIR = "slides";
export const DEFAULT_SLIDE_SECONDS = 15;
export const DEFAULT_DVD_SECONDS = 15;
export const DEFAULT_UPLOAD_DELAY_SECONDS = 1;
export const DEFAULT_LOOP_PROOF_SECONDS = 5;
export const DEFAULT_TUNESHINE_HOST = "192.168.4.76";
export const OAKLAND = { latitude: 37.8044, longitude: -122.2712 };
export const AC_ROUTE_STOPS = [
  { stop: "59550", route: "88" },
  { stop: "53885", route: "12" }
];
export const AC_STOPS = AC_ROUTE_STOPS.map(({ stop }) => stop);

export const palette = {
  bg: [10, 12, 20, 255],
  panel: [18, 23, 38, 255],
  dim: [55, 65, 92, 255],
  text: [232, 240, 255, 255],
  muted: [145, 159, 185, 255],
  cyan: [72, 220, 255, 255],
  blue: [79, 135, 255, 255],
  yellow: [255, 221, 92, 255],
  orange: [255, 145, 69, 255],
  pink: [255, 84, 139, 255],
  green: [95, 232, 139, 255],
  red: [255, 84, 84, 255],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255]
};
