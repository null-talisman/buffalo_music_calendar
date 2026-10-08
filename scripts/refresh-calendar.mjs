import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferGenre } from "./genre.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const venuesPath = resolve(root, "src/sources/venues.json");
const eventsPath = resolve(root, "src/data/events.json");
const horizonDays = 45;

async function main() {
  const venues = JSON.parse(readFileSync(venuesPath, "utf8"));
  const previous = readEvents();
  const known = knownShows(previous);
  // A venue may declare what it books when a listing says nothing about genre.
  const defaultGenres = new Map(venues.map((venue) => [venue.website, venue.defaultGenre]));

  const collected = [];
  for (const venue of venues) {
    try {
      const shows = await loadVenue(venue, known);
      console.log(`${venue.name}: ${shows.length} shows`);
      collected.push(...shows);
    } catch (error) {
      const kept = previous.filter((show) => show.source.url === venue.website);
      console.error(`${venue.name} failed (${error.message}). Keeping ${kept.length} saved shows.`);
      collected.push(...kept);
    }
  }

  for (const show of collected) {
    const genre = inferGenre(show.band, show.summary) ?? defaultGenres.get(show.source.url);
    if (genre) show.genre = genre;
    else delete show.genre;
  }

  collected.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  mkdirSync(dirname(eventsPath), { recursive: true });
  writeFileSync(eventsPath, `${JSON.stringify(collected, null, 2)}\n`);
  console.log(`Wrote ${collected.length} shows to src/data/events.json`);
}

function readEvents() {
  try {
    return JSON.parse(readFileSync(eventsPath, "utf8"));
  } catch {
    return [];
  }
}

// Each venue in src/sources/venues.json names one of these parsers. `website`
// is the listing page the parser starts from.
const parsers = {
  caz: loadCaz,
  "jsonld-pages": loadJsonLdPages,
  tribe: loadTribe,
  squarespace: loadSquarespace,
  ical: loadIcal,
  spoton: loadSpotOn,
  ticketweb: loadTicketWeb,
  ticketmaster: loadTicketmaster,
  mohawk: loadMohawk,
  "simple-calendar": loadSimpleCalendar,
};

async function loadVenue(venue, known) {
  const parser = parsers[venue.parser];
  if (!parser) throw new Error(`No website parser "${venue.parser}" for ${venue.id}`);
  return parser(venue, known);
}

// Detail pages are the slow part of the daily run. A show already saved and
// still inside the listing window is reused instead of downloaded again.
function knownShows(previous) {
  const map = new Map();
  for (const show of previous) {
    if (!show?.eventUrl || !inWindow(show.startsAt)) continue;
    for (const key of urlKeys(show.eventUrl)) map.set(key, show);
  }
  return map;
}

function urlKeys(url) {
  try {
    const parsed = new URL(url);
    const stripped = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
    return [stripped, `${stripped}/`];
  } catch {
    return [url];
  }
}

function savedShow(known, url, venueName) {
  if (!known) return undefined;
  for (const key of urlKeys(url)) {
    const show = known.get(key);
    if (show?.source?.name === venueName) return show;
  }
  return undefined;
}

// --- The Caz: one page per show, dates and times in visible text ---------

async function loadCaz(venue, known) {
  const html = await fetchText(venue.website);
  const paths = unique(
    [...html.matchAll(/href="(\/shows\/[^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => /-\d{2}-[a-z]{3}$/.test(path)),
  );

  const pending = [];
  const shows = [];
  for (const path of paths) {
    const eventUrl = new URL(path, venue.website).href;
    const saved = savedShow(known, eventUrl, venue.name);
    if (saved) shows.push(saved);
    else pending.push(path);
  }
  if (shows.length > 0) console.log(`${venue.name}: reused ${shows.length} saved pages, fetching ${pending.length}`);

  const pages = await mapPool(pending, 4, async (path) => {
    const eventUrl = new URL(path, venue.website).href;
    const page = await fetchText(eventUrl);
    return showFromCaz(page, eventUrl, venue);
  });

  return [...shows, ...pages.filter(Boolean)];
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
    id: showId(venue, eventUrl),
    band: decodeEntities(title),
    venue: venue.name,
    startsAt,
    price: formatCazPrice(price),
    summary: doors ? `Doors ${doors[1]}. Show ${showTime[1]}.` : `Show at ${showTime[1]}.`,
    eventUrl,
    source: sourceOf(venue),
  });
}

