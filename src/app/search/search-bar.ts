import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { findLowercaseOperator, findQueryIssue } from './boolean-query';

export const EXAMPLE_QUERIES = [
  '(drone AND (package OR delivery))',
  '"climate change" AND NOT policy',
  'title:"machine learning" AND yearPublished>=2020',
];

@Component({
  selector: 'app-search-bar',
  templateUrl: './search-bar.html',
  styleUrl: './search-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBar {
  /** The query currently applied; the draft resets to it when it changes. */
  readonly query = input('');
  readonly busy = input(false);

  readonly search = output<string>();

  protected readonly examples = EXAMPLE_QUERIES;
  protected readonly draft = linkedSignal(() => this.query());
  /** Syntax problems are only shown as errors once the user tries to submit. */
  protected readonly attempted = signal(false);

  protected readonly issue = computed(() =>
    this.draft().trim() ? findQueryIssue(this.draft()) : null,
  );
  protected readonly lowercaseOperator = computed(() => findLowercaseOperator(this.draft()));
  protected readonly showIssue = computed(() => this.attempted() && this.issue() !== null);

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    const text = this.draft().trim();
    if (!text) return;

    this.attempted.set(true);
    if (this.issue()) return;

    this.attempted.set(false);
    this.search.emit(text);
  }

  protected useExample(example: string): void {
    this.draft.set(example);
    this.submit();
  }
}
