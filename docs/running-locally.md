# Running Mini-Cypris locally

You do not need any of this to try the app: the
[live demo](https://mini-cypris.cadetsummers.workers.dev) is the same code. This page is for
running it from a clone, running the tests, or deploying your own copy.

## Requirements

- Node.js 22.18 or later on the 22 line, or 24 and later. Angular alone would accept less, but
  Wrangler and the routing tests do not; `package.json` states this in `engines`.
- A free CORE API key from <https://core.ac.uk/services/api>.

## Start the app

```bash
git clone https://github.com/CadeSummers/mini-cypris.git
cd mini-cypris
npm install
cp .env.example .env    # then paste your key after CORE_API_KEY=
npm start
```

Open <http://localhost:4200> and try `(drone AND (package OR delivery))`. The terminal prints
whether the key was picked up.

`.env` is git-ignored. The dev-server proxy (`proxy.conf.mjs`) reads the key and adds it to
requests on the server side, so it never reaches the browser bundle.

**Without a key** the app still starts, but CORE's anonymous allowance is too small to search
with: most requests are refused with a rate-limit error. The app handles that as it handles any
rate limit, by saying so and showing when CORE will accept searches again.

**What `npm start` talks to.** Paper searches go straight to CORE with your key. Plain-English
search, suggestions and citation metrics run on a Cloudflare Worker, so under `npm start` the
paths `/ai` and `/metrics` go to the deployed demo and count against its limits. To send them
somewhere else, set `WORKER_ORIGIN` before starting, for example
`WORKER_ORIGIN=http://localhost:8787` with `npm run preview` running in another terminal. If the
Worker cannot be reached those features say so and the rest of the app works.

## Commands

| Command                     | What it does                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| `npm start`                 | Dev server with the CORE proxy, on port 4200                      |
| `npm test`                  | Unit tests (Vitest) in watch mode                                 |
| `npm test -- --watch=false` | Unit tests, once                                                  |
| `npm run e2e`               | End-to-end tests (Playwright) against a mocked CORE               |
| `npm run test:worker`       | The Worker's tests in a local copy of Cloudflare's runtime        |
| `npm run e2e:worker`        | Builds, then tests the app and the Worker together under Wrangler |
| `npm run lint`              | ESLint with the Angular rules                                     |
| `npm run format:check`      | Prettier, check only                                              |
| `npm run build`             | Production build into `dist/`                                     |
| `npm run preview`           | Builds, then serves the app and the Worker locally with Wrangler  |
| `npm run deploy`            | Builds, then deploys to Cloudflare                                |

The browser tests need Chromium the first time: `npx playwright install chromium`. They start
the dev server themselves and need no API key, because every CORE request is mocked.

`npm run preview` needs a Cloudflare login for the language model; the rest of the Worker runs
without one.

## Deploying your own copy (Cloudflare Workers)

`wrangler.jsonc` serves the built app as static files and runs `worker/core-proxy.js` for the
three API paths.

```bash
npx wrangler login                     # once; opens the browser
npm run deploy                         # creates the Worker
npx wrangler secret put CORE_API_KEY   # stored encrypted; never in the repository
```

Optional settings:

- `OPENALEX_API_KEY` (secret): a free key from <https://openalex.org/settings/api>. Without it
  the deployed site usually cannot fetch citation metrics, because OpenAlex's keyless allowance
  is shared by IP address; it then says they are unavailable and everything else works.
- `CORE_SHARED_LIMIT` (variable, default 10): CORE requests a minute for all visitors together.
  Raise it if your CORE key allows more.
- `AI_DAILY_LIMIT` (variable, default 250): model calls per 24 hours for all visitors together.
  The default sits just under Cloudflare's free allowance.

The Worker forwards only CORE's work search and aggregate endpoints, with only the parameters
the app uses, so the public URL cannot be used as a general proxy for the key.

## Project layout

```
src/app/
  core-api/     CORE client, raw response types, the clean Paper model, error mapping
  search/       search page, search bar, paper card, search store, boolean parser, the CORE
                query rewrite, refine filter, highlighting, plain-English box, suggestions
  chart/        year chart, ranked top-ten chart, the switcher, and the functions behind them
  ai/           client for /ai/query, the limit notice, the suggestions on/off setting
  metrics/      citation metrics for the loaded papers, and sorting by them
  theme/        the light or dark palette choice
proxy.conf.mjs  dev-server proxy: adds the CORE key, forwards /ai and /metrics to a Worker
worker/         the Cloudflare Worker (CORE proxy, limits, /ai, /metrics) and its tests
wrangler.jsonc  Cloudflare build output and routing settings
e2e/            Playwright end-to-end tests and the mocked CORE they run against
e2e-worker/     browser tests of the built app and the Worker together, and their fake CORE
```
