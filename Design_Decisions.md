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
everyone using it. The edge cache and the per-visitor limit (section 4a) soften this, but
cached results can be up to ten minutes old. The dev proxy and the Worker also duplicate a
little logic (adding the header); I kept them separate because each is small and they run in
different runtimes.

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

### 4a. Per-visitor rate limiting

_Brief step 2 (use the API responsibly), step 8 (additions)._

**Decision.** Each visitor to the deployed site may cause at most 8 requests to CORE per
minute. The count is kept by a Durable Object, one per visitor IP address
(`VisitorLimiter` in `worker/core-proxy.js`). Searches answered from the Worker's cache are
free and never counted. When the limit is reached the Worker answers 429 itself, with the
exact time the visitor can search again, and the app shows a message that says this is the
demo's limit, not CORE's.

**Why.**

- **One shared key means one shared allowance.** CORE gives the key about 10 requests a
  minute in total. Without a per-visitor cap, one person (or one script) clicking quickly
  would lock every other visitor out, including a reviewer.
- **8 of 10.** A fresh search costs two requests (results and chart counts), so 8 allows four
  brand-new searches a minute, more than a person reading results will make, while leaving a
  little for someone else. It is a constant at the top of the Worker.
- **Only real CORE requests count.** The limiter is checked after the cache, so repeating a
  search, using a shared link, or going back never spends the visitor's allowance.
- **A sliding window, not a fixed one.** The object stores the times of the visitor's recent
  requests and allows a new one only if fewer than 8 fall in the last 60 seconds. That makes
  the "try again at" time exact: it is when the oldest of those requests turns 60 seconds old.
- **It fails open.** If the limiter is unavailable, the search goes ahead. The limiter
  protects the demo; it should never be the reason the demo is down.
- **The visitor is identified by `CF-Connecting-IP`,** which Cloudflare sets itself and a
  client cannot forge, unlike `X-Forwarded-For`.
- **The app tells the two limits apart.** The Worker's 429 carries an `x-proxy-limit` header,
  and `toApiError` uses it to show "Search limit reached" with the reason, not the CORE
  message suggesting an API key (which a visitor to the demo cannot act on).

**What I tried first, and why I changed it.** Cloudflare has a built-in rate-limiting binding
that needs a few lines of configuration, and I started with it. Testing it on the deployed
Worker with the limit set to 8, 19 requests in about a minute all passed. That is by design:
Cloudflare documents it as approximate and eventually consistent, counted separately in each
location, and recommends a Durable Object when the limit must be strict. It suits "about a
thousand a minute"; it does not suit "exactly 8". With the Durable Object, the same test
passed 8 requests and refused the 9th, and a search already in the cache was still served.

**Trade-offs, stated plainly.**

- **An IP address is not a person.** People behind one office or university network share a
  limit, and one person can change networks. Without accounts there is nothing better to key
  on, and for a demo the cost of being wrong is a short wait.
- **A request that CORE itself refuses still uses one of the visitor's 8.** Counting only
  successes would need a second call to the object; the simpler rule errs on the side of
  protecting the shared allowance.
- **It limits each visitor, not the total.** Two visitors each within their limit can still
  exhaust CORE's 10 a minute between them; then CORE's own 429 is passed through as before.
- **Each counted request adds a Durable Object call** (a few milliseconds) and a small write.
  This is well inside Cloudflare's free allowance at demo traffic.

**Alternatives.**

- _Cloudflare's rate-limiting binding_: tried and measured, as above.
- _A counter in Workers KV_: also eventually consistent, with no atomic increment.
- _A counter in the Cache API_: per data centre and not atomic; two simultaneous requests
  would both read the old count.
- _Cloudflare WAF rate-limiting rules_: no code at all, but configured in the dashboard
  rather than in the repository, and cannot tell a cache hit from a request that reaches
  CORE.
- _A single global limiter_ (one object for everyone): would protect CORE's total exactly but
  does nothing for fairness between visitors, and puts every request through one object.
- _Limiting in the Angular app_: trivially bypassed, since anyone can call the Worker directly.

---

### 4b. Testing the Worker

_Brief step 2 (use the API responsibly), step 7 ("working" at each stage), step 8 (additions)._

**Decision.** 12 tests in `worker/core-proxy.test.mjs` run the real Worker in Cloudflare's
runtime on my machine and in CI, with CORE replaced by a fake. They use Miniflare (the
engine inside `wrangler dev`) as a library and Node's built-in test runner. Run them with
`npm run test:worker`.

