#!/usr/bin/env node

import sharp from "sharp";

const WIDTH = 64;
const HEIGHT = 64;
const CHANNELS = 4;
const SCALE = 2;
const OUTPUT = "nick-loves-jenn.webp";

const palette = {
  bg: [13, 15, 28, 255],
  grid: [24, 29, 52, 255],
  shadow: [2, 3, 8, 180],
  nick: [92, 220, 255, 255],
  loves: [255, 92, 146, 255],
  jenn: [255, 224, 117, 255],
  sparkle: [255, 255, 255, 255]
};

const font = {
  " ": ["0", "0", "0", "0", "0", "0", "0"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  i: ["1", "0", "1", "1", "1", "1", "1"],
  c: ["0111", "1000", "1000", "1000", "1000", "1000", "0111"],
  k: ["1001", "1010", "1100", "1000", "1100", "1010", "1001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  o: ["0110", "1001", "1001", "1001", "1001", "1001", "0110"],
  v: ["1001", "1001", "1001", "1001", "1001", "0110", "0110"],
  e: ["0110", "1001", "1111", "1000", "1000", "1001", "0110"],
  s: ["0111", "1000", "1000", "0110", "0001", "0001", "1110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  n: ["0000", "1110", "1001", "1001", "1001", "1001", "1001"]
};

const frames = [
  { text: "Nick", color: palette.nick, sparkles: [[9, 10], [52, 48]] },
  { text: "Loves", color: palette.loves, sparkles: [[51, 12], [11, 50]] },
  { text: "Jenn", color: palette.jenn, sparkles: [[12, 13], [52, 51]] }
];

function setPixel(buffer, frame, x, y, color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    return;
  }

  const offset = ((frame * HEIGHT + y) * WIDTH + x) * CHANNELS;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function fillRect(buffer, frame, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(buffer, frame, xx, yy, color);
    }
  }
}

function drawBackground(buffer, frame) {
  fillRect(buffer, frame, 0, 0, WIDTH, HEIGHT, palette.bg);

  for (let y = 0; y < HEIGHT; y += 8) {
    for (let x = 0; x < WIDTH; x += 8) {
      setPixel(buffer, frame, x, y, palette.grid);
    }
  }

  fillRect(buffer, frame, 2, 2, WIDTH - 4, 1, palette.grid);
  fillRect(buffer, frame, 2, HEIGHT - 3, WIDTH - 4, 1, palette.grid);
  fillRect(buffer, frame, 2, 2, 1, HEIGHT - 4, palette.grid);
  fillRect(buffer, frame, WIDTH - 3, 2, 1, HEIGHT - 4, palette.grid);
}

function textWidth(text) {
  return Array.from(text).reduce((width, character, index) => {
    const glyph = font[character];
    if (!glyph) {
      throw new Error(`Missing glyph for ${character}`);
    }

    const glyphWidth = Math.max(...glyph.map((row) => row.length));
    const gap = index === text.length - 1 ? 0 : 1;
    return width + glyphWidth + gap;
  }, 0);
}

function drawText(buffer, frame, text, startX, startY, color, offsetX = 0, offsetY = 0) {
  let cursorX = startX + offsetX;

  for (const character of text) {
    const glyph = font[character];
    const glyphWidth = Math.max(...glyph.map((row) => row.length));

    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          fillRect(
            buffer,
            frame,
            cursorX + column * SCALE,
            startY + offsetY + row * SCALE,
            SCALE,
            SCALE,
            color
          );
        }
      }
    }

    cursorX += (glyphWidth + 1) * SCALE;
  }
}

function drawSparkle(buffer, frame, x, y) {
  setPixel(buffer, frame, x, y - 2, palette.sparkle);
  setPixel(buffer, frame, x, y + 2, palette.sparkle);
  setPixel(buffer, frame, x - 2, y, palette.sparkle);
  setPixel(buffer, frame, x + 2, y, palette.sparkle);
  fillRect(buffer, frame, x - 1, y - 1, 3, 3, palette.sparkle);
}

const frameBuffer = Buffer.alloc(WIDTH * HEIGHT * frames.length * CHANNELS);

frames.forEach((frame, index) => {
  drawBackground(frameBuffer, index);

  const width = textWidth(frame.text) * SCALE;
  const x = Math.floor((WIDTH - width) / 2);
  const y = Math.floor((HEIGHT - 7 * SCALE) / 2);

  drawText(frameBuffer, index, frame.text, x, y, palette.shadow, 2, 2);
  drawText(frameBuffer, index, frame.text, x, y, frame.color);

  for (const [sparkleX, sparkleY] of frame.sparkles) {
    drawSparkle(frameBuffer, index, sparkleX, sparkleY);
  }
});

await sharp(frameBuffer, {
  raw: {
    width: WIDTH,
    height: HEIGHT * frames.length,
    channels: CHANNELS,
    pageHeight: HEIGHT
  },
  animated: true
})
  .webp({
    delay: frames.map(() => 1000),
    loop: 0,
    lossless: true,
    effort: 6
  })
  .toFile(OUTPUT);

const metadata = await sharp(OUTPUT, { animated: true }).metadata();
console.log(
  `Wrote ${OUTPUT}: ${metadata.width}x${metadata.pageHeight}, ${metadata.pages} frames, ${metadata.delay.join(",")} ms delays`
);
