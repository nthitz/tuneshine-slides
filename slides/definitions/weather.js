import { palette } from "../../lib/constants.js";
import { drawCenteredText, drawText } from "../../lib/font.js";
import { drawBackground } from "../../lib/rendering.js";

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

function drawCloud(canvas, x, y, color = palette.muted) {
  canvas.rect(x + 5, y + 5, 29, 8, color);
  canvas.rect(x + 10, y, 12, 14, color);
  canvas.rect(x + 21, y + 2, 10, 12, color);
  canvas.rect(x + 3, y + 8, 33, 6, color);
}

function drawWeatherIcon(canvas, icon, tick) {
  if (icon === "sun") {
    drawSun(canvas, 32, 22, tick);
    return;
  }
  if (icon === "rain") {
    drawCloud(canvas, 15, 14, palette.muted);
    for (let x = 20; x <= 42; x += 7) {
      const y = 35 + ((tick + x) % 3);
      canvas.line(x, y, x - 2, y + 5, palette.cyan);
    }
    return;
  }
  if (icon === "storm") {
    drawCloud(canvas, 15, 14, palette.muted);
    canvas.line(31, 32, 25, 43, palette.yellow);
    canvas.line(25, 43, 34, 39, palette.yellow);
    canvas.line(34, 39, 29, 50, palette.yellow);
    return;
  }
  if (icon === "snow") {
    drawCloud(canvas, 15, 14, palette.muted);
    for (let x = 21; x <= 43; x += 11) {
      const y = 38 + ((tick + x) % 4);
      canvas.pixel(x, y, palette.white);
      canvas.pixel(x - 1, y, palette.white);
      canvas.pixel(x + 1, y, palette.white);
      canvas.pixel(x, y - 1, palette.white);
      canvas.pixel(x, y + 1, palette.white);
    }
    return;
  }
  drawCloud(canvas, 15, 18, palette.muted);
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
    drawText(canvas, `${data.weather.temp}`, 5, 47, palette.text, 1);
    drawText(canvas, "F", 24, 47, palette.muted, 1);
    drawText(canvas, data.weather.label.slice(0, 5), 35, 47, palette.yellow, 1);
  }
};
