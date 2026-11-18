import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { YearChart } from '../chart/year-chart';
import { parseQuery } from './boolean-query';
import { PaperCard } from './paper-card';
import { filterPapers } from './paper-matcher';
import { DEFAULT_LIMIT, SearchBar } from './search-bar';
import { SearchRequest, SearchStore } from './search-store';

@Component({
  selector: 'app-search-page',
  imports: [DatePipe, DecimalPipe, PaperCard, SearchBar, YearChart],
  providers: [SearchStore],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  protected readonly store = inject(SearchStore);
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

  /** While the filter is incomplete or invalid, keep showing everything. */
  protected readonly visiblePapers = computed(() => {
    const refine = this.refine();
    const papers = this.store.papers();
    return refine?.ok ? filterPapers(papers, refine.ast) : papers;
  });

  protected onSearch(request: SearchRequest): void {
    this.store.search(request.query, request.limit);
  }

  protected onRefineInput(event: Event): void {
    this.refineText.set((event.target as HTMLInputElement).value);
  }
}
