import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PaperCard } from './paper-card';
import { DEFAULT_LIMIT, SearchBar } from './search-bar';
import { SearchRequest, SearchStore } from './search-store';

@Component({
  selector: 'app-search-page',
  imports: [DecimalPipe, PaperCard, SearchBar],
  providers: [SearchStore],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  protected readonly store = inject(SearchStore);
  protected readonly defaultLimit = DEFAULT_LIMIT;

  protected onSearch(request: SearchRequest): void {
    this.store.search(request.query, request.limit);
  }
}
