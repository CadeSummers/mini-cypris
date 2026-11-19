import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { cleanCategoryLabel } from '../chart/category-series';
import { ChartPanel } from '../chart/chart-panel';
import { parseQuery } from './boolean-query';
import { PaperCard } from './paper-card';
import { PlainEnglishBar } from './plain-english-bar';
import { collectHighlightTerms } from './highlight';
import { filterPapers } from './paper-matcher';
import { DEFAULT_LIMIT, SearchBar, clampLimit } from './search-bar';
import { SearchRequest, SearchStore } from './search-store';

/** A document type from the URL is put inside a quoted filter, so keep it to plain words. */
const SAFE_TYPE = /^[\w -]{1,40}$/;

/** Reads a search out of the URL (?q=…&limit=…&year=…&type=…); null when there is no query. */
export function requestFromParams(params: ParamMap): SearchRequest | null {
  const query = (params.get('q') ?? '').trim();
  if (!query) return null;

  const year = params.get('year') ?? '';
  const type = (params.get('type') ?? '').trim();
  return {
    query,
    limit: clampLimit(params.get('limit')),
    year: /^\d{4}$/.test(year) ? Number(year) : null,
    documentType: SAFE_TYPE.test(type) ? type : null,
  };
}

/** The inverse of `requestFromParams`; defaults are left out to keep URLs short. */
export function paramsFromRequest(request: SearchRequest): Record<string, string | number | null> {
  return {
    q: request.query,
    limit: request.limit === DEFAULT_LIMIT ? null : request.limit,
    year: request.year ?? null,
    type: request.documentType ?? null,
  };
}

@Component({
  selector: 'app-search-page',
  imports: [DatePipe, DecimalPipe, PaperCard, PlainEnglishBar, SearchBar, ChartPanel],
  providers: [SearchStore],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  protected readonly store = inject(SearchStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly defaultLimit = DEFAULT_LIMIT;
  /** Placeholder cards shown while a search is in flight. */
  protected readonly skeletons = [0, 1, 2];

  /**
   * Boolean filter applied in the browser to the papers already loaded.
   * It is tied to the CORE query: a new query starts with no filter, while
   * changing only the number of papers keeps it.
   */
  protected readonly refineText = linkedSignal({
    source: () => this.store.request()?.query,
    computation: () => '',
  });

  private readonly refine = computed(() => {
    const text = this.refineText().trim();
    return text ? parseQuery(text) : null;
  });

  protected readonly refineIssue = computed(() => {
    const refine = this.refine();
    return refine && !refine.ok ? refine.issue.message : null;
  });

  /** True when a valid filter is narrowing the list. */
  protected readonly refining = computed(() => this.refine()?.ok === true);

  /** The selected document type as the chart labels it ("thesis" is shown as "Thesis"). */
  protected readonly typeLabel = computed(() => {
    const type = this.store.request()?.documentType;
    return type ? cleanCategoryLabel(type, 'documentType') || type : null;
  });

  /** Words to mark on the cards: from the CORE query and, if valid, the refine box. */
  protected readonly highlight = computed(() => {
    const query = this.store.request()?.query;
    const search = query ? parseQuery(query) : null;
    const refine = this.refine();
    return collectHighlightTerms(search?.ok ? search.ast : null, refine?.ok ? refine.ast : null);
  });

  /** While the filter is incomplete or invalid, keep showing everything. */
  protected readonly visiblePapers = computed(() => {
    const refine = this.refine();
    const papers = this.store.papers();
    return refine?.ok ? filterPapers(papers, refine.ast) : papers;
  });

  constructor() {
    // The URL is the source of truth for the search. User actions only change
    // the URL; this subscription turns each URL into a search. That makes
    // searches shareable and gives working back/forward buttons for free.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const request = requestFromParams(params);
      if (request) {
        this.store.search(request);
      } else {
        this.store.reset();
      }
    });
  }

  protected onSearch(request: SearchRequest): void {
    // Chart drill-downs belong to their query: keep them when only the number
    // of papers changes, drop them when the query itself changes.
    const current = this.store.request();
    const same = current && current.query === request.query;
    this.navigate({
      ...request,
      year: same ? current.year : null,
      documentType: same ? current.documentType : null,
    });
  }

  /** Runs a query the user did not type: one the model wrote or suggested. */
  protected onQueryPicked(query: string): void {
    this.onSearch({ query, limit: this.store.request()?.limit ?? DEFAULT_LIMIT });
  }

  protected onYearSelected(year: number | null): void {
    const current = this.store.request();
    if (current) this.navigate({ ...current, year });
  }

  protected onTypeSelected(documentType: string | null): void {
    const current = this.store.request();
    if (current) this.navigate({ ...current, documentType });
  }

  protected onRefineInput(event: Event): void {
    this.refineText.set((event.target as HTMLInputElement).value);
  }

  private navigate(request: SearchRequest): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: paramsFromRequest(request),
    });
  }
}