**What they prove.**

- **The key.** It is added to the request that goes to CORE, and it appears nowhere in the
  response body or headers. An `Authorization` header sent by the browser is not forwarded.
  With no key configured, no `Authorization` header is sent at all.
- **Not an open proxy.** Other CORE paths, other methods and a `../` path all get 404, and
  the fake CORE receives nothing.
- **The cache.** A repeated search is served from the cache and CORE is called once, even if
  the parameters arrive in a different order. Aggregate requests are cached by their body.
  Errors are never cached.
- **The per-visitor limit.** 8 new searches pass; the 9th gets 429 with `x-proxy-limit:
visitor` and a retry time one minute after the first; CORE saw exactly 8 requests. While
  over the limit, a cached search is still served, and a different IP address is unaffected.
- **Header filtering.** An upstream `set-cookie` or internal header is dropped; the
  rate-limit headers the app reads are kept.
- **Failure.** CORE's own 429 passes through and is told apart from the Worker's. If CORE
  cannot be reached, the Worker answers 502.

**Why.**

- **This is the only code that handles the key.** "The key never reaches the browser" was a
  sentence in the README. Now it is a test.
- **The earlier checks were manual.** I verified the cache and the limit by sending requests
  to the deployed site. That spends the real allowance and nobody repeats it on every change.
- **The real runtime, not a stand-in.** The Worker uses the Cache API, a Durable Object and
  `crypto.subtle`. Mocking those in Node would test my mocks. Miniflare runs `workerd`, the
  same runtime Cloudflare runs in production.
- **No production code was changed to make it testable.** Miniflare can intercept the
  Worker's outbound `fetch`, so the fake CORE is supplied by the test, not by a setting in
  the Worker.
- **Each test is its own visitor** (its own IP address and query text), so tests cannot use
  up each other's allowance or read each other's cache entries.

**I checked that the tests can fail.** Changing `VISITOR_LIMIT` from 8 to 9 made both limit
tests fail; I reverted it.

**Trade-offs, stated plainly.**

- **The window expiring after 60 seconds is not tested.** I cannot move the runtime's clock,
  and really waiting would add a minute to every CI run. The test checks the retry time the
  Worker returns instead.
- **It is Cloudflare's runtime, but not Cloudflare's network.** The routing in
  `wrangler.jsonc` (which paths reach the Worker), the real edge cache across locations and
  the deployed secret are still only checked on the live site.
- **Miniflare is pinned as its own dev dependency (version 4).** The copy bundled inside
  Wrangler was a version 5 beta whose options differ from the published documentation, so I
  did not build on it. The cost is a second copy in `node_modules`.

**Alternatives.**

- _Starting `wrangler dev` as a separate process_ and sending it HTTP requests: closest to
  how it is run by hand, but it needs a port, a wait for start-up, and a change to the Worker
  to point it at a fake CORE. It also hung on my machine while I was building the limiter.
- _`@cloudflare/vitest-pool-workers`_, Cloudflare's own test integration: runs tests inside
  the runtime with isolated storage per test. It ties the project to a specific Vitest
  version, and Angular's test builder already chooses one.
- _Unit-testing the helper functions in Node_: fast, but it skips the parts most likely to be
  wrong (cache keys, the Durable Object, header handling on real `Response` objects).

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

### 5a. Highlighting matched terms

_Brief step 3 ("clean and intuitive"), step 5 (boolean search), step 8 (additions)._

**Decision.** Words from the query are highlighted in each card's title and abstract, for
both the CORE search and the in-browser refine box.

**Why.**

- **It answers "why is this paper here?"** A boolean query can match a paper through any of
  several terms; marking them lets a researcher judge relevance without reading every
  abstract. It is the standard behaviour of search tools, so its absence is noticed.
- **It reuses the boolean parser.** The terms come from the same syntax tree that validation
  and the refine filter use (`collectHighlightTerms` in `search/highlight.ts`), so the
  highlighter understands the query the same way the rest of the app does:
  - terms under `NOT` are not highlighted, because they say what a paper must not contain;
  - `title:x` highlights titles only and `abstract:x` abstracts only;
  - terms on other fields (author, publisher, year) and comparisons like `year>=2020` are
    skipped, because the title and abstract are not where they matched.
- **No HTML is ever built from paper text.** The text is split into plain and matching
  segments and the template renders each as an element (`<mark>` or `<span>`). The obvious
  shortcut, building an HTML string and binding it with `innerHTML`, would mean trusting
  titles and abstracts from thousands of repositories, some of which already contain markup.
