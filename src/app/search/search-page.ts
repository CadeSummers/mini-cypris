import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PaperCard } from './paper-card';
import { SearchBar } from './search-bar';
import { SearchStore } from './search-store';

const DEFAULT_LIMIT = 10;

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

  protected onSearch(query: string): void {
    this.store.search(query, DEFAULT_LIMIT);
  }
}
