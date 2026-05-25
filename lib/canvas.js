import { CHANNELS, HEIGHT, WIDTH } from "./constants.js";

export class Canvas {
  constructor(buffer, frameIndex) {
    this.buffer = buffer;
    this.frameIndex = frameIndex;
    this.width = WIDTH;
    this.height = HEIGHT;
  }

  pixel(x, y, color) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    const offset = ((this.frameIndex * HEIGHT + y) * WIDTH + x) * CHANNELS;
    this.buffer[offset] = color[0];
    this.buffer[offset + 1] = color[1];
    this.buffer[offset + 2] = color[2];
    this.buffer[offset + 3] = color[3];
  }

  rect(x, y, width, height, color) {
    for (let yy = y; yy < y + height; yy += 1) {
      for (let xx = x; xx < x + width; xx += 1) {
        this.pixel(xx, yy, color);
      }
    }
  }

  line(x1, y1, x2, y2, color) {
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    let x = x1;
    let y = y1;

    while (true) {
      this.pixel(x, y, color);
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}
