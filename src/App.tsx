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

export default function App() {
  const [view, setView] = useState<CalendarView>("weekend");
  const dates = datesForView(view);
  const shows = loadShows();
  const current = VIEWS.find((item) => item.id === view) ?? VIEWS[1];

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">Buffalo</p>
        <h1>Music Calendar</h1>
        <p className="range">
          <span>{current.caption}</span>
          <time dateTime={dates[0].toISOString()}>{formatDateSpan(dates)}</time>
        </p>
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
      </header>
      <CalendarBoard view={view} dates={dates} shows={shows} />
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
