import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const venuesPath = resolve(root, "src/sources/venues.json");
const eventsPath = resolve(root, "src/data/events.json");
const horizonDays = 45;

const venues = JSON.parse(readFileSync(venuesPath, "utf8"));
const previous = readEvents();

const collected = [];
for (const venue of venues) {
  try {
    const shows = await loadVenue(venue);
    console.log(`${venue.name}: ${shows.length} shows`);
    collected.push(...shows);
  } catch (error) {
    const kept = previous.filter((show) => show.source.name === venue.name);
    console.error(`${venue.name} failed (${error.message}). Keeping ${kept.length} saved shows.`);
    collected.push(...kept);
  }
}

collected.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
mkdirSync(dirname(eventsPath), { recursive: true });
writeFileSync(eventsPath, `${JSON.stringify(collected, null, 2)}\n`);
console.log(`Wrote ${collected.length} shows to src/data/events.json`);

function readEvents() {
  try {
    return JSON.parse(readFileSync(eventsPath, "utf8"));
  } catch {
    return [];
  }
}

async function loadVenue(venue) {
  if (venue.id === "the-caz") return loadCaz(venue);
  if (venue.id === "electric-city") return loadElectricCity(venue);
  if (venue.id === "buffalo-iron-works") return loadIronWorks(venue);
  throw new Error(`No website parser for ${venue.id}`);
}

async function loadCaz(venue) {
  const html = await fetchText(venue.website);
  const paths = unique(
    [...html.matchAll(/href="(\/shows\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => /-\d{2}-[a-z]{3}$/.test(path)),
  );

  const pages = await mapPool(paths, 4, async (path) => {
    const eventUrl = new URL(path, venue.website).href;
    const page = await fetchText(eventUrl);
    return showFromCaz(page, eventUrl, venue);
  });

  return pages.filter(Boolean);
}

function showFromCaz(html, eventUrl, venue) {
  if (/private-event|closed-for/i.test(eventUrl)) return null;
  const title = cazTitle(html);
  if (!title || /private event|closed for/i.test(title)) return null;

  const text = visibleText(html);
  const date = text.match(
    /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/,
  );
  const showTime = text.match(/Show\s*[•·]\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
  if (!date || !showTime) return null;

  const startsAt = wallTimeToIso(date[4], date[2], date[3], showTime[1]);
  if (!inWindow(startsAt)) return null;

  const doors = text.match(/Doors\s*[•·]\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
  const price = text.match(/\$(\d+\.\d{2}) to \$(\d+\.\d{2})/) ?? text.match(/\$(\d+\.\d{2})/);

  return compactShow({
    id: slugId(eventUrl),
    band: decodeEntities(title),
    venue: venue.name,
    startsAt,
    price: formatCazPrice(price),
    summary: doors ? `Doors ${doors[1]}. Show ${showTime[1]}.` : `Show at ${showTime[1]}.`,
    eventUrl,
    source: sourceOf(venue),
  });
}

async function loadElectricCity(venue) {
  const html = await fetchText(venue.website);
  const urls = unique(
    [...html.matchAll(/href="([^"]*\/events\/[a-z0-9-]+\/?)"/gi)].map((match) =>
      new URL(match[1], venue.website).href.replace(/\/?$/, "/"),
    ),
  ).filter((url) => !/\/events\/?$/.test(new URL(url).pathname));

  const pages = await mapPool(urls, 4, async (eventUrl) => {
    const page = await fetchText(eventUrl);
    return showFromJsonLd(page, eventUrl, venue);
  });

  return pages.filter(Boolean);
}

function showFromJsonLd(html, eventUrl, venue) {
  const event = jsonLdNodes(html).find((node) => node["@type"] === "MusicEvent" || node["@type"] === "Event");
  if (!event?.name || !event.startDate) return null;
  if (/bundle/i.test(event.name)) return null;
  if (event.eventStatus && !String(event.eventStatus).endsWith("EventScheduled")) return null;
  if (!inWindow(event.startDate)) return null;

  const description = clip(plain(event.description ?? ""));
  return compactShow({
    id: slugId(event.url || eventUrl),
    band: plain(event.name),
    venue: venue.name,
    startsAt: asEasternWallClock(event.startDate),
    price: priceFromOffer(event.offers),
    summary: description || undefined,
    eventUrl: event.url || eventUrl,
    source: sourceOf(venue),
  });
}

async function loadIronWorks(venue) {
  const start = isoDate(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + horizonDays);
  const end = isoDate(endDate);
  const shows = [];

  for (let page = 1; page < 10; page += 1) {
    const url = `https://buffaloironworks.com/wp-json/tribe/events/v1/events?start_date=${start}&end_date=${end}&per_page=50&page=${page}`;
    const data = await fetchJson(url);
    for (const event of data.events ?? []) {
      const show = showFromTribe(event, venue);
      if (show) shows.push(show);
    }
    if (page >= (data.total_pages ?? 1)) break;
  }

  return shows;
}

function showFromTribe(event, venue) {
  if (!event.title || !event.url || !event.start_date) return null;
  const startsAt = tribeStart(event.start_date);
  if (!inWindow(startsAt)) return null;
  const summary = clip(plain(event.description ?? ""));
  return compactShow({
    id: slugId(event.url),
    band: plain(event.title),
    venue: venue.name,
    startsAt,
    price: cleanCost(event.cost),
    summary: summary || undefined,
    eventUrl: event.url,
    source: sourceOf(venue),
  });
}

function sourceOf(venue) {
  return { name: venue.name, kind: "website", url: venue.website };
}

function compactShow(show) {
  const next = { ...show };
  if (!next.price) delete next.price;
  if (!next.summary) delete next.summary;
  return next;
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of list) {
        if (Array.isArray(node["@graph"])) nodes.push(...node["@graph"]);
        else nodes.push(node);
      }
    } catch {
      // A venue page can contain a broken block. Skip that block.
    }
  }
  return nodes;
}

