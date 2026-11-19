import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { concat, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { AiLimitNotice } from '../ai/ai-limit-notice';
import { AiOutcome, AiQuery } from '../ai/ai-query';
import { normalizeForCore } from './query-fixes';

/** The related searches for one query; null outcome while waiting for the model. */
interface Related {
  query: string;
  outcome: AiOutcome | null;
}

/**
 * Queries the user might want next, written by the model and offered as
 * buttons. Nothing here runs a search by itself.
 *
 * This component is shown only once a search has settled, so the model is
 * asked after the papers are on screen and can never hold them up.
 *
 * - Related searches are requested for every query.
 * - "Did you mean" is requested as well when the search found no papers or
 *   failed: that is when a spelling mistake is likely.
 *
 * Both depend on the query alone. Choosing a year or a document type, or
 * loading more papers, asks nothing new.
 */
@Component({
  selector: 'app-suggestions',
  imports: [AiLimitNotice],
  templateUrl: './suggestions.html',
  styleUrl: './suggestions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Suggestions {
  private readonly ai = inject(AiQuery);

  /** The query the results on screen belong to. */
  readonly query = input.required<string>();
  /** True when that query, with no chart filter applied, found no papers. */
  readonly noResults = input(false);
  /** True when the search ended in an error CORE gave for this query. */
  readonly failed = input(false);

  /** A suggested query the user clicked. */
  readonly picked = output<string>();

  /** True when there are no papers to show, so other searches are the main thing to offer. */
  protected readonly empty = computed(() => this.noResults() || this.failed());

  /** The query to ask a spelling correction for, or '' when none is wanted. */
  private readonly toCorrect = computed(() => (this.empty() ? this.query() : ''));

  protected readonly correction = toSignal(
    toObservable(this.toCorrect).pipe(
      distinctUntilChanged(),
      switchMap((query) =>
        query
          ? this.ai
              .ask('correct', normalizeForCore(query))
              .pipe(map((outcome) => (outcome.kind === 'queries' ? outcome.queries[0] : null)))
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** Raised by "Try again", to ask once more for the query on screen. */
  private readonly attempt = signal(0);
  private readonly toRelate = computed(() => ({ query: this.query(), attempt: this.attempt() }));

  private readonly relatedState = toSignal(
    toObservable(this.toRelate).pipe(
      distinctUntilChanged((a, b) => a.query === b.query && a.attempt === b.attempt),
      // switchMap drops an answer that arrives after the user has moved to another query.
      switchMap(({ query }) =>
        concat(
          of<Related>({ query, outcome: null }),
          this.ai
            .ask('related', normalizeForCore(query))
            .pipe(map((outcome): Related => ({ query, outcome }))),
        ),
      ),
    ),
    { initialValue: null },
  );

  /** Related searches, but only those that belong to the query now on screen. */
  protected readonly related = computed(() => {
    const state = this.relatedState();
    return state && state.query === this.query() ? state : null;
  });

  protected retry(): void {
    this.attempt.update((count) => count + 1);
  }
}
