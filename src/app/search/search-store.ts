import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, map, of, switchMap, tap } from 'rxjs';
import { CoreApi, SearchPage } from '../core-api/core-api';
import { Paper } from '../core-api/paper';

export interface SearchRequest {
  query: string;
  limit: number;
}

export type SearchStatus = 'idle' | 'loading' | 'loaded' | 'error';

type Outcome = { ok: true; page: SearchPage } | { ok: false; error: unknown };

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

  private readonly _request = signal<SearchRequest | null>(null);
  private readonly _status = signal<SearchStatus>('idle');
  private readonly _papers = signal<Paper[]>([]);
  private readonly _totalHits = signal(0);
  private readonly _errorMessage = signal<string | null>(null);

  /** The request currently shown or in flight; null until the first search. */
  readonly request = this._request.asReadonly();
  readonly status = this._status.asReadonly();
  readonly papers = this._papers.asReadonly();
  readonly totalHits = this._totalHits.asReadonly();
  readonly errorMessage = this._errorMessage.asReadonly();
  readonly loading = computed(() => this._status() === 'loading');

  constructor() {
    this.requests
      .pipe(
        tap((request) => {
          this._request.set(request);
          this._status.set('loading');
          this._errorMessage.set(null);
        }),
        switchMap((request) =>
          this.api.search(request.query, request.limit).pipe(
            map((page): Outcome => ({ ok: true, page })),
            // Catch inside switchMap so one failure does not end the stream.
            catchError((error: unknown) => of<Outcome>({ ok: false, error })),
          ),
        ),
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
          this._errorMessage.set('Something went wrong talking to CORE. Please try again.');
          this._status.set('error');
        }
      });
  }

  search(query: string, limit: number): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    this.requests.next({ query: trimmed, limit });
  }
}
