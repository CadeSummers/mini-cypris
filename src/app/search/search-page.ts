import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PaperCard } from './paper-card';
import { SearchStore } from './search-store';

@Component({
  selector: 'app-search-page',
  imports: [DecimalPipe, PaperCard],
  providers: [SearchStore],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPage {
  protected readonly store = inject(SearchStore);

  constructor() {
    // Fixed demo query until the search bar arrives in the next step.
    this.store.search('drone', 10);
  }
}
