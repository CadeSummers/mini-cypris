# Design decisions

Why the app is built the way it is, step by step, with the alternatives that were considered.
"Brief" refers to the project description (_Software Engineering Initial Project_); its
numbered steps are cited so each decision can be traced back to a requirement.

Each section follows the same shape: **Decision**, **Why**, **Alternatives**.

---

## 1. Framework version and project setup

_Brief step 1: "Create a new Angular project using version 20 or higher."_

**Decision.** Angular 21, generated with the CLI: standalone components, signals, zoneless
change detection, SCSS, no server-side rendering, Vitest for unit tests.

**Why.**

- Angular 21 satisfies "20 or higher" and its defaults (zoneless, signals, the `@if`/`@for`
  control flow) are the idioms a current Angular codebase is moving towards.
- Angular 22 was available, but its CLI requires Node 24.15+. Angular 21 runs on Node 20, 22
  and 24, so a reviewer is less likely to hit a version error before seeing the app.
- No SSR: this is a client-side search tool behind an API, so SSR adds moving parts without a
  benefit that matters here.

**Alternatives.**

- _Angular 20 exactly_: the minimum allowed; no advantage over 21.
- _Angular 22_: newest, but narrows which Node versions can run the project.
- _NgModules / zone.js_: still supported, but legacy for a new project.

---

## 2. Talking to CORE

_Brief step 2: "Learn how to do a simple GET request to make queries."_

**Decision.** One service, `CoreApi`, is the only code that knows CORE's URLs and response
shapes. It returns a clean `Paper` model, not CORE's raw objects.

**Why.**

- CORE's data is inconsistent. In live responses, missing values arrive as `null`, as `''`, or
  not at all; years arrive as numbers or strings; abstracts contain HTML tags, escaped HTML
  (`&lt;p&gt;`), and text cut off mid-tag; some author names carry internal ids
  (`"Xiao Liu (13082469)"`); some abstracts just repeat the title. Normalising once, at the
  boundary, means no component has to defend against any of this.
- Raw types (`CoreWork`) and the domain type (`Paper`) are separate, so a change in CORE's API
  is absorbed in one mapping function (`toPaper`).
- The search URL ends in a slash (`/search/works/`) on purpose: without it CORE responds with
  a redirect, which costs a round trip and, through a proxy, can drop the API key.

**Alternatives.**

- _Use CORE's objects directly in templates_ (what the original starter sketch did): less
  code, but null checks and cleanup leak into every template.
- _A generated client from CORE's OpenAPI spec_: more than two endpoints warrant.
- _Runtime validation (e.g. Zod)_: worth it for a larger surface; here the mapper already
  tolerates every field being absent.

---

## 3. State management and request handling

_Brief steps 4 and 5 (searching "efficiently")._

**Decision.** A `SearchStore` service holds the search state as signals. Requests go through
an RxJS stream using `switchMap`. Results are cached in memory by query, page size and year.

**Why.**

- **Race conditions.** With plain `subscribe()` calls, two quick searches can finish out of
  order and the older result wins. `switchMap` cancels the in-flight request when a new one
  starts, so that cannot happen. There is a unit test for exactly this.
- **Signals for state, RxJS for events.** Signals are a good fit for "what is on screen now";
  RxJS is a good fit for cancellation and "ignore clicks while busy" (`exhaustMap` for
  load-more). Using each for what it is good at keeps both parts small.
- **Rate limits shape the design.** CORE allows roughly 10 requests per minute. So: no
  search-as-you-type, the page-size field searches on commit rather than per keystroke,
  repeated searches come from a cache, and the chart is fetched once per query.
- The store is provided by the page component, so its lifetime matches the page and tests can
  create it in isolation.

**Alternatives.**

- _NgRx / NgRx SignalStore_: sensible at larger scale; here it would be more boilerplate than
  logic.
- _Angular's `httpResource` / `rxResource`_: concise and signal-native, but still marked
  experimental, and load-more plus a dependent aggregate request fit less naturally.
