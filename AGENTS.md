# AGENTS.md

Guide for AI agents working in this repo. Read this before making changes.

## What this is

A self-updating, read-only World Cup 2026 sweepstake tracker. One JSON file is the source of truth; a GitHub Action rebuilds a static HTML page on every push and deploys to GitHub Pages.

Live site: https://dave-poe.github.io/wc2026/

## Architecture

```
results.json ──▶ build.mjs ──▶ index.html (generated, gitignored) ──▶ GitHub Pages
                    ▲
              template.html (look + client JS)
```

- **`results.json`** — the only file edited during the tournament. Allocations, fixtures, scores, prizes, knockout bracket.
- **`build.mjs`** — zero-dep Node script. Computes standings, third-place ranking, prize ownership, elimination state. Inlines the resulting payload into `template.html` at `/*__DATA__*/`.
- **`template.html`** — the page shell: CSS, structure, client JS for tabs/theme/rendering. Reads `window.__SWEEPSTAKE__`.
- **`index.html`** — generated output. **Gitignored.** Never edit by hand.

## Key commands

```bash
node build.mjs              # build index.html
npm test                    # Playwright smoke test (local: builds + serves)
npm run test:prod           # Playwright against the live URL
```

`npm test` auto-runs `build.mjs` and serves via `http-server` (see `playwright.config.ts`).

## CI

- [.github/workflows/update.yml](.github/workflows/update.yml) — builds and deploys to Pages on push to `main` (paths-filtered to relevant files).
- [.github/workflows/update-results.yml](.github/workflows/update-results.yml) — scheduled score updates from football-data.org; validates `results.json` and creates a PR only when scores change.
- [.github/workflows/test.yml](.github/workflows/test.yml) — Playwright on PRs only. **Not** on push to main (intentional).
- [.github/workflows/test-prod.yml](.github/workflows/test-prod.yml) — runs after every successful deploy against the live URL.

Pages source must be set to **GitHub Actions** in repo Settings → Pages (not "Deploy from a branch").

## Conventions

- **No dependencies in the build path.** `build.mjs` is pure Node stdlib. Don't add bundlers, frameworks, or runtime deps. Devtools (Playwright, http-server) are fine.
- **Team names are identifiers.** Strings in `results.json` (`groups`, `allocations`, fixtures, knockout) must match each other exactly. The `flagISO` map in `build.mjs:15-28` keys off the same name. Rename in one place → rename everywhere.
- **Lightweight first.** This is a small personal project. Don't add abstractions, configuration layers, or "for future use" hooks. If a one-line fix works, that's the right fix.
- **Static everything.** All data is baked in at build time. No runtime fetches, no APIs, no client storage beyond theme preference.

## Gotchas

- **Flag drift.** If a team name in `results.json` doesn't appear in `build.mjs`'s `flagISO` map, the flag silently disappears. No build warning yet (TODO). When renaming a team, update both.
- **Display vs. lookup names.** The host strip in [template.html](template.html) uses a `hosts` array of `[team, label]` pairs — the first is the canonical name (used for `flagISO` lookup), the second is what the user sees. Same pattern can be reused if other teams need short display names.
- **`page.goto("/")` in Playwright** discards the base URL's path. Tests use `page.goto("./")` so `/wc2026/` is preserved on the live site.
- **Tiebreaks the engine can't resolve** (equal Pts/GD/GF) emit a warning in the Action log and a red flag on the site. Resolve via `tiebreakOverrides` in `results.json`. The engine deliberately does not implement FIFA's later tiebreakers (conduct, ranking).
- **`meta.subtitle` was removed** — host names live in the template's `hosts` array now.

## When making changes

- Editing logic (`build.mjs`) → run `node build.mjs` and `npm test` locally before pushing.
- Editing UI (`template.html`) → run `npm test` to catch any selector regressions in `tests/smoke.spec.ts`.
- Editing data (`results.json`) → no test needed; the deploy workflow rebuilds. Prod smoke test will catch breakage.
- Don't commit `index.html`. It's gitignored for a reason.
