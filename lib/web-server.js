import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { appState } from "./dashboard-state.js";
import {
  fetchDeviceBrightness,
  removeLocalImage,
  setDeviceBrightness
} from "./tuneshine-device.js";

let webServer = null;

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
    .slider { display: grid; gap: 6px; min-width: 220px; }
    .slider-row { display: flex; align-items: center; gap: 10px; }
    input[type="range"] { width: 180px; accent-color: #5fe88b; }
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
        <div><div class="label">Plex</div><div id="plex" class="value"></div></div>
      </div>
    </section>
    <section>
      <div class="label">Controls</div>
      <div class="controls">
        <button id="nextSlide">Next Slide</button>
        <select id="slideSelect" aria-label="Slide"></select>
        <div class="slider">
          <div class="label">Brightness</div>
          <div class="slider-row">
            <input id="brightness" type="range" min="1" max="100" disabled>
            <span id="brightnessValue" class="value">-</span>
          </div>
        </div>
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

    async function loadBrightness() {
      const input = document.getElementById('brightness');
      const value = document.getElementById('brightnessValue');
      try {
        const response = await fetch('/api/brightness', { cache: 'no-store' });
        const brightness = await response.json();
        if (!response.ok) throw new Error(brightness.error ?? 'Brightness unavailable');
        const current = brightness.idle ?? brightness.active;
        if (document.activeElement !== input) {
          input.value = current;
        }
        input.disabled = false;
        value.textContent = current + '%';
      } catch (error) {
        input.disabled = true;
        value.textContent = '-';
      }
    }

    async function setBrightness(brightness) {
      const value = document.getElementById('brightnessValue');
      value.textContent = brightness + '%';
      await fetch('/api/brightness', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brightness: Number(brightness) })
      });
      await loadBrightness();
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
      const brightness = document.getElementById('brightness');
      brightness.oninput = () => {
        document.getElementById('brightnessValue').textContent = brightness.value + '%';
      };
      brightness.onchange = () => setBrightness(brightness.value);
      renderSlideOptions(status);
      document.getElementById('phase').textContent = status.phase;
      document.getElementById('current').textContent = status.current?.title ?? '-';
      document.getElementById('next').textContent = status.next?.title ?? '-';
      document.getElementById('timer').textContent = status.remainingSeconds == null ? '-' : Math.ceil(status.remainingSeconds) + 's';
      document.getElementById('cycle').textContent = status.cycle;
      document.getElementById('metadata').textContent = 'idle=' + status.metadata.idle + ' overridable=' + status.metadata.overridable;
      document.getElementById('plex').textContent = status.plex.active
        ? status.plex.title + ' (' + status.plex.server + ')'
        : (status.plex.enabled ? 'Watching' : 'Disabled');
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
    loadBrightness();
    setInterval(refresh, 1000);
    setInterval(loadBrightness, 30000);
  </script>
</body>
</html>`;
}

export function startWebServer(options) {
  if (!options.webEnabled) return null;

  const app = new Hono();

  app.onError((error, context) => {
    appState.lastError = error instanceof Error ? error.message : String(error);
    return context.json({ error: appState.lastError }, 500);
  });

  app.get("/", (context) => context.html(webPage()));

  app.get("/api/status", (context) => context.json(statusPayload(options)));

  app.get("/api/brightness", async (context) => {
    const brightness = await fetchDeviceBrightness(options.host);
    return context.json(brightness);
  });

  app.post("/api/brightness", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const brightness = await setDeviceBrightness(options.host, body.brightness);
    return context.json(brightness);
  });

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

export function closeWebServer() {
  if (!webServer) return;
  webServer.close();
  webServer = null;
}
