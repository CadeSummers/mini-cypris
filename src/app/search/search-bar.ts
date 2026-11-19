import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { MAX_PAGE_SIZE } from '../core-api/core-api';
import { findQueryIssue } from './boolean-query';
import { findQueryTip } from './query-fixes';
import { SearchRequest } from './search-store';

export const EXAMPLE_QUERIES = [
  '(drone AND (package OR delivery))',
  '"climate change" AND NOT policy',
  'title:"machine learning" AND yearPublished>=2020',
];

export const DEFAULT_LIMIT = 10;

/** Coerces user input to a whole number CORE accepts, or `fallback` if it is not a number. */
export function clampLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
}

@Component({
  selector: 'app-search-bar',
  templateUrl: './search-bar.html',
  styleUrl: './search-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBar {
  /** The query and limit currently applied; the drafts reset to them when they change. */
  readonly query = input('');
  readonly limit = input(DEFAULT_LIMIT);
  readonly busy = input(false);

  readonly search = output<SearchRequest>();

  protected readonly examples = EXAMPLE_QUERIES;
  protected readonly maxLimit = MAX_PAGE_SIZE;
  protected readonly draft = linkedSignal(() => this.query());
  protected readonly limitDraft = linkedSignal(() => this.limit());
  /** Syntax problems are only shown as errors once the user tries to submit. */
  protected readonly attempted = signal(false);

  protected readonly issue = computed(() =>
    this.draft().trim() ? findQueryIssue(this.draft()) : null,
  );
  protected readonly tip = computed(() => findQueryTip(this.draft()));
  protected readonly showIssue = computed(() => this.attempted() && this.issue() !== null);

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  /**
   * Fires on commit (blur, Enter, spinner click) rather than per keystroke,
   * so typing "25" costs one request instead of two against CORE's rate limit.
   */
  protected onLimitChange(event: Event): void {
    const element = event.target as HTMLInputElement;
    const limit = clampLimit(element.value, this.limitDraft());
    // Write back so an out-of-range entry visibly snaps to the allowed value.
    element.value = String(limit);

    if (limit === this.limitDraft()) return;
    this.limitDraft.set(limit);
    // Re-run only when a search is already on screen for this exact query.
    if (this.query() && this.draft().trim() === this.query()) this.submit();
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    const query = this.draft().trim();
    if (!query) return;

    this.attempted.set(true);
    if (this.issue()) return;

    this.attempted.set(false);
    this.search.emit({ query, limit: this.limitDraft() });
  }

  protected applyTip(fixed: string): void {
    this.draft.set(fixed);
  }

  protected useExample(example: string): void {
    this.draft.set(example);
    this.submit();
  }
}