function priceFromOffer(offers) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer) return undefined;
  const min = offer.priceSpecification?.minPrice ?? offer.price;
  const max = offer.priceSpecification?.maxPrice;
  if (min == null || min === "") return undefined;
  if (max != null && max !== "" && Number(max) !== Number(min)) {
    return `${money(min)}–${money(max)}`;
  }
  return money(min);
}

function money(value) {
  const amount = Number(value);
  if (Number.isNaN(amount)) return `$${value}`;
  if (amount === 0) return "Free";
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function formatCazPrice(match) {
  if (!match) return undefined;
  if (match[2]) return `${money(match[1])}–${money(match[2])}`;
  return money(match[1]);
}

function cleanCost(cost) {
  const text = plain(String(cost ?? ""));
  if (!text || text === "0") return undefined;
  if (/free/i.test(text)) return "Free";
  return text;
}

function tribeStart(startDate) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(startDate);
  if (!match) throw new Error(`Unexpected Iron Works start ${startDate}`);
  return `${match[1]}T${match[2]}:00${easternOffset(match[1])}`;
}

function wallTimeToIso(year, monthName, day, label) {
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  const clock = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(label.trim());
  if (!clock) throw new Error(`Unexpected show time ${label}`);
  let hour = Number(clock[1]) % 12;
  if (/pm/i.test(clock[3])) hour += 12;
  const ymd = `${year}-${months[monthName.toLowerCase()]}-${String(day).padStart(2, "0")}`;
  return `${ymd}T${String(hour).padStart(2, "0")}:${clock[2]}:00${easternOffset(ymd)}`;
}

function asEasternWallClock(iso) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[1]}T${match[2]}${easternOffset(match[1])}`;
}

function easternOffset(ymd) {
  const probe = new Date(`${ymd}T16:00:00Z`);
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "shortOffset",
    })
      .formatToParts(probe)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT-4";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return "-04:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
}

function inWindow(iso) {
  const start = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + horizonDays);
  return start >= today && start < horizon;
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cazTitle(html) {
  const lines = visibleText(html)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const presented = lines.findIndex((line) => line === "Presented by The Caz");
  if (presented > 0) return lines[presented - 1];

  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const fromHeading = heading ? plain(heading[1]) : "";
  if (fromHeading && !/^the caz$/i.test(fromHeading)) return fromHeading;

  return pageTitle(html).replace(/\s+[|\-–—]\s+The Caz\s*$/i, "").trim();
}

function pageTitle(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"),
  ).replace(/[ \t]+\n/g, "\n");
}

function plain(value) {
  return decodeEntities(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function clip(text) {
  const cut = text.replace(/\s*(\[…\]|\[&hellip;\]|…)\s*$/g, "").trim();
  if (cut.length <= 280) return cut;
  return `${cut.slice(0, 279).replace(/\s+\S*$/, "")}…`;
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&hellip;/g, "…")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—");
}

function slugId(url) {
  const path = new URL(url).pathname.replace(/\/$/, "");
  return path.split("/").pop() || path;
}

function unique(values) {
  return [...new Set(values)];
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "buffalo-music-calendar", accept: "text/html,application/json" },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}
