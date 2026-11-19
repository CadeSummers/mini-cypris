import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { buildCategoryMetrics } from '../chart/category-metrics';
import { cleanCategoryLabel } from '../chart/category-series';
import { ChartPanel } from '../chart/chart-panel';
import { PaperMetricsStore, PaperSort, sortPapers } from '../metrics/paper-metrics';
import { parseQuery } from './boolean-query';
import { PaperCard } from './paper-card';
import { PlainEnglishBar } from './plain-english-bar';
import { collectHighlightTerms } from './highlight';
import { filterPapers } from './paper-matcher';
import { DEFAULT_LIMIT, SearchBar, clampLimit } from './search-bar';
import { SearchRequest, SearchStore, hasFilter } from './search-store';
import { Suggestions } from './suggestions';

/** A document type from the URL is put inside a quoted filter, so keep it to plain words. */
const SAFE_TYPE = /^[\w -]{1,40}$/;

/**
 * A publisher or author name from the URL is put inside a quoted filter too.
 * Names contain commas, brackets and accents, so the rule is what they may not
 * contain: a quote or backslash (which could end the phrase) or control characters.
 */
const SAFE_NAME = /^[^"\\\p{Cc}]{1,200}$/u;

function safeName(value: string | null): string | null {
  const name = (value ?? '').trim();
  return SAFE_NAME.test(name) ? name : null;
}

/**
 * Reads a search out of the URL (?q=…&limit=…&year=…&type=…&publisher=…&author=…);
 * null when there is no query.
 */
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
    publisher: safeName(params.get('publisher')),
    author: safeName(params.get('author')),
  };
}

/** The inverse of `requestFromParams`; defaults are left out to keep URLs short. */
export function paramsFromRequest(request: SearchRequest): Record<string, string | number | null> {
  return {
    q: request.query,
    limit: request.limit === DEFAULT_LIMIT ? null : request.limit,
    year: request.year ?? null,
    type: request.documentType ?? null,
    publisher: request.publisher ?? null,
    author: request.author ?? null,
  };
}

@Component({
  selector: 'app-search-page',
  imports: [DatePipe, DecimalPipe, PaperCard, PlainEnglishBar, SearchBar, ChartPanel, Suggestions],
  providers: [SearchStore],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  protected readonly store = inject(SearchStore);
  protected readonly metrics = inject(PaperMetricsStore);
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

  /** The selected publisher and author as the charts label them. */
  protected readonly publisherLabel = computed(() => {
    const publisher = this.store.request()?.publisher;
    return publisher ? cleanCategoryLabel(publisher, 'publisher') || publisher : null;
  });
  protected readonly authorLabel = computed(() => {
    const author = this.store.request()?.author;
    return author ? cleanCategoryLabel(author, 'authors') || author : null;
  });

  /** True when a chart selection is narrowing the list. */
  protected readonly filtered = computed(() => {
    const request = this.store.request();
    return request ? hasFilter(request) : false;
  });

  /**
   * True when the query itself found nothing. With a chart selection applied, an
   * empty list more likely means the selection is too narrow than a misspelling.
   */
  protected readonly noResults = computed(
    () => this.store.status() === 'loaded' && this.store.totalHits() === 0 && !this.filtered(),
  );

  /**
   * True while a new search is on its way and an earlier list is still held.
   * That list stays on screen, dimmed, so the page does not go blank in between.
   */
  protected readonly showingStale = computed(
    () => this.store.status() === 'loading' && this.store.papers().length > 0,
  );

  /**
   * True when CORE answered this query with an error instead of papers. Other
   * searches are worth offering then; they are not for a rate limit, a lost
   * connection or a rejected key, which no other query would get past.
   */
  protected readonly searchFailed = computed(() => {
    const kind = this.store.status() === 'error' ? this.store.error()?.kind : null;
    return kind === 'server' || kind === 'bad-query';
  });

  /** Words to mark on the cards: from the CORE query and, if valid, the refine box. */
  protected readonly highlight = computed(() => {
    const query = this.store.request()?.query;
    const search = query ? parseQuery(query) : null;
    const refine = this.refine();
    return collectHighlightTerms(search?.ok ? search.ast : null, refine?.ok ? refine.ast : null);
  });

  /** How the loaded papers are ordered; a new query goes back to CORE's own order. */
  protected readonly sortBy = linkedSignal<string | undefined, PaperSort>({
    source: () => this.store.request()?.query,
    computation: () => 'relevance',
  });

  /** How many of the loaded papers have citation metrics. */
  protected readonly withMetrics = computed(
    () => this.store.papers().filter((paper) => this.metrics.for(paper) !== null).length,
  );

  /** What the loaded papers say about each publisher and author, for the chart tables. */
  protected readonly categoryMetrics = computed(() => {
    const papers = this.store.papers();
    const metricsFor = (paper: (typeof papers)[number]) => this.metrics.for(paper);
    return {
      publisher: buildCategoryMetrics(papers, 'publisher', metricsFor),
      authors: buildCategoryMetrics(papers, 'authors', metricsFor),
    };
  });

  /**
   * The papers to list: filtered by the refine box (while it is incomplete or
   * invalid, everything is shown), then put in the chosen order.
   */
  protected readonly visiblePapers = computed(() => {
    const refine = this.refine();
    const papers = this.store.papers();
    const matching = refine?.ok ? filterPapers(papers, refine.ast) : papers;
    return sortPapers(matching, this.sortBy(), (paper) => this.metrics.for(paper));
  });

  constructor() {
    // Papers are shown as soon as CORE answers; their citation metrics are
    // asked for afterwards and fill in when they arrive.
    effect(() => this.metrics.ensure(this.store.papers()));

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
      publisher: same ? current.publisher : null,
      author: same ? current.author : null,
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

  protected onPublisherSelected(publisher: string | null): void {
    const current = this.store.request();
    if (current) this.navigate({ ...current, publisher });
  }

  protected onAuthorSelected(author: string | null): void {
    const current = this.store.request();
    if (current) this.navigate({ ...current, author });
  }

  protected onSortChange(event: Event): void {
    this.sortBy.set((event.target as HTMLSelectElement).value as PaperSort);
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
