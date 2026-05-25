#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import sharp from "sharp";
import terminalKit from "terminal-kit";
import {
  DEFAULT_DVD_SECONDS,
  DEFAULT_LOOP_PROOF_SECONDS,
  DEFAULT_SLIDE_SECONDS,
  DEFAULT_UPLOAD_DELAY_SECONDS,
  DEFAULT_TUNESHINE_HOST
} from "./lib/constants.js";
import { getSlideData } from "./lib/data.js";
import { renderSlide } from "./lib/rendering.js";
import { slideRegistry } from "./slides/definitions/index.js";

const term = terminalKit.terminal;
const ANSI_RESET = "\x1b[0m";
let tuiActive = false;
let tuiRestored = false;

function parseArgs(args) {
  const options = {
    command: args[0] ?? "build",
    seconds: Number(process.env.SLIDE_SECONDS ?? DEFAULT_SLIDE_SECONDS),
    dvdSeconds: Number(process.env.DVD_SLIDE_SECONDS ?? DEFAULT_DVD_SECONDS),
    uploadDelay: Number(process.env.UPLOAD_DELAY_SECONDS ?? DEFAULT_UPLOAD_DELAY_SECONDS),
    loopProofDelay: Number(process.env.LOOP_PROOF_DELAY_SECONDS ?? DEFAULT_LOOP_PROOF_SECONDS),
    galleryDir: process.env.GALLERY_DIR,
    host: process.env.TUNESHINE_HOST ?? DEFAULT_TUNESHINE_HOST
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--seconds" || arg === "-s") {
      options.seconds = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--dvd-seconds") {
      options.dvdSeconds = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--upload-delay") {
      options.uploadDelay = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--loop-proof-delay") {
      options.loopProofDelay = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--gallery-dir") {
      options.galleryDir = args[index + 1];
      index += 1;
    } else if (arg === "--host") {
      options.host = args[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["build", "once", "loop"].includes(options.command)) {
    throw new Error("Command must be build, once, or loop");
  }
  if (!Number.isFinite(options.seconds) || options.seconds < 1 || options.seconds > 60) {
    throw new Error("--seconds must be between 1 and 60");
  }
  if (!Number.isFinite(options.dvdSeconds) || options.dvdSeconds < 1 || options.dvdSeconds > 120) {
    throw new Error("--dvd-seconds must be between 1 and 120");
  }
  if (!Number.isFinite(options.uploadDelay) || options.uploadDelay < 0 || options.uploadDelay > 5) {
    throw new Error("--upload-delay must be between 0 and 5 seconds");
  }
  if (
    !Number.isFinite(options.loopProofDelay) ||
    options.loopProofDelay < 0 ||
    options.loopProofDelay > 30
  ) {
    throw new Error("--loop-proof-delay must be between 0 and 30 seconds");
  }

  options.seconds = Math.round(options.seconds);
  options.dvdSeconds = Math.round(options.dvdSeconds);
  return options;
}

function printHelp() {
  console.log(`Usage: node tuneshine-dashboard.js <build|once|loop> [options]

Options:
  -s, --seconds <n>  Seconds each slide is visible (default: ${DEFAULT_SLIDE_SECONDS})
      --dvd-seconds <n>
                     Seconds the DVD slide is visible (default: ${DEFAULT_DVD_SECONDS})
      --upload-delay <n>
                     Extra animation seconds rendered as upload cushion (default: ${DEFAULT_UPLOAD_DELAY_SECONDS})
      --loop-proof-delay <n>
                     Extra animation seconds for slides that opt into loop-proof rendering (default: ${DEFAULT_LOOP_PROOF_SECONDS})
      --gallery-dir <path>
                     Folder of images for the optional gallery slide
      --host <host>  Tuneshine host or IP (default: ${DEFAULT_TUNESHINE_HOST})

Environment:
  ACTRANSIT_TOKEN    Fallback token for AC Transit direct arrivals
  511_TOKEN          Preferred token for 511 StopMonitoring bus arrivals
  TOKEN_511          Alternate env name for 511_TOKEN
  SLIDE_SECONDS      Default slide duration
  DVD_SLIDE_SECONDS  DVD slide duration
  UPLOAD_DELAY_SECONDS
                     Extra animation seconds rendered as upload cushion
  LOOP_PROOF_DELAY_SECONDS
                     Extra animation seconds for slides that opt into loop-proof rendering
  GALLERY_DIR        Folder of images for the optional gallery slide
  TUNESHINE_HOST     Default Tuneshine host or IP
`);
}

function slideDuration(slide, options) {
  if (slide.id === "dvd") {
    return options.dvdSeconds;
  }
  return slide.durationSeconds ?? options.seconds;
}

function slideUploadDelay(slide, options) {
  if (slide.loopProofSeconds !== undefined) {
    return Number(slide.loopProofSeconds);
  }
  if (slide.loopProof) {
    return options.loopProofDelay;
  }
  return options.uploadDelay;
}

function dataIssues(data) {
  const issues = [];

  if (data.weather?.error) {
    issues.push(`Weather: ${data.weather.error}`);
  }
  if (data.bus?.error) {
    issues.push(`Bus: ${data.bus.error}`);
  }
  if (data.bus?.missingToken) {
    issues.push("Bus: missing transit API token");
  }

  return issues;
}

async function buildSlides(options) {
  const data = await getSlideData();
  const issues = dataIssues(data);
  const rendered = [];
  const slides = slideRegistry.filter((slide) => slide.id !== "gallery" || options.galleryDir);

  for (const slide of slides) {
    const durationSeconds = slideDuration(slide, options);
    const uploadDelay = slideUploadDelay(slide, options);
    const requestedRenderSeconds = durationSeconds + uploadDelay;
    const outputPath = slide.renderFile
      ? await slide.renderFile({
          data,
          durationSeconds,
          renderSeconds: requestedRenderSeconds,
          options
        })
      : await renderSlide(slide, data, durationSeconds, requestedRenderSeconds);
    if (!outputPath) {
      continue;
    }
    const metadata = await sharp(outputPath, { animated: true }).metadata();
    const file = await stat(outputPath);
    const renderedSeconds =
      Array.isArray(metadata.delay) && metadata.delay.length > 0
        ? metadata.delay.reduce((sum, delay) => sum + delay, 0) / 1000
        : requestedRenderSeconds;
    rendered.push({
      slide,
      path: outputPath,
      bytes: file.size,
      pages: metadata.pages ?? 1,
      delay: metadata.delay,
      durationSeconds,
      renderedSeconds,
      uploadDelay,
      dataIssues: issues
    });
  }

  return rendered;
}

async function uploadSlide(host, renderedSlide) {
  const file = await readFile(renderedSlide.path);
  const form = new FormData();
  form.append(
    "image",
    new Blob([file], { type: "image/webp" }),
    path.basename(renderedSlide.path)
  );
  form.append(
    "metadata",
    JSON.stringify({
      ...renderedSlide.slide.metadata,
      idle: true,
      overridable: true
    })
  );

  const response = await fetch(`http://${host}/image`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error(`Upload failed for ${renderedSlide.slide.id}: ${response.status}`);
  }

  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function terminalColor([red, green, blue]) {
  return `${red};${green};${blue}`;
}

async function createTerminalPreview(imagePath, width) {
  const image = sharp(imagePath, { animated: false })
    .ensureAlpha()
    .resize({ width, height: width, kernel: "nearest", fit: "fill" });

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const lines = [];

  for (let y = 0; y < info.height; y += 1) {
    let line = "";
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const color = [data[offset], data[offset + 1], data[offset + 2]];
      line += `\x1b[48;2;${terminalColor(color)}m  `;
    }
    lines.push(`${line}${ANSI_RESET}`);
  }

  return { lines, width: info.width * 2 };
}

async function addTerminalPreviews(rendered) {
  if (!process.stdout.isTTY) return rendered;

  const terminalWidth = term.width || process.stdout.columns || 80;
  const terminalHeight = term.height || process.stdout.rows || 40;
  const headerRows = 10;
  const maxByWidth = Math.floor((terminalWidth - 2) / 2);
  const maxByHeight = terminalHeight - headerRows;
  const previewSize = Math.max(8, Math.min(32, maxByWidth, maxByHeight));

  return Promise.all(
    rendered.map(async (item) => {
      const preview = await createTerminalPreview(item.path, previewSize);
      return {
        ...item,
        preview: preview.lines,
        previewWidth: preview.width
      };
    })
  );
}

function progressBar(remainingSeconds, totalSeconds, width = 28) {
  const elapsed = Math.max(0, totalSeconds - remainingSeconds);
  const filled = Math.min(width, Math.round((elapsed / totalSeconds) * width));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function previewPair(current, next) {
  const terminalWidth = term.width || process.stdout.columns || 80;
  const showNextPreview = terminalWidth >= current.previewWidth + next.previewWidth + 2;
  if (!showNextPreview) {
    return current.preview.join("\n");
  }

  const lines = [];
  const rowCount = Math.max(current.preview.length, next.preview.length);
  for (let index = 0; index < rowCount; index += 1) {
    const left = current.preview[index] ?? "";
    const right = next.preview[index] ?? "";
    lines.push(`${left}  ${right}`);
  }
  return lines.join("\n");
}

function renderTui(rendered, index, remainingSeconds, status, cycle) {
  if (!process.stdout.isTTY) return;

  const current = rendered[index];
  const next = rendered[(index + 1) % rendered.length];
  const totalSeconds = current.durationSeconds;
  const terminalWidth = term.width || process.stdout.columns || 80;
  const showNextPreview = terminalWidth >= current.previewWidth + next.previewWidth + 2;
  const label = showNextPreview ? "Current / Next" : "Current";
  const issueLine =
    current.dataIssues.length > 0 ? `API: ${current.dataIssues.join(" | ")}` : "API: OK";
  const lines = [
    `Tuneshine Dashboard  cycle ${cycle}`,
    "",
    `${label}: ${current.slide.title} -> ${next.slide.title}`,
    `Status: ${status}`,
    issueLine,
    `Cadence: ${current.durationSeconds}s  WebP: ${current.renderedSeconds.toFixed(1)}s`,
    `Timer: ${String(Math.ceil(remainingSeconds)).padStart(2, " ")}s  ${progressBar(
      remainingSeconds,
      totalSeconds
    )}`,
    "",
    previewPair(current, next),
    "",
    "Press Ctrl+C to stop."
  ];

  term.moveTo(1, 1);
  term.eraseDisplay();
  lines.forEach((line, lineIndex) => {
    term.moveTo(1, lineIndex + 1);
    term(line);
  });
}

async function waitForSlide(rendered, index, cycle) {
  const started = Date.now();
  const durationMs = rendered[index].durationSeconds * 1000;

  while (true) {
    const elapsed = Date.now() - started;
    const remainingMs = Math.max(0, durationMs - elapsed);
    renderTui(rendered, index, remainingMs / 1000, "Live", cycle);
    if (remainingMs === 0) return;
    await sleep(Math.min(250, remainingMs));
  }
}

function setupTui() {
  if (!process.stdout.isTTY) return;

  tuiActive = true;
  term.fullscreen();
  term.hideCursor();
  term.grabInput();

  term.on("key", (name) => {
    if (name === "CTRL_C" || name === "q" || name === "Q") {
      restoreTui();
      process.exit(130);
    }
  });

  process.once("exit", restoreTui);
  process.once("SIGINT", () => {
    restoreTui();
    process.exit(130);
  });
}

function restoreTui() {
  if (!tuiActive || tuiRestored) return;

  tuiRestored = true;
  term.styleReset();
  term.hideCursor(false);
  term.grabInput(false);
  term.fullscreen(false);
}

async function runOnce(options, cycle = 1) {
  const rendered = await buildSlides(options);
  const slides = await addTerminalPreviews(rendered);

  for (let index = 0; index < slides.length; index += 1) {
    const renderedSlide = slides[index];
    renderTui(slides, index, renderedSlide.durationSeconds, "Uploading", cycle);
    await uploadSlide(options.host, renderedSlide);
    if (!process.stdout.isTTY) {
      console.log(`Uploaded ${renderedSlide.slide.id}`);
    }
    await waitForSlide(slides, index, cycle);
  }
}

async function runLoop(options) {
  let cycle = 1;
  while (true) {
    await runOnce(options, cycle);
    cycle += 1;
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.command === "build") {
  const rendered = await buildSlides(options);
  for (const item of rendered) {
    const delay = Array.isArray(item.delay) ? item.delay.join(",") : "static";
    console.log(
      `${item.path}: ${item.durationSeconds}s cadence, ${item.renderedSeconds.toFixed(
        1
      )}s webp, ${item.pages} frames, ${delay} ms, ${item.bytes} bytes`
    );
  }
} else if (options.command === "once") {
  setupTui();
  await runOnce(options);
} else {
  setupTui();
  await runLoop(options);
}
