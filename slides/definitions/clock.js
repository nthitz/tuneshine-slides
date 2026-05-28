import { palette } from "../../lib/constants.js";
import { drawCenteredText } from "../../lib/font.js";
import { drawBackground } from "../../lib/rendering.js";

const SEGMENTS = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
  2: ["a", "b", "g", "e", "d"],
  3: ["a", "b", "g", "c", "d"],
  4: ["f", "g", "b", "c"],
  5: ["a", "f", "g", "c", "d"],
  6: ["a", "f", "g", "e", "c", "d"],
  7: ["a", "b", "c"],
  8: ["a", "b", "c", "d", "e", "f", "g"],
  9: ["a", "b", "c", "d", "f", "g"]
};

const DIGIT_WIDTH = 7;
const NARROW_DIGIT_WIDTH = 4;
const COLON_WIDTH = 2;
const DIGIT_GAP = 1;

function characterWidth(character) {
  if (character === ":") return COLON_WIDTH;
  return character === "1" ? NARROW_DIGIT_WIDTH : DIGIT_WIDTH;
}

function digitalTimeWidth(time) {
  return Array.from(time).reduce((width, character, index) => {
    return width + characterWidth(character) + (index === time.length - 1 ? 0 : DIGIT_GAP);
  }, 0);
}

function drawSegment(canvas, segment, x, y, color) {
  const horizontal = {
    a: [x + 1, y, 5, 2],
    g: [x + 1, y + 5, 5, 2],
    d: [x + 1, y + 11, 5, 2]
  };
  const vertical = {
    f: [x, y + 1, 2, 5],
    b: [x + 5, y + 1, 2, 5],
    e: [x, y + 6, 2, 6],
    c: [x + 5, y + 6, 2, 6]
  };
  const rect = horizontal[segment] ?? vertical[segment];
  canvas.rect(...rect, color);
}

function drawDigitalDigit(canvas, digit, x, y, color) {
  const digitX = digit === "1" ? x - 3 : x;
  for (const segment of SEGMENTS[digit] ?? []) {
    drawSegment(canvas, segment, digitX, y, color);
  }
}

function drawDigitalColon(canvas, x, y, color) {
  canvas.rect(x, y + 3, 2, 2, color);
  canvas.rect(x, y + 8, 2, 2, color);
}

function drawDigitalTime(canvas, time, y, color) {
  let cursorX = Math.floor((canvas.width - digitalTimeWidth(time)) / 2);
  for (const character of time) {
    if (character === ":") {
      drawDigitalColon(canvas, cursorX, y, color);
    } else {
      drawDigitalDigit(canvas, character, cursorX, y, color);
    }
    cursorX += characterWidth(character) + DIGIT_GAP;
  }
}

export default {
  id: "clock",
  title: "Clock",
  accent: palette.cyan,
  progressBar: true,
  fps: 10,
  metadata: { trackName: "Clock", artistName: "Dashboard", serviceName: "Local" },
  render(canvas, tick, data, context) {
    drawBackground(canvas, palette.cyan);
    const now = new Date(data.now.getTime() + context.elapsedSeconds * 1000);
    const time = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "America/Los_Angeles"
    }).replace(/\s[AP]M$/, "");
    const date = now
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "America/Los_Angeles"
      })
      .replace(",", "");

    drawDigitalTime(canvas, time, 17, palette.cyan);
    drawCenteredText(canvas, date, 39, palette.text, 1);
  }
};
