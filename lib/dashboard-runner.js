import { stat } from "node:fs/promises";
import sharp from "sharp";
import { getSlideData } from "./data.js";
import {
  appState,
  inactivePlexStatus,
  markShutdownStarted,
  plexStatusFromMatch,
  shutdownStarted
} from "./dashboard-state.js";
import { findPlexPlayback, getPlexConfig, plexMetadata, renderPlexArtwork } from "./plex.js";
import { renderSlide } from "./rendering.js";
import { uploadImage, uploadSlide, removeLocalImage } from "./tuneshine-device.js";
import { addTerminalPreviews, renderTui, restoreTui, setupTui } from "./tui.js";
import { closeWebServer, startWebServer } from "./web-server.js";
import { slideRegistry } from "../slides/definitions/index.js";

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

export async function buildSlides(options) {
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

async function waitForSlide(rendered, index, cycle) {
  const started = Date.now();
  const durationMs = rendered[index].durationSeconds * 1000;

  while (true) {
    if (appState.plex.active) return { completed: false, plexActive: true };

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
  if (!markShutdownStarted()) return;
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
    if (result.plexActive) return false;
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
    if (appState.plex.active) {
      appState.phase = "plex";
      await sleep(500);
      continue;
    }

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

async function monitorPlex(options, plexConfig) {
  if (!plexConfig.enabled) return;

  appState.plex = inactivePlexStatus(true);
  let activeKey = null;
  let missedPolls = 0;

  while (!shutdownStarted) {
    try {
      const match = await findPlexPlayback(plexConfig);
      if (match?.error) {
        appState.plex = inactivePlexStatus(true, match.error);
      } else if (match) {
        missedPolls = 0;
        appState.plex = plexStatusFromMatch(match);

        if (match.key !== activeKey) {
          const artworkPath = await renderPlexArtwork(match);
          await uploadImage(options.host, artworkPath, plexMetadata(match, options));
          activeKey = match.key;
          appState.current = {
            id: "plex",
            title: match.title,
            path: artworkPath
          };
          appState.next = null;
          appState.remainingSeconds = null;
          appState.lastUploadAt = new Date().toISOString();
          appState.phase = "plex";
          if (!process.stdout.isTTY) {
            console.log(`Uploaded Plex artwork: ${match.title}`);
          }
        }
      } else if (activeKey) {
        missedPolls += 1;
        if (missedPolls >= 2) {
          activeKey = null;
          missedPolls = 0;
          appState.plex = inactivePlexStatus(true);
          appState.phase = "live";
        }
      } else {
        appState.plex = inactivePlexStatus(true);
      }
    } catch (error) {
      appState.plex = inactivePlexStatus(
        true,
        error instanceof Error ? error.message : String(error)
      );
    }

    await sleep(plexConfig.pollSeconds * 1000);
  }
}

async function printBuildOutput(options) {
  const rendered = await buildSlides(options);
  for (const item of rendered) {
    const delay = Array.isArray(item.delay) ? item.delay.join(",") : "static";
    console.log(
      `${item.path}: ${item.durationSeconds}s cadence, ${item.renderedSeconds.toFixed(
        1
      )}s webp, ${item.pages} frames, ${delay} ms, ${item.bytes} bytes`
    );
  }
}

export async function runDashboard(options) {
  const plexConfig = getPlexConfig();
  appState.plex = inactivePlexStatus(plexConfig.enabled);

  if (options.command === "build") {
    await printBuildOutput(options);
    return;
  }

  setupShutdownHandlers(options);
  setupTui((exitCode) => {
    shutdown(options, exitCode);
  });
  startWebServer(options);
  monitorPlex(options, plexConfig);

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
