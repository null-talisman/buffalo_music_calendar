import { useState } from "react";
import type { Show, WeekendDay } from "../types";
import { formatWeekday, sameDay, type Weekend } from "../lib/weekend";
import { EventCard } from "./EventCard";
import { EventDialog } from "./EventDialog";

const DAYS: readonly WeekendDay[] = ["friday", "saturday", "sunday"];

export function WeekendBoard({
  weekend,
  shows,
}: {
  weekend: Weekend;
  shows: Show[];
}) {
  const [selected, setSelected] = useState<Show | null>(null);

  return (
    <>
    <section className="board" aria-label="This weekend">
      {DAYS.map((day) => {
        const date = weekend[day];
        const dayShows = shows.filter((show) => sameDay(show.startsAt, date));

        return (
          <section className={`day day-${day}`} key={day} aria-labelledby={`${day}-heading`}>
            <header className="day-head">
              <p className="day-name" id={`${day}-heading`}>
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
