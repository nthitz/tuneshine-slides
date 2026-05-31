#!/usr/bin/env node

import "dotenv/config";
import { fetchPlexSessions, getPlexConfig } from "../lib/plex.js";

function artworkFields(session) {
  return {
    grandparentThumb: session.grandparentThumb,
    parentThumb: session.parentThumb,
    thumb: session.thumb,
    grandparentArt: session.grandparentArt,
    art: session.art
  };
}

async function main() {
  const config = getPlexConfig();
  if (config.servers.length === 0) {
    console.error("No Plex servers configured. Run npm run plex:discover or set PLEX_SERVERS.");
    process.exit(1);
  }

  for (const server of config.servers) {
    console.log(`\n${server.name} (${server.url})`);
    try {
      const sessions = await fetchPlexSessions(server);
      if (sessions.length === 0) {
        console.log("  No active sessions.");
        continue;
      }

      for (const session of sessions) {
        const user = session.User ?? {};
        const player = session.Player ?? {};
        console.log(`  ${session.type}: ${session.title ?? "(untitled)"}`);
        console.log(`    user: ${user.title ?? "-"} (${user.id ?? "-"})`);
        console.log(`    player: ${player.title ?? "-"} state=${player.state ?? "-"}`);
        console.log(`    ratingKey: ${session.ratingKey ?? "-"}`);
        console.log(`    artwork: ${JSON.stringify(artworkFields(session))}`);
      }
    } catch (error) {
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

await main();
