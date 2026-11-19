# What Mini-Cypris does beyond the brief

The brief's eight steps are mapped in the [README](../README.md). This page lists everything
added on top of them, grouped by theme. The reasoning for the larger ones is in
[Design_Decisions.md](../Design_Decisions.md).

## Search

- **Two kinds of boolean search.** The main box sends the query to CORE. "Refine these papers"
  filters the papers already loaded, instantly and without another request, with the same
  syntax: `AND`, `OR`, `NOT`, parentheses, `"phrases"`, `field:value`, `year>=2020`.
- **Validation before sending.** Unbalanced parentheses, unclosed quotes, empty phrases and
  dangling operators are caught in the browser with a specific message.
- **Queries CORE counts correctly.** CORE miscounts some well-formed queries: outer parentheses
  around a nested group, `AND` beside `OR` without parentheses, and adjacent words. Each query
  is rewritten into an equivalent, flat shape on its way to CORE. What you typed stays as it is.
- **Queries CORE fails on.** A quoted single word (`"exoplanet"`) makes CORE answer with a
  server error, and `authors:` matches nothing. Both are repaired on the way out; a wrong field
  name such as `year` gets a one-click fix; a rejected query is reported as a query problem, not
  an outage.
- **Highlighted matches.** Query words are marked in each title and abstract, for the CORE
  search and the refine box alike. The refine filter and the highlighter use one matching rule,
  so a paper that is kept is a paper whose match is marked.
- **Shareable URLs.** The query, the number of papers and every chart selection live in the URL,
  so a search can be bookmarked or sent, and back and forward work.
- **Load more.** Fetches the next page from where CORE's list left off and appends it.
- **No blank page between searches.** The previous papers stay on screen, dimmed, until the new
  ones arrive.

## Chart

- **Counted over every match.** The chart comes from CORE's aggregate endpoint, not from the
  papers on screen. If that request fails it falls back to the loaded papers and says so.
- **Four views from one request.** Year, document type, publisher and author. Switching is
  instant and costs nothing against the rate limit.
- **Click-through.** Clicking a year's bar, or a document type, publisher or author (its name
  or its bar), lists those papers. Selections combine, show as removable chips, and the chart
  keeps showing the whole query for context.
- **Table views.** Every chart has a table alternative. For publishers and authors it adds
  citation context from the loaded papers.

## Plain English and suggestions

- **Plain-English search.** "Journal articles about graphene batteries published by Elsevier
  since 2019" becomes a boolean query with the right document type, publisher and years, written
  by Meta Llama 3.3 on Cloudflare Workers AI. The query appears in the Boolean box and the URL,
  so it can be read, edited and shared.
- **Contained output.** The Worker checks every model answer against the query grammar and
  discards anything else. Author names are cut back to the words the visitor wrote.
- **Related searches and "Did you mean".** After a search the model suggests up to three related
  searches; a search that finds nothing also gets a spelling correction. Nothing runs by itself.
- **An off switch.** Suggestions can be turned off beside the disclosure, for searches that are
  confidential. A Boolean search then goes to CORE and nowhere else.

## Citation metrics

- **On each card.** Where a paper has a DOI that OpenAlex knows: citation count, Field-Weighted
  Citation Impact, Relative Citation Ratio (PubMed papers), and the h-index of an author, the
  journal and the publisher. The figures come from [OpenAlex](https://openalex.org) and
  [NIH iCite](https://icite.od.nih.gov) through the Worker.
- **Sorting.** Loaded papers can be sorted by citations or FWCI, with an explanation of each
  figure one click away.

## Data quality

- **Cleaning at the boundary.** Abstracts lose HTML remnants and trailing links; author names
  lose internal ids, profile links and placeholders such as "null null"; a paper CORE lists
  twice is shown once.
- **Honest charts.** Papers "published" in the future are left out of the year chart with a
  visible count; publisher names CORE spells two ways are left apart and the chart says so.

## States and accessibility

- **Specific states.** Skeleton loading, an empty state with suggestions, and distinct messages
  for a visitor's rate limit, a busy demo, CORE's own limit, a bad query, a rejected key, a
  server error and being offline, each with the time to retry where one is known.
- **Accessibility.** Labelled controls, live regions for status changes, a text summary and
  table for every chart, keyboard-reachable selections, reduced-motion support, and automated
  accessibility scans in light and dark themes.
- **Light and dark theme.** Follows the device until a choice is made, then remembers it.
- **Phone layout.** The page is laid out for a 390-pixel screen as well as for a desktop.

## Deployment

- **The key stays on the server.** A Cloudflare Worker holds it as an encrypted secret and
  forwards only CORE's search and aggregate endpoints, with only the parameters the app uses.
- **Caching.** Successful answers are cached at the edge and in the browser, so the example
  queries and shared links do not spend the rate limit.
- **Limits.** Each visitor gets a number of new CORE requests and model calls a minute, counted
  exactly by a Durable Object, and all visitors together share a budget matched to the CORE key
  and to the model's free daily allowance.
- **A small first download.** Chart.js loads as its own file after the page appears.

## Tests and tooling

- **Unit tests** for the API client, data cleaning, the boolean parser, the CORE rewrite, the
  refine filter, the search store (cancellation, caching, paging, fallback), chart data and URL
  handling.
- **End-to-end tests** in a real browser against a mocked CORE: searching with the button and
  with Enter, the number of papers, invalid syntax, every drill-down, refine, load more, each
  limit message, shareable URLs, the chart switcher and its fallback, plain-English search,
  suggestions and their switch.
- **Worker tests** that run the real Worker in Cloudflare's runtime against a fake CORE and a
  fake model: the key goes to CORE and never to the browser, only the allowed endpoints and
  parameters are forwarded, repeats come from the cache, and each limit refuses at the right
  count.
- **Routing tests** of the production build and the Worker together under Wrangler.
- **CI** runs the format check, lint and all four suites on every push.