- **A term matches at the start of a word and the whole word is marked,** so `drone` marks
  "drones" but not "androne". CORE's search stems words in a similar way, so this is close
  to what CORE actually matched.
- **`<mark>` is the semantic element** for this, and the colour is a soft background that
  keeps the text's own colour, so highlighted link text still reads as a link.

**Trade-offs, stated plainly.**

- **It is an approximation of CORE's matching.** CORE also searches the full text and applies
  its own stemming, so a paper can match with nothing highlighted (the term is in the body)
  or through a form my rule does not mark ("delivered" for `delivery`).
- **The refine box matches substrings, the highlighter matches word starts.** Refining by
  `liver` keeps a paper containing "delivery" but does not highlight it. I chose one
  highlighting rule for both sources over two slightly different ones.

**Alternatives.**

- _`innerHTML` with a sanitiser_: less template code, but puts untrusted text through an HTML
  parser for no benefit.
- _A pipe returning marked-up HTML_: same concern, and pipes that return HTML need
  `bypassSecurityTrust…`, which is exactly the kind of escape hatch to avoid.
- _The CSS Custom Highlight API_: highlights without changing the DOM, but needs imperative
  range bookkeeping and is awkward to test.
- _Asking CORE for highlights_: its search API does not return match positions.

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
- _Other dimensions as the default_: years tell the clearest story, so the year chart stays
  the default view; the others are one click away (see below).
- _ngx-charts / D3 / ECharts_: ngx-charts tracks Angular versions slowly; D3 is more code for
  a bar chart; ECharts is much larger.
- _A line chart_: suggests continuity between years; bars are more honest for yearly counts.

### 9a. Chart dimension switcher

_Brief step 6 ("aggregate data from all papers that match"), step 8 (additions)._

**Decision.** A "Chart by" switcher above the chart: Year (the default), Document type,
Publisher, Author. The last three show the ten most common values as ranked horizontal bars,
counted by CORE over every matching paper.

**Why.**

- **It answers different questions about the same result set.** Year says whether a topic is
  growing; document type says whether it is theses or journal articles; publisher and author
  say who is producing the work. For an R&D search tool those are the natural next questions.
- **It costs no extra requests.** CORE's aggregate endpoint accepts several fields at once, so
  one `POST` now asks for `yearPublished`, `documentType`, `publisher` and `authors`
  together. Switching views is instant and spends nothing against the rate limit. I checked
  which fields CORE allows by trying them: `language` returns nothing and `journals` is
  rejected, so they are not offered.
- **Ranked lists are plain HTML and CSS, not Chart.js.** The labels are long names
  ("Institute of Electrical and Electronics Engineers (IEEE)") that need to wrap, and an
  ordered list is read correctly by a screen reader with no separate table. It also added no
  chart code to the bundle. Chart.js stays for the year chart, where a real axis matters.
