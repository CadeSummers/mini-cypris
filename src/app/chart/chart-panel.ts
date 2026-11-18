import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CategorySeries, Dimension } from './category-series';
import { RankedChart } from './ranked-chart';
import { ChartSource, YearChart } from './year-chart';
import { YearSeries } from './year-series';

/** What the chart area is currently showing. */
export type ChartView = 'year' | Dimension;

interface ViewOption {
  view: ChartView;
  /** Text on the switcher button. */
  tab: string;
}

interface RankedText {
  heading: string;
  noun: string;
  caveat: string;
}

const VIEWS: ViewOption[] = [
  { view: 'year', tab: 'Year' },
  { view: 'documentType', tab: 'Document type' },
  { view: 'publisher', tab: 'Publisher' },
  { view: 'authors', tab: 'Author' },
];

const RANKED_TEXT: Record<Dimension, RankedText> = {
  documentType: {
    heading: 'Top document types',
    noun: 'document types',
    caveat: '',
  },
  publisher: {
    heading: 'Top publishers',
    noun: 'publishers',
    caveat:
      'Publisher names are shown as CORE records them, so one publisher can appear under more than one name.',
  },
  authors: {
    heading: 'Top authors',
    noun: 'authors',
    caveat:
      'Author names are shown as CORE records them, so one person can appear under more than one spelling.',
  },
};

/**
 * The chart area: a switcher over the same result set, viewed by year or by
 * the most common document types, publishers or authors.
 */
@Component({
  selector: 'app-chart-panel',
  imports: [YearChart, RankedChart],
  templateUrl: './chart-panel.html',
  styleUrl: './chart-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartPanel {
  readonly yearSeries = input<YearSeries | null>(null);
  readonly breakdowns = input<Record<Dimension, CategorySeries> | null>(null);
  readonly source = input<ChartSource>('all');
  readonly loading = input(false);
  readonly selectedYear = input<number | null>(null);

  readonly yearSelected = output<number | null>();

  protected readonly views = VIEWS;
  protected readonly view = signal<ChartView>('year');

  /** The dimension on show, or null while the year chart is. */
  protected readonly dimension = computed<Dimension | null>(() => {
    const view = this.view();
    return view === 'year' ? null : view;
  });
  protected readonly rankedText = computed(() => {
    const dimension = this.dimension();
    return dimension ? RANKED_TEXT[dimension] : null;
  });
  protected readonly rankedSeries = computed(() => {
    const dimension = this.dimension();
    return dimension ? (this.breakdowns()?.[dimension] ?? null) : null;
  });
}
