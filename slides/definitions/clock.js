import { palette } from "../../lib/constants.js";
import { drawCenteredText } from "../../lib/font.js";
import { drawBackground } from "../../lib/rendering.js";

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

    drawCenteredText(canvas, time, 15, palette.cyan, 2);
    drawCenteredText(canvas, date, 37, palette.text, 1);
    canvas.rect(19, 51, 26, 2, palette.dim);
    canvas.pixel(23 + (tick % 18), 51, palette.white);
  }
};
