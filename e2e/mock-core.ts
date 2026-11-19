import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AGGREGATE_RESPONSE, searchResponse } from './fixtures';

/** What the mock answers with. Defaults to 200 and a JSON body. */
export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface SearchCall {
  q: string;
  limit: number;
  offset: number;
}

export interface AggregateCall {
  q: string;
  aggregations: string[];
}

const SEARCH_PATH = '/core-api/v3/search/works/';
const AGGREGATE_PATH = '/core-api/v3/search/works/aggregate';

/**
 * Stands in for CORE. It answers the two endpoints the app uses, records every
 * call so tests can assert on what was sent, and notes any other request to
 * /core-api/ so the suite can never reach the real API by accident.
 */
export class MockCore {
  readonly searches: SearchCall[] = [];
  readonly aggregates: AggregateCall[] = [];
  readonly unexpected: string[] = [];

  private searchHandler: (call: SearchCall) => Reply = (call) => ({
    body: searchResponse(call.limit, call.offset),
  });
  private aggregateHandler: (call: AggregateCall) => Reply = () => ({ body: AGGREGATE_RESPONSE });

  /** Replaces the answer to searches, e.g. to return an error or a filtered page. */
  onSearch(handler: (call: SearchCall) => Reply): void {
    this.searchHandler = handler;
  }

  onAggregate(handler: (call: AggregateCall) => Reply): void {
    this.aggregateHandler = handler;
  }

  async install(page: Page): Promise<void> {
    await page.route('**/core-api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let reply: Reply;

      if (request.method() === 'GET' && url.pathname === SEARCH_PATH) {
        const call: SearchCall = {
          q: url.searchParams.get('q') ?? '',
          limit: Number(url.searchParams.get('limit')),
          offset: Number(url.searchParams.get('offset')),
        };
        this.searches.push(call);
        reply = this.searchHandler(call);
      } else if (request.method() === 'POST' && url.pathname === AGGREGATE_PATH) {
        const call = request.postDataJSON() as AggregateCall;
        this.aggregates.push(call);
        reply = this.aggregateHandler(call);
      } else {
        this.unexpected.push(`${request.method()} ${url.pathname}`);
        reply = { status: 404, body: { message: 'Not mocked' } };
      }

      await route.fulfill({
        status: reply.status ?? 200,
        headers: reply.headers,
        contentType: 'application/json',
        body: JSON.stringify(reply.body ?? {}),
      });
    });
  }
}

export interface AiCall {
  mode: string;
  text: string;
}

/**
 * Stands in for the app's plain-English endpoint (and so for the language
 * model behind it). Unless a test says otherwise it declines, which is the
 * quietest answer: no suggestion appears and no search is started.
 */
export class MockAi {
  readonly calls: AiCall[] = [];
  readonly unexpected: string[] = [];

  private handler: (call: AiCall) => Reply = () => ({ body: { ok: false, reason: 'unclear' } });

  onAsk(handler: (call: AiCall) => Reply): void {
    this.handler = handler;
  }

  async install(page: Page): Promise<void> {
    await page.route('**/ai/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let reply: Reply;

      if (request.method() === 'POST' && url.pathname === '/ai/query') {
        const call = request.postDataJSON() as AiCall;
        this.calls.push(call);
        reply = this.handler(call);
      } else {
        this.unexpected.push(`${request.method()} ${url.pathname}`);
        reply = { status: 404, body: { message: 'Not mocked' } };
      }

      await route.fulfill({
        status: reply.status ?? 200,
        headers: reply.headers,
        contentType: 'application/json',
        body: JSON.stringify(reply.body ?? {}),
      });
    });
  }
}

/**
 * `test` with `core` and `ai` fixtures: both are mocked before the page loads
 * anything, so no test can reach the real CORE or the real model.
 */
export const test = base.extend<{ core: MockCore; ai: MockAi }>({
  core: [
    async ({ page }, use) => {
      const core = new MockCore();
      await core.install(page);
      await use(core);
      expect(core.unexpected, 'requests to CORE that the mock does not cover').toEqual([]);
    },
    { auto: true },
  ],
  ai: [
    async ({ page }, use) => {
      const ai = new MockAi();
      await ai.install(page);
      await use(ai);
      expect(ai.unexpected, 'requests to /ai/ that the mock does not cover').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
