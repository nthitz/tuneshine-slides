import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AC_ROUTE_STOPS, OAKLAND } from "./constants.js";

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const WEATHER_CACHE_PATH = path.join(".cache", "weather.json");
let weatherCache = null;

export function weatherCodeToCondition(code) {
  if ([0, 1].includes(code)) return { label: "SUN", icon: "sun" };
  if ([2, 3, 45, 48].includes(code)) return { label: "CLOUD", icon: "cloud" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return { label: "RAIN", icon: "rain" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "SNOW", icon: "snow" };
  if ([95, 96, 99].includes(code)) return { label: "STORM", icon: "storm" };
  return { label: "WX", icon: "cloud" };
}

export function minutesUntil(dateString, now = new Date()) {
  const value = new Date(dateString).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round((value - now.getTime()) / 60000));
}

function normalizeRoute(route) {
  return String(route ?? "?").match(/\d+/)?.[0] ?? String(route ?? "?");
}

function createBusRoutes(arrivals) {
  return AC_ROUTE_STOPS.map(({ route, stop }) => ({
    route,
    stop,
    minutes: arrivals
      .filter((arrival) => arrival.stop === stop && normalizeRoute(arrival.route) === route)
      .map((arrival) => arrival.minutes)
      .sort((a, b) => a - b)
      .slice(0, 2)
  }));
}

function isValidWeather(value) {
  return (
    value &&
    Number.isFinite(value.fetchedAt) &&
    Number.isFinite(value.temp) &&
    typeof value.label === "string" &&
    typeof value.icon === "string"
  );
}

function isFreshWeather(value, now = Date.now()) {
  return isValidWeather(value) && now - value.fetchedAt < WEATHER_CACHE_TTL_MS;
}

async function readWeatherCache() {
  if (weatherCache) return weatherCache;

  try {
    const cache = JSON.parse(await readFile(WEATHER_CACHE_PATH, "utf8"));
    if (isValidWeather(cache)) {
      weatherCache = cache;
      return weatherCache;
    }
  } catch {
    // Missing or malformed cache should not block the dashboard.
  }

  return null;
}

async function writeWeatherCache(weather) {
  weatherCache = weather;
  await mkdir(path.dirname(WEATHER_CACHE_PATH), { recursive: true });
  await writeFile(WEATHER_CACHE_PATH, `${JSON.stringify(weather, null, 2)}\n`);
}

async function fetchWeatherFromApi() {
  const params = new URLSearchParams({
    latitude: String(OAKLAND.latitude),
    longitude: String(OAKLAND.longitude),
    current: "temperature_2m,weather_code",
    temperature_unit: "fahrenheit",
    timezone: "America/Los_Angeles"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
  const data = await response.json();
  return {
    fetchedAt: Date.now(),
    temp: Math.round(data.current.temperature_2m),
    ...weatherCodeToCondition(data.current.weather_code)
  };
}

export async function fetchWeather() {
  const cached = await readWeatherCache();
  if (isFreshWeather(cached)) return cached;

  const weather = await fetchWeatherFromApi();
  await writeWeatherCache(weather);
  return weather;
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export async function fetchBusArrivals() {
  const token511 = envValue("TOKEN_511", "511_TOKEN");
  if (token511) {
    return fetch511BusArrivals(token511);
  }

  const token = envValue("ACTRANSIT_TOKEN");
  if (!token) {
    return { missingToken: true, arrivals: [], routes: createBusRoutes([]) };
  }

  const arrivals = [];
  for (const { stop, route } of AC_ROUTE_STOPS) {
    const params = new URLSearchParams({ token });
    const response = await fetch(
      `https://api.actransit.org/transit/stops/${stop}/predictions?${params}`
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`AC Transit ${response.status}: ${message.trim()}`);
    }
    const predictions = await response.json();
    for (const prediction of predictions) {
      const minutes = minutesUntil(prediction.PredictedDeparture);
      if (minutes !== null && normalizeRoute(prediction.RouteName) === route) {
        arrivals.push({
          stop,
          route: String(prediction.RouteName ?? "?"),
          minutes
        });
      }
    }
  }

  arrivals.sort((a, b) => a.minutes - b.minutes);
  return { missingToken: false, arrivals, routes: createBusRoutes(arrivals) };
}

async function fetch511BusArrivals(apiKey) {
  const arrivals = [];

  for (const { stop, route } of AC_ROUTE_STOPS) {
    const params = new URLSearchParams({
      api_key: apiKey,
      agency: "AC",
      stopCode: stop,
      format: "json"
    });
    const response = await fetch(`https://api.511.org/transit/StopMonitoring?${params}`);
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`511 ${response.status}: ${body.trim()}`);
    }

    const data = JSON.parse(body);
    const visits =
      data.ServiceDelivery?.StopMonitoringDelivery?.MonitoredStopVisit ??
      data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.MonitoredStopVisit ??
      [];

    for (const visit of Array.isArray(visits) ? visits : [visits]) {
      const journey = visit?.MonitoredVehicleJourney;
      const call = journey?.MonitoredCall;
      const expectedArrival =
        call?.ExpectedArrivalTime ?? call?.ExpectedDepartureTime ?? call?.AimedArrivalTime;
      const minutes = minutesUntil(expectedArrival);
      const routeName = journey?.LineRef ?? journey?.PublishedLineName ?? "?";
      if (minutes !== null && normalizeRoute(routeName) === route) {
        arrivals.push({
          stop,
          route: String(routeName),
          minutes
        });
      }
    }
  }

  arrivals.sort((a, b) => a.minutes - b.minutes);
  return { missingToken: false, arrivals, routes: createBusRoutes(arrivals) };
}

export async function getSlideData() {
  const [weather, bus] = await Promise.allSettled([fetchWeather(), fetchBusArrivals()]);
  return {
    now: new Date(),
    weather:
      weather.status === "fulfilled"
        ? weather.value
        : { error: weather.reason?.message ?? "Weather error" },
    bus:
      bus.status === "fulfilled" ? bus.value : { error: bus.reason?.message ?? "Bus error" }
  };
}