// --- WordPress venues with schema.org Event JSON-LD on each show page -----
// Electric City lists /events/<slug>/; Town Ballroom lists /event/<slug>/...

async function loadJsonLdPages(venue, known) {
  const html = await fetchText(venue.website);
  const urls = unique(
    [...html.matchAll(/href="([^"]+)"/gi)]
      .map((match) => absoluteUrl(match[1], venue.website))
      .filter((url) => url && isEventPath(new URL(url).pathname, venue.eventPath))
      .map((url) => url.replace(/\/?$/, "/")),
  );

  const pending = [];
  const shows = [];
  for (const eventUrl of urls) {
    const saved = savedShow(known, eventUrl, venue.name);
    if (saved) shows.push(saved);
    else pending.push(eventUrl);
  }
  if (shows.length > 0) console.log(`${venue.name}: reused ${shows.length} saved pages, fetching ${pending.length}`);

  const pages = await mapPool(pending, 4, async (eventUrl) => {
    const page = await fetchText(eventUrl);
    return showFromJsonLd(page, eventUrl, venue);
  });

  return [...shows, ...pages.filter(Boolean)];
}

function isEventPath(pathname, eventPath) {
  return pathname.startsWith(eventPath) && /^[a-z0-9%-]+/i.test(pathname.slice(eventPath.length));
}

function showFromJsonLd(html, eventUrl, venue) {
  const event = jsonLdNodes(html).find((node) => node["@type"] === "MusicEvent" || node["@type"] === "Event");
  if (!event?.name || !event.startDate) return null;
  if (/bundle/i.test(event.name)) return null;
  if (event.eventStatus && !String(event.eventStatus).endsWith("EventScheduled")) return null;
  if (!inWindow(event.startDate)) return null;

  const description = clip(plain(event.description ?? ""));
  const slug = new URL(eventUrl).pathname.slice(venue.eventPath.length).split("/")[0];
  return compactShow({
    id: `${venue.id}-${slug}`,
    band: plain(event.name),
    // Town Ballroom also promotes shows at other rooms; the page says where.
    venue: (venue.venueFromPage && plain(event.location?.name ?? "")) || venue.name,
    startsAt: asEasternWallClock(event.startDate),
    price: priceFromOffer(event.offers, venue.ignoreZeroPrice),
    summary: description || undefined,
    eventUrl: event.url || eventUrl,
    source: sourceOf(venue),
  });
}

// --- The Events Calendar (WordPress "tribe") REST API ---------------------

async function loadTribe(venue) {
  const start = isoDate(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + horizonDays);
  const end = isoDate(endDate);
  const shows = [];

  for (let page = 1; page < 10; page += 1) {
    const url = new URL("/wp-json/tribe/events/v1/events", venue.website);
    url.search = `start_date=${start}&end_date=${end}&per_page=50&page=${page}`;
    const data = await fetchJson(url.href);
    for (const event of data.events ?? []) {
      const show = showFromTribe(event, venue);
      if (show) shows.push(show);
    }
    if (page >= (data.total_pages ?? 1)) break;
  }

  return shows;
}

// `room` keeps only events the feed places in that room, for sites that list
// several rooms (Sportsmen's and The Cave) or several halls (the BPO). A
// `titleSuffix` such as "– The Cave" also claims the show for that room and is
// trimmed off the title; `excludeTitle` drops shows another room has claimed.
function showFromTribe(event, venue) {
  if (!event.title || !event.url || !event.start_date) return null;
  let band = plain(event.title);
  const suffix = venue.titleSuffix ? new RegExp(venue.titleSuffix, "i") : null;
  if (venue.room) {
    const inRoom = new RegExp(venue.room, "i").test(event.venue?.venue ?? "") || suffix?.test(band);
    if (!inRoom) return null;
  }
  if (venue.excludeTitle && new RegExp(venue.excludeTitle, "i").test(band)) return null;
  if (suffix) band = band.replace(suffix, "").trim();
  if (venue.musicOnly && !looksLikeMusic(band)) return null;
  const startsAt = tribeStart(event.start_date);
  if (!inWindow(startsAt)) return null;
  const summary = clip(plain(event.description ?? ""));
  return compactShow({
    id: showId(venue, event.url),
    band,
    venue: venue.name,
    startsAt,
    price: cleanCost(event.cost),
    summary: summary || undefined,
    eventUrl: event.url,
    source: sourceOf(venue),
  });
}

