import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { YearSeries, recentPoints } from './year-series';

// Register only what a bar chart needs, rather than Chart.js's `registerables`,
// to keep the bundle small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/** Where the numbers come from: every matching paper, or just the loaded page. */
export type ChartSource = 'all' | 'loaded';

const RECENT_SPAN = 25;

@Component({
  selector: 'app-year-chart',
  imports: [DecimalPipe],
  templateUrl: './year-chart.html',
  styleUrl: './year-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class YearChart {
  /** Null until a search has produced data. */
  readonly series = input<YearSeries | null>(null);
  readonly source = input<ChartSource>('all');
  readonly loading = input(false);
  readonly currentYear = input(new Date().getFullYear());
  /** The year the result list is currently narrowed to, if any. */
  readonly selectedYear = input<number | null>(null);

  /** Emits the clicked year, or null when the selected year is clicked again. */
  readonly yearSelected = output<number | null>();

  protected readonly recentSpan = RECENT_SPAN;
  protected readonly showAll = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'bar', number[], string>;

  protected readonly allPoints = computed(() => this.series()?.points ?? []);
  protected readonly recent = computed(() =>
    recentPoints(this.allPoints(), RECENT_SPAN, this.currentYear()),
  );
  /** Offer the toggle only when the recent window actually hides something. */
  protected readonly canToggle = computed(
    () => this.recent().length > 0 && this.recent().length < this.allPoints().length,
  );
  protected readonly points = computed(() =>
    this.showAll() || !this.recent().length ? this.allPoints() : this.recent(),
  );
  protected readonly hasData = computed(() => this.points().length > 0);
  protected readonly shownTotal = computed(() =>
    this.points().reduce((sum, point) => sum + point.count, 0),
  );

  /** Text alternative for the canvas. */
  protected readonly summary = computed(() => {
    const points = this.points();
    if (!points.length) return 'No chart data.';
    const peak = points.reduce((best, point) => (point.count > best.count ? point : best));
    return (
      `Bar chart of papers per year from ${points[0].year} to ${points.at(-1)!.year}. ` +
      `Peak: ${peak.count.toLocaleString()} papers in ${peak.year}.`
    );
  });

  constructor() {
    effect(() => {
      const points = this.points();
      const selected = this.selectedYear();
      const labels = points.map((point) => String(point.year));
      const data = points.map((point) => point.count);

      if (!this.chart) {
        this.chart = this.createChart(this.canvas().nativeElement, labels, data);
      } else {
        // Update in place: cheaper than destroy/recreate and animates the change.
        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = data;
      }
      // With a year selected, the other bars fade so the selection stands out.
      this.chart.data.datasets[0].backgroundColor = points.map((point) =>
        selected === null || point.year === selected ? this.colors.accent : this.colors.faded,
      );
      this.chart.update();
    });

    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  /** Toggles the selection; also used by the table so it works from the keyboard. */
  protected select(year: number): void {
    this.yearSelected.emit(year === this.selectedYear() ? null : year);
  }

  private colors = { accent: '#2f5bea', faded: '#c3cff8' };

  private createChart(canvas: HTMLCanvasElement, labels: string[], data: number[]) {
    const styles = getComputedStyle(canvas);
    const muted = styles.getPropertyValue('--text-muted').trim() || '#5b6475';
    const grid = styles.getPropertyValue('--border').trim() || '#e1e5ec';
    this.colors = {
      accent: styles.getPropertyValue('--accent').trim() || this.colors.accent,
      faded: styles.getPropertyValue('--accent-faded').trim() || this.colors.faded,
    };

    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, borderRadius: 3, maxBarThickness: 48 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_event, elements) => {
          const point = elements.length ? this.points()[elements[0].index] : undefined;
          if (point) this.select(point.year);
        },
        onHover: (event, elements) => {
          const target = event.native?.target as HTMLElement | undefined;
          if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        plugins: {
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (item) => {
                const count = item.parsed.y ?? 0;
                return `${count.toLocaleString()} ${count === 1 ? 'paper' : 'papers'}`;
              },
              footer: (items) =>
                Number(items[0]?.label) === this.selectedYear()
                  ? 'Click to show all years'
                  : 'Click to list papers from this year',
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true } },
          y: {
            beginAtZero: true,
            grid: { color: grid },
            ticks: { color: muted, precision: 0 },
          },
        },
      },
    });
  }
}
