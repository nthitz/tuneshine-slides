import sharp from "sharp";
import terminalKit from "terminal-kit";

const term = terminalKit.terminal;
const ANSI_RESET = "\x1b[0m";
let tuiActive = false;
let tuiRestored = false;

function webUiAddress(options) {
  return options.webEnabled ? `http://localhost:${options.webPort}` : "disabled";
}

function terminalColor([red, green, blue]) {
  return `${red};${green};${blue}`;
}

async function createTerminalPreview(imagePath, width) {
  const image = sharp(imagePath, { animated: false })
    .ensureAlpha()
    .resize({ width, height: width, kernel: "nearest", fit: "fill" });

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const lines = [];

  for (let y = 0; y < info.height; y += 1) {
    let line = "";
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const color = [data[offset], data[offset + 1], data[offset + 2]];
      line += `\x1b[48;2;${terminalColor(color)}m  `;
    }
    lines.push(`${line}${ANSI_RESET}`);
  }

  return { lines, width: info.width * 2 };
}

export async function addTerminalPreviews(rendered) {
  if (!process.stdout.isTTY) return rendered;

  const terminalWidth = term.width || process.stdout.columns || 80;
  const terminalHeight = term.height || process.stdout.rows || 40;
  const headerRows = 11;
  const maxByWidth = Math.floor((terminalWidth - 2) / 2);
  const maxByHeight = terminalHeight - headerRows;
  const previewSize = Math.max(8, Math.min(32, maxByWidth, maxByHeight));

  return Promise.all(
    rendered.map(async (item) => {
      const preview = await createTerminalPreview(item.path, previewSize);
      return {
        ...item,
        preview: preview.lines,
        previewWidth: preview.width
      };
    })
  );
}

function progressBar(remainingSeconds, totalSeconds, width = 28) {
  const elapsed = Math.max(0, totalSeconds - remainingSeconds);
  const filled = Math.min(width, Math.round((elapsed / totalSeconds) * width));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function previewPair(current, next) {
  const terminalWidth = term.width || process.stdout.columns || 80;
  const showNextPreview = terminalWidth >= current.previewWidth + next.previewWidth + 2;
  if (!showNextPreview) {
    return current.preview.join("\n");
  }

  const lines = [];
  const rowCount = Math.max(current.preview.length, next.preview.length);
  for (let index = 0; index < rowCount; index += 1) {
    const left = current.preview[index] ?? "";
    const right = next.preview[index] ?? "";
    lines.push(`${left}  ${right}`);
  }
  return lines.join("\n");
}

export function renderTui(rendered, index, remainingSeconds, status, cycle) {
  if (!process.stdout.isTTY) return;

  const current = rendered[index];
  const next = rendered[(index + 1) % rendered.length];
  const totalSeconds = current.durationSeconds;
  const terminalWidth = term.width || process.stdout.columns || 80;
  const showNextPreview = terminalWidth >= current.previewWidth + next.previewWidth + 2;
  const label = showNextPreview ? "Current / Next" : "Current";
  const issueLine =
    current.dataIssues.length > 0 ? `API: ${current.dataIssues.join(" | ")}` : "API: OK";
  const lines = [
    `Tuneshine Dashboard  cycle ${cycle}`,
    "",
    `${label}: ${current.slide.title} -> ${next.slide.title}`,
    `Status: ${status}`,
    `Web UI: ${webUiAddress(current.options)}`,
    issueLine,
    `Metadata: idle=true  overridable=${!current.options.devMode}`,
    `Cadence: ${current.durationSeconds}s  WebP: ${current.renderedSeconds.toFixed(1)}s`,
    `Timer: ${String(Math.ceil(remainingSeconds)).padStart(2, " ")}s  ${progressBar(
      remainingSeconds,
      totalSeconds
    )}`,
    "",
    previewPair(current, next),
    "",
    "Press Ctrl+C to stop."
  ];

  term.moveTo(1, 1);
  term.eraseDisplay();
  lines.forEach((line, lineIndex) => {
    term.moveTo(1, lineIndex + 1);
    term(line);
  });
}

export function setupTui(onShutdown) {
  if (!process.stdout.isTTY) return;

  tuiActive = true;
  term.fullscreen();
  term.hideCursor();
  term.grabInput();

  term.on("key", (name) => {
    if (name === "CTRL_C" || name === "q" || name === "Q") {
      onShutdown(130);
    }
  });
}

export function restoreTui() {
  if (!tuiActive || tuiRestored) return;

  tuiRestored = true;
  term.styleReset();
  term.hideCursor(false);
  term.grabInput(false);
  term.fullscreen(false);
}
