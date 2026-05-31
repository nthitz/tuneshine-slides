#!/usr/bin/env node

import "dotenv/config";

function envValue(name) {
  const value = process.env[name]?.trim();
  return value || null;
}

function normalizeServerKey(value) {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

async function fetchResources(token) {
  const url = new URL("https://plex.tv/api/resources");
  url.searchParams.set("includeHttps", "1");
  url.searchParams.set("includeRelay", "1");
  url.searchParams.set("X-Plex-Token", token);

  const response = await fetch(url, {
    headers: {
      accept: "application/xml"
    }
  });
  const body = await response.text();
  if (!response.ok) {
    const details = body.trim().replace(/\s+/g, " ").slice(0, 200);
    throw new Error(
      `Plex resources request failed: ${response.status}${details ? ` ${details}` : ""}`
    );
  }
  return parseResourcesXml(body);
}

async function fetchAccount(token) {
  const url = new URL("https://plex.tv/users/account");
  url.searchParams.set("X-Plex-Token", token);

  const response = await fetch(url, {
    headers: {
      accept: "application/xml"
    }
  });
  if (!response.ok) return {};

  const body = await response.text();
  const match = body.match(/<user\b([^>]*)\/?>/);
  return match ? parseAttributes(match[1]) : {};
}

function serverConnections(resource) {
  return (resource.connections ?? [])
    .filter((connection) => connection.uri)
    .sort((a, b) => Number(b.local) - Number(a.local));
}

function decodeXmlAttribute(value) {
  return String(value)
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/\s([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXmlAttribute(match[2]);
  }
  return attributes;
}

function parseResourcesXml(xml) {
  const resources = [];
  for (const deviceMatch of xml.matchAll(/<Device\b([^>]*)>([\s\S]*?)<\/Device>/g)) {
    const resource = parseAttributes(deviceMatch[1]);
    resource.connections = [];

    for (const connectionMatch of deviceMatch[2].matchAll(/<Connection\b([^>]*)\/>/g)) {
      const connection = parseAttributes(connectionMatch[1]);
      connection.local = connection.local === "1";
      resource.connections.push(connection);
    }

    resources.push(resource);
  }
  return resources;
}

function printServer(resource) {
  const key = normalizeServerKey(resource.name);
  const connection = serverConnections(resource)[0];
  if (!connection) return;

  console.log(`# ${resource.name}`);
  console.log(`PLEX_${key}_NAME=${resource.name}`);
  console.log(`PLEX_${key}_URL=${connection.uri}`);
  console.log(`PLEX_${key}_TOKEN=${resource.accessToken}`);
  console.log("");
}

async function main() {
  const token = envValue("PLEX_TOKEN") ?? process.argv[2];
  if (!token) {
    console.error("Set PLEX_TOKEN in .env or pass it as the first argument.");
    process.exit(1);
  }

  const [account, resources] = await Promise.all([fetchAccount(token), fetchResources(token)]);
  const servers = resources.filter((resource) =>
    String(resource.provides ?? "")
      .split(",")
      .includes("server")
  );

  if (servers.length === 0) {
    console.error("No Plex servers found for this token.");
    process.exit(1);
  }

  console.log("PLEX_ENABLED=true");
  console.log("PLEX_POLL_SECONDS=5");
  console.log(`PLEX_USERNAME=${account.username || account.title || "your_plex_username"}`);
  console.log(`PLEX_SERVERS=${servers.map((server) => normalizeServerKey(server.name)).join(",")}`);
  console.log("");
  for (const server of servers) {
    printServer(server);
  }
}

await main();
