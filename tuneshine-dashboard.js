#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import "dotenv/config";
import { Hono } from "hono";
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
const CLEANUP_FETCH_TIMEOUT_MS = 4 * 1000;
let tuiActive = false;
let tuiRestored = false;
let shutdownStarted = false;
let webServer = null;

const appState = {
  enabled: true,
  phase: "starting",
  cycle: 0,
  current: null,
  next: null,
  remainingSeconds: null,
  issues: [],
  lastUploadAt: null,
  lastError: null,
  requestedSlideId: null,
  slides: []
};

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function parseArgs(args) {
  const options = {
    command: args[0] ?? "build",
    seconds: Number(process.env.SLIDE_SECONDS ?? DEFAULT_SLIDE_SECONDS),
    dvdSeconds: Number(process.env.DVD_SLIDE_SECONDS ?? DEFAULT_DVD_SECONDS),
    uploadDelay: Number(process.env.UPLOAD_DELAY_SECONDS ?? DEFAULT_UPLOAD_DELAY_SECONDS),
    loopProofDelay: Number(process.env.LOOP_PROOF_DELAY_SECONDS ?? DEFAULT_LOOP_PROOF_SECONDS),
    galleryDir: process.env.GALLERY_DIR,
    devMode: parseBoolean(process.env.DEV_MODE),
    webPort: parsePort(process.env.WEB_PORT ?? 3000),
    webEnabled: !parseBoolean(process.env.WEB_DISABLED),
    startEnabled: !parseBoolean(process.env.DASHBOARD_DISABLED),
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
    } else if (arg === "--dev-mode") {
      options.devMode = true;
    } else if (arg === "--web-port") {
      options.webPort = parsePort(args[index + 1]);
      index += 1;
    } else if (arg === "--no-web") {
      options.webEnabled = false;
    } else if (arg === "--disabled") {
      options.startEnabled = false;
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
  if (options.webEnabled && !options.webPort) {
    throw new Error("--web-port must be between 1 and 65535");
  }

  options.seconds = Math.round(options.seconds);
  options.dvdSeconds = Math.round(options.dvdSeconds);
  appState.enabled = options.startEnabled;
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
      --dev-mode     Upload images with overridable=false for testing over music
      --web-port <n> Web status/control port (default: 3000)
      --no-web       Disable the web status/control server
      --disabled     Start with uploads disabled
      --host <host>  Tuneshine host or IP (default: ${DEFAULT_TUNESHINE_HOST})

Environment:
  TOKEN_511          Preferred token for 511 StopMonitoring bus arrivals
  511_TOKEN          Backward-compatible alternate token name
  ACTRANSIT_TOKEN    Fallback token for AC Transit direct arrivals
  SLIDE_SECONDS      Default slide duration
  DVD_SLIDE_SECONDS  DVD slide duration
  UPLOAD_DELAY_SECONDS
                     Extra animation seconds rendered as upload cushion
  LOOP_PROOF_DELAY_SECONDS
                     Extra animation seconds for slides that opt into loop-proof rendering
  GALLERY_DIR        Folder of images for the optional gallery slide
  DEV_MODE           Set to true/1/yes/on to upload images with overridable=false
  WEB_PORT           Web status/control port
  WEB_DISABLED       Set to true/1/yes/on to disable the web server
  DASHBOARD_DISABLED Set to true/1/yes/on to start with uploads disabled
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
      dataIssues: issues,
      options
    });
  }

  return rendered;
}

function uploadMetadata(renderedSlide, options) {
  return {
    ...renderedSlide.slide.metadata,
    idle: true,
    overridable: !options.devMode
  };
}

