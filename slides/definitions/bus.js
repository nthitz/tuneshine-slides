import { palette } from "../../lib/constants.js";
import { drawCenteredText, drawText } from "../../lib/font.js";
import { drawBackground } from "../../lib/rendering.js";

function drawBusIcon(canvas, x, y) {
  canvas.rect(x, y, 18, 14, palette.green);
  canvas.rect(x + 2, y + 2, 14, 5, palette.bg);
  canvas.rect(x + 3, y + 3, 5, 3, palette.cyan);
  canvas.rect(x + 10, y + 3, 5, 3, palette.cyan);
  canvas.rect(x + 3, y + 9, 3, 2, palette.bg);
  canvas.rect(x + 12, y + 9, 3, 2, palette.bg);
  canvas.rect(x + 3, y + 13, 3, 2, palette.black);
  canvas.rect(x + 12, y + 13, 3, 2, palette.black);
}

function routeLine(route) {
  const times =
    route.minutes.length > 0 ? route.minutes.map((minutes) => `${minutes}M`).join(",") : "--";
  return `${route.route}: ${times}`;
}

export default {
  id: "bus",
  title: "AC Transit",
  accent: palette.green,
  progressBar: true,
  fps: 10,
  metadata: { trackName: "AC Transit", artistName: "Dashboard", serviceName: "Local" },
  render(canvas, tick, data) {
    drawBackground(canvas, palette.green);
    drawBusIcon(canvas, 3, 9 + (tick % 2));
    drawText(canvas, "AC", 25, 12, palette.green, 1);

    if (data.bus.error) {
      if (data.bus.error.toUpperCase().includes("ACTIVATED")) {
        drawCenteredText(canvas, "ACTIVATE", 28, palette.yellow, 1);
        drawCenteredText(canvas, "TOKEN", 42, palette.muted, 1);
        return;
      }
      drawCenteredText(canvas, "BUS ERR", 30, palette.red, 1);
      return;
    }

    if (data.bus.missingToken) {
      drawCenteredText(canvas, "AC TOKEN?", 30, palette.yellow, 1);
      drawCenteredText(canvas, "SET ENV", 44, palette.muted, 1);
      return;
    }

    const routes = data.bus.routes ?? [];
    if (routes.length === 0) {
      drawCenteredText(canvas, "NO BUS", 31, palette.yellow, 1);
      return;
    }

    routes.forEach((route, index) => {
      const y = 32 + index * 13;
      const color = route.minutes.some((minutes) => minutes <= 5) ? palette.red : palette.text;
      drawText(canvas, routeLine(route), 4, y, color, 1);
    });
  }
};
