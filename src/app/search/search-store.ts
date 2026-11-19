import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, exhaustMap, map, merge, of, switchMap, takeUntil, tap } from 'rxjs';
import {
  CategorySeries,
  DIMENSIONS,
  Dimension,
  buildCategorySeries,
  countByDimension,
} from '../chart/category-series';
import { ChartSource } from '../chart/year-chart';
import { YearSeries, buildYearSeries, countByYear } from '../chart/year-series';
import { ApiError, toApiError } from '../core-api/api-error';
import { normalizeForCore } from './query-fixes';
import { Aggregations, CoreApi, SearchPage } from '../core-api/core-api';
import { Paper } from '../core-api/paper';

export interface SearchRequest {
  query: string;
  limit: number;
  /** Optional drill-down to one publication year, chosen from the chart. */
  year?: number | null;
  /** Optional drill-down to one document type, as CORE spells it (e.g. "thesis"). */
  documentType?: string | null;
}

export type SearchStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** `ready` holds CORE's counts; `unavailable` means the UI should fall back to loaded papers. */
type AggregateState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; query: string; counts: Aggregations };

export interface ChartData {
  series: YearSeries;
  source: ChartSource;
}

/** The same result set ranked by each non-time field. */
export type Breakdowns = Record<Dimension, CategorySeries>;

type Outcome = { ok: true; page: SearchPage } | { ok: false; error: ApiError };

/** How many distinct searches to remember; CORE's rate limit makes repeats costly. */
const CACHE_SIZE = 20;

/** CORE does not page beyond this many results without its scroll API. */
const MAX_OFFSET = 10_000;

