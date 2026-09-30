import { useState } from "react";
import { loadShows } from "./lib/loadEvents";
import { datesForView, formatDateSpan, type CalendarView } from "./lib/weekend";
import { CalendarBoard } from "./components/CalendarBoard";

const VISITORS =
  "https://hitscounter.dev/api/hit?url=www.buffalomusiccalendar.com&label=Visitors&icon=cup-straw&color=%230a58ca&message=&style=flat&tz=UTC";

const VIEWS: readonly { id: CalendarView; label: string; caption: string }[] = [
  { id: "today", label: "Today", caption: "Today" },
  { id: "weekend", label: "Weekend", caption: "This weekend" },
  { id: "week", label: "Week", caption: "Next 7 days" },
];

const ALL = "";

function distinct(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export default function App() {
  const [view, setView] = useState<CalendarView>("weekend");
  const [genre, setGenre] = useState(ALL);
  const [venue, setVenue] = useState(ALL);
  const dates = datesForView(view);
  const allShows = loadShows();
  const current = VIEWS.find((item) => item.id === view) ?? VIEWS[1];

  const genres = distinct(allShows.map((show) => show.genre));
  const venues = distinct(allShows.map((show) => show.venue));
  const shows = allShows.filter(
    (show) => (genre === ALL || show.genre === genre) && (venue === ALL || show.venue === venue),
  );
  const filtered = genre !== ALL || venue !== ALL;

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">Buffalo</p>
        <h1>
          <span>Music</span>
          <img className="mark" src="/bills-classic-logo.png" alt="" />
          <span>Calendar</span>
        </h1>
        <p className="range">
          <span>{current.caption}</span>
          <time dateTime={dates[0].toISOString()}>{formatDateSpan(dates)}</time>
        </p>
        <div className="controls">
          <div className="views" role="group" aria-label="Date range">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === view}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="filters">
            <label>
              <span>Genre</span>
              <select value={genre} onChange={(event) => setGenre(event.target.value)}>
                <option value={ALL}>All genres</option>
                {genres.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Venue</span>
              <select value={venue} onChange={(event) => setVenue(event.target.value)}>
                <option value={ALL}>All venues</option>
                {venues.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            {filtered ? (
              <button
                type="button"
                className="clear"
                onClick={() => {
                  setGenre(ALL);
                  setVenue(ALL);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <CalendarBoard view={view} dates={dates} shows={shows} filtered={filtered} />
      <footer className="colophon">
        <p>
          For questions or support, please email{" "}
          <a href="mailto:support@buffalomusiccalendar.com">support@buffalomusiccalendar.com</a>
        </p>
        <img className="visitors" src={VISITORS} alt="Visitor count" />
      </footer>
    </div>
  );
}
