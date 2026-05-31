export let shutdownStarted = false;

export const appState = {
  enabled: true,
  phase: "starting",
  cycle: 0,
  current: null,
  next: null,
  remainingSeconds: null,
  issues: [],
  lastUploadAt: null,
  lastError: null,
  brightness: null,
  plex: {
    enabled: false,
    active: false,
    title: null,
    server: null,
    player: null,
    lastError: null
  },
  requestedSlideId: null,
  slides: []
};

export function markShutdownStarted() {
  if (shutdownStarted) return false;
  shutdownStarted = true;
  return true;
}

export function plexStatusFromMatch(match) {
  return {
    enabled: true,
    active: true,
    title: match.title,
    server: match.server.name,
    player: match.player.title ?? null,
    lastError: null
  };
}

export function inactivePlexStatus(enabled, lastError = null) {
  return {
    enabled,
    active: false,
    title: null,
    server: null,
    player: null,
    lastError
  };
}
