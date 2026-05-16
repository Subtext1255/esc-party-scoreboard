# Agent Instructions

## Project Overview

This is a small Node.js 20+ Eurovision-style party scoreboard. It serves a browser app, accepts guest ballots, stores party state as local JSON, and uses server-sent events to keep connected browsers in sync.

The app is intentionally dependency-light:

- `server.js` is the Node HTTP server, API layer, party persistence, scoring/reveal logic, and static file server.
- `app.js` is the browser client, UI rendering, host controls, local ballot storage, invite QR generation, and SSE handling.
- `index.html` defines the app shell and DOM targets used by `app.js`.
- `entries.html` and `entries.js` define the dedicated full-width entry editor.
- `styles.css` owns the visual design and responsive/presentation modes.
- `entries/*.tsv` are saved entry lists; `entries/2026.tsv` is the default starter list for new parties.
- `assets/stage-backdrop.png` is the main visual backdrop.
- `data/` contains runtime party data and is ignored by git.

## Run And Verify

Use:

```powershell
npm start
```

The default local URL is:

```text
http://localhost:4173
```

There is currently no automated test script. For meaningful verification, start the app and exercise the affected workflow in a browser. For UI work, check both desktop and narrow/mobile widths.

The PowerShell profile on this machine may print a `Microsoft.WinGet.CommandNotFound` import warning. Treat it as environment noise unless the command itself fails.

## Data And State

Do not commit generated party data from `data/`. The app writes live party state under:

```text
data/parties/
```

`entries/2026.tsv` is the default template. Existing parties can have their own saved entries after hosts edit or load entries in the dedicated entry editor page.

The TSV format is:

```text
Country<TAB>Artist<TAB>Song
```

Keep real tabs in TSV files, preserve the header, and avoid converting the file to comma-separated data.

## Implementation Notes

- Keep the app dependency-free unless a new package is clearly worth the extra setup for a local party app.
- Preserve Node built-in module style in `server.js` (`require("node:...")`) and plain browser JavaScript in `app.js`.
- API changes usually need matching edits in both `server.js` and `app.js`.
- Party-specific API calls should keep the `party` query parameter behavior intact so invite links continue to work.
- Host-only actions must continue to call the host-token checks in `server.js`.
- Scoring uses Eurovision points in `POINTS_BY_RANK`: `12, 10, 8, 7, 6, 5, 4, 3, 2, 1`.
- Reveal behavior is stateful. Be careful around `awardNextPoint`, `awardThroughPoint`, `applyAwards`, and client spotlight rendering.
- SSE clients are tracked in memory. When adding state mutations, call the existing save/broadcast path so all connected browsers update.
- Client ballot drafts are stored in browser local storage and keyed by party/device concepts. Avoid breaking guests' ability to edit their own ballot before presentation starts.

## UX Expectations

This app is used live during a watch party, often on shared screens and phones. Prefer changes that are obvious, resilient, and fast under light local-network weirdness.

- Keep host controls hard to trigger accidentally, especially resets and reveals.
- Keep guest voting simple on mobile.
- Do not add explanatory landing pages; the app should open directly into the usable scoreboard experience.
- Avoid layout shifts during reveals and scoreboard updates.
- Keep presentation mode readable from across a room.

## Git Hygiene

- Respect existing uncommitted changes. Do not revert work you did not make.
- Keep changes scoped; avoid broad formatting churn in the large single-file scripts.
- Do not stage or commit ignored runtime data from `data/`.