async function uploadSlide(host, renderedSlide, options) {
  const file = await readFile(renderedSlide.path);
  const form = new FormData();
  form.append(
    "image",
    new Blob([file], { type: "image/webp" }),
    path.basename(renderedSlide.path)
  );
  form.append(
    "metadata",
    JSON.stringify(uploadMetadata(renderedSlide, options))
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

async function removeLocalImage(host) {
  const response = await fetch(`http://${host}/image`, {
    method: "DELETE",
    signal: AbortSignal.timeout(CLEANUP_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Remove image failed: ${response.status}`);
  }
}

async function cleanupDevImage(options) {
  if (!options.devMode) return;

  try {
    await removeLocalImage(options.host);
    if (!process.stdout.isTTY) {
      console.log("Removed dev-mode image");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.stdout.isTTY) {
      restoreTui();
    }
    console.error(`Failed to remove dev-mode image: ${message}`);
  }
}

function statusPayload(options) {
  return {
    ...appState,
    metadata: {
      idle: true,
      overridable: !options.devMode
    },
    config: {
      host: options.host,
      devMode: options.devMode,
      webPort: options.webPort
    }
  };
}

function webUiAddress(options) {
  return options.webEnabled ? `http://localhost:${options.webPort}` : "disabled";
}

function webPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tuneshine Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0c14; color: #e8f0ff; }
    body { margin: 0; padding: 24px; }
    main { max-width: 920px; margin: 0 auto; display: grid; gap: 18px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 22px; margin: 0; font-weight: 650; }
    button { border: 1px solid #37425c; background: #121726; color: #e8f0ff; border-radius: 6px; padding: 10px 14px; font: inherit; cursor: pointer; }
    select { border: 1px solid #37425c; background: #121726; color: #e8f0ff; border-radius: 6px; padding: 10px 12px; font: inherit; min-width: 190px; }
    button.enabled { background: #14351f; border-color: #5fe88b; }
    button.disabled { background: #3a1820; border-color: #ff548b; }
    button:disabled, select:disabled { opacity: .45; cursor: not-allowed; }
    section { border: 1px solid #222a3c; border-radius: 8px; padding: 16px; background: #0f1320; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .label { color: #91a0b9; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    .value { font-size: 18px; margin-top: 4px; overflow-wrap: anywhere; }
    .preview { image-rendering: pixelated; width: 256px; height: 256px; border: 1px solid #222a3c; background: #05060d; }
    .row { display: flex; align-items: flex-start; gap: 18px; flex-wrap: wrap; }
    .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .issues { color: #ffdd5c; }
    pre { margin: 0; white-space: pre-wrap; color: #91a0b9; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Tuneshine Dashboard</h1>
      <button id="toggle">Loading</button>
    </header>
    <section class="row">
      <img id="preview" class="preview" alt="Current slide preview">
      <div class="grid" style="flex:1">
        <div><div class="label">Phase</div><div id="phase" class="value"></div></div>
        <div><div class="label">Current</div><div id="current" class="value"></div></div>
        <div><div class="label">Next</div><div id="next" class="value"></div></div>
        <div><div class="label">Timer</div><div id="timer" class="value"></div></div>
        <div><div class="label">Cycle</div><div id="cycle" class="value"></div></div>
        <div><div class="label">Metadata</div><div id="metadata" class="value"></div></div>
      </div>
    </section>
    <section>
      <div class="label">Controls</div>
      <div class="controls">
        <button id="nextSlide">Next Slide</button>
        <select id="slideSelect" aria-label="Slide"></select>
      </div>
    </section>
    <section>
      <div class="label">API / Errors</div>
      <div id="issues" class="value issues"></div>
    </section>
    <section>
      <div class="label">Raw Status</div>
      <pre id="raw"></pre>
    </section>
  </main>
  <script>
    async function setEnabled(enabled) {
      await fetch('/api/enabled', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      await refresh();
    }

    async function nextSlide() {
      await fetch('/api/slides/next', { method: 'POST' });
      await refresh();
    }

    async function jumpToSlide(id) {
      await fetch('/api/slides/jump', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      await refresh();
    }

    function renderSlideOptions(status) {
      const select = document.getElementById('slideSelect');
      const slidesKey = status.slides.map((slide) => slide.id + ':' + slide.title).join('|');
      if (select.dataset.slidesKey !== slidesKey) {
        select.dataset.slidesKey = slidesKey;
        select.replaceChildren();
        for (const slide of status.slides) {
          const option = document.createElement('option');
          option.value = slide.id;
          option.textContent = slide.title;
          select.appendChild(option);
        }
      }

      if (document.activeElement !== select) {
        select.value = status.requestedSlideId ?? status.current?.id ?? status.slides[0]?.id ?? '';
      }
      select.disabled = !status.enabled || status.phase === 'starting' || !status.slides.length;
      select.onchange = () => jumpToSlide(select.value);
    }

    async function refresh() {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const status = await response.json();
      const toggle = document.getElementById('toggle');
      toggle.textContent = status.enabled ? 'Disable Loop' : 'Enable Loop';
      toggle.className = status.enabled ? 'enabled' : 'disabled';
      toggle.onclick = () => setEnabled(!status.enabled);
      const nextButton = document.getElementById('nextSlide');
      nextButton.disabled = !status.enabled || !status.current || !status.slides.length;
      nextButton.onclick = nextSlide;
      renderSlideOptions(status);
      document.getElementById('phase').textContent = status.phase;
      document.getElementById('current').textContent = status.current?.title ?? '-';
      document.getElementById('next').textContent = status.next?.title ?? '-';
      document.getElementById('timer').textContent = status.remainingSeconds == null ? '-' : Math.ceil(status.remainingSeconds) + 's';
      document.getElementById('cycle').textContent = status.cycle;
      document.getElementById('metadata').textContent = 'idle=' + status.metadata.idle + ' overridable=' + status.metadata.overridable;
      document.getElementById('issues').textContent = status.lastError ?? (status.issues.length ? status.issues.join(' | ') : 'OK');
      document.getElementById('raw').textContent = JSON.stringify(status, null, 2);
      const preview = document.getElementById('preview');
      const previewKey = status.current?.path && status.lastUploadAt
        ? status.current.path + ':' + status.lastUploadAt
        : '';
      if (preview.dataset.key !== previewKey) {
        preview.dataset.key = previewKey;
        preview.src = previewKey ? '/current.webp?t=' + encodeURIComponent(previewKey) : '';
      }
    }

    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

function startWebServer(options) {
  if (!options.webEnabled) return null;

  const app = new Hono();

  app.onError((error, context) => {
    appState.lastError = error instanceof Error ? error.message : String(error);
    return context.json({ error: appState.lastError }, 500);
  });

  app.get("/", (context) => context.html(webPage()));

  app.get("/api/status", (context) => context.json(statusPayload(options)));

  app.post("/api/enabled", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    appState.enabled = Boolean(body.enabled);
    appState.phase = appState.enabled ? "enabled" : "disabled";
    appState.lastError = null;
    appState.requestedSlideId = null;
    if (!appState.enabled) {
      await removeLocalImage(options.host);
      appState.current = null;
      appState.next = null;
      appState.remainingSeconds = null;
    }
    return context.json(statusPayload(options));
  });

  app.post("/api/slides/next", (context) => {
    if (!appState.slides.length) {
      return context.json({ error: "No slides have been rendered yet" }, 409);
    }

    const currentIndex = appState.slides.findIndex((slide) => slide.id === appState.current?.id);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % appState.slides.length;
    appState.requestedSlideId = appState.slides[nextIndex].id;
    appState.lastError = null;
    return context.json(statusPayload(options));
  });

  app.post("/api/slides/jump", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const requestedSlideId = String(body.id ?? "");
    if (!appState.slides.some((slide) => slide.id === requestedSlideId)) {
      return context.json({ error: `Unknown slide: ${requestedSlideId}` }, 404);
    }

    appState.requestedSlideId = requestedSlideId;
    appState.lastError = null;
    return context.json(statusPayload(options));
  });

  app.get("/current.webp", async (context) => {
    if (!appState.current?.path) {
      return context.text("No current slide", 404);
    }
    return new Response(await readFile(appState.current.path), {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/webp"
      }
    });
  });

  const server = serve(
    {
      fetch: app.fetch,
      hostname: "0.0.0.0",
      port: options.webPort
    },
    () => {
      if (!process.stdout.isTTY) {
        console.log(`Web UI listening on http://0.0.0.0:${options.webPort}`);
      }
    }
  );

  server.on("error", (error) => {
      appState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
  });
  webServer = server;
  return server;
}

function closeWebServer() {
  if (!webServer) return;
  webServer.close();
  webServer = null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function consumeSlideRequest(slides, currentIndex) {
  if (!appState.requestedSlideId) return null;

  const requestedIndex = slides.findIndex((slide) => slide.slide.id === appState.requestedSlideId);
  appState.requestedSlideId = null;

  if (requestedIndex === -1 || requestedIndex === currentIndex) return null;
  return requestedIndex;
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
  const headerRows = 11;
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
    `Web UI: ${webUiAddress(current.options)}`,
    issueLine,
    `Metadata: idle=true  overridable=${!current.options.devMode}`,
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
    const requestedIndex = consumeSlideRequest(rendered, index);
    if (requestedIndex !== null) return { completed: false, requestedIndex };

    const elapsed = Date.now() - started;
    const remainingMs = Math.max(0, durationMs - elapsed);
    appState.remainingSeconds = remainingMs / 1000;
    renderTui(rendered, index, remainingMs / 1000, "Live", cycle);
    if (!appState.enabled) return { completed: false };
    if (remainingMs === 0) return { completed: true };
    await sleep(Math.min(250, remainingMs));
  }
}

async function shutdown(options, exitCode = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  restoreTui();
  closeWebServer();
  await cleanupDevImage(options);
  process.exit(exitCode);
}

function setupShutdownHandlers(options) {
  process.once("SIGINT", () => {
    shutdown(options, 130);
  });
  process.once("SIGTERM", () => {
    shutdown(options, 143);
  });
  process.once("exit", restoreTui);
}

function setupTui(options) {
  if (!process.stdout.isTTY) return;

  tuiActive = true;
  term.fullscreen();
  term.hideCursor();
  term.grabInput();

  term.on("key", (name) => {
    if (name === "CTRL_C" || name === "q" || name === "Q") {
      shutdown(options, 130);
    }
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
  appState.slides = slides.map((slide) => ({
    id: slide.slide.id,
    title: slide.slide.title,
    path: slide.path,
    durationSeconds: slide.durationSeconds,
    renderedSeconds: slide.renderedSeconds
  }));

  let index = 0;
  while (index < slides.length) {
    if (!appState.enabled) return false;
    const requestedIndex = consumeSlideRequest(slides, index);
    if (requestedIndex !== null) {
      index = requestedIndex;
    }

    const renderedSlide = slides[index];
    const nextSlide = slides[(index + 1) % slides.length];
    appState.phase = "uploading";
    appState.cycle = cycle;
    appState.current = {
      id: renderedSlide.slide.id,
      title: renderedSlide.slide.title,
      path: renderedSlide.path
    };
    appState.next = {
      id: nextSlide.slide.id,
      title: nextSlide.slide.title,
      path: nextSlide.path
    };
    appState.remainingSeconds = renderedSlide.durationSeconds;
    appState.issues = renderedSlide.dataIssues;
    appState.lastError = null;
    renderTui(slides, index, renderedSlide.durationSeconds, "Uploading", cycle);
    await uploadSlide(options.host, renderedSlide, options);
    appState.lastUploadAt = new Date().toISOString();
    if (!process.stdout.isTTY) {
      console.log(`Uploaded ${renderedSlide.slide.id}`);
    }
    appState.phase = "live";
    const result = await waitForSlide(slides, index, cycle);
    if (!result.completed && result.requestedIndex !== undefined) {
      index = result.requestedIndex;
      continue;
    }
    if (!result.completed) return false;
    index += 1;
  }

  return true;
}

async function runLoop(options) {
  let cycle = 1;
  while (true) {
    if (!appState.enabled) {
      appState.phase = "disabled";
      appState.remainingSeconds = null;
      await sleep(500);
      continue;
    }

    const completed = await runOnce(options, cycle);
    if (completed) {
      cycle += 1;
    }
  }
}

async function main() {
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
    return;
  }

  setupShutdownHandlers(options);
  setupTui(options);
  startWebServer(options);

  try {
    if (options.command === "once") {
      await runOnce(options);
      await cleanupDevImage(options);
      restoreTui();
      closeWebServer();
    } else {
      await runLoop(options);
    }
  } catch (error) {
    restoreTui();
    closeWebServer();
    await cleanupDevImage(options);
    throw error;
  }
}

await main();
