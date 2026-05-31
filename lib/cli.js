import {
  DEFAULT_DVD_SECONDS,
  DEFAULT_LOOP_PROOF_SECONDS,
  DEFAULT_SLIDE_SECONDS,
  DEFAULT_TUNESHINE_HOST,
  DEFAULT_UPLOAD_DELAY_SECONDS
} from "./constants.js";

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

export function parseArgs(args) {
  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const options = {
    command: args[0] ?? "build",
    seconds: Number(process.env.SLIDE_SECONDS ?? DEFAULT_SLIDE_SECONDS),
    dvdSeconds: Number(process.env.DVD_SLIDE_SECONDS ?? DEFAULT_DVD_SECONDS),
    uploadDelay: Number(process.env.UPLOAD_DELAY_SECONDS ?? DEFAULT_UPLOAD_DELAY_SECONDS),
    loopProofDelay: Number(process.env.LOOP_PROOF_DELAY_SECONDS ?? DEFAULT_LOOP_PROOF_SECONDS),
    galleryDir: process.env.GALLERY_DIR,
    devMode: parseBoolean(process.env.DEV_MODE),
    webPort: parsePort(process.env.WEB_PORT ?? 3000),
    webEnabled: !parseBoolean(process.env.WEB_DISABLED),
    startEnabled: !parseBoolean(process.env.DASHBOARD_DISABLED),
    host: process.env.TUNESHINE_HOST ?? DEFAULT_TUNESHINE_HOST
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--seconds" || arg === "-s") {
      options.seconds = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--dvd-seconds") {
      options.dvdSeconds = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--upload-delay") {
      options.uploadDelay = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--loop-proof-delay") {
      options.loopProofDelay = Number(args[index + 1]);
      index += 1;
    } else if (arg === "--gallery-dir") {
      options.galleryDir = args[index + 1];
      index += 1;
    } else if (arg === "--dev-mode") {
      options.devMode = true;
    } else if (arg === "--web-port") {
      options.webPort = parsePort(args[index + 1]);
      index += 1;
    } else if (arg === "--no-web") {
      options.webEnabled = false;
    } else if (arg === "--disabled") {
      options.startEnabled = false;
    } else if (arg === "--host") {
      options.host = args[index + 1];
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["build", "once", "loop"].includes(options.command)) {
    throw new Error("Command must be build, once, or loop");
  }
  if (!Number.isFinite(options.seconds) || options.seconds < 1 || options.seconds > 60) {
    throw new Error("--seconds must be between 1 and 60");
  }
  if (!Number.isFinite(options.dvdSeconds) || options.dvdSeconds < 1 || options.dvdSeconds > 120) {
    throw new Error("--dvd-seconds must be between 1 and 120");
  }
  if (!Number.isFinite(options.uploadDelay) || options.uploadDelay < 0 || options.uploadDelay > 5) {
    throw new Error("--upload-delay must be between 0 and 5 seconds");
  }
  if (
    !Number.isFinite(options.loopProofDelay) ||
    options.loopProofDelay < 0 ||
    options.loopProofDelay > 30
  ) {
    throw new Error("--loop-proof-delay must be between 0 and 30 seconds");
  }
  if (options.webEnabled && !options.webPort) {
    throw new Error("--web-port must be between 1 and 65535");
  }

  options.seconds = Math.round(options.seconds);
  options.dvdSeconds = Math.round(options.dvdSeconds);
  return options;
}

export function printHelp() {
  console.log(`Usage: node tuneshine-dashboard.js <build|once|loop> [options]

Options:
  -s, --seconds <n>  Seconds each slide is visible (default: ${DEFAULT_SLIDE_SECONDS})
      --dvd-seconds <n>
                     Seconds the DVD slide is visible (default: ${DEFAULT_DVD_SECONDS})
      --upload-delay <n>
                     Extra animation seconds rendered as upload cushion (default: ${DEFAULT_UPLOAD_DELAY_SECONDS})
      --loop-proof-delay <n>
                     Extra animation seconds for slides that opt into loop-proof rendering (default: ${DEFAULT_LOOP_PROOF_SECONDS})
      --gallery-dir <path>
                     Folder of images for the optional gallery slide
      --dev-mode     Upload images with overridable=false for testing over music
      --web-port <n> Web status/control port (default: 3000)
      --no-web       Disable the web status/control server
      --disabled     Start with uploads disabled
      --host <host>  Tuneshine host or IP (default: ${DEFAULT_TUNESHINE_HOST})

Environment:
  TOKEN_511          Preferred token for 511 StopMonitoring bus arrivals
  511_TOKEN          Backward-compatible alternate token name
  ACTRANSIT_TOKEN    Fallback token for AC Transit direct arrivals
  SLIDE_SECONDS      Default slide duration
  DVD_SLIDE_SECONDS  DVD slide duration
  UPLOAD_DELAY_SECONDS
                     Extra animation seconds rendered as upload cushion
  LOOP_PROOF_DELAY_SECONDS
                     Extra animation seconds for slides that opt into loop-proof rendering
  GALLERY_DIR        Folder of images for the optional gallery slide
  DEV_MODE           Set to true/1/yes/on to upload images with overridable=false
  WEB_PORT           Web status/control port
  WEB_DISABLED       Set to true/1/yes/on to disable the web server
  DASHBOARD_DISABLED Set to true/1/yes/on to start with uploads disabled
  TUNESHINE_HOST     Default Tuneshine host or IP
`);
}