/** The query actually sent to CORE: the user's query, narrowed by any chart selections. */
export function toCoreQuery(request: SearchRequest): string {
  const filters: string[] = [];
  if (request.year) filters.push(`yearPublished:${request.year}`);
  if (request.documentType) filters.push(`documentType:"${request.documentType}"`);
  const query = normalizeForCore(request.query);
  return filters.length ? [`(${query})`, ...filters].join(' AND ') : query;
}

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
  private readonly moreRequests = new Subject<void>();
  private readonly aggregateRequests = new Subject<string>();
  /** Emits when the store is reset, so in-flight responses are dropped. */
  private readonly cancel = new Subject<void>();
  /** Insertion-ordered, so the first key is always the oldest entry. */
  private readonly cache = new Map<string, SearchPage>();
  private readonly aggregateCache = new Map<string, Aggregations>();
  private readonly currentYear = new Date().getFullYear();

  private readonly _request = signal<SearchRequest | null>(null);
  private readonly _status = signal<SearchStatus>('idle');
  private readonly _papers = signal<Paper[]>([]);
  private readonly _totalHits = signal(0);
  private readonly _error = signal<ApiError | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _moreError = signal<ApiError | null>(null);
  private readonly _aggregate = signal<AggregateState>({ status: 'idle' });

  /** The request currently shown or in flight; null until the first search. */
  readonly request = this._request.asReadonly();
  readonly status = this._status.asReadonly();
  readonly papers = this._papers.asReadonly();
  readonly totalHits = this._totalHits.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loading = computed(() => this._status() === 'loading');

  readonly loadingMore = this._loadingMore.asReadonly();
  /** A failed "load more" keeps the papers already on screen and reports here. */
  readonly moreError = this._moreError.asReadonly();
  readonly canLoadMore = computed(() => {
    const loaded = this._papers().length;
    return this._status() === 'loaded' && loaded < Math.min(this._totalHits(), MAX_OFFSET);
  });

  /**
   * Year distribution for the chart. Prefers CORE's aggregate over every
   * matching paper; if that request fails, falls back to counting the papers
   * on screen and says so through `source`.
   */
  readonly chart = computed<ChartData | null>(() => {
    const aggregate = this._aggregate();
    if (aggregate.status === 'ready') {
      return {
        series: buildYearSeries(aggregate.counts.yearPublished, this.currentYear),
        source: 'all',
      };
    }
    if (aggregate.status === 'unavailable' && this._status() === 'loaded') {
      return {
        series: buildYearSeries(countByYear(this._papers()), this.currentYear),
        source: 'loaded',
      };
    }
    return null;
  });

  /**
   * Top document types, publishers and authors. Same source rules as `chart`:
   * CORE's counts over every match, or the loaded papers as a fallback.
   */
  readonly breakdowns = computed<Breakdowns | null>(() => {
    const aggregate = this._aggregate();
    const counts = (dimension: Dimension): Record<string, number> | null => {
      if (aggregate.status === 'ready') return aggregate.counts[dimension];
      if (aggregate.status === 'unavailable' && this._status() === 'loaded') {
        return countByDimension(this._papers(), dimension);
      }
      return null;
    };

    const entries = DIMENSIONS.map((dimension) => {
      const raw = counts(dimension);
      return raw ? ([dimension, buildCategorySeries(raw, dimension)] as const) : null;
    });
    return entries.every((entry) => entry !== null)
      ? (Object.fromEntries(entries) as Breakdowns)
      : null;
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
          this._moreError.set(null);
          this._loadingMore.set(false);
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

    this.moreRequests
      .pipe(
        // exhaustMap ignores extra clicks while a page is already on its way.
        exhaustMap(() => {
          const request = this._request();
          if (!request || !this.canLoadMore()) return of(null);

          this._loadingMore.set(true);
          this._moreError.set(null);
          return this.api.search(toCoreQuery(request), request.limit, this._papers().length).pipe(
            map((page): Outcome => ({ ok: true, page })),
            catchError((error: unknown) => of<Outcome>({ ok: false, error: toApiError(error) })),
            // A new search (or a reset) makes this page irrelevant: drop it.
            takeUntil(merge(this.requests, this.cancel)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((outcome) => {
        if (!outcome) return;
        this._loadingMore.set(false);
        if (outcome.ok) {
          this.append(outcome.page.papers);
        } else {
          this._moreError.set(outcome.error);
        }
      });

    this.aggregateRequests
      .pipe(
        tap(() => this._aggregate.set({ status: 'loading' })),
        switchMap((query) => {
          const cached = this.aggregateCache.get(query);
          if (cached) return of<AggregateState>({ status: 'ready', query, counts: cached });

          return this.api.aggregate(normalizeForCore(query)).pipe(
            tap((counts) => this.aggregateCache.set(query, counts)),
            map((counts): AggregateState => ({ status: 'ready', query, counts })),
            // The chart is secondary: a failure here must not break the search.
            catchError(() => of<AggregateState>({ status: 'unavailable' })),
            takeUntil(this.cancel),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this._aggregate.set(state));
  }

  search(request: SearchRequest): void {
    const query = request.query.trim();
    if (!query) return;
    this.requests.next({
      query,
      limit: request.limit,
      year: request.year ?? null,
      documentType: request.documentType ?? null,
    });
    this.aggregate(query);
  }

  /** Repeats the current request, e.g. after an error. */
  retry(): void {
    const request = this._request();
    if (request) this.search(request);
  }

  /** Fetches the next page of the current search and appends it. */
  loadMore(): void {
    this.moreRequests.next();
  }

  /** Back to the initial, empty state, abandoning anything in flight. */
  reset(): void {
    this.cancel.next();
    this._request.set(null);
    this._status.set('idle');
    this._papers.set([]);
    this._totalHits.set(0);
    this._error.set(null);
    this._loadingMore.set(false);
    this._moreError.set(null);
    this._aggregate.set({ status: 'idle' });
  }

  /**
   * The aggregate depends only on the base query, so changing the limit or
   * drilling into a year or document type does not refetch it: the chart keeps showing the
   * whole picture while the list narrows.
   */
  private aggregate(query: string): void {
    const current = this._aggregate();
    if (current.status === 'ready' && current.query === query) return;
    this.aggregateRequests.next(query);
  }

  private load(request: SearchRequest) {
    const key = `${request.limit}|${request.year ?? ''}|${request.documentType ?? ''}|${request.query}`;
    const cached = this.cache.get(key);
    if (cached) return of<Outcome>({ ok: true, page: cached });

    return this.api.search(toCoreQuery(request), request.limit).pipe(
      tap((page) => this.remember(key, page)),
      map((page): Outcome => ({ ok: true, page })),
      // Catch inside switchMap so one failure does not end the stream.
      catchError((error: unknown) => of<Outcome>({ ok: false, error: toApiError(error) })),
      takeUntil(this.cancel),
    );
  }

  /** CORE can repeat a work across pages; keep the first occurrence of each id. */
  private append(papers: Paper[]): void {
    this._papers.update((current) => {
      const seen = new Set(current.map((paper) => paper.id));
      return [...current, ...papers.filter((paper) => !seen.has(paper.id))];
    });
  }

  private remember(key: string, page: SearchPage): void {
    this.cache.set(key, page);
    if (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
  }
}
