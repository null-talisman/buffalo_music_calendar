import events from "../data/events.json";
import type { Show } from "../types";

/**
 * Shows scraped by scripts/refresh-calendar.mjs, bundled at build time.
 * Sorted by start time so each day's column reads top to bottom.
 */
export function loadShows(): Show[] {
  return [...(events as Show[])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
