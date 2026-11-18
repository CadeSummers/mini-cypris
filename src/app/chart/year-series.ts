import { Paper } from '../core-api/paper';

export interface YearPoint {
  year: number;
  count: number;
}

export interface YearSeries {
  /** Ascending and continuous: years with no papers are present with a count of 0. */
  points: YearPoint[];
  /** Papers represented by `points`. */
  total: number;
  /** Papers dated after the current year, which can only be metadata errors. */
  futureDated: number;
}

/** Years before this are almost always bad metadata rather than real papers. */
const EARLIEST_PLAUSIBLE_YEAR = 1500;

/**
 * Turns raw year → count data into a clean series for charting.
 *
 * CORE aggregates metadata from thousands of repositories, and some of it is
 * wrong: a query can report papers "published" in 2093. Those are excluded
 * from the chart but counted, so the UI can say so instead of hiding it.
 */
export function buildYearSeries(counts: Record<string, number>, currentYear: number): YearSeries {
  const byYear = new Map<number, number>();
  let futureDated = 0;

  for (const [key, count] of Object.entries(counts)) {
    const year = Number(key);
    if (!Number.isInteger(year) || year < EARLIEST_PLAUSIBLE_YEAR || !(count > 0)) continue;
    if (year > currentYear) {
      futureDated += count;
    } else {
      byYear.set(year, (byYear.get(year) ?? 0) + count);
    }
  }

  if (!byYear.size) return { points: [], total: 0, futureDated };

  const years = [...byYear.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);

  const points: YearPoint[] = [];
  let total = 0;
  for (let year = first; year <= last; year++) {
    const count = byYear.get(year) ?? 0;
    points.push({ year, count });
    total += count;
  }

  return { points, total, futureDated };
}

/** Client-side aggregation, used when the API aggregate is unavailable. */
export function countByYear(papers: readonly Paper[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const paper of papers) {
    if (paper.year !== null) counts[paper.year] = (counts[paper.year] ?? 0) + 1;
  }
  return counts;
}

/** The points from the last `span` years up to and including `currentYear`. */
export function recentPoints(
  points: readonly YearPoint[],
  span: number,
  currentYear: number,
): YearPoint[] {
  return points.filter((point) => point.year > currentYear - span);
}
