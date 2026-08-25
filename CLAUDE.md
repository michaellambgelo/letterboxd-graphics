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
npm run fetch-posters <name>         # fill poster gaps from TMDB (needs the Keychain key)
npm run fetch-posters <name> -- --yes # non-interactive: take the year-matched hit
```

**Always pass `--yes` when running `fetch-posters` from a tool call.** Without
it the script prompts per film via `readline`, which hangs forever in a non-TTY
shell. `--yes` takes the top year-filtered hit — then *look at the rendered PNG*
to confirm the collision-prone titles (*Luca*, *Past Lives*) got the right film.

There is no test suite. Verification is visual: build the PNG and look at it.

## Layout

| Path | Role |
|---|---|
| `graphics/*.json` | One file per graphic — the whole spec |
| `posters/` | `<slug>-<year>.<ext>`, hand-supplied. **Gitignored** |
| `templates/*.html` | Standalone HTML themes reading `window.__GRAPHIC__` |
| `lib/join.mjs` | Diary join against `letterboxd-viewer` |
| `lib/slug.mjs` | Canonical slug / poster stem / join key |
| `scripts/build.mjs` | Static server + playwright screenshot |
| `scripts/fetch-posters.mjs` | Optional TMDB gap-filler |

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

## The TMDB credential

Read per-run from the macOS Keychain (`dotfiles.TMDB_API_KEY`), never exported or
passed as an argument. Do not add it to `.env`, a config file, or a shell export —
`export TMDB_API_KEY=…` doesn't survive between tool calls anyway, and a secret
pasted into the session lands in the transcript.

Only `fetch-posters` needs it. `build` never does.

## Adding a template

Copy `templates/letterboxd-dark.html`. A template must:

1. Read `window.__GRAPHIC__` (`{ title, subtitle, footer, width, height, columns, films[] }`).
2. Size `#sheet` from `--w` / `--h` — the build screenshots that element, not the
   viewport.
3. Set `document.body.dataset.ready = '1'` when fonts and images have settled.

Then name it in a config's `template` field.
