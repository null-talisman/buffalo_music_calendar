import type { Show } from "../types";
import { formatClock } from "../lib/weekend";

export function EventCard({
  show,
  onOpen,
}: {
  show: Show;
  onOpen: (show: Show) => void;
}) {
  return (
    <button type="button" className="event" onClick={() => onOpen(show)}>
      <time dateTime={show.startsAt}>{formatClock(show.startsAt)}</time>
      <span className="event-copy">
        <span className="event-band">{show.band}</span>
        <span className="event-venue">{show.venue}</span>
      </span>
      {show.price ? <span className="price">{show.price}</span> : null}
    </button>
  );
}
