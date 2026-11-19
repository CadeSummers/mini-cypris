import { Paper } from '../core-api/paper';
import { PaperMetrics } from '../metrics/paper-metrics';
import { cleanCategoryLabel } from './category-series';

/** The ranked charts whose table carries citation context. */
export type MetricDimension = 'publisher' | 'authors';

/** What the loaded papers say about one publisher or author. */
export interface CategoryMetrics {
  /** Loaded papers under this name. */
  loaded: number;
  /** Citations of those papers added up; null when none of them has a count. */
  citations: number | null;
  /** The publisher's or author's h-index; null when no loaded paper supplies it. */
  hIndex: number | null;
}

/** The key a chart row and its metrics share: the cleaned label, without regard to case. */
export function categoryKey(label: string): string {
  return label.toLowerCase();
}

/**
 * A person's name in one comparable form, so CORE's "Li, Xueping" and
 * OpenAlex's "Xueping Li" are recognised as the same author.
 */
export function normalizeName(name: string): string {
  const [last, ...rest] = name.split(',');
  const ordered = rest.length ? `${rest.join(' ')} ${last}` : name;
  return ordered
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Citation context per publisher or author, taken from the loaded papers only.
 *
 * The chart's own counts cover every matching paper, but citation metrics
 * exist only for the papers on screen, so a name that none of them carries
 * has no entry here.
 *
 * A publisher's h-index is the one OpenAlex gives for a paper CORE files under
 * that publisher. An author's h-index is known only for the one author per
 * paper that the metrics name, and only when the names match.
 */
export function buildCategoryMetrics(
  papers: readonly Paper[],
  dimension: MetricDimension,
  metricsFor: (paper: Paper) => PaperMetrics | null,
): Map<string, CategoryMetrics> {
  const result = new Map<string, CategoryMetrics>();

  for (const paper of papers) {
    const metrics = metricsFor(paper);
    const raw = dimension === 'authors' ? paper.authors : [paper.publisher ?? ''];
    const keys = new Map<string, string>();
    for (const value of raw) {
      const label = cleanCategoryLabel(value, dimension);
      if (label) keys.set(categoryKey(label), label);
    }

    for (const [key, label] of keys) {
      const entry = result.get(key) ?? { loaded: 0, citations: null, hIndex: null };
      entry.loaded += 1;

      const citations = metrics?.citations ?? null;
      if (citations !== null) entry.citations = (entry.citations ?? 0) + citations;

      const named =
        dimension === 'publisher'
          ? (metrics?.publisher ?? null)
          : metrics?.author && normalizeName(metrics.author.name) === normalizeName(label)
            ? metrics.author
            : null;
      if (named) entry.hIndex = Math.max(entry.hIndex ?? 0, named.hIndex);

      result.set(key, entry);
    }
  }
  return result;
}
