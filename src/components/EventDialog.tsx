import { useEffect, useRef } from "react";
import type { Show } from "../types";
import { formatShowWhen } from "../lib/weekend";

export function EventDialog({ show, onClose }: { show: Show; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="popup-close" onClick={onClose}>
          Close
        </button>
        <p className="popup-venue">{show.venue}</p>
        <h2 id="event-dialog-title">{show.band}</h2>
        <p className="popup-when">{formatShowWhen(show.startsAt)}</p>
        {show.price ? <p className="price popup-price">{show.price}</p> : null}
        {show.summary ? <p className="popup-summary">{show.summary}</p> : null}
        <a className="event-link" href={show.eventUrl} target="_blank" rel="noreferrer">
          View event
        </a>
      </div>
    </div>
  );
}
