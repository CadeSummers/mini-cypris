import { DatePipe } from '@angular/common';
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
import { distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { AiOutcome, AiQuery } from '../ai/ai-query';
import { normalizeForCore } from './query-fixes';

/** The answer to "suggest related searches" for one query; null outcome while waiting. */
interface Related {
  query: string;
  outcome: AiOutcome | null;
}

/**
 * Queries the user might want next, written by the model and offered as
 * buttons. Nothing here runs a search by itself.
 *
 * - "Did you mean" is requested automatically, but only when a search found
 *   no papers: that is when a spelling mistake is likely, and it keeps
 *   ordinary searches away from the model.
 * - Related searches are requested only when the user asks for them.
 */
@Component({
  selector: 'app-suggestions',
  imports: [DatePipe],
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

  /** A suggested query the user clicked. */
  readonly picked = output<string>();

  /** The query to ask a spelling correction for, or '' when none is wanted. */
  private readonly toCorrect = computed(() => (this.noResults() ? this.query() : ''));

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

  private readonly relatedState = signal<Related | null>(null);
  /** Related searches, but only if they were asked for the query now on screen. */
  protected readonly related = computed(() => {
    const state = this.relatedState();
    return state && state.query === this.query() ? state : null;
  });

  protected suggestRelated(): void {
    const query = this.query();
    this.relatedState.set({ query, outcome: null });
    this.ai.ask('related', normalizeForCore(query)).subscribe((outcome) => {
      // Ignore an answer that arrives after the user has moved to another query.
      if (this.relatedState()?.query === query) this.relatedState.set({ query, outcome });
    });
  }
}
