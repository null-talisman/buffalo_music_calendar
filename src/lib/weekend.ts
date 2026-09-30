// Dates are handled in the browser's local time zone. Show times in
// events.json carry an Eastern offset, so they land on the right day for
// anyone viewing from Buffalo.

export type CalendarView = "today" | "weekend" | "week";

export type Weekend = {
  friday: Date;
  saturday: Date;
  sunday: Date;
};

const SUNDAY = 0;
const FRIDAY = 5;
const SATURDAY = 6;

/**
 * The weekend to show. Friday through Sunday counts as "this weekend", so
 * the page keeps showing the current one until Monday.
 */
export function upcomingWeekend(now: Date = new Date()): Weekend {
  const today = startOfDay(now);
  const day = today.getDay();

  let offset: number;
  if (day === SATURDAY) offset = -1;
  else if (day === SUNDAY) offset = -2;
  else offset = FRIDAY - day;

  const friday = addDays(today, offset);
  return {
    friday,
    saturday: addDays(friday, 1),
    sunday: addDays(friday, 2),
  };
}

/** Today is one day. Weekend is the coming Friday–Sunday. Week is the next 7 days. */
export function datesForView(view: CalendarView, now: Date = new Date()): Date[] {
  const today = startOfDay(now);
  switch (view) {
    case "today":
      return [today];
    case "weekend": {
      const weekend = upcomingWeekend(now);
      return [weekend.friday, weekend.saturday, weekend.sunday];
    }
    case "week":
      return Array.from({ length: 7 }, (_, index) => addDays(today, index));
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/** "Sep 29" for one day, "Oct 2 – 4" or "Oct 30 – Nov 1" for a span. */
export function formatDateSpan(dates: readonly Date[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  if (!last || sameDay(first.toISOString(), last)) return format.format(first);
  return format.formatRange(first, last);
}

/** "Friday" */
export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
}

/** "7:00 PM" */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "Friday, October 2 · 7:00 PM" */
export function formatShowWhen(iso: string, timeTbd = false): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
  return `${day} · ${timeTbd ? "Time TBD" : formatClock(iso)}`;
}

export function sameDay(iso: string, date: Date): boolean {
  const show = new Date(iso);
  return (
    show.getFullYear() === date.getFullYear() &&
    show.getMonth() === date.getMonth() &&
    show.getDate() === date.getDate()
  );
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
