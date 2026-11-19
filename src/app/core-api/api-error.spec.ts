import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { parseRetryAfter, toApiError } from './api-error';

describe('parseRetryAfter', () => {
  it("parses CORE's timestamp format", () => {
    expect(parseRetryAfter('2026-11-18T17:17:00+0000')?.toISOString()).toBe(
      '2026-11-18T17:17:00.000Z',
    );
  });

  it('returns null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('toApiError', () => {
  const http = (status: number, headers?: Record<string, string>) =>
    new HttpErrorResponse({ status, headers: new HttpHeaders(headers) });

  it.each([
    [429, 'rate-limit'],
    [0, 'network'],
    [400, 'bad-query'],
    [401, 'auth'],
    [403, 'auth'],
    [500, 'server'],
    [504, 'server'],
    [418, 'unknown'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(toApiError(http(status)).kind).toBe(kind);
  });

  it('carries the retry time on a rate limit', () => {
    const error = toApiError(http(429, { 'x-ratelimit-retry-after': '2026-11-18T17:17:00+0000' }));
    expect(error.retryAt?.toISOString()).toBe('2026-11-18T17:17:00.000Z');
  });

  it("tells the proxy's per-visitor limit apart from CORE's own", () => {
    const fromCore = toApiError(http(429));
    const fromProxy = toApiError(
      http(429, {
        'x-proxy-limit': 'visitor',
        'x-ratelimit-retry-after': '2026-11-18T17:17:00.000Z',
      }),
    );

    expect(fromCore.title).toBe('CORE rate limit reached');
    expect(fromProxy.kind).toBe('rate-limit');
    expect(fromProxy.title).toBe('Search limit reached');
    expect(fromProxy.retryAt?.toISOString()).toBe('2026-11-18T17:17:00.000Z');
  });

  it('reports a query CORE rejected as a bad query, even though CORE says 500', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 500,
        error: { message: 'Azure search failed with status code: 400. Error context: ...' },
      }),
    );
    expect(error.kind).toBe('bad-query');
  });

  it('handles non-HTTP failures', () => {
    expect(toApiError(new Error('boom')).kind).toBe('unknown');
  });
});