// Hofbräuhaus mixes brunch and Sabres watch parties into the same calendar.
const MUSIC_WORDS = /\b(live|music|band|duo|trio|dj|brass|open mic|concert|karaoke|continues with|in the haus)\b/i;
const NOT_MUSIC_WORDS = /\b(sabres|hockey|bills|watch party|pregame|open for|sonntagsbrunch|magician|trivia|bingo)\b/i;

function looksLikeMusic(title) {
  return MUSIC_WORDS.test(title) && !NOT_MUSIC_WORDS.test(title);
}

// --- Mohawk Place: hand-written HTML, one <div class="show"> per night -----
//
// The "Upcoming" panel has dates, times and prices. "Coming Soon" below it
// only has a date and the bill, so those shows are saved with timeTbd.

async function loadMohawk(venue) {
  const html = await fetchText(venue.website);
  const upcoming = sliceBetween(html, 'class="panel panel-upcoming"', 'class="coming-soon"');
  const comingSoon = sliceBetween(html, 'class="coming-soon"', 'class="panel panel-past"');
  const shows = [];

  let year = new Date().getFullYear();
  const blocks = upcoming.matchAll(
    /<div class="month-label">([^<]+)<\/div>|<div class="show">([\s\S]*?)(?=<div class="show">|<div class="month-label">|<!-- =|$)/g,
  );
  for (const [, monthLabel, block] of blocks) {
    if (monthLabel) {
      year = Number(/\d{4}/.exec(monthLabel)?.[0] ?? year);
      continue;
    }
    const show = mohawkShow(block, year, venue);
    if (show) shows.push(show);
  }

  for (const [, date, bill] of comingSoon.matchAll(
    /<div class="cs-date">([^<]+)<\/div>\s*<div class="cs-bill">([\s\S]*?)<\/div>/g,
  )) {
    const parts = /^(\d{1,2})\/(\d{1,2})$/.exec(date.trim());
    const band = plain(bill);
    if (!parts || !band) continue;
    const monthName = MONTHS[Number(parts[1]) - 1];
    const startsAt = wallTimeToIso(yearFor(monthName, parts[2]), monthName, parts[2], "8:00 pm");
    if (!inWindow(startsAt)) continue;
    const ymd = startsAt.slice(0, 10);
    shows.push(
      compactShow({
        id: `${venue.id}-${ymd}-${slugify(band)}`,
        band,
        venue: venue.name,
        startsAt,
        timeTbd: true,
        eventUrl: venue.website,
        source: sourceOf(venue),
      }),
    );
  }

  return shows;
}

function mohawkShow(block, year, venue) {
  const field = (name) => {
    const match = new RegExp(`<(?:div|p) class="${name}">([\\s\\S]*?)<\\/(?:div|p)>`).exec(block);
    return match ? plain(match[1]) : "";
  };
  const date = /([A-Za-z]{3})\s+(\d{1,2})\s*$/.exec(field("date"));
  const band = field("bill");
  const price = field("price");
  if (!date || !band || /cancel/i.test(price)) return null;

  const times = field("times");
  const clock =
    /(\d{1,2}(?::\d{2})?\s*[ap]m)\s*show/i.exec(times)?.[1] ??
    [...times.matchAll(/\d{1,2}(?::\d{2})?\s*[ap]m/gi)].at(-1)?.[0];
  const startsAt = wallTimeToIso(year, date[1], date[2], clock ? withMinutes(clock) : "8:00 pm");
  if (!inWindow(startsAt)) return null;

  const facebook = /class="fb-link" href="([^"]+)"/.exec(block)?.[1];
  const eventUrl = facebook ? decodeEntities(facebook) : venue.website;
  const presents = field("presents");
  const note = field("note");
  const summary = clip([presents, note].filter(Boolean).join(" · "));

  return compactShow({
    id: `${venue.id}-${startsAt.slice(0, 10)}-${slugify(band)}`,
    band,
    venue: venue.name,
    startsAt,
    ...(clock ? {} : { timeTbd: true }),
    price: cleanCost(price),
    summary: summary || undefined,
    eventUrl,
    source: sourceOf(venue),
  });
}

