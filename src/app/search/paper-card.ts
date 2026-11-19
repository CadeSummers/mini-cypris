import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Paper } from '../core-api/paper';
import { PaperMetrics } from '../metrics/paper-metrics';
import { HighlightTerms, NO_HIGHLIGHT, highlightSegments } from './highlight';

const MAX_AUTHORS = 3;
/** Abstracts longer than this get a "Show more" toggle. */
const LONG_ABSTRACT = 320;

/** One number in the metrics row, with what it means for the tooltip. */
interface MetricItem {
  label: string;
  value: string;
  meaning: string;
}

const whole = new Intl.NumberFormat('en-US');

@Component({
  selector: 'app-paper-card',
  templateUrl: './paper-card.html',
  styleUrl: './paper-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperCard {
  readonly paper = input.required<Paper>();
  /** Query words to mark in the title and abstract. */
  readonly highlight = input<HighlightTerms>(NO_HIGHLIGHT);

  /** Citation context from OpenAlex and NIH iCite; null when the paper has none. */
  readonly metrics = input<PaperMetrics | null>(null);

  protected readonly expanded = signal(false);

  /** The metrics that exist for this paper, in a fixed order. */
  protected readonly metricItems = computed<MetricItem[]>(() => {
    const metrics = this.metrics();
    if (!metrics) return [];
    const items: MetricItem[] = [];

    if (metrics.citations !== null) {
      items.push({
        label: 'Citations',
        value: whole.format(metrics.citations),
        meaning: 'Times this paper has been cited, as counted by OpenAlex.',
      });
    }
    if (metrics.fwci !== null) {
      const place =
        metrics.percentile === null ? '' : ` This paper is at percentile ${metrics.percentile}.`;
      items.push({
        label: 'FWCI',
        value: metrics.fwci.toFixed(2),
        meaning:
          'Field-Weighted Citation Impact: citations compared with papers of the same field, ' +
          `year and type. 1.00 is the average.${place}`,
      });
    }
    if (metrics.rcr !== null) {
      items.push({
        label: 'RCR',
        value: metrics.rcr.toFixed(2),
        meaning:
          'Relative Citation Ratio, from the NIH: citations per year compared with ' +
          'NIH-funded papers in the same field. 1.00 is the median. PubMed papers only.',
      });
    }
    if (metrics.author) {
      items.push({
        label: 'Author h-index',
        value: `${metrics.author.hIndex} (${metrics.author.name})`,
        meaning:
          'The highest h-index amongst the authors listed. An h-index of 20 means 20 ' +
          'papers cited at least 20 times each.',
      });
    }
    if (metrics.journal) {
      items.push({
        label: 'Journal h-index',
        value: whole.format(metrics.journal.hIndex),
        meaning: `h-index of ${metrics.journal.name}, across everything it has published.`,
      });
    }
    if (metrics.publisher) {
      items.push({
        label: 'Publisher h-index',
        value: whole.format(metrics.publisher.hIndex),
        meaning: `h-index of ${metrics.publisher.name}, across all its journals.`,
      });
    }
    return items;
  });

  protected readonly authors = computed(() => {
    const names = this.paper().authors;
    if (!names.length) return 'Unknown authors';
    return names.length > MAX_AUTHORS
      ? `${names.slice(0, MAX_AUTHORS).join('; ')} et al.`
      : names.join('; ');
  });

  protected readonly titleSegments = computed(() =>
    highlightSegments(this.paper().title, this.highlight().title),
  );
  protected readonly abstractSegments = computed(() =>
    highlightSegments(this.paper().abstract, this.highlight().abstract),
  );

  protected readonly isLong = computed(() => this.paper().abstract.length > LONG_ABSTRACT);

  protected toggle(): void {
    this.expanded.update((value) => !value);
  }
}
