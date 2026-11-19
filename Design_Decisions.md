# Design decisions

This document records the main decisions behind Mini-Cypris and why each chosen option was
preferred over the others. "Brief" means the project description (_Software Engineering Initial
Project_). For an overview see [README.md](README.md), for what the app does see
[docs/features.md](docs/features.md), and for setup see
[docs/running-locally.md](docs/running-locally.md). Each section uses the same labels:
**Decision**, **Why**, **Alternatives considered**, **Limits**.

## 1. Framework version and project setup

**Decision.** Angular 21, generated with the CLI: standalone components, signals, zoneless change
detection, SCSS, no server-side rendering, Vitest for unit tests.

**Why.** Angular 21 satisfies the brief's "version 20 or higher", and its defaults are the idioms
a current Angular codebase is moving towards.

**Alternatives considered.**

- Angular 21 over Angular 22, because the Angular 22 CLI needs newer Node releases (22.22.3 or
  later on the 22 line, 24.15 or later on the 24 line), while Angular 21 accepts Node 22.12 and
  any Node 24, so it runs on more of the machines a reviewer is likely to have. `package.json`
  states the versions this project supports in `engines`.
- A client-rendered app over server-side rendering, because this is a search tool behind an API
  and SSR adds moving parts without a benefit that matters here.

## 2. Talking to CORE

**Decision.** One service, `CoreApi`, is the only code that knows CORE's URLs and response shapes.
It returns a clean `Paper` model (`src/app/core-api/paper.ts`), not CORE's raw objects.

**Why.**

- CORE's data is inconsistent. Missing values arrive as `null`, as `''`, or not at all; years
  arrive as numbers or strings; abstracts contain HTML tags and escaped HTML. Cleaning once, at
  the boundary, means no component has to defend against this.
- The same mapping drops placeholder author names such as "null null" and a link stuck on the end
  of an abstract. A paper listed twice (the same CORE id, or the same DOI from two repositories)
  is shown once (`withoutRepeats` in `search-store.ts`).
- The search URL ends in a slash (`/search/works/`). Without it CORE answers with a redirect,
  which costs a round trip and, through a proxy, can drop the API key.

**Alternatives considered.** A mapped `Paper` model over CORE's objects used directly in
templates, because the direct route puts null checks and cleanup in every template. A hand-written
service over a client generated from CORE's OpenAPI spec, because the app calls two endpoints.

## 3. State management and request handling

**Decision.** A `SearchStore` service holds the search state as signals. Requests go through an
RxJS stream with `switchMap`. Results are cached in memory by query, page size and chart
selections.

**Why.**

- With plain `subscribe()` calls, two quick searches can finish out of order and the older result
  wins. `switchMap` cancels the request in flight when a new one starts.
- CORE allows roughly 10 requests a minute, and that shapes the design: no search-as-you-type,
  repeated searches come from the cache, and the chart is fetched once per query and not repeated
  while a request for the same query is in flight.
- A plain-English answer that arrives after the visitor has searched for something else is dropped.

**Alternatives considered.**

- A signal store service over NgRx, because at this size NgRx adds more boilerplate than logic.
- RxJS streams over Angular's `httpResource`/`rxResource`, because those are still marked
  experimental and fit load more and a dependent chart request less naturally.
- A store over state held in the component, because component state is harder to test and leaves
  the out-of-order problem open.

## 4. API key, the dev proxy and the Worker

**Decision.** The browser calls `/core-api/...`. In development the dev server proxies that to
`api.core.ac.uk` and adds the key from a git-ignored `.env` file (`proxy.conf.mjs`). The deployed
site uses a Cloudflare Worker (`worker/core-proxy.js`) at the same path, which adds the key from a
Worker secret. Nothing in `src/` knows which proxy it is talking to.

**Why.**

- A key placed in `environment.ts` is compiled into the JavaScript bundle, where anyone can read
  it. With a proxy the key never enters the browser or git.
- A free CORE key is needed in practice, because CORE refuses most anonymous searches. The live
  demo is the path that needs no setup.
- The Worker is an allowlist, not an open proxy. Only CORE's search and aggregate endpoints are
  forwarded, with only `q`, `limit` and `offset` passed to the search and only `{q, aggregations}`
  with known fields to the aggregate.
- It caches successful answers at Cloudflare's edge (ten minutes for searches, an hour for chart
  counts), so a repeated query costs nothing against the shared key. Errors are never cached.
