# Mini-Cypris

[![CI](https://github.com/CadeSummers/mini-cypris/actions/workflows/ci.yml/badge.svg)](https://github.com/CadeSummers/mini-cypris/actions/workflows/ci.yml)

**Live demo:** <https://mini-cypris.cadetsummers.workers.dev>

A small Angular app for searching open-access research papers through the
[CORE API](https://api.core.ac.uk/docs/v3): boolean keyword search, a control for how many
papers to fetch, and a chart of publications per year across **every** paper that matches the
query.

Built as a take-home project for Cypris. The reasoning behind each choice, with the
alternatives considered, is in [Design_Decisions.md](Design_Decisions.md).

![A 35-second demo: a question typed in plain English becomes a boolean query with a document type and a year filter; the results arrive with related searches; the chart is switched to publishers and a bar is clicked to list that publisher's papers, with citation figures on the cards; then the page is switched to the dark theme](docs/demo.gif)

![Search results for a boolean query, with the papers-per-year chart above the paper cards](docs/search-desktop.png)

![A plain-English question, "journal articles about drone delivery published by Elsevier since 2020", turned into a boolean query with a document type, a publisher and a year filter, with the results and related searches below the chart](docs/plain-english.png)

![Paper cards sorted by citations, each with a row of citation count, FWCI, RCR and h-index figures](docs/citation-metrics.png)

![The dark theme, with the publisher chart opened as a table that sets each publisher's paper count beside its loaded papers, their citations and its h-index](docs/dark-theme.png)

| Year drill-down                                                                                     | Document type drill-down                                                                                                    | Publisher click-through                                                                                                                                         | Phone width                                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| ![The 2021 bar selected in the chart, with the list narrowed to that year](docs/year-drilldown.png) | ![The Thesis type selected in the document type chart, with the list narrowed to the 8,737 theses](docs/type-drilldown.png) | ![The ten most common publishers as ranked bars, one of them clicked, with the list narrowed to that publisher and a removable chip](docs/chart-publishers.png) | ![The same search at a 390-pixel-wide screen](docs/search-phone.png) |

## Run it

Requires Node.js 20.19+, 22.12+ or 24+.

```bash
git clone https://github.com/CadeSummers/mini-cypris.git
cd mini-cypris
npm install
npm start
```

Open <http://localhost:4200>. **Add a CORE API key before searching** (next section): without
one the app starts, but CORE refuses most searches. To try the app with no setup at all, use
the [live demo](https://mini-cypris.cadetsummers.workers.dev).

### API key (free, needed in practice)

1. Request a key at <https://core.ac.uk/services/api>.
2. Copy `.env.example` to `.env` and paste the key after `CORE_API_KEY=`.
3. Restart `npm start`. The terminal prints whether the key was picked up.
4. Try `(drone AND (package OR delivery))`.

**Without a key.** The app runs and sends its requests to CORE anonymously, but CORE's
anonymous allowance is too small to search with. I checked from a fresh clone on 2026-11-19:
the first search was refused (HTTP 429) and CORE asked for a ten-minute wait; after the wait,
one of the two requests a search makes (the chart's counts) was answered and the other (the
papers) was refused again. The app handles this as it handles any rate limit: it says so,
shows the time CORE will accept searches again, and points here.

`.env` is git-ignored. The key is read by the dev-server proxy (`proxy.conf.mjs`) and added to
requests on the server side, so it never reaches the browser bundle.

### Other commands

| Command                     | What it does                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| `npm test`                  | Runs the unit tests (Vitest) in watch mode                        |
| `npm test -- --watch=false` | Runs the unit tests once                                          |
| `npm run e2e`               | Runs the end-to-end tests (Playwright) against a mocked CORE      |
| `npm run test:worker`       | Runs the Cloudflare Worker's tests in a local Workers runtime     |
| `npm run e2e:worker`        | Builds, then tests the app and the Worker together under Wrangler |
| `npm run build`             | Production build into `dist/`                                     |
| `npm run preview`           | Builds, then serves the app and the Worker locally with Wrangler  |
| `npm run deploy`            | Builds, then deploys to Cloudflare                                |

The end-to-end tests need a browser the first time: `npx playwright install chromium`. They
start the dev server themselves and need no API key, because every CORE request is mocked.

`npm start` is the way to develop locally: API calls go through the dev-server proxy, so
opening a static copy of `dist/` directly will not reach CORE.

### Deploying (Cloudflare Workers)

The repository is ready to deploy to [Cloudflare](https://developers.cloudflare.com/workers/):
`wrangler.jsonc` serves the built app as static assets, and `worker/core-proxy.js` plays the
role of the dev proxy, serving `/core-api/*` and adding the key on the server.

```bash
npx wrangler login                     # once; opens the browser
npx wrangler secret put CORE_API_KEY   # paste the key when prompted; stored encrypted
npm run deploy
```

Optionally, for citation metrics on the deployed site, get a free key at
<https://openalex.org/settings/api> and run `npx wrangler secret put OPENALEX_API_KEY`.

If `secret put` says the Worker does not exist yet, run `npm run deploy` first, then set the
secret. The Worker forwards only the two CORE endpoints the app uses, so the public URL
cannot be used as a general-purpose proxy for the key (see
[Design_Decisions.md](Design_Decisions.md#4-api-key-and-the-dev-proxy)).

## What it does

Mapped to the steps in the project brief:

| Brief | Requirement                         | Where                                                                                                                                                    |
| ----- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Angular 20 or higher                | Angular 21: standalone components, signals, zoneless change detection                                                                                    |
| 2     | Query CORE with GET                 | `src/app/core-api/core-api.ts`                                                                                                                           |
| 3     | Clean UI for paper objects          | Paper cards: title, authors, year, publisher, expandable abstract, PDF and DOI links                                                                     |
| 4     | Field for how many papers to return | "Papers to fetch" (1–100); changing it re-runs the current search                                                                                        |
| 5     | Boolean keyword search              | Main bar queries CORE; "Refine these papers" filters the loaded papers with the same syntax                                                              |
| 6     | Chart aggregating all matches       | Papers per year from CORE's aggregate endpoint, covering every match, not just the loaded page; switchable to top document types, publishers and authors |
| 7     | README and incremental commits      | This file; each commit builds, passes its tests and runs                                                                                                 |

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
4. **Year and document type drill-down.** Click a year's bar (or a year in the chart's table
   view), or a type's name in the "Document type" view, to list only those papers. The two
   combine. The chart keeps showing the whole query so the context is not lost.
5. **Shareable URLs.** The search lives in the URL (`?q=…&limit=…&year=…&type=…`), so a search can be
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
12. **Deployable without leaking the key.** A small Cloudflare Worker stands in for the dev
    proxy, holds the key as an encrypted secret, and is restricted to the two CORE endpoints
    the app needs. It caches successful
    answers at the edge so repeated queries do not spend the shared rate limit. A per-visitor limit (8 new
    CORE requests a minute, counted exactly by a Durable Object) stops one visitor using up
    the allowance everyone shares.
13. **Chart dimension switcher.** "Chart by" Year, Document type, Publisher or Author. All
    four come from one CORE request, so switching is instant and costs nothing against the
    rate limit. Placeholder values are dropped; names CORE spells two ways are left apart and
    the chart says so.
14. **Highlighted matches.** Query words are marked in each title and abstract, for both the
    CORE search and the refine box. Terms under `NOT` are left unmarked, and `title:` terms
    are marked in titles only.
15. **Tests.** 153 unit tests covering the API service, data cleaning, the boolean parser and
    matcher, the search store (cancellation, caching, paging, fallback), chart data and URL
    handling.
16. **End-to-end tests.** 37 Playwright tests drive the app in a real browser against a
    mocked CORE: search, the number of papers, invalid syntax, year and document type drill-down, refine, load
    more, both rate-limit messages, shareable URLs, the chart switcher and its fallback, plus
    two automated accessibility scans. They run in CI on every push.
17. **Worker tests.** 40 tests run the real Worker in Cloudflare's runtime locally (Miniflare)
    against a fake CORE. They check that the key is sent to CORE and never to the browser,
    that only the two allowed endpoints are proxied, that repeated queries come from the
    cache, and that a visitor's 9th new request in a minute is refused.
18. **Routing tests.** 8 browser tests run the production build and the Worker together under
    `wrangler dev`, using the real `wrangler.jsonc`. They check which requests reach the
    Worker and which are served as files, and that the per-visitor limit message appears in
    the page.
19. **Plain-English search.** "Better yet, ask me in plain English": a sentence such as
    "show me papers about abiogenesis and exoplanets published after 2000" is turned into a
    boolean query by a language model (Meta Llama 3.3 70B on Cloudflare Workers AI) and run.
    The query appears in the Boolean box and the URL, so it can be read, edited and shared.
    The model can only produce queries: the Worker checks every answer and discards anything
    else. An American model was chosen deliberately; see `Design_Decisions.md` 7b.
20. **Suggestions.** After every search, once the papers are on screen, the model suggests up
    to three related searches. A search that finds nothing, or that CORE answers with an
    error, says "No papers found" and also offers "Did you mean" with the spelling corrected.
    If the model has received too many requests, the page says so and when it will take more.
    See `Design_Decisions.md` 7c.
21. **Forgiving queries.** CORE answers some harmless queries with a server error (for
    example `"exoplanet"`, a quoted single word). The app repairs those on the way out,
    offers one-click fixes for lowercase operators and wrong field names, and reports a
    rejected query as a query problem instead of an outage. An author filter
    (`authors:"Smith, Jane"`) is sent to the field CORE really searches; CORE's documented
    `authors:` matches nothing.
22. **Citation metrics.** Where a paper has a DOI that OpenAlex knows, its card shows the
    citation count, Field-Weighted Citation Impact (FWCI), Relative Citation Ratio (RCR, for
    PubMed papers) and the h-index of an author, the journal and the publisher. Loaded
    papers can be sorted by citations or FWCI. CORE has no usable citation data, so the
    numbers come from [OpenAlex](https://openalex.org) and
    [NIH iCite](https://icite.od.nih.gov), through the Worker. See `Design_Decisions.md` 5b.
23. **Publisher and author tables.** The "Publisher" and "Author" charts have a "View as
    table" that sets each name's paper count beside citation context from the loaded papers:
    how many of them carry the name, their citations added up, and the h-index. A name that
    no loaded paper carries shows a dash. See `Design_Decisions.md` 9c.
24. **Home link.** The Cypris logo and the name at the top left are one link back to the
    empty start page.
25. **Light and dark theme.** A sun and moon switch at the top right. The page follows the
    device setting until a choice is made, then remembers it. See `Design_Decisions.md` 8a.
26. **Click-through on every chart.** Clicking a document type, publisher or author (the
    name or its bar) lists that value's papers, as clicking a year does. Selections combine,
    show as removable chips and live in the URL. See `Design_Decisions.md` 9b.
27. **No blank page between searches.** The previous papers stay on screen, dimmed, until the
    new ones arrive.
28. **Filters in plain English.** "Journal articles about graphene batteries published by
    Elsevier since 2019" or "papers by Jane Goodall on chimpanzees" become queries with the
    right document type, publisher, author and years. See `Design_Decisions.md` 7b.

## Project layout

```
src/app/
  core-api/     CORE client, raw response types, the clean Paper model, error mapping
  search/       search page, search bar, paper card, search store, boolean parser and matcher,
                query fixes, the plain-English box and the suggestions
  ai/           client for the app's own /ai/query endpoint
  metrics/      citation metrics for the loaded papers, and sorting by them
  theme/        the light or dark palette choice
  chart/        year chart, ranked top-ten chart, the switcher, and the pure functions behind them
proxy.conf.mjs  dev-server proxy that adds the API key (and forwards /ai and /metrics to the deployed Worker)
worker/         the same proxy as a Cloudflare Worker, the plain-English and citation
                metrics endpoints, and their tests
wrangler.jsonc  Cloudflare build output and routing settings
e2e/            Playwright end-to-end tests and the mocked CORE they run against
e2e-worker/     browser tests of the built app and the Worker together, and their fake CORE
```

## Known limitations

- Clicking a publisher with a one-word name can list more papers than its bar counts,
  because CORE matches the word inside longer publisher names too. A note under the chart
  says so, and the list always shows its real total.
- A deployed copy shares one CORE key, and therefore one rate limit, among all its visitors.
  The Worker caches repeated queries (searches for 10 minutes, year counts for an hour) and
  limits each visitor to 8 new CORE requests a minute, but several visitors searching at
  once can still reach CORE's own limit.
- Plain-English search and suggestions depend on a free allowance of model calls (about 300
  a day by my estimate), and every new search uses one for its suggestions. When it runs out
  the page says the model has received too many requests and when it resets; the Boolean box
  is unaffected. Every new search query is sent to the model, not only plain-English
  questions; a note under the plain-English box says so. The model can write a poor query; the query is always shown so it can be
  corrected. Questions are sent to Cloudflare, which does not say in which country the model
  runs. Under `npm start` this one feature calls the deployed Worker.
- Citation metrics cover only papers with a DOI that OpenAlex knows: 6 of 25 in one test
  search and 14 of 25 in another. They are OpenAlex's and the NIH's figures and will differ
  from Scopus's or Google Scholar's. Without an `OPENALEX_API_KEY` secret the deployed site
  usually cannot fetch them, because OpenAlex's keyless allowance is shared by IP address;
  it then says they are unavailable and everything else works.
- The in-browser refine filter matches by substring and only sees the loaded papers; it is a
  convenience on top of CORE's search, not a replacement for it.
- CORE pages by offset only up to 10,000 results; "Load more" stops there.
- Publisher and author bars are not clickable. CORE's filters for those fields do not match
  the charted counts exactly, so a click would list a different number of papers than the
  bar shows.
- The end-to-end tests use a mocked CORE, so they would not notice CORE changing its
  response format. Clicking a bar on the chart canvas is checked by hand; the tests use the
  chart's table view for the same action.
- The Worker's tests run in a local copy of Cloudflare's runtime. Cloudflare's real network,
  the deployed secret and the 60-second limit window actually expiring are checked on the
  deployed site only.

## A note on AI assistance

This project was built with the help of an AI coding assistant (Claude Code). The design
decisions and trade-offs are documented in [Design_Decisions.md](Design_Decisions.md).

Separately, the app itself uses a language model for plain-English search and suggestions
(additions 19 and 20). That model only ever writes search queries.
