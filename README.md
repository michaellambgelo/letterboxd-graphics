# letterboxd-graphics

Shareable film-poster graphics, built from the diary data in
[`letterboxd-viewer`](https://github.com/michaellambgelo/letterboxd-viewer).

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
npm run fetch-posters august     # fills poster gaps — no API key needed
npm run build august             # → out/august.png
npm run edit                     # visual editor with live preview
```

`out/august.png` renders at 2× (2160×2700) so type stays crisp after a platform
downscales it. Pass `-- --1x` for the nominal 1080×1350.

## The editor

```bash
npm run edit           # opens the first graphic
npm run edit august    # opens a specific one
```

Fields on the left, the graphic live-rendering on the right. The preview is the
**real** `letterboxd-dark.html` in an iframe, repainted by calling its
`__RENDER__` on every keystroke — so it cannot drift from the exported PNG.

- **Copy** — eyebrow, title, subtitle, footer, handle.
- **Films** — drag to reorder, ✕ to remove, click a row to reveal its per-film
  overrides (displayed title, rating, log count). Type in the add box to search
  your diary; picking a result fills in the rating and watch count.
- **Poster picker** — click a film's thumbnail. Offers the current file, the
  Letterboxd poster, and (with a TMDB credential) every alternate TMDB holds for
  that film, including textless art. Choosing one downloads it into `posters/`.

  It also deep-links straight to that film's TMDB poster gallery, its TMDB page,
  and its Letterboxd page — **no credential required**, because the TMDB id comes
  off the Letterboxd page for free. So the keyless path to custom art is: open the
  gallery, copy any image address, paste it into the picker's URL box. Both
  `image.tmdb.org` and `media.themoviedb.org` links work, and whatever size you
  copied is normalised up to `w780`, so grabbing a page thumbnail still gives a
  full-resolution poster.
- **Type sizes** — a global multiplier plus an individual size for all nine text
  elements: eyebrow, title, subtitle, film title, film year, stars, log count,
  footnote, handle.
- **Layout** — columns, width, height, grid gap, poster corner radius.
- **Colour** — background and the three accents.

**Render PNG** always saves first, so the file you get matches the preview you
were looking at. `⌘S` saves; the pill by the buttons shows unsaved state, and
closing with unsaved changes warns you.

Everything the editor writes is plain JSON in `graphics/<name>.json` — nothing
stops you editing that by hand instead.

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

### Theme

Optional. Anything omitted falls back to `THEME_DEFAULTS` in `lib/graphic.mjs`,
so an older config keeps rendering identically as knobs get added.

```json
"theme": {
  "ground": "#14181c",
  "accent": "#00e054", "accent2": "#40bcf4", "accent3": "#ff8000",
  "gap": 26, "posterRadius": 5,
  "scale": 1,
  "fontSize": {
    "eyebrow": 17, "title": 62, "subtitle": 19,
    "filmTitle": 16.5, "filmYear": 14, "stars": 15,
    "logs": 13, "footnote": 14.5, "handle": 14
  }
}
```

`scale` multiplies every font size at once; `fontSize` sets them individually, in
px at the nominal 1080px width.

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
JSON-LD `image` gives a poster with no title search — and therefore no same-title
collision to resolve. `Luca (2021)` resolves itself to `/film/luca-2021`.

The page offers 600×900, but Letterboxd's CDN renders sizes on demand: the
`0-<w>-0-<h>-crop` segment of the URL is a *request*, not a fixed asset. The
fetcher rewrites it to **1000×1500**, since a poster is drawn ~434 device px wide
at 2× export and 600 leaves almost no headroom. Only 2:3 crops are rewritten, so
avatars and backdrops keep their own dimensions.

### TMDB fallback

Only used for a film with **no** `boxd.it` URI — something you haven't watched,
included through config overrides. Force it with `--tmdb`. A v3 API key and a v4
read-access token both work; the script tells them apart by shape.

Set it either way:

```bash
# environment variable
export TMDB_API_KEY=...

# or macOS Keychain, so it never lands in a shell history or a dotfile
security add-generic-password -a "$USER" -s dotfiles.TMDB_API_KEY -w
```

The scripts check `TMDB_API_KEY` first, then fall back to reading
`dotfiles.TMDB_API_KEY` from the Keychain per run — the value is never passed as
an argument or written to disk.

## The diary join

`lib/join.mjs` reads a sibling checkout of
[`letterboxd-viewer`](https://github.com/michaellambgelo/letterboxd-viewer) at
`../letterboxd-viewer` — override the location with `LETTERBOXD_VIEWER_PATH`:

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

The Letterboxd decal in the footer is the real brand asset, copied from
`letterboxd-viewer/assets/images/` — not a hand-rolled imitation.

A template is a standalone HTML file that defines `window.__RENDER__(graphic)`,
paints from the argument, and resolves once fonts and images have settled
(setting `document.body.dataset.ready`). The PNG build injects
`window.__GRAPHIC__` and lets the template auto-call itself; the editor calls
`__RENDER__` directly for live updates. Add a new one by copying the existing
file and naming it in a config's `template`.

## License

MIT — see [LICENSE.md](LICENSE.md).

The Letterboxd decal in `assets/` is Letterboxd's own brand asset, included for
attribution and not covered by that licence. Poster art is not redistributed:
`posters/` is gitignored, and you supply the images.
