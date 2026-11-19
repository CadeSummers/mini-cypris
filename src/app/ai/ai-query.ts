import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { parseRetryAfter } from '../core-api/api-error';
import { parseQuery } from '../search/boolean-query';

/**
 * What the model is asked for. Every mode returns CORE queries and nothing else:
 * - translate: a plain-English request becomes one query;
 * - correct: a query that found nothing gets its spelling fixed;
 * - related: a query gets up to three follow-up queries.
 */
export type AiMode = 'translate' | 'correct' | 'related';

export type AiRefusal = 'not_a_search' | 'unclear';

export type AiOutcome =
  | { kind: 'queries'; queries: string[] }
  /** The model would not, or could not, write a query. */
  | { kind: 'refused'; reason: AiRefusal }
  /** This visitor has asked too often; see the Worker's per-visitor limit. */
  | { kind: 'limited'; retryAt: Date | null }
  /** The model, or the day's free allowance, is not available. */
  | { kind: 'unavailable' };

/** Longest text the endpoint accepts (worker/ai-query.js enforces the same). */
export const MAX_AI_TEXT = 300;

interface AiResponse {
  ok?: boolean;
  queries?: unknown;
  reason?: unknown;
}

/**
 * Asks the app's own endpoint (worker/ai-query.js) to write CORE queries. The
 * Worker checks everything the model says; this service checks once more with
 * the app's own parser, so a query that reaches the page is always one the
 * search box would accept.
 */
@Injectable({ providedIn: 'root' })
export class AiQuery {
  private readonly http = inject(HttpClient);

  ask(mode: AiMode, text: string): Observable<AiOutcome> {
    return this.http.post<AiResponse>('/ai/query', { mode, text }).pipe(
      map((response): AiOutcome => {
        const queries = (Array.isArray(response.queries) ? response.queries : []).filter(
          (query): query is string => typeof query === 'string' && parseQuery(query).ok,
        );
        if (response.ok === true && queries.length) return { kind: 'queries', queries };
        return {
          kind: 'refused',
          reason: response.reason === 'not_a_search' ? 'not_a_search' : 'unclear',
        };
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 429) {
          const retryAt = parseRetryAfter(error.headers.get('x-ratelimit-retry-after'));
          return of<AiOutcome>({ kind: 'limited', retryAt });
        }
        return of<AiOutcome>({ kind: 'unavailable' });
      }),
    );
  }
}
