import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { OUT_DIR } from "./constants.js";

const PLEX_FETCH_TIMEOUT_MS = 5 * 1000;
const PLEX_ARTWORK_PATH = path.join(OUT_DIR, "plex.webp");

function envValue(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizeServerKey(value) {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getPlexConfig() {
  const enabled = parseBoolean(envValue("PLEX_ENABLED"));
  const pollSeconds = Number(envValue("PLEX_POLL_SECONDS") ?? 5);
  const username = envValue("PLEX_USERNAME");
  const userId = envValue("PLEX_USER_ID");
  const serverNames = splitList(envValue("PLEX_SERVERS"));
  const servers = [];

  for (const name of serverNames) {
    const key = normalizeServerKey(name);
    const url = envValue(`PLEX_${key}_URL`);
    const token = envValue(`PLEX_${key}_TOKEN`) ?? envValue("PLEX_TOKEN");
    const displayName = envValue(`PLEX_${key}_NAME`) ?? name;
    if (url && token) {
      servers.push({ name: displayName, key, url: stripTrailingSlash(url), token });
    }
  }

  return {
    enabled,
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds >= 2 ? pollSeconds : 5,
    username,
    userId,
    servers
  };
}

function plexHeaders(token) {
  return {
    accept: "application/json",
    "x-plex-token": token
  };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: plexHeaders(token),
    signal: AbortSignal.timeout(PLEX_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionUser(session) {
  const user = session.User ?? session.user;
  return {
    id: String(user?.id ?? user?.ID ?? ""),
    title: String(user?.title ?? user?.username ?? user?.name ?? "")
  };
}

function sessionPlayer(session) {
  return session.Player ?? session.player ?? {};
}

function mediaTitle(session) {
  if (session.type === "episode") {
    return [session.grandparentTitle, session.parentTitle, session.title].filter(Boolean).join(" - ");
  }
  return session.title ?? session.parentTitle ?? session.grandparentTitle ?? "Plex";
}

function artworkPath(session) {
  if (session.type === "episode") {
    return (
      session.grandparentThumb ??
      session.parentThumb ??
      session.thumb ??
      session.grandparentArt ??
      session.art ??
      null
    );
  }

  if (session.type === "track") {
    return session.parentThumb ?? session.thumb ?? session.grandparentThumb ?? session.art ?? null;
  }

  return session.thumb ?? session.parentThumb ?? session.grandparentThumb ?? session.art ?? null;
}

function matchesUser(session, config) {
  if (!config.username && !config.userId) return true;
  const user = sessionUser(session);
  if (config.userId && user.id === String(config.userId)) return true;
  return Boolean(config.username && user.title.toLowerCase() === config.username.toLowerCase());
}

function isPlaying(session) {
  return String(sessionPlayer(session).state ?? "").toLowerCase() === "playing";
}

function isSupportedMedia(session) {
  return ["movie", "episode", "track"].includes(String(session.type ?? ""));
}

function createPlexMatch(server, session) {
  const artPath = artworkPath(session);
  if (!artPath) return null;

  return {
    server,
    session,
    key: `${server.name}:${session.ratingKey ?? session.key ?? artPath}`,
    title: mediaTitle(session),
    type: session.type,
    user: sessionUser(session),
    player: sessionPlayer(session),
    artworkPath: artPath
  };
}

export async function fetchPlexSessions(server) {
  const url = `${server.url}/status/sessions`;
  const data = await fetchJson(url, server.token);
  return toArray(data.MediaContainer?.Metadata);
}

export async function findPlexPlayback(config = getPlexConfig()) {
  if (!config.enabled || config.servers.length === 0) return null;
  const errors = [];

  for (const server of config.servers) {
    try {
      const sessions = await fetchPlexSessions(server);
      const session = sessions.find(
        (item) => isSupportedMedia(item) && isPlaying(item) && matchesUser(item, config)
      );
      if (session) return createPlexMatch(server, session);
    } catch (error) {
      errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    return { error: errors.join("; ") };
  }
  return null;
}

export async function renderPlexArtwork(match) {
  const artworkUrl = new URL(match.artworkPath, `${match.server.url}/`);
  artworkUrl.searchParams.set("X-Plex-Token", match.server.token);

  const response = await fetch(artworkUrl, {
    signal: AbortSignal.timeout(PLEX_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`Plex artwork request failed: ${response.status}`);

  const artwork = Buffer.from(await response.arrayBuffer());
  await mkdir(OUT_DIR, { recursive: true });
  await sharp(artwork)
    .resize(64, 64, { fit: "contain", background: "#000000" })
    .webp({ lossless: true, effort: 6 })
    .toFile(PLEX_ARTWORK_PATH);

  return PLEX_ARTWORK_PATH;
}

export function plexMetadata(match, options) {
  return {
    trackName: match.title,
    artistName: match.server.name,
    serviceName: "Plex",
    contentType: "video",
    itemId: match.key,
    accountName: match.user.title || undefined,
    zoneName: match.player.title || undefined,
    idle: true,
    overridable: !options.devMode
  };
}