// "8pm" -> "8:00 pm" so wallTimeToIso can read it.
function withMinutes(clock) {
  return clock.replace(/^(\d{1,2})\s*([ap]m)$/i, "$1:00 $2");
}

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = text.indexOf(endMarker, start);
  return text.slice(start, end < 0 ? undefined : end);
}

function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// --- Squarespace events collections (?format=json) ------------------------

async function loadSquarespace(venue) {
  const url = new URL(venue.website);
  url.searchParams.set("format", "json");
  const data = await fetchJson(url.href);
  const shows = [];

  for (const item of data.upcoming ?? data.items ?? []) {
    if (!item.title || !item.startDate || !item.fullUrl) continue;
    const startsAt = epochToEastern(item.startDate);
    if (!inWindow(startsAt)) continue;
    const eventUrl = new URL(item.fullUrl, venue.website).href;
    const summary = clip(plain(item.excerpt ?? ""));
    shows.push(
      compactShow({
        id: showId(venue, eventUrl),
        band: stripVenueSuffix(plain(item.title), venue.name),
        venue: venue.name,
        startsAt,
        summary: summary || undefined,
        eventUrl,
        source: sourceOf(venue),
      }),
    );
  }

  return shows;
}

// "The Steam Donkeys @ Nietzsche's Buffalo" -> "The Steam Donkeys"
function stripVenueSuffix(title, venueName) {
  const at = title.lastIndexOf("@");
  if (at <= 0) return title;
  const firstWord = venueName.split(/\s+/)[0].toLowerCase();
  return title.slice(at).toLowerCase().includes(firstWord) ? title.slice(0, at).trim() : title;
}

// --- iCalendar feeds (Babeville's Events Manager plugin) -------------------

async function loadIcal(venue) {
  const text = await fetchText(new URL(venue.icalPath, venue.website).href);
  const shows = [];

  for (const props of icsEvents(text)) {
    if (!props.SUMMARY || !props.DTSTART || !props.URL) continue;
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(props.DTSTART);
    if (!match) continue;
    const ymd = `${match[1]}-${match[2]}-${match[3]}`;
    const startsAt = `${ymd}T${match[4]}:${match[5]}:00${easternOffset(ymd)}`;
    if (!inWindow(startsAt)) continue;

    // CATEGORIES carries the room (Asbury Hall, The 9th Ward) plus site tags.
    const room = icsText(props.CATEGORIES ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag && !/highlighted/i.test(tag))
      .join(" / ");
    const description = clip(icsText(props.DESCRIPTION ?? ""));
    const summary = [room, description].filter(Boolean).join(" · ");
    shows.push(
      compactShow({
        id: showId(venue, props.URL),
        band: icsText(props.SUMMARY),
        venue: venue.name,
        startsAt,
        summary: summary || undefined,
        eventUrl: props.URL,
        source: sourceOf(venue),
      }),
    );
  }

  return shows;
}

function icsEvents(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const events = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const props = {};
    for (const line of block.split("END:VEVENT")[0].split(/\r?\n/)) {
      const match = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/.exec(line);
      if (match) props[match[1]] = match[2];
    }
    events.push(props);
  }
  return events;
}

function icsText(value) {
  return plain(value.replace(/\\n/g, " ").replace(/\\([,;\\])/g, "$1"));
}

// --- SpotOn restaurant sites (Duende) --------------------------------------
// <section id="123"><h2>Band</h2><h3>Friday October 2nd</h3> ...
// <h3 class="event-time">06:00 PM - 08:00 PM</h3></section>

