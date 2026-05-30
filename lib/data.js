import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AC_ROUTE_STOPS, OAKLAND } from "./constants.js";

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const WEATHER_CACHE_PATH = path.join(".cache", "weather.json");
const WEATHER_CACHE_VERSION = 4;
const BUS_FETCH_TIMEOUT_MS = 12 * 1000;
let weatherCache = null;

const weatherCodeConditions = new Map([
  [0, { label: "CLEAR", icon: "clear" }],
  [1, { label: "FAIR", icon: "clear" }],
  [2, { label: "PARTLY CLOUDY", icon: "partly-cloudy" }],
  [3, { label: "CLOUDY", icon: "cloud" }],
  [45, { label: "FOG", icon: "fog" }],
  [48, { label: "RIME FOG", icon: "fog" }],
  [51, { label: "DRIZZLE", icon: "drizzle" }],
  [53, { label: "DRIZZLE", icon: "drizzle" }],
  [55, { label: "DRIZZLE", icon: "drizzle" }],
  [56, { label: "FREEZING RAIN", icon: "ice-rain" }],
  [57, { label: "FREEZING RAIN", icon: "ice-rain" }],
  [61, { label: "RAIN", icon: "rain" }],
  [63, { label: "RAIN", icon: "rain" }],
  [65, { label: "RAIN", icon: "rain" }],
  [66, { label: "FREEZING RAIN", icon: "ice-rain" }],
  [67, { label: "FREEZING RAIN", icon: "ice-rain" }],
  [71, { label: "SNOW", icon: "snow" }],
  [73, { label: "SNOW", icon: "snow" }],
  [75, { label: "SNOW", icon: "snow" }],
  [77, { label: "SNOW GRAINS", icon: "snow" }],
  [80, { label: "SHOWERS", icon: "rain" }],
  [81, { label: "SHOWERS", icon: "rain" }],
  [82, { label: "SHOWERS", icon: "rain" }],
  [85, { label: "SNOW", icon: "snow" }],
  [86, { label: "SNOW", icon: "snow" }],
  [95, { label: "STORM", icon: "storm" }],
  [96, { label: "HAIL", icon: "storm" }],
  [99, { label: "HAIL", icon: "storm" }]
]);

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function hasPositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function weatherCodeToCondition(code, current = {}) {
  const condition = weatherCodeConditions.get(code) ?? { label: "WX", icon: "unknown" };
  const isDay = current.isDay !== false;

  if (["clear", "partly-cloudy"].includes(condition.icon)) {
    if (hasPositive(current.snowfall)) return { label: "SNOW", icon: "snow" };
    if (hasPositive(current.precipitation) || hasPositive(current.rain) || hasPositive(current.showers)) {
      if (Number.isFinite(current.apparentTemp) && current.apparentTemp <= 32) {
        return { label: "FREEZING RAIN", icon: "ice-rain" };
      }
      return { label: "RAIN", icon: "rain" };
    }
    if (Number.isFinite(current.windGust) && current.windGust >= 35) {
      return { label: "WIND", icon: "wind" };
    }
    if (Number.isFinite(current.windSpeed) && current.windSpeed >= 25) {
      return { label: "WIND", icon: "wind" };
    }
    if (Number.isFinite(current.cloudCover) && current.cloudCover >= 75) {
      return { label: "CLOUDY", icon: "cloud" };
    }
    if (Number.isFinite(current.cloudCover) && current.cloudCover >= 30) {
      return {
        label: "PARTLY CLOUDY",
        icon: isDay ? "partly-cloudy-day" : "partly-cloudy-night"
      };
    }
    if (condition.icon === "clear") {
      return { ...condition, icon: isDay ? "sun" : "moon" };
    }
    return { ...condition, icon: isDay ? "partly-cloudy-day" : "partly-cloudy-night" };
  }

  return condition;
}