- **Cleaning is conservative.** Placeholder values such as `null null` (the "top author" in
  CORE's raw data for the drone query) are dropped, and values differing only by case or an
  appended repository id are merged. Different spellings of one publisher or person are _not_
  merged, because guessing aliases would put numbers on screen that CORE never reported. A
  note under those two charts says so.
- **Same fallback as the year chart.** If the aggregate fails, the lists are computed from
  the loaded papers and labelled that way.
- **The logic is a pure function** (`buildCategorySeries` in `chart/category-series.ts`), unit
  tested without a browser, like the year series.
- **The year chart is hidden, not destroyed, when another view is chosen,** so its Chart.js
  instance and the "All years" choice survive switching back.

**Trade-offs, stated plainly.**

- **Only the year chart drills down.** I tested using the other values as filters:
  `documentType:"thesis"` returned exactly the charted count, but `publisher:"IEEE"` returned
  3,395 papers against a bar of 1,622 (CORE matches the word, not the exact name) and an
  author filter returned none. A click that lists a different number of papers than the bar
  shows would be worse than no click, so those bars are read-only.
- **CORE returns its 100 largest values per field,** so the lists are a top ten, with no
  "other" total, and merging after cleaning can only combine values within that 100.
- **The chosen view is not in the URL.** It is a way of looking at the data, not part of the
  search; adding it would be simple if sharing a specific view mattered.

**Alternatives.**

- _A separate request per dimension, made when its tab is first opened_: fewer bytes for
  people who never switch, but each switch would spend a request against 10 per minute.
- _Horizontal Chart.js bars_: consistent with the year chart, but poor at long labels and
  needs its own table alternative.
- _A pie or donut chart_: common for "share of" data, but hard to compare ten slices and
  misleading when the ten do not add up to the whole.
- _Alias tables for publishers_ (mapping "MDPI AG" to "Multidisciplinary Digital Publishing
  Institute"): correct for the names I know, wrong or incomplete for the rest.
- _Showing all four charts at once_: no switching, but pushes the results far down the page.

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

- _Chart rendering in unit tests_: jsdom has no canvas. The chart's data pipeline is unit
  tested; the chart on screen is covered by the end-to-end tests below.

### 11a. End-to-end tests against a mocked CORE

_Brief step 7 ("working" at each stage), steps 3 to 6 (each feature has a test), step 8
(additions)._

**Decision.** 18 Playwright tests in `e2e/` drive the app in a real Chromium browser. CORE is
replaced at the network boundary: `e2e/mock-core.ts` answers the two endpoints the app
calls with made-up data, records every request, and fails the test if the app calls anything
else under `/core-api/`. They run with `npm run e2e` and as a second job in CI.

**Why.**

- **Unit tests check the parts; these check that the parts are connected.** A unit test can
  prove the store sends the right offset. Only a browser test proves that clicking "Load 10
  more" reaches the store and that ten more cards appear.
- **Each requirement in the brief has a test a reviewer can read.** Listing papers (step 3),
  the number of papers (step 4), boolean search (step 5) and the chart counting every match
  (step 6) are each a named test.
- **The mock sits at the network, not inside Angular.** The real `HttpClient`, router, store
  and components all run. The only thing replaced is CORE itself.
- **Not the real CORE.** Real requests would spend the rate limit (18 tests make about 50
  requests; the key allows about 10 a minute), need the key in CI, and fail whenever CORE is
  slow. They would also make it impossible to test a 429 or a 503 on demand.
- **The tests assert on requests, not only on the screen.** "Refining does not ask CORE
  again" and "choosing a year does not refetch the counts" are claims about what is _not_
  sent, so the mock records every call.
- **Elements are found the way a user finds them**, by role and label ("Boolean search",
  "Papers to fetch", the alert, "List papers from 2023"). No test ids were added to the app.
  If a label is removed, the test fails, which also protects accessibility.
- **Two tests run axe**, an automated accessibility checker, on the empty page and on a page
  of results.

**What the tests found.** The first run of the accessibility scan failed: the page had no
level-one heading, because "Mini-Cypris" in the header was a plain `<span>`. It is now an
`<h1>`. The 106 unit tests could not have caught this.

**I also checked that the tests can fail.** I changed the API client to always send
`limit=10`; the "papers to fetch" test failed as it should, and I reverted the change.

**Trade-offs, stated plainly.**

- **A mock proves the app handles the responses I wrote, not that CORE still sends them.**
  If CORE renames a field, these tests stay green. The deployed site is the check for that.
- **The year drill-down is driven through the chart's "View as table" buttons,** not by
  clicking a bar. Clicking a pixel position on a canvas breaks whenever the layout shifts.
  Both routes call the same handler, but the bar click itself is still only checked by hand.
- **The Worker is not covered here.** These tests run against the dev server. The Worker has
  its own tests (section 4b).
- **Chromium only.** Adding Firefox and WebKit is one line each in `playwright.config.ts`
  but triples the CI time.
- **Automated accessibility checks find only some problems** (commonly estimated at a third
  to a half). They do not replace testing with a keyboard and a screen reader.

**Alternatives.**

- _Cypress_: also good; Playwright is faster to start, runs tests in parallel for free, and
  its network mocking and request recording needed no plugin.
- _Angular component tests in jsdom_: no real layout, no canvas, no real router history.
- _A fake CORE server process_: more realistic than route interception, but another thing to
  start and keep in step, for no extra coverage of the app.
- _Recording real CORE responses_ and replaying them: realistic data, but it would put
  real papers' abstracts in the repository and still go stale.

---

## What I would do next

1. A global budget in the Worker on top of the per-visitor limit, so the app can queue or
   warn before CORE's own limit is hit.
2. Drill-down from the document type chart, the one extra dimension where CORE's filter
   matched the charted count exactly.
3. Saved searches and export of results (CSV / BibTeX).
4. One test that runs the browser suite against the Worker and the built app together, so the
   routing in `wrangler.jsonc` is covered too.
5. Dark theme: colours are already CSS custom properties, so this is mostly a second palette.