async function loadSpotOn(venue) {
  const html = await fetchText(venue.website);
  const shows = [];

  for (const match of html.matchAll(/<section id="(\d+)">([\s\S]*?)<\/section>/g)) {
    const [, id, block] = match;
    const title = block.match(/<h2>([\s\S]*?)<\/h2>/);
    const date = block.match(/<h3>\s*[A-Z][a-z]+ (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})(?:st|nd|rd|th)?\s*<\/h3>/);
    const time = block.match(/<h3 class="event-time">\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (!title || !date || !time) continue;
    const band = plain(title[1]);
    if (!band) continue;

    const startsAt = wallTimeToIso(yearFor(date[1], date[2]), date[1], date[2], time[1]);
    if (!inWindow(startsAt)) continue;
    const info = block.match(/<div class="event-info-text">([\s\S]*?)<h3 class="event-time">/);
    const summary = clip(plain(info?.[1] ?? "").replace(/\b(MORE INFO|PURCHASE TICKETS)[^.]*$/i, "").trim());

    shows.push(
      compactShow({
        id: `${venue.id}-${id}`,
        band,
        venue: venue.name,
        startsAt,
        summary: summary || undefined,
        eventUrl: `${venue.website}#${id}`,
        source: sourceOf(venue),
      }),
    );
  }

  return shows;
}

// --- TicketWeb WordPress plugin (Rec Room) ---------------------------------
// <span class="artisteventsname ...">Band</span> ... with <span>A</span>, <span>B</span>
// <div class="artisteventstime">Saturday Oct 3 @ 07:00 PM</div>

async function loadTicketWeb(venue) {
  const html = await fetchText(venue.website);
  const shows = [];

  for (const block of html.split('class="flexmedia flexmedia--artistevents"').slice(1)) {
    const link = block.match(/href="([^"]+\/tm-event\/[^"]+)"/);
    const title = block.match(/class="artisteventsname[^"]*">([\s\S]*?)<\/span>/);
    const time = block.match(/class="artisteventstime">\s*[A-Z][a-z]+ ([A-Z][a-z]{2}) (\d{1,2}) @ (\d{1,2}:\d{2}\s*[AP]M)/i);
    if (!link || !title || !time) continue;

    const startsAt = wallTimeToIso(yearFor(time[1], time[2]), time[1], time[2], time[3]);
    if (!inWindow(startsAt)) continue;

    const support = block.match(/class="artistname[^"]*">([\s\S]*?)<\/div>/);
    const age = block.match(/class="artistseventsagelimit"[^>]*>\s*([^<]+?)\s*</);
    const band = plain(title[1]);
    const openers = support
      ? plain(support[1])
          .replace(/^with\s+/i, "")
          .split(/\s*,\s*/)
          .filter((act) => act && act !== band)
      : [];
    const summary = [openers.length ? `With ${openers.join(", ")}.` : "", age ? age[1].trim() : ""]
      .filter(Boolean)
      .join(" ");

    shows.push(
      compactShow({
        id: showId(venue, link[1]),
        band,
        venue: venue.name,
        startsAt,
        summary: summary || undefined,
        eventUrl: link[1],
        source: sourceOf(venue),
      }),
    );
  }

  return shows;
}

// --- Ticketmaster venue search ----------------------------------------------
// buffaloriverworks.com answers every request with a SiteGround captcha.
// Ticketmaster publishes this venue's onsale shows, which is the reachable list.

async function loadTicketmaster(venue) {
  const start = isoDate(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + horizonDays);
  const end = isoDate(endDate);
  const shows = [];

  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://www.ticketmaster.com/api/search/events/venue");
    url.searchParams.set("venueId", venue.venueId);
    url.searchParams.set("region", "200");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "date");
    url.searchParams.set("addOnType", "EVENT");
    url.searchParams.set("productStatuses", "onsale,offsale,rescheduled");
    url.searchParams.set("startDate", start);
    url.searchParams.set("endDate", end);
    url.searchParams.set("useStrictDateRange", "true");
    const data = await fetchJson(url.href);
    for (const event of data.events ?? []) {
      const show = showFromTicketmaster(event, venue);
      if (show) shows.push(show);
    }
    if (shows.length >= (data.total ?? 0) || (data.events ?? []).length === 0) break;
  }

  return shows;
}

