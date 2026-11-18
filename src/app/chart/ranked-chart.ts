import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CategorySeries, TOP_CATEGORIES } from './category-series';
import { ChartSource } from './year-chart';

/**
 * A ranked list of horizontal bars: the most common values of one field.
 *
 * Plain HTML and CSS, not a canvas: the labels are long names that need to
 * wrap and be selectable, and a list is read correctly by screen readers
 * without a separate table alternative.
 */
@Component({
  selector: 'app-ranked-chart',
  imports: [DecimalPipe],
  templateUrl: './ranked-chart.html',
  styleUrl: './ranked-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RankedChart {
  /** Card heading, e.g. "Top publishers". */
  readonly heading = input.required<string>();
  /** Lower-case plural for sentences, e.g. "publishers". */
  readonly noun = input.required<string>();
  /** Null until a search has produced data. */
  readonly series = input<CategorySeries | null>(null);
  readonly source = input<ChartSource>('all');
  readonly loading = input(false);
  /** An honest caveat about this field's data quality, if there is one. */
  readonly caveat = input('');

  protected readonly top = TOP_CATEGORIES;
  protected readonly items = computed(() => this.series()?.items ?? []);
  protected readonly hasData = computed(() => this.items().length > 0);
  private readonly max = computed(() => Math.max(1, ...this.items().map((item) => item.count)));

  /** Bar length as a percentage of the largest bar, never invisibly small. */
  protected width(count: number): number {
    return Math.max(1, (count / this.max()) * 100);
  }
}
