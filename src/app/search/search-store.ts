import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { ApiError, toApiError } from '../core-api/api-error';
import { CoreApi, SearchPage } from '../core-api/core-api';
import { Paper } from '../core-api/paper';
import { ChartSource } from '../chart/year-chart';
import { YearSeries, buildYearSeries, countByYear } from '../chart/year-series';

export interface SearchRequest {
  query: string;
  limit: number;
}

export type SearchStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** `ready` holds CORE's counts; `unavailable` means the UI should fall back to loaded papers. */
type AggregateState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; query: string; counts: Record<string, number> };

export interface ChartData {
  series: YearSeries;
  source: ChartSource;
}

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
  private readonly aggregateRequests = new Subject<string>();
  private readonly aggregateCache = new Map<string, Record<string, number>>();
  private readonly currentYear = new Date().getFullYear();

  private readonly _request = signal<SearchRequest | null>(null);
  private readonly _status = signal<SearchStatus>('idle');
  private readonly _papers = signal<Paper[]>([]);
  private readonly _totalHits = signal(0);
  private readonly _error = signal<ApiError | null>(null);
  private readonly _aggregate = signal<AggregateState>({ status: 'idle' });

  /** The request currently shown or in flight; null until the first search. */
  readonly request = this._request.asReadonly();
  readonly status = this._status.asReadonly();
  readonly papers = this._papers.asReadonly();
  readonly totalHits = this._totalHits.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loading = computed(() => this._status() === 'loading');

  /**
   * Year distribution for the chart. Prefers CORE's aggregate over every
   * matching paper; if that request fails, falls back to counting the papers
   * on screen and says so through `source`.
   */
  readonly chart = computed<ChartData | null>(() => {
    const aggregate = this._aggregate();
    if (aggregate.status === 'ready') {
      return { series: buildYearSeries(aggregate.counts, this.currentYear), source: 'all' };
    }
    if (aggregate.status === 'unavailable' && this._status() === 'loaded') {
      return {
        series: buildYearSeries(countByYear(this._papers()), this.currentYear),
        source: 'loaded',
      };
    }
    return null;
  });

  readonly chartLoading = computed(
    () => this._aggregate().status === 'loading' || (this.loading() && !this.chart()),
  );

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

    this.aggregateRequests
      .pipe(
        tap(() => this._aggregate.set({ status: 'loading' })),
        switchMap((query) => {
          const cached = this.aggregateCache.get(query);
          if (cached) return of<AggregateState>({ status: 'ready', query, counts: cached });

          return this.api.aggregateYears(query).pipe(
            tap((counts) => this.aggregateCache.set(query, counts)),
            map((counts): AggregateState => ({ status: 'ready', query, counts })),
            // The chart is secondary: a failure here must not break the search.
            catchError(() => of<AggregateState>({ status: 'unavailable' })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this._aggregate.set(state));
  }

  search(query: string, limit: number): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    this.requests.next({ query: trimmed, limit });
    this.aggregate(trimmed);
  }

  /** Repeats the current request, e.g. after an error. */
  retry(): void {
    const request = this._request();
    if (!request) return;
    this.requests.next(request);
    this.aggregate(request.query);
  }

  /** The aggregate depends only on the query, so changing the limit does not refetch it. */
  private aggregate(query: string): void {
    const current = this._aggregate();
    if (current.status === 'ready' && current.query === query) return;
    this.aggregateRequests.next(query);
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