- _State in the component_ (the starter's approach): fine for a demo, harder to test and it
  had the race condition described above.

---

## 4. API key and the dev proxy

_Brief step 7 (public repo), step 2._

**Decision.** The browser calls `/core-api/...`. The dev server proxies that to
`api.core.ac.uk` and adds the key from a git-ignored `.env` file. The app also works with no
key at all.

**Why.**

- A key placed in `environment.ts` is compiled into the JavaScript bundle, where anyone can
  read it, and is one careless commit away from a public repo. With the proxy the key never
  enters the browser or git.
- It mirrors how a real product works: the front end talks to its own backend, which holds
  the credentials for upstream services.
- It avoids depending on CORE's CORS behaviour for the `POST` aggregate request.
- A reviewer can clone and run without requesting a key.

**Deployment: a Cloudflare Worker.** A static build has no dev server, so the deployed site
needs something doing the proxy's job. `worker/core-proxy.js` is that: one Worker, mounted at
the same `/core-api/*` path, that adds the key from a Worker secret. `wrangler.jsonc` serves
the built Angular files directly and sends only API calls to the Worker. The Angular code is
identical in development and production; nothing in `src/` knows which proxy it is talking
to.

I chose Cloudflare for three reasons:

- **Familiarity.** I have deployed on Cloudflare in a previous project, so I could spend the
  time on the proxy's behaviour, not on learning a host.
- **Adoption.** It is one of the most widely used edge platforms, so the setup is one a
  reviewer or teammate is likely to recognise and can maintain.
- **Security of the key.** The key is stored as a Worker secret: encrypted, not readable
  again from the dashboard or CLI once saved, absent from the repository and from the
  JavaScript sent to the browser, and available only to the Worker at run time.

Details of the Worker:

- It is an allowlist, not an open proxy: only `GET /v3/search/works/` and
  `POST /v3/search/works/aggregate` are forwarded. A public URL that forwarded anything would
  let strangers spend the key on any CORE endpoint.
- It passes CORE's rate-limit headers through, so the "try again at" message works when
  deployed.
- It caches successful answers at Cloudflare's edge: ten minutes for searches, an hour for
  year counts, which change slowly. Every visitor shares one key and about ten requests a
  minute, so a repeated query (an example chip, a shared link, a reviewer retracing their
  steps) should cost nothing. Errors and rate-limit responses are never cached. The Cache
  API stores only GET requests, so the aggregate `POST` is keyed by a hash of its body. A
  response header, `x-proxy-cache: HIT|MISS`, shows which path was taken.
- It has no dependencies and uses only web-standard `Request`/`Response`/`fetch`.

I first wrote this as a Netlify function and then moved it to Cloudflare for the reasons
above (both commits are in the history). The move changed about ten lines, which is the
benefit of keeping the proxy to web-standard APIs.

**Trade-off, stated plainly.** The deployed site shares one key, and so one rate limit, among
everyone using it. The edge cache softens this for repeated queries, but a burst of distinct
new queries can still hit the limit, and cached results can be up to ten minutes old. That is
fine for a demo; a product would also rate-limit per user. The dev proxy and the Worker also duplicate a little logic
(adding the header); I kept them separate because each is under a screen of code and they run
in different runtimes.

**Alternatives.**

- _Key in `environment.ts`_ (the starter's approach): simplest, but leaks the key.
- _Key typed into the UI and kept in `localStorage`_: works on static hosting, but adds a
  setup step for every user and stores a secret in the browser.
- _An Express server_: works, but needs an always-on host for what is one small function.
- _Netlify or Vercel functions_: equivalent in capability; see the reasons for Cloudflare
  above.
- _Cloudflare Pages Functions_: also works, but Cloudflare now points new projects to Workers
  with static assets, which is what this uses.
- _GitHub Pages_: free and simple, but static only, so the key problem would be unsolved.

---

## 5. Presenting papers

_Brief step 3: "a clean and intuitive design of your making."_

**Decision.** A single-column list of cards. Each shows the title (linked), up to three
authors, year, publisher, an abstract clamped to three lines with a "Show more" toggle, and
PDF/DOI links. Styling is hand-written SCSS on a small set of CSS custom properties.

**Why.**

- Researchers scan titles first, so the title is the largest element and the abstract is
  collapsed by default. A single column keeps line lengths readable.
- The link goes to the DOI when there is one (the stable, canonical address) and to the CORE
  record otherwise, so a card always leads somewhere.
- Missing data is stated ("Unknown authors", "No abstract available") rather than left as a
  blank gap.
- No component library: the UI is a form, a list and a chart. Plain SCSS keeps the bundle
  small and shows the layout work directly. Design tokens in `styles.scss` keep it
  consistent.

**Alternatives.**

- _Angular Material_: fast and accessible by default, but adds weight and a generic look for
  very few components.
- _Tailwind_: quick to write; adds tooling and moves styling into templates.
- _A table_: denser, but abstracts do not fit well in table cells.

---

## 6. The "how many papers" field

_Brief step 4._

**Decision.** A number input from 1 to 100 that maps to CORE's `limit`. Out-of-range values
snap into range visibly. Changing it re-runs the current search.

**Why.**

- 100 is CORE's maximum page size, so the UI does not offer what the API will refuse.
- It reacts to `change` (blur, Enter, spinner) rather than every keystroke: typing "25" should
  cost one request, not two.
- It only re-runs when a search is already on screen for the query in the box, so adjusting
  the number before the first search does nothing surprising.

**Alternatives.**

- _A dropdown (10 / 25 / 50 / 100)_: harder to get wrong, but the brief asks for a field and a
  free number is more flexible.
- _A slider_: imprecise for exact counts.

---

## 7. Boolean search

_Brief step 5: "a search bar that allows users to search through the documents collected via
a boolean keyword search", with the example `(drone AND (package OR delivery))` and a link to
CORE's query syntax._

The sentence can be read two ways, so the app does both.

**Decision A: the main search bar sends the boolean query to CORE.** CORE's query language
already understands `AND`, `OR`, `NOT`, parentheses, phrases and `field:value`. The text is
passed through unchanged, after a structural check in the browser.

**Decision B: a second box filters the papers already loaded,** in the browser, with the same
syntax, using a small recursive-descent parser written for this project.

**Why.**

- The brief links to CORE's own search documentation, which points to reading A. But
  "documents collected" also reads naturally as "the documents you have already fetched",
  which is reading B. Supporting both removes the ambiguity instead of betting on one.
- **Validation saves requests and confusion.** An unbalanced parenthesis sent to CORE comes
  back as a vague server error and still uses up rate limit. Catching it locally gives a
  precise message ("This opening parenthesis is never closed.").
- **The parser is permissive about terms on purpose.** It only judges structure. Anything it
  does not recognise (`yearPublished>=2020`, `_exists_:fullText`) passes through as a term, so
  it never rejects valid CORE syntax it does not know about.
- **Lowercase operators get a hint, not an error.** `drone and delivery` is a valid query; it
  just searches for the word "and". The UI points this out without blocking.
- Errors appear only after a submit attempt, so the user is not scolded mid-typing.
- One parser serves both features: its syntax tree drives validation for the main bar and
  evaluation for the refine box.

**Alternatives.**

- _CORE only_ (the starter's approach): least code, but covers one reading of the brief and
  gives poor feedback on malformed queries.
- _Client-side only_: cannot search beyond the loaded page, which defeats the purpose.
- _A parsing library (e.g. a Lucene query parser)_: more complete, but a dependency for ~200
  lines of logic that is easy to test.
- _A visual query builder_: friendlier for newcomers; slower for the expert users a research
  tool attracts. Example chips cover discoverability instead.

**Known limits of the refine box.** Matching is case-insensitive substring matching, not
CORE's relevance ranking or stemming, and it only sees loaded papers. The UI says so.

---

## 8. Loading, empty and error states

_Brief step 3 (intuitive design)._

**Decision.** Four explicit states (idle, loading, loaded, error). Errors are mapped to
typed, actionable messages. A failed "load more" keeps the papers already shown.

**Why.**

- Each failure has a different remedy: wait (rate limit), fix the query (400), fix the key
  (401/403), retry (5xx), check the connection (offline). One generic message hides that.
- On a rate limit the app reads CORE's `x-ratelimit-retry-after` header and shows the time at
  which searching will work again.
- Skeleton cards keep the layout stable while loading, and respect `prefers-reduced-motion`.
- Status changes are announced through an `aria-live` region.

**Alternatives.**

- _Automatic retry with backoff_: helpful for flaky 5xx responses, but against a tight rate
  limit it can make things worse; a manual "Try again" keeps the user in control.
- _Toast notifications_: easy to miss and gone when you look for them.

---

## 9. The chart

_Brief step 6: "The chart should aggregate data from all papers that match a given query. You
can choose to find the chart information from the data stored client-side or from the API in
aggregate."_

**Decision.** A bar chart of papers per publication year, built from CORE's aggregate endpoint
(`POST /v3/search/works/aggregate`), which counts across every matching paper. If that request
fails, the chart falls back to counting the loaded papers and labels itself accordingly.

**Why.**

- **"All papers that match" is the key phrase.** The drone example matches about 71,000
  papers; a chart of the 10 on screen would describe the page, not the query. The aggregate
  endpoint answers the actual question in one request.
- **The numbers are verifiable.** Selecting 2021 in the chart lists 6,521 papers, the same
  figure the bar shows.
- **Year is the right dimension.** It is present on nearly every record, has a natural order,
  and answers a real research question: is this topic growing?
- **Bad data is surfaced, not hidden.** CORE reports papers dated 2027, 2093 and so on.
  They are excluded from the chart and a note says how many, so the totals remain explainable.
- **Defaults to the last 25 years, with an "All years" toggle.** The long tail back to the
  1950s otherwise squeezes the recent years, which are the interesting part.
- **Graceful degradation.** The chart is secondary to the results; if the aggregate fails,
  the search still succeeds and the chart says it is showing loaded papers only.
- **Blank before the first query,** as the brief allows, with a prompt explaining what will
  appear.
- **Clicking a bar narrows the list to that year** while the chart keeps showing the whole
  query, so the chart is a way to navigate, not only a picture.
- **Chart.js with only the bar-chart parts registered.** It is small, well known and
  canvas-based. Registering individual pieces instead of everything keeps the initial bundle
  under the CLI's 500 kB budget. The chart instance is created once and updated in place.
- **Accessible alternative.** The canvas has a generated text summary, and a "View as table"
  disclosure exposes the same data to screen readers and keyboards.

**Alternatives.**

- _Client-side aggregation only_ (the starter's approach): explicitly allowed by the brief
  and simpler, but only reflects the loaded page. Kept as the fallback.
- _One count request per year_: also gives true totals, but costs dozens of requests against
  a 10-per-minute limit.
- _Other dimensions (authors, document type)_: the aggregate endpoint supports them; years
  tell the clearest story. A dimension switcher is a natural next step.
- _ngx-charts / D3 / ECharts_: ngx-charts tracks Angular versions slowly; D3 is more code for
  a bar chart; ECharts is much larger.
- _A line chart_: suggests continuity between years; bars are more honest for yearly counts.

---

## 10. URL state, load more

_Brief step 8 (extras), step 5 ("efficiently")._

**Decision.** The search (`q`, `limit`, `year`) lives in the URL's query string, and the URL
is the single source of truth: user actions change the URL, and the page turns each URL into
a search. "Load more" appends the next page using CORE's `offset`.

**Why.**

- Research is collaborative: a search worth running is worth sending to a colleague or
  bookmarking. It also makes the browser's back and forward buttons work.
- One direction of data flow (URL → store → view) avoids the bugs that come from keeping the
  URL and component state in sync by hand.
- Load more keeps the reader's place in the list, unlike numbered pages. Duplicate ids across
  pages are removed, since CORE can return the same work twice.

**Alternatives.**

- _State only in memory_: simpler, but a refresh loses the search.
- _Numbered pagination_: better for jumping around large result sets; relevance-ranked
  results are usually read from the top.
- _Infinite scroll_: spends rate limit without the user asking, and makes the footer
  unreachable.

---

## 11. Testing and tooling

_Brief step 7 ("working" at each stage)._

**Decision.** Unit tests on the logic that can be wrong in interesting ways: data cleaning,
the boolean parser and matcher, the store's cancellation/caching/paging/fallback behaviour,
error mapping and URL parsing. Prettier for formatting. Every commit builds and passes.

**Why.**

- Logic is kept in pure functions and one store, apart from components, so most of it can be
  tested without rendering anything.
- HTTP is tested with Angular's `HttpTestingController`, which can assert that a request was
  cancelled, not merely that the right data showed up.

**Not done, and why.**

- _Chart rendering tests_: jsdom has no canvas. The chart's data pipeline is tested; the
  drawing was checked by hand in the browser.
- _End-to-end tests (Playwright)_: valuable next step; they would need a mocked CORE to avoid
  the rate limit.

---

## What I would do next

1. Per-user rate limiting in the Worker, so one busy visitor cannot use up the shared CORE
   allowance.
2. More chart dimensions (top authors, document type) using the same aggregate endpoint.
3. Highlight matched terms in titles and abstracts.
4. Saved searches and export of results (CSV / BibTeX).
5. End-to-end tests against a mocked CORE.
6. Dark theme: colours are already CSS custom properties, so this is mostly a second palette.