function showFromTicketmaster(event, venue) {
  if (!event.title || !event.url || !event.dates?.startDate || event.cancelled) return null;
  const startsAt = epochToEastern(Date.parse(event.dates.startDate));
  if (!inWindow(startsAt)) return null;

  const title = plain(event.title);
  const openers = (event.artists ?? [])
    .map((artist) => plain(artist.name ?? ""))
    .filter((name) => name && !title.toLowerCase().includes(name.toLowerCase()));

  return compactShow({
    id: showId(venue, event.url),
    band: title,
    venue: venue.name,
    startsAt,
    summary: openers.length ? `With ${openers.join(", ")}.` : undefined,
    eventUrl: event.url,
    source: sourceOf(venue),
  });
}

// --- Simple Calendar grid (Mr. Goodbar) ------------------------------------
// The Google Calendar plugin draws one month into the page and loads the
// others from admin-ajax.php. Drink specials share the grid with the bands,
// so a title has to name a show before it is kept.

const SIMPLE_CALENDAR_SHOW = /\b(bands?|djs?|karaoke|live music|comedy|open mic)\b/i;

async function loadSimpleCalendar(venue) {
  const html = await fetchText(venue.website);
  const id = html.match(/data-calendar-id="(\d+)"/)?.[1];
  const nonce = html.match(/"nonce":"([0-9a-f]+)"/)?.[1];
  if (!id || !nonce) throw new Error(`No Simple Calendar on ${venue.website}`);

  const embedded = embeddedCalendarMonth(html);
  const shows = [];
  const seen = new Set();
  for (const { year, month } of monthsInWindow()) {
    const markup =
      embedded?.year === year && embedded?.month === month
        ? html
        : await fetchSimpleCalendarMonth(venue.website, id, nonce, year, month);
    for (const show of showsFromSimpleCalendar(markup, venue, year, month)) {
      if (seen.has(show.id)) continue;
      seen.add(show.id);
      shows.push(show);
    }
  }
  return shows;
}

function embeddedCalendarMonth(html) {
  const name = html.match(/class="simcal-current-month">([^<]+)</)?.[1];
  const year = html.match(/class="simcal-current-year">(\d{4})</)?.[1];
  if (!name || !year) return null;
  return { year: Number(year), month: monthIndex(name) + 1 };
}

function monthsInWindow() {
  const months = [];
  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(1);
  const horizon = new Date();
  horizon.setHours(12, 0, 0, 0);
  horizon.setDate(horizon.getDate() + horizonDays);
  while (cursor <= horizon) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  return months;
}

async function fetchSimpleCalendarMonth(website, id, nonce, year, month) {
  const response = await fetch(new URL("/wp-admin/admin-ajax.php", website), {
    method: "POST",
    headers: {
      "user-agent": "buffalo-music-calendar",
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      action: "simcal_default_calendar_draw_grid",
      month: String(month),
      year: String(year),
      id,
      nonce,
    }),
  });
  if (!response.ok) throw new Error(`${response.status} for ${website} ${year}-${month}`);
  const payload = await response.json();
  if (!payload.success || typeof payload.data !== "string") {
    throw new Error(`Simple Calendar rejected ${year}-${month}`);
  }
  return payload.data;
}

function showsFromSimpleCalendar(html, venue, year, month) {
  const shows = [];
  const dayPattern =
    /class="simcal-day-(\d+)[^"]*simcal-day-has-events[^"]*"[\s\S]*?<ul class="simcal-events">([\s\S]*?)<\/ul>/g;
  for (const match of html.matchAll(dayPattern)) {
    const day = match[1];
    for (const title of simpleCalendarTitles(match[2])) {
      if (!SIMPLE_CALENDAR_SHOW.test(title)) continue;
      const show = showFromSimpleCalendar(title, venue, year, month, day);
      if (show) shows.push(show);
    }
  }
  return shows;
}

