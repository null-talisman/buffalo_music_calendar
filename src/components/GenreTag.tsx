const GENRE_CLASS: Record<string, string> = {
  Rock: "rock",
  Punk: "punk",
  Metal: "metal",
  Folk: "folk",
  Country: "country",
  Americana: "americana",
  Blues: "blues",
  Jazz: "jazz",
  Soul: "soul",
  Funk: "funk",
  "Hip-Hop": "hiphop",
  EDM: "edm",
  Electronic: "electronic",
  Reggae: "reggae",
  Latin: "latin",
  Classical: "classical",
  Comedy: "comedy",
  Karaoke: "karaoke",
  DJ: "dj",
};

export function GenreTag({ genre }: { genre: string }) {
  const kind = GENRE_CLASS[genre] ?? "other";
  return <span className={`tag tag-${kind}`}>{genre}</span>;
}
