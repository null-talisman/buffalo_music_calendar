import { useState } from "react";
import type { Show } from "../types";
import { formatWeekday, sameDay, type CalendarView } from "../lib/weekend";
import { EventCard } from "./EventCard";
import { EventDialog } from "./EventDialog";

export function CalendarBoard({
  view,
  dates,
  shows,
}: {
  view: CalendarView;
  dates: Date[];
  shows: Show[];
}) {
  const [selected, setSelected] = useState<Show | null>(null);

  return (
    <>
      <section className={`board board-${view}`} aria-label="Shows">
        {dates.map((date) => {
          const dayShows = shows.filter((show) => sameDay(show.startsAt, date));
          const headingId = `day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

          return (
            <section className="day" data-weekday={date.getDay()} key={headingId} aria-labelledby={headingId}>
              <header className="day-head">
                <p className="day-name" id={headingId}>
                  {formatWeekday(date)}
                </p>
                <p className="day-num">{date.getDate()}</p>
              </header>
              {dayShows.length > 0 ? (
                <div className="events">
                  {dayShows.map((show) => (
                    <EventCard key={show.id} show={show} onOpen={setSelected} />
                  ))}
                </div>
              ) : (
                <p className="empty">No shows posted</p>
              )}
            </section>
          );
        })}
      </section>
      {selected ? <EventDialog show={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
