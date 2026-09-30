import type { Show } from "../types";
import { formatClock } from "../lib/weekend";
import { GenreTag } from "./GenreTag";

export function EventCard({
  show,
  onOpen,
}: {
  show: Show;
  onOpen: (show: Show) => void;
}) {
  return (
    <button type="button" className="event" onClick={() => onOpen(show)}>
      <time dateTime={show.startsAt}>{show.timeTbd ? "Time TBD" : formatClock(show.startsAt)}</time>
      <span className="event-copy">
        <span className="event-band">{show.band}</span>
        <span className="event-venue">{show.venue}</span>
        {show.genre ? <GenreTag genre={show.genre} /> : null}
      </span>
      {show.price ? <span className="price">{show.price}</span> : null}
    </button>
  );
}
