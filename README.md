# Mini-Cypris

A small Angular app for searching open-access research papers through the
[CORE API](https://api.core.ac.uk/docs/v3): boolean keyword search, a control for how many
papers to fetch, and a chart of publications per year across **every** paper that matches the
query.

Built as a take-home project for Cypris. The reasoning behind each choice, with the
alternatives considered, is in [Design_Decisions.md](Design_Decisions.md).

## Run it

Requires Node.js 20.19+, 22.12+ or 24+.

```bash
git clone https://github.com/CadeSummers/mini-cypris.git
cd mini-cypris
npm install
npm start
```

Open <http://localhost:4200> and try `(drone AND (package OR delivery))`.

### API key (optional, recommended)

The app works without a key, but CORE then allows only a handful of requests per minute. A
free key raises the daily allowance:

1. Request a key at <https://core.ac.uk/services/api>.
2. Copy `.env.example` to `.env` and paste the key after `CORE_API_KEY=`.
3. Restart `npm start`. The terminal prints whether the key was picked up.

`.env` is git-ignored. The key is read by the dev-server proxy (`proxy.conf.mjs`) and added to
requests on the server side, so it never reaches the browser bundle.

### Other commands

| Command                     | What it does                               |
| --------------------------- | ------------------------------------------ |
| `npm test`                  | Runs the unit tests (Vitest) in watch mode |
| `npm test -- --watch=false` | Runs the unit tests once                   |
| `npm run build`             | Production build into `dist/`              |

`npm start` is the way to run the app locally: API calls go through the dev-server proxy, so
opening a static copy of `dist/` directly will not reach CORE.

### Deploying (Netlify)

The repository is ready to deploy to [Netlify](https://www.netlify.com/): `netlify.toml`
builds the app, and `netlify/functions/core-proxy.mjs` plays the role of the dev proxy,
serving `/core-api/*` and adding the key on the server.

1. In Netlify, choose **Add new site → Import an existing project** and pick this repository.
   The build settings are read from `netlify.toml`.
2. Under **Site configuration → Environment variables**, add `CORE_API_KEY` with your key.
3. Deploy. Later pushes to `main` redeploy automatically.

The function forwards only the two CORE endpoints the app uses, so the public URL cannot be
used as a general-purpose proxy for the key (see
[Design_Decisions.md](Design_Decisions.md#4-api-key-and-the-dev-proxy)).

## What it does

Mapped to the steps in the project brief:

| Brief | Requirement                         | Where                                                                                          |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1     | Angular 20 or higher                | Angular 21: standalone components, signals, zoneless change detection                          |
| 2     | Query CORE with GET                 | `src/app/core-api/core-api.ts`                                                                 |
| 3     | Clean UI for paper objects          | Paper cards: title, authors, year, publisher, expandable abstract, PDF and DOI links           |
| 4     | Field for how many papers to return | "Papers to fetch" (1–100); changing it re-runs the current search                              |
| 5     | Boolean keyword search              | Main bar queries CORE; "Refine these papers" filters the loaded papers with the same syntax    |
| 6     | Chart aggregating all matches       | Papers per year from CORE's aggregate endpoint, covering every match, not just the loaded page |
| 7     | README and incremental commits      | This file; each commit builds, passes its tests and runs                                       |

## Additions beyond the brief

1. **True aggregate chart.** The chart is computed by CORE over every matching paper (for
   example 71,000 for the drone query), not over the 10 on screen. If that request fails, the
   chart falls back to the loaded papers and says so.
2. **Two kinds of boolean search.** The main bar sends the query to CORE. A second box filters
   the papers already loaded, instantly and without another API call, using a small
   hand-written boolean parser (`AND`, `OR`, `NOT`, parentheses, `"phrases"`, `field:value`,
   `year>=2020`).
3. **Query validation before sending.** Unbalanced parentheses, unclosed quotes and dangling
   operators are caught in the browser with a specific message, and lowercase `and`/`or`/`not`
   gets a hint, since CORE treats those as ordinary words.
4. **Year drill-down.** Click a bar (or a year in the chart's table view) to list only that
   year's papers. The chart keeps showing the whole query so the context is not lost.
5. **Shareable URLs.** The search lives in the URL (`?q=…&limit=…&year=…`), so a search can be
   bookmarked or sent to someone, and back/forward work.
6. **Load more.** Fetches the next page and appends it, skipping duplicates.
7. **Rate-limit awareness.** CORE's limits are tight, so repeated searches are served from an
   in-memory cache, the chart is not refetched when only the page size or year changes, and a
   rate-limit error shows when searching will work again.
8. **Stale-response protection.** Starting a new search cancels the previous request, so a
   slow old response cannot overwrite newer results.
9. **Data cleaning.** CORE aggregates metadata from thousands of repositories. Abstracts are
   stripped of HTML remnants, author names of internal ids, and papers "published" in the
   future are excluded from the chart with a visible note of how many.
10. **Specific states.** Skeleton loading, an empty state with suggestions, and distinct
    messages for rate limiting, bad queries, a rejected key, server errors and being offline.
11. **Accessibility.** Labelled controls, live regions for status changes, a text summary and
    table alternative for the chart, keyboard-reachable year selection, reduced-motion support.
12. **Deployable without leaking the key.** A small serverless function stands in for the dev
    proxy on Netlify, restricted to the two CORE endpoints the app needs.
13. **Tests.** 83 unit tests covering the API service, data cleaning, the boolean parser and
    matcher, the search store (cancellation, caching, paging, fallback) and URL handling.

## Project layout

```
src/app/
  core-api/     CORE client, raw response types, the clean Paper model, error mapping
  search/       search page, search bar, paper card, search store, boolean parser and matcher
  chart/        year chart component and the pure functions that build its data
proxy.conf.mjs  dev-server proxy that adds the API key
netlify/        the same proxy as a serverless function, for the deployed site
netlify.toml    Netlify build and routing settings
```

## Known limitations

- A deployed copy shares one CORE key, and therefore one rate limit, among all its visitors.
  The proxy function does no per-user limiting.
- The in-browser refine filter matches by substring and only sees the loaded papers; it is a
  convenience on top of CORE's search, not a replacement for it.
- CORE pages by offset only up to 10,000 results; "Load more" stops there.
- The chart component itself is verified by hand in the browser. Its data logic is unit
  tested, but canvas rendering is not.

## A note on AI assistance

This project was built with the help of an AI coding assistant (Claude Code). The design
decisions and trade-offs are documented in [Design_Decisions.md](Design_Decisions.md).