- Under `npm start`, `/ai` and `/metrics` go to the deployed Worker by default, so every feature
  runs with no Cloudflare account. `WORKER_ORIGIN` points them elsewhere.

I chose Cloudflare over Netlify or Vercel functions for these reasons:

- I have deployed on Cloudflare before, for [Hybrasil](https://hybrasil.app)
  ([source](https://github.com/CadeSummers/Hybrasil)), a map of every known exoplanet and star
  system within 100 light-years, so I could spend the time on the proxy's behaviour, not on
  learning a host.
- It is one of the most widely used edge platforms, so a reviewer is likely to recognise the setup.
- A Worker secret is encrypted and cannot be read back from the dashboard or CLI once saved.
- A Durable Object gives the exact request counts the limits in 4a depend on.

**Alternatives considered.** A proxy over a key typed into the UI and kept in `localStorage`,
because that adds a setup step for every user and stores a secret in the browser. A Worker over an
Express server, because a server needs an always-on host for one small function.

**Limits.** The deployed site shares one key among everyone using it, and cached results can be up
to ten minutes old.

### 4a. Limits on the shared key and the model

**Decision.** The Worker enforces two kinds of limit, both counted by a Durable Object:

- Per visitor, by IP address: 8 CORE requests a minute and 15 model calls a minute.
- Shared by all visitors: 10 CORE requests a minute, which is the key's own allowance
  (`CORE_SHARED_LIMIT`), and 250 model calls per 24 hours, just under the free allowance of
  roughly 300 (`AI_DAILY_LIMIT`).

Answers served from the cache are never counted. When a limit is reached the Worker answers 429
itself with the time to try again, and the app says this is the demo's limit and not CORE's.

**Why.**

- One shared key means one shared allowance. Without a per-visitor cap, one person or one script
  would lock out every other visitor. The shared counts stop several visitors, each within their
  own limit, from using up an allowance together.
- If the counter itself fails, a CORE search is still served, and the worst case is that CORE
  refuses it. The model is not called, because uncounted calls could use up the day's allowance.

**Alternatives considered.**

- A Durable Object over Cloudflare's built-in rate-limiting binding, because the binding is
  approximate by design. With its limit set to 8, 19 of 19 requests in about a minute passed.
- A Durable Object over a counter in Workers KV, because KV has no atomic increment.
- Limits in the Worker over limits in the Angular app, because anyone can call the Worker directly.

**Limits.** An IP address is not a person: people behind one office network share a limit. A
request that CORE refuses still uses one of the visitor's 8.

### 4b. Testing the Worker

**Decision.** Two suites cover the Worker. `npm run test:worker` runs the real Worker in
Cloudflare's runtime through Miniflare, with CORE, the model, OpenAlex and iCite replaced by
fakes. `npm run e2e:worker` runs Playwright against the production build and the Worker together
under `wrangler dev`, using the production `wrangler.jsonc` minus the AI binding.

**Why.** This is the only code that handles the key, so the tests assert that the key reaches CORE
and appears nowhere in the response. They also cover the allowlist, the cache, both kinds of limit
and CORE's own failures. The second suite covers the routing in `wrangler.jsonc`: a wrong pattern
there would pass every other suite and break the deployed site.

**Alternatives considered.**

- Miniflare in the real Workers runtime over mocks in Node, because the Worker uses the Cache API,
  a Durable Object and `crypto.subtle`, and mocking those would test the mocks.
- Automated tests over manual checks against the deployed site, because manual checks spend the
  real allowance and nobody repeats them on every change.

**Limits.** Cloudflare's real network and the real CORE are exercised only by the deployed site.

## 5. Presenting papers

**Decision.** A single-column list of cards. Each shows the title (linked), up to three authors,
year, publisher, an abstract clamped to three lines with a "Show more" toggle, and PDF and DOI
links. Styling is hand-written SCSS on a small set of CSS custom properties.

**Why.** Researchers scan titles, so the title is the largest element and the abstract is
collapsed by default. The link goes to the DOI when there is one and to the CORE record otherwise.
Missing data is stated ("Unknown authors"), not left as a gap.

**Alternatives considered.** Plain SCSS over Angular Material or Tailwind, because the UI is a
form, a list and a chart, and plain SCSS keeps the bundle small. Cards over a table, because
abstracts do not fit well in table cells.

### 5a. Highlighting matched terms

**Decision.** Words from the query are highlighted in each card's title and abstract, for both the
CORE search and the in-browser refine box.

**Why.** A boolean query can match a paper through any of several terms, and marking them lets a
researcher judge relevance without reading every abstract. The terms come from the same syntax
tree that validation uses, so terms under `NOT` are not highlighted. The refine filter
(`paper-matcher.ts`) and the highlighter (`highlight.ts`) share one word-start pattern
(`wordPattern`): `deliver` and `deliver*` match "delivery"; `ai` matches "AI" but not "said".

**Alternatives considered.**

- One shared word-start pattern over plain substring matching in the refine box, because substring
  matching keeps papers with nothing highlighted.
- Text segments rendered by the template over `innerHTML` with a sanitiser, because `innerHTML`
  puts untrusted titles and abstracts through an HTML parser.

**Limits.** CORE also searches the full text and applies its own stemming, so a paper can match
with nothing highlighted.

### 5b. Citation metrics on each paper

**Decision.** Where the data exists, a card shows citation count, Field-Weighted Citation Impact
(FWCI), Relative Citation Ratio (RCR), and three h-indexes: the highest among the paper's
authors, the journal's and the publisher's. The numbers come from OpenAlex and NIH iCite through a Worker endpoint, `POST /metrics`
(`worker/paper-metrics.js`). A control sorts the loaded papers by citations or FWCI.

**Why.**

- The browser makes one request. The Worker makes a handful of batched requests (papers, their
  authors, journals, publishers, and iCite) and joins them, and each DOI is cached for a day for
  all visitors.
- The only input is a list of DOIs, each checked against the shape of a DOI. The visitor's query
  is never sent to OpenAlex or the NIH.
- Papers appear as soon as CORE answers and metrics fill in afterwards, so a slow or failed lookup
  never delays the list.

**Alternatives considered.**

- OpenAlex and iCite over CORE's own `citationCount`, because it was 0 for every paper in a sample
  of 46 and CORE has none of the other metrics.
- OpenAlex over Google Scholar (no API), Scopus (a paid licence) and Semantic Scholar (no FWCI).
- Every author's h-index over the first and last author's only, because the author with the highest h-index
  can sit anywhere in the list, and "highest among the authors" is a claim a reader can check.
- Matching by DOI over matching by title, because a title search can attach one paper's numbers to
  another with a similar title. Wrong numbers are worse than none.

**Limits.** Coverage is partial and depends on how many CORE records carry a DOI: in a sample of
25 papers for the drone query, 8 had a DOI and 6 had metrics. The page states the count. These are
OpenAlex's figures, so its FWCI will differ from Scopus's, and RCR appears only on PubMed-indexed
papers. Author lookups are capped at 1,500 per request, shared between its papers, so on a
page of 100 papers a very long author list is cut to its first authors and its last. The deployed
Worker needs a free OpenAlex key, held as a secret.

## 6. The "how many papers" field

**Decision.** A number input from 1 to 100 that maps to CORE's `limit`. Out-of-range values snap
into range visibly. Changing it re-runs the current search.

**Why.** 100 is CORE's maximum page size, so the UI does not offer what the API will refuse. The
field reacts to `change` (blur, Enter, spinner), so typing "25" costs one request and not two.

**Alternatives considered.** A free number over a dropdown (10 / 25 / 50 / 100), because the brief
asks for a field. A number input over a slider, because a slider is imprecise for exact counts.

## 7. Boolean search

**Decision.** The main search bar sends the boolean query to CORE, after a structural check in the
browser. A second box filters the papers already loaded, in the browser, with the same syntax.
Both use one small recursive-descent parser written for this project (`boolean-query.ts`).

**Why.**

- The brief links to CORE's search documentation, which points to searching CORE. Its phrase
  "documents collected" also reads as "the documents already fetched". Supporting both removes the
  ambiguity.
- An unbalanced parenthesis sent to CORE comes back as a vague server error and still uses the
  rate limit. Catching it locally gives a precise message. An empty phrase `""` is a syntax error
  too.
- The parser judges structure only. Anything it does not recognise (`yearPublished>=2020`) passes
  through as a term. It reads `AND`, `OR` and `NOT` in any case, because CORE does.
- The search bar's output is named `submitted`, not `search`, because Chrome fires a native
  `search` event on Enter in a search input. An end-to-end test presses Enter, and angular-eslint's
  no-output-native rule guards the naming.

**Alternatives considered.**

- CORE search plus a local filter over either alone, because CORE alone covers one reading of the
  brief and a local filter alone cannot search beyond the loaded page.
- A hand-written parser over a parsing library, because the logic is small and easy to test.

**Limits.** The refine box sees only loaded papers and does not use CORE's ranking or stemming.

### 7a. What is sent to CORE

**Decision.** Every query is parsed and re-written on its way to CORE (`normalizeForCore` in
`search/query-fixes.ts`, `shapeForCore` in `search/core-query-shape.ts`). The text the user typed,
in the box and in the URL, is unchanged.

- The query is sent as either an AND of terms and OR-groups or an OR of terms and AND-groups, one
  level deep, with every operator written out. NOT in front of a group is moved to its terms. A
  query that would expand past 32 groups, or that does not parse, is sent as written.
- Quotes around a single word are removed, and `authors:` and `author:` are sent as
  `authors/name:`.
- Chart filters (year, type, publisher, author) are joined to the query before the rewrite, so
  click-through counts are right too. The brief's example narrowed to 2021 lists 464 papers.

**Why.** CORE answers some well-formed queries with the wrong total or a server error:

| Query sent to CORE                                  | CORE's answer                                      |
| --------------------------------------------------- | -------------------------------------------------- |
| `drone AND (package OR delivery)`                   | 4,729 papers                                       |
| `(drone AND (package OR delivery))`                 | 71,213, the same as `drone` alone                  |
| `drone AND package OR delivery`                     | 71,213; AND is not applied before OR               |
| `drone delivery`                                    | 1,621,487; adjacent words are OR-ed                |
| `drone and delivery`                                | 4,330, the same as `drone AND delivery`            |
| `"exoplanet"`, `"drone" AND "delivery"`             | 500; every term is a quoted single word            |
| `drone AND year:2020`, `fullText:drone`             | 500; the field does not exist                      |
| `(drone AND delivery) AND authors:"Alkouz, Balsam"` | 0 papers; `authors/name:"Alkouz, Balsam"` finds 20 |

Groups nested inside groups are miscounted as well. This app reads adjacent words as AND, and the
rewrite makes CORE do the same.

**Alternatives considered.**

- A full rewrite over only stripping the outer parentheses, because stripping fixes the brief's
  example but not nested groups or chart filters.
- A rewrite over sending the text as typed, because that is faithful to the user's text and
  returns wrong totals.
- Tidying the request over rewriting the text in the box, because changing what someone typed in
  front of them is worse than a repair they never need to think about.

**Limits.** This works around behaviour in someone else's service, and the rules come from
measurement, not documentation.

### 7b. Plain-English search

**Decision.** A second box takes a sentence such as "show me papers about abiogenesis and
exoplanets published after 2000". A language model writes the CORE query
(`abiogenesis AND exoplanet AND yearPublished>2000`) and the app runs it as an ordinary search.
The model is Meta's Llama 3.3 70B on Cloudflare Workers AI, called from the Worker
(`worker/ai-query.js`).

**Why.**

- The model runs on the same platform as the Worker and is reached through a binding, so there is
  no second vendor and no extra key. It is free at this scale, and it supports a forced JSON
  reply.
- The model may only write CORE queries, and this is enforced in code. Every query is checked
  before it leaves the Worker (`isSafeCoreQuery`): length, a small set of characters, field names
  from a list verified against CORE, balanced quotes and parentheses, and an explicit operator
  between every two terms. That last rule stops prose. Anything else the model writes is
  discarded.
- The query appears in the Boolean box and in the URL, so the user can read and edit it, and
  sharing the link runs the search without calling the model again.

**Alternatives considered.**

- Author names trimmed in code (`keepStatedAuthors`) over relying on the prompt alone, because the
  model can add a given name the user never wrote. Asked for papers "by Hughes", the Worker sends
  `authors:Hughes`.
- Workers AI over a model from a second provider, because that needs another account and key.
- A model over hand-written rules ("after 2000" becomes `yearPublished>2000`), because rules
  handle only the phrasings someone thought of.

**Limits.** The model can choose poor terms or misread a request, and showing the query is the
safeguard. It can be steered towards a different search, but not towards anything that is not a
search: in a sample of 21 inputs, including attempts to override the rules, every reply was a
query or a refusal code. The question goes to a third party, and a note under the box says so.

### 7c. Spelling corrections and related searches

**Decision.** After a search, the model is asked for up to three related searches. When a query
finds no papers, or CORE answers it with an error, the model is also asked for the same query with
its spelling corrected ("Did you mean"). Both are offered as buttons. They are automatic by
default, with a switch beside the disclosure: "Suggest related searches with the AI model. Turn
this off if your searches are confidential." The choice is remembered in the browser
(`src/app/ai/ai-suggestions-setting.ts`). With the switch off, a Boolean search goes to CORE and
nowhere else. The plain-English box is always an explicit request to the model.

**Why.** The papers never wait for the model: the call starts after the results are shown, and
there is one call per query, not per page. A correction must keep every term. No search runs by
itself, so a wrong suggestion costs a glance, not a search.

**Alternatives considered.**

- Automatic suggestions with a switch over suggestions behind a button, because a suggestion that
  has to be requested is seen far less often.
- A switch over a disclosure alone, because a disclosure gives a visitor with confidential queries
  no choice.
- A CORE error shown as "No papers found" with suggestions over a generic outage message, because
  the outage message gives the user nothing to do. The page says that CORE returned an error and
  which.

**Limits.** Suggestions are on by default, so a visitor who does not read the note sends queries
to the model. For a product with customer queries I would make it opt-in per account. A suggestion
is not checked against CORE before it is shown, so "Did you mean" can lead to another empty list.

## 8. States, header and theme

**Decision.** Four explicit states: idle, loading, loaded, error. Errors are mapped to typed
messages that say what to do. The header holds a home link and a light or dark switch, and a
footer line says the project is independent and not affiliated with Cypris.

**Why.**

- Each failure has a different remedy: wait (rate limit), fix the query (400), fix the key
  (401/403), try a suggested search (5xx), check the connection (offline). On a rate limit the app
  shows the time at which searching will work again.
- When papers are already on screen they stay, dimmed and `inert`, until the new ones arrive, so
  the page does not jump. A search from an empty page shows skeleton cards.
- Every colour is a CSS variable in `src/styles.scss`, so dark mode is a second set of values and
  no component has its own dark rules. The device setting is the default, and a choice made with
  the switch is saved in `localStorage`.

**Alternatives considered.** A manual "Try again" over automatic retry with backoff, because
against a tight rate limit automatic retries can make things worse. Inline messages over toast
notifications, because toasts are easy to miss.

## 9. The chart

**Decision.** A bar chart of papers per publication year, built from CORE's aggregate endpoint,
which counts across every matching paper. If that request fails, the chart counts the loaded
papers and labels itself accordingly.

**Why.**

- The brief asks for a chart of "all papers that match". Its example matches 4,729 papers, and a
  chart of the 10 on screen would describe the page, not the query.
- Year is present on nearly every record, has a natural order, and answers whether a topic is
  growing. Clicking a bar narrows the list to that year.
- The year chart is loaded with `@defer (on immediate)` as its own file, which took the first
  download from about 500 kB to about 349 kB.
- "View as table" exposes the same data to screen readers and keyboards.

**Alternatives considered.**

- CORE's aggregate over counting loaded papers, because loaded papers reflect only the page.
  Client-side counting is kept as the fallback.
- Chart.js over ngx-charts, D3 or ECharts, because ngx-charts tracks Angular versions slowly, D3 is
  more code for a bar chart, and ECharts is much larger.

### 9a. Chart dimension switcher

**Decision.** A "Chart by" switcher: Year (the default), Document type, Publisher, Author. The
last three show the ten most common values as ranked horizontal bars, counted by CORE over every
matching paper.

**Why.** CORE's aggregate endpoint accepts several fields at once, so one `POST` asks for all
four and switching views spends nothing against the rate limit. Different spellings of one
publisher or person are not merged, because guessing aliases would put numbers on screen that CORE
never reported.

**Alternatives considered.** Ranked lists in HTML and CSS over horizontal Chart.js bars, because
long names need to wrap and an ordered list is read correctly by a screen reader. A switcher over
all four charts at once, because four charts push the results far down the page.

### 9b. Click-through from the ranked charts

**Decision.** Every ranked chart filters on a click, like the year chart. The choice is shown as a
removable chip and lives in the URL (`type=`, `publisher=`, `author=`). All four selections
combine with AND.

**Why.** The filter is added to the query and sent to CORE, so it covers every matching paper and
not only the loaded ones. For document types the list count equals the bar. For publishers and
authors it is close, measured on `drone AND delivery`:

| Filter sent                                                  | Bar | List |
| ------------------------------------------------------------ | --- | ---- |
| `publisher:"Elsevier BV"`                                    | 163 | 163  |
| `publisher:"MDPI AG"`                                        | 122 | 123  |
| `publisher:"Multidisciplinary Digital Publishing Institute"` | 185 | 191  |
| `publisher:Elsevier` (a one-word name)                       | 61  | 253  |
| `authors/name:"Alkouz, Balsam"`                              | 20  | 20   |
| `authors/name:"Bouguettaya, Athman"`                         | 18  | 21   |

**Alternatives considered.**

- Clickable publisher and author bars with a visible note over read-only bars, because the click
  answers the natural next question and the note ("Clicking one can also list papers CORE files
  under a similar name.") explains the difference. The status line gives the real number listed.
- Selections combined with AND over a new selection replacing the last, because replacing throws
  away a choice the user made.

**Limits.** A one-word publisher name can list far more papers than its bar, because the word also
matches longer names. With more than one selection, no chart shows the combined count; it is in
the status line.

### 9c. "View as table" on the publisher and author charts

**Decision.** Each row is one bar, with five columns: the name, Papers (the bar's count), Loaded
papers, Citations (summed over those loaded papers) and h-index. The table is computed from
metrics already fetched for the cards, so it costs no requests.

**Alternatives considered.** Linking through loaded papers over asking OpenAlex about each name,
because a wrong match on a free-text name puts another person's h-index on screen.

**Limits.** Many rows show a dash for "no data", because the top publishers of all matching papers
are often not among the loaded ones.

## 10. URL state and load more

**Decision.** The search (`q`, `limit`, and the chart selections) lives in the URL's query string,
and the URL is the single source of truth: user actions change the URL, and the page turns each
URL into a search. "Load more" appends the next page using CORE's `offset`. The next page starts
after the last row CORE sent (`nextOffset`) and loading stops on an empty page.

**Why.** A search worth running is worth sending to a colleague or bookmarking, and the browser's
back and forward buttons work. One direction of data flow avoids keeping the URL and component
state in sync by hand.

**Alternatives considered.**

- An offset that follows CORE's rows over the count of papers shown, because the count re-reads
  rows whenever a repeat was hidden.
- Load more over numbered pages, because relevance-ranked results are read from the top and load
  more keeps the reader's place.
- Load more over infinite scroll, because scrolling spends the rate limit without the user asking.

## 11. Testing and tooling

**Decision.** Four layers of tests, all run in CI:

- Unit tests (Vitest) on the logic that can be wrong in interesting ways: data cleaning, the
  parser and matcher, query shaping, the store's cancellation, caching and paging, error mapping.
- Worker tests in the Workers runtime (4b).
- Playwright tests in `e2e/` that drive the app in Chromium with CORE replaced at the network
  boundary. The mock records every request and fails the test if the app calls anything else
  under `/core-api/`.
- Playwright tests against the production build and the Worker together (4b).

ESLint (angular-eslint) and `prettier --check` run in CI ahead of the tests. `.gitattributes` fixes
line endings to LF, so a Windows checkout passes the same format check.

**Why.**

- Browser tests check that the parts are connected, and they assert on requests as well as the
  screen. "Refining does not ask CORE again" is a claim about what is not sent.
- Elements are found by role and label, so removing a label fails a test. Three tests run axe: on
  the empty page, on results, and on results in the dark theme.
- For the Worker, routing and browser suites I confirmed that breaking the behaviour they cover
  makes a test fail.

**Alternatives considered.**

- A mocked CORE over the real one, because real requests spend the rate limit, need the key in CI,
  and cannot produce a 429 or a 503 on demand.
- Linting in CI over formatting alone, because rules such as no-output-native catch faults a
  formatter cannot.

**Limits.** A mock proves the app handles the responses I wrote, not that CORE still sends them.
Tests run in Chromium only. Automated accessibility checks find only some problems.

## What I would do next

1. Exact publisher click-through, if CORE exposes identifiers to filter on.
2. Saved searches and export of results (CSV, BibTeX).
3. A scheduled check of the deployed site, one real search a day, to notice if CORE changes its
   response format.
4. Suggestions as an opt-in setting per account, for a product with customer queries.
5. For plain-English search: a fixed set of test questions re-run whenever the prompt changes.
6. For citation metrics: match papers without a DOI by title and year, with a strict similarity
   check, so more cards can show figures.
