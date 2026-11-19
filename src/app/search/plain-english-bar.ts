import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiSuggestionsSetting } from '../ai/ai-suggestions-setting';
import { AiLimitNotice } from '../ai/ai-limit-notice';
import { AiOutcome, AiQuery, MAX_AI_TEXT } from '../ai/ai-query';

/** A question that was turned into a query, shown back so the user can see what was searched. */
interface Written {
  question: string;
  query: string;
}

/**
 * "Ask in plain English": sends the question to the model, and hands the query
 * it writes to the normal search. The query then appears in the Boolean box,
 * where it can be read and edited, so the model's work is never hidden.
 */
@Component({
  selector: 'app-plain-english-bar',
  imports: [AiLimitNotice],
  templateUrl: './plain-english-bar.html',
  styleUrl: './plain-english-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlainEnglishBar {
  private readonly ai = inject(AiQuery);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly suggestions = inject(AiSuggestionsSetting);

  /** True while a CORE search is running, so two requests are not started at once. */
  readonly busy = input(false);
  /** The query now applied; the note about a written query is shown only while it still is. */
  readonly currentQuery = input('');

  /** The query the model wrote. */
  readonly queryWritten = output<string>();

  protected readonly maxLength = MAX_AI_TEXT;
  protected readonly draft = signal('');
  protected readonly asking = signal(false);
  /** The last answer that was not a query: a refusal, a limit, or an outage. */
  protected readonly problem = signal<Exclude<AiOutcome, { kind: 'queries' }> | null>(null);
  protected readonly written = signal<Written | null>(null);

  protected onSuggestionsToggle(event: Event): void {
    this.suggestions.set((event.target as HTMLInputElement).checked);
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const question = this.draft().trim();
    if (!question || this.asking()) return;

    this.asking.set(true);
    this.problem.set(null);
    this.written.set(null);

    // The model can take seconds. If the visitor runs another search meanwhile,
    // that search is what they want: the answer is dropped, not applied over it.
    const queryWhenAsked = this.currentQuery();

    this.ai
      .ask('translate', question)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        this.asking.set(false);
        if (this.currentQuery() !== queryWhenAsked) return;
        if (outcome.kind === 'queries') {
          const query = outcome.queries[0];
          this.written.set({ question, query });
          this.queryWritten.emit(query);
        } else {
          this.problem.set(outcome);
        }
      });
  }
}
