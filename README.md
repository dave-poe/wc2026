# World Cup 2026 Sweepstake

A self-updating, read-only sweepstake tracker. You edit one file
(`results.json`); GitHub rebuilds and redeploys the public site
automatically.

## How it works

```
results.json  ──(edit + push)──▶  GitHub Action runs build.mjs
              ──▶  index.html  ──▶  GitHub Pages (public)
```

- **`results.json`** — the only file you ever edit. Allocations, scores, prizes.
- **`build.mjs`** — computes standings, the 8-best-third-placed cut,
  prize owners, and bakes everything into `index.html`. You never edit this.
- **`template.html`** — the look of the site. You never edit this (unless you
  want to restyle).
- **`index.html`** — generated output. Don't edit it by hand; it gets
  overwritten on every build.

Viewers only ever see `index.html`. They cannot change anything — all data is
baked in at build time.

## One-time setup

1. Create a new GitHub repo, push these files to the `main` branch.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push any change (or run the workflow manually: **Actions → Build & Deploy
   → Run workflow**).
4. Your public URL appears under Settings → Pages. Share that link.

## Updating during the tournament

Edit `results.json` directly in GitHub's web UI (works on a phone): open the
file → pencil icon → edit → **Commit**. The site rebuilds in about one
minute.

**Enter a score:** find the fixture, set `homeScore`/`awayScore` to integers.
```json
{ "group": "C", "date": "2026-06-13", "home": "Brazil", "away": "Morocco",
  "homeScore": 2, "awayScore": 0 }
```

Leave both as `null` for unplayed games. Standings, GD, and qualification
update automatically.

**Set allocations:** under `allocations`, map each person to their teams
using the **exact** team names from the `groups` block.
```json
"allocations": {
  "Dave": ["Brazil", "Japan", "Norway", "Panama"],
  "Sam": ["England", "Spain", "Curaçao", "Iraq"]
}
```

**Award a prize:** put the responsible team in the prize's `team` field.
The owner is resolved automatically. If nobody owns that team, it shows as
*unowned* (by design).
```json
"firstHatTrick": {
  "label": "First Hat-trick of Tournament",
  "team": "Argentina",
  "note": "Messi vs Algeria"
}
```

**Resolve a tie the build can't:** if two teams finish equal on points, goal
difference *and* goals scored, the site shows a red warning and the Action log
lists it. The engine can't apply FIFA's later tiebreakers (team conduct, FIFA
ranking), so you decide the order:
```json
"tiebreakOverrides": {
  "C": ["Brazil", "Scotland", "Haiti", "Morocco"]
}
```

List all four teams top-to-bottom. The warning disappears on the next build.

**Knockout stage:** fill the `knockout` block as matches happen. Example:
```json
"roundOf32": [
  {
    "home": "Brazil",
    "away": "Switzerland",
    "homeScore": 2,
    "awayScore": 1,
    "winner": "Brazil"
  }
],
"final": {
  "home": "Brazil",
  "away": "France",
  "homeScore": 1,
  "awayScore": 0,
  "winner": "Brazil"
}
```

Setting a `winner` marks the loser eliminated on the Pool board.

## Local preview (optional)

```bash
node build.mjs && open index.html
```

## Automated score updates

A scheduled GitHub Action also pulls finished scores from football-data.org and updates `results.json` automatically.
- It only creates a PR when `results.json` actually changes.
- It validates `results.json` as JSON before the PR is opened.
- It runs on the hours after most games finish: `22:00`, `00:00`, `02:00`, and `05:00` UTC.

## Notes / limitations

- Group eliminations only finalise on the Pool board once **all 12 groups**
  are complete, because the 8-best-third-placed cut needs every group's final
  table. Before that, only knockout losers are marked out.
- Fixtures are pre-seeded with correct groups and dates. Kick-off *times* aren't
  shown (date only) — add them to the template if wanted.
- First-red-card / first-hat-trick are manual: no free data source exposes them
  reliably.
