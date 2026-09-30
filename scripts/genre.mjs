import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// None of the venue feeds publish a genre. The label comes from three places,
// in order of trust: an act we already know, a genre named in the show title,
// then a genre named in the listing text.

const artistsPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/sources/artists.json");
const ARTISTS = Object.entries(JSON.parse(readFileSync(artistsPath, "utf8"))).flatMap(
  ([genre, names]) => names.map((name) => [genre, wordPattern(normalize(name))]),
);

// What kind of night it is matters more than who is hosting it, so
// "Open Mic hosted by Tom Stahl" is an open mic, not a folk show.
const EVENT_PATTERNS = [
  ["Open Mic", /\bopen mic\b|\bsongwriter showcase\b/],
  ["Karaoke", /\bkaraoke\b/],
  ["Trivia", /\btrivia\b|\bbingo\b|\bname that song\b/],
  ["Watch Party", /\bwatch part(?:y|ies)\b|\bviewing party\b|\bgame party\b/],
  ["Dinner Show", /\bmurder mystery\b|\bmystery dinner\b|\bdinner (?:&|and) show\b|\bsupper club\b|\btaste-a-long\b/],
  ["Burlesque", /\bburlesque\b|\bdrag\b/],
  ["Comedy", /\bcomedy\b|\bcomedian\b|\bstand-?up\b/],
  ["Piano", /\bdueling pianos\b|\bpiano party\b/],
  ["Talk", /\bconvo\b|\bmusic history\b|\blecture\b/],
];

// First match wins, so "punk rock" stays Punk and "pop punk" stays Punk.
const GENRE_PATTERNS = [
  ["German", /(?<!no )\bgerman music\b|\bbavarian\b|\bpolka\b|\bhaus (?:duo|band|residency)\b|\bbarrel tapping\b/],
  ["Emo", /\bemo\b/],
  ["Hip-Hop", /\bhip[-\s]?hop\b|\brap\b/],
  ["EDM", /\b(?:edm|techno|dubstep|bass music|house music|deep house|tech house|drum (?:&|and) bass|rave)\b/],
  ["Electronic", /\belectronic\b|\bsynth\b/],
  ["Punk", /\bpunk\b|\bhardcore\b/],
  ["Metal", /\bmetal\b|\bdoom\b|\bdeath ?core\b/],
  ["Blues", /\bblues\b/],
  ["Jazz", /\bjazz\b|\bsax\b|\bbig band\b/],
  ["Soul", /\bsoul\b|\bmotown\b|\br&b\b/],
  ["Funk", /\bfunk\b/],
  ["Bluegrass", /\bbluegrass\b|\bstring band\b|\bjug ?band\b/],
  ["Jam", /\bjam band\b|\bjam\b/],
  ["Folk", /\bfolk\b|\bceltic\b|\birish\b|\bacoustic\b/],
  ["Country", /(?<!the )\bcountry\b|\bhonky[-\s]?tonk\b/],
  ["Americana", /\bamericana\b|\bsinger-songwriter\b|\balt-country\b/],
  ["Reggae", /\breggae\b|\bska\b|\bdub\b/],
  ["Latin", /\blatin\b|\bsalsa\b|\bcumbia\b|\bbachata\b/],
  ["Classical", /\bclassical\b|\borchestra\b|\bchamber music\b|\bchamber players\b|\bminuets?\b|\bsymphony\b|\bstring quartet\b|\bbrass\b/],
  ["Indie", /\bindie\b|\bshoegaze\b|\bdream pop\b/],
  ["Pop", /\bpop\b/],
  ["DJ", /\bdj\b|\bdance party\b/],
  ["Rock", /(?<!black )\brock\b|\bpsychedelic\b|\bgrunge\b/],
];

// Listing text is noisier than a title, so only clear genre words count there.
const TEXT_PATTERNS = [...EVENT_PATTERNS, ...GENRE_PATTERNS].filter(
  ([label]) => !["Watch Party", "Piano", "Talk", "Jam", "Pop", "German"].includes(label),
);

const TRIBUTE = /\btribute\b|\bthe music of\b|\bsongs of\b/;

export function inferGenre(band, summary = "") {
  const title = normalize(band);
  const text = normalize(summary);

  return (
    firstMatch(EVENT_PATTERNS, title) ??
    knownArtist(title) ??
    firstMatch(GENRE_PATTERNS, title) ??
    firstMatch(TEXT_PATTERNS, text) ??
    (TRIBUTE.test(title) ? "Tribute" : undefined)
  );
}

function firstMatch(patterns, text) {
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) return label;
  }
  return undefined;
}

// The act named first is the headliner, so it decides the label.
function knownArtist(title) {
  let best;
  for (const [genre, pattern] of ARTISTS) {
    const match = pattern.exec(title);
    if (match && (best === undefined || match.index < best.index)) best = { genre, index: match.index };
  }
  return best?.genre;
}

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function wordPattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
}
