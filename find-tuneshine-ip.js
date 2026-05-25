#!/usr/bin/env node

import mdns from "multicast-dns";

const SERVICE_TYPE = "_tuneshine._tcp";
const MDNS_SERVICE_NAME = `${SERVICE_TYPE}.local`;
const DEFAULT_TIMEOUT_MS = 5000;

const options = parseArgs(process.argv.slice(2));
const browser = mdns({ multicast: true });
const devices = new Map();
const pendingHosts = new Set();
let timeoutId;

function parseArgs(args) {
  const parsed = {
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--timeout" || arg === "-t") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout must be a positive number of seconds");
      }
      parsed.timeoutMs = value * 1000;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node find-tuneshine-ip.js [options]

Find Tuneshine devices advertised via mDNS service type ${SERVICE_TYPE}.

Options:
  -t, --timeout <seconds>  How long to wait for mDNS responses (default: 5)
      --json               Print discovered devices as JSON
  -h, --help               Show this help
`);
}

function normalizeName(name) {
  return name.endsWith(".") ? name.slice(0, -1) : name;
}

function getOrCreateDevice(instanceName) {
  const key = normalizeName(instanceName);
  const existing = devices.get(key);

  if (existing) {
    return existing;
  }

  const device = {
    name: key,
    host: null,
    port: null,
    ip: null
  };

  devices.set(key, device);
  return device;
}

function findDeviceByHost(host) {
  const normalizedHost = normalizeName(host);

  for (const device of devices.values()) {
    if (device.host === normalizedHost) {
      return device;
    }
  }

  return null;
}

function readRecord(record) {
  if (record.type === "PTR" && normalizeName(record.name) === MDNS_SERVICE_NAME) {
    const instanceName = record.data;
    getOrCreateDevice(instanceName);
    query(instanceName, "SRV");
    query(instanceName, "TXT");
    return;
  }

  if (record.type === "SRV") {
    const device = getOrCreateDevice(record.name);
    device.host = normalizeName(record.data.target);
    device.port = record.data.port;

    if (!device.ip && !pendingHosts.has(device.host)) {
      pendingHosts.add(device.host);
      query(device.host, "A");
    }
    return;
  }

  if (record.type === "A") {
    const device = findDeviceByHost(record.name);

    if (device) {
      device.ip = record.data;
      finish();
    }
  }
}

function query(name, type) {
  browser.query([{ name, type }]);
}

function finish() {
  clearTimeout(timeoutId);
  browser.destroy();

  const found = Array.from(devices.values()).filter((device) => device.ip);

  if (found.length === 0) {
    console.error(`No Tuneshine devices found via ${SERVICE_TYPE}`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  for (const device of found) {
    const port = device.port ? `:${device.port}` : "";
    console.log(`${device.ip}${port}`);
  }
}

browser.on("response", (response) => {
  for (const record of [
    ...response.answers,
    ...response.additionals,
    ...response.authorities
  ]) {
    readRecord(record);
  }
});

browser.on("error", (error) => {
  clearTimeout(timeoutId);
  console.error(`mDNS discovery failed: ${error.message}`);
  process.exit(1);
});

timeoutId = setTimeout(finish, options.timeoutMs);
query(MDNS_SERVICE_NAME, "PTR");
