import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PaperCard } from './paper-card';
import { DEFAULT_LIMIT, SearchBar } from './search-bar';
import { SearchRequest, SearchStore } from './search-store';

@Component({
  selector: 'app-search-page',
  imports: [DatePipe, DecimalPipe, PaperCard, SearchBar],
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

  protected onSearch(request: SearchRequest): void {
    this.store.search(request.query, request.limit);
  }
}
