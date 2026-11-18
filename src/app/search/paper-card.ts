import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Paper } from '../core-api/paper';

const MAX_AUTHORS = 3;
/** Abstracts longer than this get a "Show more" toggle. */
const LONG_ABSTRACT = 320;

@Component({
  selector: 'app-paper-card',
  templateUrl: './paper-card.html',
  styleUrl: './paper-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperCard {
  readonly paper = input.required<Paper>();

  protected readonly expanded = signal(false);

  protected readonly authors = computed(() => {
    const names = this.paper().authors;
    if (!names.length) return 'Unknown authors';
    return names.length > MAX_AUTHORS
      ? `${names.slice(0, MAX_AUTHORS).join('; ')} et al.`
      : names.join('; ');
  });

  protected readonly isLong = computed(() => this.paper().abstract.length > LONG_ABSTRACT);

  protected toggle(): void {
    this.expanded.update((value) => !value);
  }
}
