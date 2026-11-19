import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CategoryMetrics, MetricDimension } from './category-metrics';
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
  /** Heading of the name column in the table. */
  column: string;
  caveat: string;
  /** Added to the caption to say what picking a bar does. */
  hint: string;
  /** Start of each name button's accessible name. */
  pickLabel: string;
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
    column: 'Document type',
    caveat: '',
    hint: 'Click a type to list its papers.',
    pickLabel: 'List papers of type',
  },
  publisher: {
    heading: 'Top publishers',
    noun: 'publishers',
    column: 'Publisher',
    // CORE's publisher filter matches the words of a name, not the exact name, so
    // a click can list more papers than the bar counts. The page says so.
    caveat:
      'Publisher names are shown as CORE records them, so one publisher can appear under more ' +
      'than one name. Clicking one can also list papers CORE files under a similar name.',
    hint: 'Click a publisher to list its papers.',
    pickLabel: 'List papers from publisher',
  },
  authors: {
    heading: 'Top authors',
    noun: 'authors',
    column: 'Author',
    caveat:
      'Author names are shown as CORE records them, so one person can appear under more than one spelling.',
    hint: 'Click an author to list their papers.',
    pickLabel: 'List papers by',
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
  readonly selectedType = input<string | null>(null);
  readonly selectedPublisher = input<string | null>(null);
  readonly selectedAuthor = input<string | null>(null);
  /** Citation context for the publisher and author tables, from the loaded papers. */
  readonly categoryMetrics = input<Record<
    MetricDimension,
    ReadonlyMap<string, CategoryMetrics>
  > | null>(null);

  readonly yearSelected = output<number | null>();
  readonly typeSelected = output<string | null>();
  readonly publisherSelected = output<string | null>();
  readonly authorSelected = output<string | null>();

  protected readonly views = VIEWS;
  protected readonly view = signal<ChartView>('year');

  /** The dimension on show, or null while the year chart is. */
  protected readonly dimension = computed<Dimension | null>(() => {
    const view = this.view();
    return view === 'year' ? null : view;
  });
  /** Picking needs CORE's own counts: the fallback counts are of loaded papers only. */
  protected readonly canPick = computed(() => this.dimension() !== null && this.source() === 'all');

  /** The value picked in the dimension on show, if any. */
  protected readonly selected = computed(() => {
    switch (this.dimension()) {
      case 'documentType':
        return this.selectedType();
      case 'publisher':
        return this.selectedPublisher();
      case 'authors':
        return this.selectedAuthor();
      default:
        return null;
    }
  });

  protected onPicked(value: string | null): void {
    switch (this.dimension()) {
      case 'documentType':
        return this.typeSelected.emit(value);
      case 'publisher':
        return this.publisherSelected.emit(value);
      case 'authors':
        return this.authorSelected.emit(value);
    }
  }

  protected readonly rankedText = computed(() => {
    const dimension = this.dimension();
    return dimension ? RANKED_TEXT[dimension] : null;
  });
  protected readonly rankedSeries = computed(() => {
    const dimension = this.dimension();
    return dimension ? (this.breakdowns()?.[dimension] ?? null) : null;
  });

  /** Only publishers and authors have citation context; document types do not. */
  protected readonly rankedMetrics = computed(() => {
    const dimension = this.dimension();
    return dimension && dimension !== 'documentType'
      ? (this.categoryMetrics()?.[dimension] ?? null)
      : null;
  });
}
