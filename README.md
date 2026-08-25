# letterboxd-graphics

Shareable film-poster graphics, built from the diary data in
[`letterboxd-viewer`](../letterboxd-viewer).

You describe a graphic in a JSON file, drop poster images in `posters/`, and the
build renders a PNG through headless Chromium. Ratings and watch counts are
joined automatically from your diary — you never retype a number that Letterboxd
already knows.

```
graphics/august.json  +  posters/*.jpg
          │
          ▼   lib/join.mjs  ← letterboxd-viewer/data/viewing_history.json
   templates/letterboxd-dark.html
          │
          ▼   scripts/build.mjs  (localhost + playwright)
   out/august.png    2160×2700
```

## Quick start

```bash
npm install
npm run fetch-posters august     # optional — fills gaps from TMDB
npm run build august             # → out/august.png
```

`out/august.png` renders at 2× (2160×2700) so type stays crisp after a platform
downscales it. Pass `-- --1x` for the nominal 1080×1350.

## Defining a graphic

One file per graphic in `graphics/`. The only required fields are `title` and
`films`:

```json
{
  "title": "movies that feel like August",
  "template": "letterboxd-dark",
  "width": 1080,
  "height": 1350,
  "columns": 4,
  "subtitle": "the end of summer, the start of school…",
  "footer": "…",
  "films": [
    { "title": "Aftersun", "year": 2022 },
    { "title": "Luca", "year": 2021 }
  ]
}
```

Films render in the order written. Per-film overrides:

| Key | Effect |
|---|---|
| `rating` | Use this instead of the diary rating (also lets you include an unwatched film) |
| `logs` | Use this instead of the diary watch count |
| `poster` | Explicit path, instead of the `posters/<slug>-<year>` convention |

Setting both `rating` and `logs` skips the diary join entirely, so a graphic
doesn't have to be about your own watches.

## Posters

Files live in `posters/`, named `<slug>-<year>.<ext>` — `aftersun-2022.jpg`,
`everybody-wants-some-2016.jpg`. `.jpg`, `.jpeg`, `.png`, `.webp`, and `.avif`
all work. The build tells you the exact filename it wants when one is missing.

`posters/` is **gitignored** — poster art isn't ours to redistribute. The repo
ships the configs and the code; you supply the images.

`npm run fetch-posters <name>` fills only the gaps. A file you placed by hand
always wins.

### It needs no API key

The newest archive's `watched.csv` carries a film-level `boxd.it` URI for every
film in the diary. That URI *is* the film, so following it and reading the page's
JSON-LD `image` gives a 600×900 poster with no title search — and therefore no
same-title collision to resolve. `Luca (2021)` resolves itself to
`/film/luca-2021`.

### TMDB fallback

Only used for a film with **no** `boxd.it` URI — something you haven't watched,
included through config overrides. Force it with `--tmdb`. The credential is read
per-run from the macOS Keychain, never exported or passed on the command line:

```bash
~/.dotfiles/secrets/keychain-secrets.sh set TMDB_API_KEY
```

plus `TMDB_API_KEY` in `~/.dotfiles/secrets/secrets.manifest`. A v3 API key and a
v4 read-access token both work; the script tells them apart by shape.

## The diary join

`lib/join.mjs` reads `../letterboxd-viewer` (override with
`LETTERBOXD_VIEWER_PATH`):

- **`data/viewing_history.json`** is the primary source — the merged archive+RSS
  diary. `logs` is the entry count; `rating` is the latest non-null
  `memberRating`, so a re-rate on a rewatch supersedes the old one.
- The newest **`data/archive/letterboxd-*/ratings.csv`** is a fallback, for a film
  rated without ever being logged. The archive directory is date-stamped, so the
  newest is globbed rather than hardcoded.

An unmatched title **fails the build**, with the near-misses spelled out —
`Ladybird` suggests `Lady Bird (2017)`, and a right title with the wrong year
says so. A silent `0 logs` on a graphic you're about to post is the outcome
worth preventing.

## Templates

`templates/letterboxd-dark.html` — Letterboxd's own palette (`#14181c` ground,
green `#00e054`, blue `#40bcf4`, orange `#ff8000`). Ratings render as real half
stars, not the text "4.5"; watch counts turn orange once a film is a rewatch.
The grid follows `columns`, so 6 or 9 films work without touching the template.

A template is a standalone HTML file that reads `window.__GRAPHIC__` and sets
`document.body.dataset.ready = '1'` once fonts and images have settled. Add a new
one by copying the existing file and naming it in a config's `template`.
