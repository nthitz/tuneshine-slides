import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Canvas } from "./canvas.js";
import { CHANNELS, HEIGHT, OUT_DIR, palette, WIDTH } from "./constants.js";

export function colorWithAlpha(color, alpha) {
  return [color[0], color[1], color[2], alpha];
}

export function drawBackground(canvas, accent = palette.cyan) {
  const gridSpacing = 8;
  const gridOffset = Math.floor(gridSpacing / 2);

  canvas.rect(0, 0, WIDTH, HEIGHT, palette.bg);
  for (let y = gridOffset; y < HEIGHT; y += gridSpacing) {
    for (let x = gridOffset; x < WIDTH; x += gridSpacing) {
      canvas.pixel(x, y, colorWithAlpha(accent, 70));
    }
  }
}

export function drawDurationBar(canvas, frameIndex, frameCount, accent) {
  const remaining = Math.max(0, frameCount - frameIndex);
  const width = Math.ceil((remaining / frameCount) * WIDTH);
  canvas.rect(0, 0, WIDTH, 1, palette.panel);
  canvas.rect(0, 0, width, 1, colorWithAlpha(accent, 60));
}

export async function renderSlide(slide, data, seconds, renderSeconds = seconds) {
  const fps = slide.fps ?? 1;
  const durationFrameCount = Math.max(1, Math.ceil(seconds * fps));
  const frameCount = Math.max(durationFrameCount, Math.ceil(renderSeconds * fps));
  const delay = Math.round(1000 / fps);
  const buffer = Buffer.alloc(WIDTH * HEIGHT * frameCount * CHANNELS);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const canvas = new Canvas(buffer, frameIndex);
    slide.render(canvas, frameIndex, data, {
      seconds,
      renderSeconds,
      fps,
      frameCount,
      durationFrameCount,
      elapsedSeconds: frameIndex / fps
    });
    if (slide.progressBar) {
      drawDurationBar(canvas, frameIndex, durationFrameCount, slide.accent);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outputPath = path.join(OUT_DIR, `${slide.id}.webp`);
  await sharp(buffer, {
    raw: {
      width: WIDTH,
      height: HEIGHT * frameCount,
      channels: CHANNELS,
      pageHeight: HEIGHT
    },
    animated: true
  })
    .webp({
      delay: Array.from({ length: frameCount }, () => delay),
      loop: 0,
      lossless: true,
      effort: 6
    })
    .toFile(outputPath);

  return outputPath;
}
