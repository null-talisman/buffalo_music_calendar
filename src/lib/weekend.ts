// Dates are handled in the browser's local time zone. Show times in
// events.json carry an Eastern offset, so they land on the right day for
// anyone viewing from Buffalo.

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

/** "Oct 2 – 4" or "Oct 30 – Nov 1" */
export function formatWeekendRange(weekend: Weekend): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).formatRange(weekend.friday, weekend.sunday);
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
export function formatShowWhen(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
  return `${day} · ${formatClock(iso)}`;
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