export function minutesUntil(dateString, now = new Date()) {
  const value = new Date(dateString).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round((value - now.getTime()) / 60000));
}

function normalizeRoute(route) {
  return String(route ?? "?").match(/\d+/)?.[0] ?? String(route ?? "?");
}

function minutesFromAcRealtimePrediction(prediction) {
  const countdown = prediction.prdctdn;
  if (/^\d+$/.test(String(countdown))) return Number(countdown);
  return minutesUntil(prediction.prdtm);
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
    value.schemaVersion === WEATHER_CACHE_VERSION &&
    Number.isFinite(value.fetchedAt) &&
    Number.isFinite(value.temp) &&
    Number.isFinite(value.weatherCode) &&
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
    current:
      "temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,is_day",
    daily: "sunrise,sunset",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "America/Los_Angeles"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
  const data = await response.json();
  const current = data.current ?? {};
  const weather = {
    schemaVersion: WEATHER_CACHE_VERSION,
    fetchedAt: Date.now(),
    temp: Math.round(current.temperature_2m),
    apparentTemp: Number.isFinite(current.apparent_temperature)
      ? Math.round(current.apparent_temperature)
      : null,
    weatherCode: current.weather_code,
    precipitation: numberOrNull(current.precipitation),
    rain: numberOrNull(current.rain),
    showers: numberOrNull(current.showers),
    snowfall: numberOrNull(current.snowfall),
    cloudCover: numberOrNull(current.cloud_cover),
    windSpeed: numberOrNull(current.wind_speed_10m),
    windGust: numberOrNull(current.wind_gusts_10m),
    isDay: current.is_day === 1,
    isNight: current.is_day === 0,
    sunrise: data.daily?.sunrise?.[0] ?? null,
    sunset: data.daily?.sunset?.[0] ?? null
  };

  return {
    ...weather,
    ...weatherCodeToCondition(weather.weatherCode, weather)
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
  const acTransitToken = envValue("ACTRANSIT_TOKEN");

  if (acTransitToken) {
    try {
      return await fetchAcTransitBusArrivals(acTransitToken);
    } catch (error) {
      if (!token511) throw error;
    }
  }

  if (!token511) {
    return { missingToken: true, arrivals: [], routes: createBusRoutes([]) };
  }

  return fetch511BusArrivals(token511);
}

function busFetch(url) {
  return fetch(url, { signal: AbortSignal.timeout(BUS_FETCH_TIMEOUT_MS) });
}

async function fetchAcTransitBusArrivals(token) {
  const arrivals = [];
  const failures = [];

  for (const { stop, route } of AC_ROUTE_STOPS) {
    const params = new URLSearchParams({ stpid: stop, rt: route, token });
    try {
      const response = await busFetch(
        `https://api.actransit.org/transit/actrealtime/prediction?${params}`
      );
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`AC Transit ${response.status}: ${message.trim()}`);
      }
      const data = await response.json();
      const predictions = data["bustime-response"]?.prd ?? [];
      for (const prediction of predictions) {
        const minutes = minutesFromAcRealtimePrediction(prediction);
        if (minutes !== null && normalizeRoute(prediction.rt) === route) {
          arrivals.push({
            stop,
            route: String(prediction.rt ?? "?"),
            minutes
          });
        }
      }
    } catch (error) {
      failures.push({ stop, message: error?.message ?? "request failed" });
    }
  }

  if (failures.length === AC_ROUTE_STOPS.length) {
    throw new Error(`AC Transit unavailable: ${failures.map(({ message }) => message).join("; ")}`);
  }

  arrivals.sort((a, b) => a.minutes - b.minutes);
  return {
    missingToken: false,
    arrivals,
    routes: createBusRoutes(arrivals),
    warnings: failures.map(({ stop, message }) => `Stop ${stop}: ${message}`)
  };
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
    const response = await busFetch(`https://api.511.org/transit/StopMonitoring?${params}`);
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
