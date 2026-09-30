import { loadShows } from "./lib/loadEvents";
import { formatWeekendRange, upcomingWeekend } from "./lib/weekend";
import { WeekendBoard } from "./components/WeekendBoard";
import venues from "./sources/venues.json";

const venueList = new Intl.ListFormat("en-US", { type: "conjunction" }).format(
  venues.map((venue) => venue.name),
);

export default function App() {
  const weekend = upcomingWeekend();
  const shows = loadShows();

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">Buffalo</p>
        <h1>Music Calendar</h1>
        <p className="range">
          <span>This weekend</span>
          <time dateTime={weekend.friday.toISOString()}>{formatWeekendRange(weekend)}</time>
        </p>
      </header>
      <WeekendBoard weekend={weekend} shows={shows} />
      <footer className="colophon">
        <p>Listings from {venueList}.</p>
      </footer>
    </div>
  );
}
