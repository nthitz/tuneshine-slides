import { readFile } from "node:fs/promises";
import path from "node:path";
import { appState } from "./dashboard-state.js";

const CLEANUP_FETCH_TIMEOUT_MS = 4 * 1000;
const TUNESHINE_FETCH_TIMEOUT_MS = 4 * 1000;

export function uploadMetadata(renderedSlide, options) {
  return {
    ...renderedSlide.slide.metadata,
    idle: true,
    overridable: !options.devMode
  };
}

export async function uploadImage(host, imagePath, metadata) {
  const file = await readFile(imagePath);
  const form = new FormData();
  form.append("image", new Blob([file], { type: "image/webp" }), path.basename(imagePath));
  form.append("metadata", JSON.stringify(metadata));

  const response = await fetch(`http://${host}/image`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  return response.json();
}

export async function uploadSlide(host, renderedSlide, options) {
  return uploadImage(host, renderedSlide.path, uploadMetadata(renderedSlide, options));
}

export async function removeLocalImage(host) {
  const response = await fetch(`http://${host}/image`, {
    method: "DELETE",
    signal: AbortSignal.timeout(CLEANUP_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Remove image failed: ${response.status}`);
  }
}

function normalizeBrightness(value) {
  const brightness = Number(value);
  if (!Number.isInteger(brightness) || brightness < 1 || brightness > 100) {
    throw new Error("Brightness must be an integer between 1 and 100");
  }
  return brightness;
}

export async function fetchDeviceBrightness(host) {
  const response = await fetch(`http://${host}/state`, {
    signal: AbortSignal.timeout(TUNESHINE_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`State request failed: ${response.status}`);
  }

  const state = await response.json();
  const brightness = state.config?.brightness;
  if (!brightness || !Number.isFinite(brightness.active) || !Number.isFinite(brightness.idle)) {
    throw new Error("Device state did not include brightness");
  }

  appState.brightness = {
    active: brightness.active,
    idle: brightness.idle
  };
  return appState.brightness;
}

export async function setDeviceBrightness(host, brightness) {
  const value = normalizeBrightness(brightness);
  const response = await fetch(`http://${host}/brightness`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active: value, idle: value }),
    signal: AbortSignal.timeout(TUNESHINE_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Brightness update failed: ${response.status}`);
  }

  appState.brightness = { active: value, idle: value };
  return appState.brightness;
}