function simpleCalendarTitles(listHtml) {
  const titles = [];
  for (const match of listHtml.matchAll(/<span class="simcal-event-title">([^<]*)<\/span>/g)) {
    const title = plain(match[1]);
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

function showFromSimpleCalendar(title, venue, year, month, day) {
  const act = simpleCalendarAct(title);
  const clock = lastClock(title);
  if (!act || !clock) return null;
  const monthName = MONTHS[month - 1];
  const startsAt = wallTimeToIso(year, monthName, day, clock);
  if (!inWindow(startsAt)) return null;
  const ymd = startsAt.slice(0, 10);
  return compactShow({
    id: `${venue.id}-${ymd}-${slugify(`${act.summary}-${act.band}`)}`,
    band: act.band,
    venue: venue.name,
    startsAt,
    summary: act.summary,
    eventUrl: venue.website,
    source: sourceOf(venue),
  });
}

// "1st Floor Band - Daze Ago - 9pm" keeps the bill. The weekly blurbs
// (drink-night karaoke, rotating DJs, open mic) become a short title.
function simpleCalendarAct(title) {
  const billed = title.match(/^(1st|2nd) Floor Bands?\s+[–—:-]\s+(.+)$/i);
  if (billed) {
    const band = billed[2]
      .replace(/\s*(?:[–—-]|@)\s*(?:doors at\s+)?\d{1,2}(?::\d{2})?\s*[ap]m\.?\s*$/i, "")
      .trim();
    const doors = /doors at\s+\d/i.test(title) ? "Doors" : "";
    return { band, summary: [`${billed[1]} floor`, doors].filter(Boolean).join(". ") };
  }
  if (/^rotating djs\b/i.test(title)) return { band: "Rotating DJs", summary: "1st floor" };
  if (/^karaoke in the attic\b/i.test(title)) {
    return { band: "Karaoke and rotating Live Music", summary: "Attic and 1st floor" };
  }
  if (/^open mic comedy\b/i.test(title)) {
    return { band: "Open Mic Comedy", summary: "Attic. DJ Mike West on the 1st floor." };
  }
  const karaoke = title.match(/^(1st|2nd) Floor Karaoke:\s*(.+)$/i);
  if (karaoke) return { band: "Karaoke", summary: `${karaoke[1]} floor. ${karaoke[2].replace(/\.$/, "")}` };
  return null;
}

function lastClock(title) {
  const matches = [...title.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b/gi)];
  const last = matches.at(-1);
  if (!last) return null;
  return `${last[1]}:${last[2] ?? "00"} ${last[3]}`;
}

// --- Shared helpers ---------------------------------------------------------

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

function priceFromOffer(offers, ignoreZero = false) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer) return undefined;
  const min = offer.priceSpecification?.minPrice ?? offer.price;
  const max = offer.priceSpecification?.maxPrice;
  if (min == null || min === "") return undefined;
  if (ignoreZero && Number(min) === 0) return undefined;
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
  if (!match) throw new Error(`Unexpected event start ${startDate}`);
  return `${match[1]}T${match[2]}:00${easternOffset(match[1])}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(name) {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  if (index < 0) throw new Error(`Unexpected month ${name}`);
  return index;
}

// Listings that omit the year mean the next occurrence of that date.
function yearFor(monthName, day) {
  const now = new Date();
  const candidate = new Date(now.getFullYear(), monthIndex(monthName), Number(day));
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return candidate < weekAgo ? now.getFullYear() + 1 : now.getFullYear();
}

function wallTimeToIso(year, monthName, day, label) {
  const clock = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(label.trim());
  if (!clock) throw new Error(`Unexpected show time ${label}`);
  let hour = Number(clock[1]) % 12;
  if (/pm/i.test(clock[3])) hour += 12;
  const month = String(monthIndex(monthName) + 1).padStart(2, "0");
  const ymd = `${year}-${month}-${String(day).padStart(2, "0")}`;
  return `${ymd}T${String(hour).padStart(2, "0")}:${clock[2]}:00${easternOffset(ymd)}`;
}

function asEasternWallClock(iso) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[1]}T${match[2]}${easternOffset(match[1])}`;
}

function epochToEastern(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  return `${ymd}T${get("hour")}:${get("minute")}:00${easternOffset(ymd)}`;
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

// Ids are React keys, so they must be unique across every venue. Recurring
// events on The Events Calendar end in /YYYY-MM-DD/, so keep the parent slug.
function showId(venue, url) {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  const slug = /^\d{4}-\d{2}-\d{2}$/.test(last) ? segments.slice(-2).join("-") : last;
  return `${venue.id}-${slug}`;
}

function absoluteUrl(href, base) {
  try {
    const url = new URL(decodeEntities(href), base);
    return url.origin === new URL(base).origin ? url.href : null;
  } catch {
    return null;
  }
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
    headers: { "user-agent": "buffalo-music-calendar", accept: "text/html,application/json,text/calendar" },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

await main();
