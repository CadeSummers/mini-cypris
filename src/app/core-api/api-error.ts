import { HttpErrorResponse } from '@angular/common/http';

export type ApiErrorKind = 'rate-limit' | 'bad-query' | 'auth' | 'server' | 'network' | 'unknown';

/** A failure described in terms the user can act on. */
export interface ApiError {
  kind: ApiErrorKind;
  title: string;
  detail: string;
  /** For rate limits: when CORE says requests will be accepted again. */
  retryAt: Date | null;
}

/** CORE sends e.g. "2026-11-18T17:17:00+0000"; add the colon strict parsers expect. */
export function parseRetryAfter(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toApiError(error: unknown): ApiError {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      kind: 'unknown',
      title: 'Something went wrong',
      detail: 'An unexpected error occurred. Please try again.',
      retryAt: null,
    };
  }

  const { status } = error;

  if (status === 429) {
    // The deployed proxy caps each visitor separately from CORE's own limit.
    if (error.headers.get('x-proxy-limit') === 'visitor') {
      return {
        kind: 'rate-limit',
        title: 'Search limit reached',
        detail:
          'This demo shares one CORE allowance among all visitors, so each visitor gets a ' +
          'limited number of new searches per minute. Searches you have already run are ' +
          'remembered and do not count.',
        retryAt: parseRetryAfter(error.headers.get('x-ratelimit-retry-after')),
      };
    }
    // All visitors of the demo together have used the minute's allowance.
    if (error.headers.get('x-proxy-limit') === 'shared') {
      return {
        kind: 'rate-limit',
        title: 'The demo is busy',
        detail:
          'This demo shares one CORE allowance among all visitors, and other visitors are ' +
          'using it right now. Searches you have already run are remembered and still work.',
        retryAt: parseRetryAfter(error.headers.get('x-ratelimit-retry-after')),
      };
    }
    return {
      kind: 'rate-limit',
      title: 'CORE rate limit reached',
      detail:
        'CORE limits how many searches can be made per minute. ' +
        'Adding an API key (see the README) raises the limit.',
      retryAt: parseRetryAfter(error.headers.get('x-ratelimit-retry-after')),
    };
  }
  if (status === 0) {
    return {
      kind: 'network',
      title: 'Cannot reach CORE',
      detail: 'Check your internet connection and that the dev server proxy is running.',
      retryAt: null,
    };
  }
  // CORE reports a query its search backend rejected as a server error, with
  // the backend's own status in the message. Retrying never helps, so say so.
  const message = (error.error as { message?: unknown } | null)?.message;
  const rejected = status >= 500 && typeof message === 'string' && /status code: 400/.test(message);
  if (status === 400 || status === 422 || rejected) {
    return {
      kind: 'bad-query',
      title: 'No papers found',
      detail:
        'CORE could not understand this query, so it returned an error instead of a list of ' +
        'papers. Check field names and operators, or try one of the similar searches below.',
      retryAt: null,
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      title: 'CORE rejected the API key',
      detail: 'Check CORE_API_KEY in your .env file, or remove it to search anonymously.',
      retryAt: null,
    };
  }
  if (status >= 500) {
    return {
      kind: 'server',
      title: 'No papers found',
      detail:
        `CORE answered with an error (${status}) instead of a list of papers. That usually ` +
        'means it could not process this query, and is sometimes temporary. Try again, ' +
        'simplify the query, or try one of the similar searches below.',
      retryAt: null,
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    detail: `CORE returned an unexpected response (${status}).`,
    retryAt: null,
  };
}
