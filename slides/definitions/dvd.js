import {
  DEFAULT_DVD_SECONDS,
  palette,
  WIDTH,
  HEIGHT
} from "../../lib/constants.js";
import { drawBackground } from "../../lib/rendering.js";

const dvdGlyph = [
  "11110010001011110",
  "10001010001010001",
  "10001010001010001",
  "10001010001010001",
  "10001010001010001",
  "10001001010010001",
  "11110000100011110"
];
const logoScale = 2;
const logoTextWidth = dvdGlyph[0].length * logoScale + 4;
const logoWidth = logoTextWidth;
const logoHeight = dvdGlyph.length * logoScale + 7;
const colors = [palette.pink, palette.cyan, palette.yellow, palette.green, palette.orange];

let animationConfig = null;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function createAnimationConfig(maxX, maxY, frameCount) {
  const cornerStart = Math.random() < 0.25;
  const dx = Math.random() < 0.5 ? -1 : 1;
  const dy = Math.random() < 0.5 ? -1 : 1;

  if (cornerStart) {
    const targetX = dx > 0 ? maxX : 0;
    const targetY = dy > 0 ? maxY : 0;
    const latestCornerFrame = Math.min(maxX, maxY, frameCount - 10);
    const cornerFrame = randomInt(7, Math.max(7, latestCornerFrame));

    return {
      x: targetX - dx * cornerFrame,
      y: targetY - dy * cornerFrame,
      dx,
      dy,
      colorOffset: randomInt(0, colors.length - 1)
    };
  }

  return {
    x: randomInt(0, maxX),
    y: randomInt(0, maxY),
    dx,
    dy,
    colorOffset: randomInt(0, colors.length - 1)
  };
}

function drawDvdLogo(canvas, x, y, color) {
  const textOffsetX = 2;
  for (let row = 0; row < dvdGlyph.length; row += 1) {
    const skew = Math.floor((dvdGlyph.length - 1 - row) / 3);
    for (let column = 0; column < dvdGlyph[row].length; column += 1) {
      if (dvdGlyph[row][column] === "1") {
        canvas.rect(
          x + textOffsetX + column * logoScale + skew,
          y + row * logoScale,
          logoScale,
          logoScale,
          color
        );
      }
    }
  }

  const ovalY = y + dvdGlyph.length * logoScale + 1;
  canvas.rect(x + 5, ovalY + 1, logoTextWidth - 10, 1, color);
  canvas.rect(x + 2, ovalY + 2, logoTextWidth - 4, 1, color);
  canvas.rect(x + 1, ovalY + 3, logoTextWidth - 2, 1, color);
  canvas.rect(x + 2, ovalY + 4, logoTextWidth - 4, 1, color);
  canvas.rect(x + 5, ovalY + 5, logoTextWidth - 10, 1, color);
  canvas.pixel(x + 4, ovalY + 1, color);
  canvas.pixel(x + logoTextWidth - 5, ovalY + 1, color);
  canvas.pixel(x + 4, ovalY + 5, color);
  canvas.pixel(x + logoTextWidth - 5, ovalY + 5, color);
  canvas.rect(x + 16, ovalY + 3, logoTextWidth - 32, 1, [5, 6, 13, 255]);
}

function moveStep(state, maxX, maxY) {
  let nextX = state.x + state.dx;
  let nextY = state.y + state.dy;
  let hitX = false;
  let hitY = false;

  if (nextX < 0 || nextX > maxX) {
    hitX = true;
    state.dx *= -1;
    nextX = state.x + state.dx;
  }
  if (nextY < 0 || nextY > maxY) {
    hitY = true;
    state.dy *= -1;
    nextY = state.y + state.dy;
  }

  state.x = nextX;
  state.y = nextY;
  return { hitX, hitY };
}

function frameState(config, tick, maxX, maxY) {
  const state = { ...config, colorChanges: 0, cornerHit: null };

  for (let frame = 1; frame <= tick; frame += 1) {
    const collision = moveStep(state, maxX, maxY);
    if (collision.hitX || collision.hitY) {
      state.colorChanges += 1;
    }
    if (collision.hitX && collision.hitY) {
      state.cornerHit = { frame, x: state.x, y: state.y };
    }
  }

  return state;
}

function drawFireworks(canvas, x, y, age) {
  if (age < 0 || age > 10) return;

  const burst = Math.min(9, age + 2);
  const fireworkColors = [palette.yellow, palette.cyan, palette.orange, palette.green, palette.pink];
  const centerX = x <= 0 ? 2 : WIDTH - 3;
  const centerY = y <= 0 ? 2 : HEIGHT - 3;
  const vectors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1]
  ];

  for (let index = 0; index < vectors.length; index += 1) {
    const [dx, dy] = vectors[index];
    const color = fireworkColors[index % fireworkColors.length];
    canvas.line(centerX, centerY, centerX + dx * burst, centerY + dy * burst, color);
    if (age > 3) {
      canvas.pixel(centerX + dx * (burst + 2), centerY + dy * (burst + 1), color);
    }
  }
}

export default {
  id: "dvd",
  title: "DVD",
  accent: palette.pink,
  progressBar: false,
  durationSeconds: DEFAULT_DVD_SECONDS,
  loopProof: true,
  fps: 5,
  metadata: { trackName: "DVD", artistName: "Dashboard", serviceName: "Local" },
  render(canvas, tick, data, context) {
    drawBackground(canvas, palette.pink);
    const maxX = WIDTH - logoWidth - 1;
    const maxY = HEIGHT - logoHeight - 1;
    if (tick === 0 || !animationConfig) {
      animationConfig = createAnimationConfig(maxX, maxY, context.frameCount);
    }
    const state = frameState(animationConfig, tick, maxX, maxY);
    const color = colors[(animationConfig.colorOffset + state.colorChanges) % colors.length];

    canvas.rect(0, 0, WIDTH, HEIGHT, [5, 6, 13, 255]);
    for (let dotY = 7; dotY < HEIGHT; dotY += 10) {
      for (let dotX = 4; dotX < WIDTH; dotX += 10) {
        canvas.pixel(dotX, dotY, palette.dim);
      }
    }
    if (state.cornerHit) {
      drawFireworks(canvas, state.cornerHit.x, state.cornerHit.y, tick - state.cornerHit.frame);
    }
    drawDvdLogo(canvas, state.x, state.y, color);
  }
};
