# CLAUDE.md

Guidance for Claude Code when working in `letterboxd-graphics`.

## What this is

A generator for shareable film-poster graphics. A JSON config plus a directory of
poster images renders to a PNG through headless Chromium. Ratings and watch
counts are joined from `../letterboxd-viewer`, not retyped.

It is **not** a web app and has no deploy target. The output is a PNG file.

## Commands

```bash
npm install
npm run build <name>                 # graphics/<name>.json → out/<name>.png (2160×2700)
npm run build <name> -- --1x         # nominal 1080×1350
npm run build <name> -- --out p.png  # explicit destination
npm run fetch-posters <name>         # fill poster gaps — Letterboxd first, no credential
npm run fetch-posters <name> -- --yes # don't prompt on the TMDB fallback
npm run fetch-posters <name> -- --tmdb # force the TMDB path
npm run edit [<name>]                # visual editor (loopback only)
npm run edit -- --no-open            # don't launch a browser (use from a tool call)
```

`fetch-posters` needs **no credential** for anything you have logged. Pass `--yes`
when running it from a tool call: only the TMDB fallback prompts, via `readline`,
which hangs forever in a non-TTY shell. There is nothing to confirm on the
Letterboxd path — the URI is exact.

There is no test suite. Verification is visual: build the PNG and look at it.

## Layout

| Path | Role |
|---|---|
| `graphics/*.json` | One file per graphic — the whole spec |
| `posters/` | `<slug>-<year>.<ext>`, hand-supplied. **Gitignored** |
| `templates/*.html` | Standalone HTML themes reading `window.__GRAPHIC__` |
| `lib/join.mjs` | Diary join against `letterboxd-viewer` |
| `lib/slug.mjs` | Canonical slug / poster stem / join key |
| `lib/graphic.mjs` | Config → render-ready payload; `THEME_DEFAULTS` |
| `lib/render.mjs` | Static server + the screenshot routine |
| `lib/posters.mjs` | Letterboxd + TMDB poster sourcing |
| `scripts/build.mjs` | CLI wrapper around graphic + render |
| `scripts/fetch-posters.mjs` | Poster gap-filler: Letterboxd primary, TMDB fallback |
| `scripts/edit.mjs` | Editor server (static + JSON API) |
| `editor/` | Editor UI — plain HTML/JS, no build step |
| `assets/` | The real Letterboxd decal, copied from letterboxd-viewer |

## Things that will bite

- **Serve over HTTP, never `file://`.** `build.mjs` runs a local static server on
  purpose — `file://` blocks XHR and font loads. Same trap as the Babel promo
  kits.
- **Never screenshot before images decode.** The template sets
  `document.body.dataset.ready = '1'` only after `document.fonts.ready` and every
  `<img>` settles; the build waits on that flag *and* re-checks `naturalWidth`,
  because a 404'd poster "loads successfully" as a broken image.
- **Year is a string on one side and a number on the other.** Config files carry
  `"year": 2017`; `viewing_history.json` carries `"2017"`. `filmKey()` coerces
  both — don't compare them raw.
- **The archive directory is date-stamped** (`letterboxd-michaellamb-2026-07-09-…`).
  `newestArchiveDir()` globs and takes the newest. Never hardcode that path; it
  expires with the next export.
- **An unmatched title must stay fatal.** The whole point of the join is that a
  graphic can't ship with `0 logs` under a film. Don't "helpfully" default to
  zero or skip the film.
- **Don't commit poster art.** `posters/` is gitignored deliberately.
- **One render path, not two.** `lib/graphic.mjs` + `lib/render.mjs` are shared by
  the PNG build and the editor preview. If you add a rendering behaviour to one
  and not the other, the preview starts lying about the output — which is this
  tool's worst possible bug. Same for poster logic: it lives in `lib/posters.mjs`,
  not copied into a script.
- **Render saves first.** The editor's Render button PUTs the draft before
  building, because the build reads the file, not the browser's state.
- **The editor writes files.** Graphic names are validated against
  `^[a-z0-9][a-z0-9._-]*$` and poster URLs against an `image.tmdb.org` /
  `a.ltrbxd.com` allowlist. The server binds to `127.0.0.1` only. Keep all three.
- **Don't hand-roll brand assets.** The footer decal is Letterboxd's own SVG. If
  you need another mark, look in `letterboxd-viewer` before drawing one.

## Where posters come from

**Letterboxd is the primary source and needs no credential.** The newest archive's
`watched.csv` carries a film-level `boxd.it` URI for every film in the diary.
That URI *is* the film — follow it and read the page's `application/ld+json`
`image` field for a 600×900 poster. No title search, so no same-title collision
to resolve: `Luca (2021)` resolves itself to `/film/luca-2021`.

This is the same source `letterboxd-viewer/assets/images/fulls/` came from — those
29 files are 600×900 too. Nothing in that repo calls the TMDB *API*; its `tmdbId`
values arrive free in the RSS `tmdb:` XML namespace.

**TMDB is the fallback only**, for a film with no `boxd.it` URI — something not in
the diary, included via config overrides. Its credential is read per-run from the
macOS Keychain (`dotfiles.TMDB_API_KEY`), never exported or passed as an argument;
`export TMDB_API_KEY=…` doesn't survive between tool calls anyway, and a secret
pasted into the session lands in the transcript.

Letterboxd bot-challenges automated clients, so the fetcher sends a browser UA and
sleeps between requests. If the film page ever starts failing, the script says so
and points at `--tmdb` or a hand-dropped file rather than retrying — treat a
challenge as a source change, not a transient error.

## Adding a template

Copy `templates/letterboxd-dark.html`. A template must:

1. Define `window.__RENDER__(graphic)` — paint from the **argument**, never from a
   captured value. The editor calls it repeatedly on the same document.
2. Auto-call it at the end: `if (window.__GRAPHIC__) window.__RENDER__(window.__GRAPHIC__);`
   That is how the PNG build drives it.
3. Set `document.body.dataset.ready = '0'` when painting starts and `'1'` once
   fonts and images settle; return that promise.
4. Size `#sheet` from `--w` / `--h` — the build screenshots that element, not the
   viewport.
5. Read theme knobs off `graphic.theme` and apply them as CSS custom properties,
   with the template's own values as fallbacks: `ground`, `accent`, `accent2`,
   `accent3`, `gap`, `posterRadius`, `scale`, and the nine `fontSize` entries.

Then name it in a config's `template` field. The editor picks up a new template
automatically; its Type/Layout/Colour knobs assume the contract above.
