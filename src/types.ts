export type WeekendDay = "friday" | "saturday" | "sunday";

export type SourceKind = "website" | "instagram" | "facebook";

export type ShowSource = {
  name: string;
  kind: SourceKind;
  url: string;
};

export type Show = {
  id: string;
  band: string;
  venue: string;
  startsAt: string;
  price?: string;
  genre?: string;
  summary?: string;
  eventUrl: string;
  source: ShowSource;
};
