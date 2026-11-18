import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { ApiError, toApiError } from '../core-api/api-error';
import { CoreApi, SearchPage } from '../core-api/core-api';
import { Paper } from '../core-api/paper';

export interface SearchRequest {
  query: string;
  limit: number;
}

export type SearchStatus = 'idle' | 'loading' | 'loaded' | 'error';

type Outcome = { ok: true; page: SearchPage } | { ok: false; error: ApiError };

/** How many distinct searches to remember; CORE's rate limit makes repeats costly. */
const CACHE_SIZE = 20;

/**
 * Holds the state of the current search as signals.
 *
 * Requests flow through one RxJS stream with `switchMap`, so starting a new
 * search cancels the previous HTTP call: a slow, stale response can never
 * overwrite newer results.
 */
@Injectable()
export class SearchStore {
  private readonly api = inject(CoreApi);
  private readonly requests = new Subject<SearchRequest>();
  /** Insertion-ordered, so the first key is always the oldest entry. */
  private readonly cache = new Map<string, SearchPage>();

  private readonly _request = signal<SearchRequest | null>(null);
  private readonly _status = signal<SearchStatus>('idle');
  private readonly _papers = signal<Paper[]>([]);
  private readonly _totalHits = signal(0);
  private readonly _error = signal<ApiError | null>(null);

  /** The request currently shown or in flight; null until the first search. */
  readonly request = this._request.asReadonly();
  readonly status = this._status.asReadonly();
  readonly papers = this._papers.asReadonly();
  readonly totalHits = this._totalHits.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loading = computed(() => this._status() === 'loading');

  constructor() {
    this.requests
      .pipe(
        tap((request) => {
          this._request.set(request);
          this._status.set('loading');
          this._error.set(null);
        }),
        switchMap((request) => this.load(request)),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (outcome.ok) {
          this._papers.set(outcome.page.papers);
          this._totalHits.set(outcome.page.totalHits);
          this._status.set('loaded');
        } else {
          this._papers.set([]);
          this._totalHits.set(0);
          this._error.set(outcome.error);
          this._status.set('error');
        }
      });
  }

  search(query: string, limit: number): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    this.requests.next({ query: trimmed, limit });
  }

  /** Repeats the current request, e.g. after an error. */
  retry(): void {
    const request = this._request();
    if (request) this.requests.next(request);
  }

  private load(request: SearchRequest) {
    const key = `${request.limit}|${request.query}`;
    const cached = this.cache.get(key);
    if (cached) return of<Outcome>({ ok: true, page: cached });

    return this.api.search(request.query, request.limit).pipe(
      tap((page) => this.remember(key, page)),
      map((page): Outcome => ({ ok: true, page })),
      // Catch inside switchMap so one failure does not end the stream.
      catchError((error: unknown) => of<Outcome>({ ok: false, error: toApiError(error) })),
    );
  }

  private remember(key: string, page: SearchPage): void {
    this.cache.set(key, page);
    if (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
