import { palette } from "../../lib/constants.js";
import { drawCenteredText, drawText, textWidth } from "../../lib/font.js";
import { drawBackground } from "../../lib/rendering.js";

const miniFont = {
  " ": ["0", "0", "0", "0", "0"],
  "?": ["111", "001", "011", "000", "010"],
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["111", "100", "101", "101", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  R: ["110", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"]
};

function miniTextWidth(text) {
  return Array.from(text.toUpperCase()).reduce((width, character, index, chars) => {
    const glyph = miniFont[character] ?? miniFont["?"];
    const glyphWidth = Math.max(...glyph.map((row) => row.length));
    return width + glyphWidth + (index === chars.length - 1 ? 0 : 1);
  }, 0);
}

function drawMiniText(canvas, text, x, y, color) {
  let cursorX = x;
  for (const character of text.toUpperCase()) {
    const glyph = miniFont[character] ?? miniFont["?"];
    const glyphWidth = Math.max(...glyph.map((row) => row.length));
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          canvas.pixel(cursorX + column, y + row, color);
        }
      }
    }
    cursorX += glyphWidth + 1;
  }
}

function wrapMiniText(text, maxWidth, maxLines = 2) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || miniTextWidth(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function drawDegree(canvas, x, y, color) {
  canvas.pixel(x + 1, y, color);
  canvas.pixel(x, y + 1, color);
  canvas.pixel(x + 2, y + 1, color);
  canvas.pixel(x + 1, y + 2, color);
}

function drawWeatherText(canvas, weather) {
  const temperature = String(weather.temp);
  const temperatureX = 5;
  const conditionX = 28;

  drawText(canvas, temperature, temperatureX, 48, palette.text, 1);
  drawDegree(canvas, temperatureX + textWidth(temperature) + 1, 48, palette.muted);

  const lines = wrapMiniText(weather.label, 64 - conditionX - 2);
  lines.forEach((line, index) => {
    drawMiniText(canvas, line, conditionX, 46 + index * 7, palette.yellow);
  });
}

function drawSun(canvas, cx, cy, tick) {
  const rays = tick % 2;
  canvas.rect(cx - 4, cy - 4, 9, 9, palette.yellow);
  canvas.rect(cx - 2, cy - 2, 5, 5, palette.orange);
  canvas.pixel(cx, cy - 8 - rays, palette.yellow);
  canvas.pixel(cx, cy + 8 + rays, palette.yellow);
  canvas.pixel(cx - 8 - rays, cy, palette.yellow);
  canvas.pixel(cx + 8 + rays, cy, palette.yellow);
  canvas.line(cx - 7, cy - 7, cx - 5, cy - 5, palette.yellow);
  canvas.line(cx + 5, cy - 5, cx + 7, cy - 7, palette.yellow);
  canvas.line(cx - 7, cy + 7, cx - 5, cy + 5, palette.yellow);
  canvas.line(cx + 5, cy + 5, cx + 7, cy + 7, palette.yellow);
}

function drawMoon(canvas, cx, cy) {
  canvas.rect(cx - 5, cy - 7, 9, 15, palette.yellow);
  canvas.rect(cx - 1, cy - 7, 8, 15, palette.bg);
  canvas.pixel(cx - 6, cy - 3, palette.yellow);
  canvas.pixel(cx - 6, cy + 4, palette.yellow);
  canvas.pixel(cx - 2, cy + 8, palette.yellow);
}

function drawCloud(canvas, x, y, color = palette.muted) {
  canvas.rect(x + 5, y + 5, 29, 8, color);
  canvas.rect(x + 10, y, 12, 14, color);
  canvas.rect(x + 21, y + 2, 10, 12, color);
  canvas.rect(x + 3, y + 8, 33, 6, color);
}

function drawFog(canvas, tick) {
  drawCloud(canvas, 15, 11, palette.muted);
  for (let y = 34; y <= 46; y += 6) {
    const offset = (tick + y) % 4;
    canvas.line(12 + offset, y, 31 + offset, y, palette.muted);
    canvas.line(36 - offset, y, 52 - offset, y, palette.muted);
  }
}

function drawRain(canvas, tick, color = palette.cyan) {
  drawCloud(canvas, 15, 14, palette.muted);
  for (let x = 20; x <= 42; x += 7) {
    const y = 35 + ((tick + x) % 3);
    canvas.line(x, y, x - 2, y + 5, color);
  }
}

function drawDrizzle(canvas, tick) {
  drawCloud(canvas, 15, 14, palette.muted);
  for (let x = 22; x <= 40; x += 9) {
    const y = 36 + ((tick + x) % 2);
    canvas.pixel(x, y, palette.cyan);
    canvas.pixel(x - 1, y + 3, palette.cyan);
  }
}

function drawIceRain(canvas, tick) {
  drawRain(canvas, tick, palette.white);
  canvas.pixel(47, 39, palette.cyan);
  canvas.pixel(46, 40, palette.cyan);
  canvas.pixel(48, 40, palette.cyan);
  canvas.pixel(47, 41, palette.cyan);
}

function drawStorm(canvas) {
  drawCloud(canvas, 15, 14, palette.muted);
  canvas.line(31, 32, 25, 43, palette.yellow);
  canvas.line(25, 43, 34, 39, palette.yellow);
  canvas.line(34, 39, 29, 50, palette.yellow);
}

function drawSnow(canvas, tick) {
  drawCloud(canvas, 15, 14, palette.muted);
  for (let x = 21; x <= 43; x += 11) {
    const y = 38 + ((tick + x) % 4);
    canvas.pixel(x, y, palette.white);
    canvas.pixel(x - 1, y, palette.white);
    canvas.pixel(x + 1, y, palette.white);
    canvas.pixel(x, y - 1, palette.white);
    canvas.pixel(x, y + 1, palette.white);
  }
}

function drawWind(canvas, tick) {
  for (let y = 17; y <= 41; y += 10) {
    const offset = (tick + y) % 5;
    canvas.line(11 + offset, y, 43 + offset, y, palette.cyan);
    canvas.line(43 + offset, y, 50 + offset, y - 4, palette.cyan);
  }
  drawCloud(canvas, 18, 22, palette.muted);
}

function drawUnknown(canvas) {
  drawCenteredText(canvas, "?", 20, palette.yellow, 2);
}

function drawWeatherIcon(canvas, icon, tick) {
  if (icon === "sun") {
    drawSun(canvas, 32, 22, tick);
    return;
  }
  if (icon === "moon") {
    drawMoon(canvas, 32, 22);
    return;
  }
  if (icon === "partly-cloudy-day") {
    drawSun(canvas, 24, 18, tick);
    drawCloud(canvas, 18, 25, palette.muted);
    return;
  }
  if (icon === "partly-cloudy-night") {
    drawMoon(canvas, 24, 18);
    drawCloud(canvas, 18, 25, palette.muted);
    return;
  }
  if (icon === "cloud") {
    drawCloud(canvas, 15, 18, palette.muted);
    return;
  }
  if (icon === "fog") {
    drawFog(canvas, tick);
    return;
  }
  if (icon === "drizzle") {
    drawDrizzle(canvas, tick);
    return;
  }
  if (icon === "rain") {
    drawRain(canvas, tick);
    return;
  }
  if (icon === "ice-rain") {
    drawIceRain(canvas, tick);
    return;
  }
  if (icon === "storm") {
    drawStorm(canvas);
    return;
  }
  if (icon === "snow") {
    drawSnow(canvas, tick);
    return;
  }
  if (icon === "wind") {
    drawWind(canvas, tick);
    return;
  }
  drawUnknown(canvas);
}

export default {
  id: "weather",
  title: "Oakland Weather",
  accent: palette.yellow,
  progressBar: true,
  fps: 10,
  metadata: { trackName: "Oakland Weather", artistName: "Dashboard", serviceName: "Local" },
  render(canvas, tick, data) {
    drawBackground(canvas, palette.yellow);
    if (data.weather.error) {
      drawCenteredText(canvas, "WX ERR", 22, palette.red, 1);
      drawCenteredText(canvas, "OAK", 38, palette.muted, 1);
      return;
    }

    drawWeatherIcon(canvas, data.weather.icon, tick);
    drawWeatherText(canvas, data.weather);
  }
};
