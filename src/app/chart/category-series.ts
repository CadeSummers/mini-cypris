import { Paper } from '../core-api/paper';

/** The non-time fields the chart can break a result set down by. */
export const DIMENSIONS = ['documentType', 'publisher', 'authors'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface CategoryItem {
  label: string;
  count: number;
  /**
   * The exact value CORE holds, usable as a filter. Null when several raw
   * values were merged into this item, because no single filter matches them all.
   */
  value: string | null;
}

export interface CategorySeries {
  /** Largest first, at most `top` entries. */
  items: CategoryItem[];
  /** Distinct usable values before trimming to `top`. */
  distinct: number;
}

/** How many bars a ranked chart shows. */
export const TOP_CATEGORIES = 10;

/** Placeholders some repositories store where a real value is missing. */
const JUNK = new Set(['', 'null', 'null null', 'unknown', 'n/a', 'none', '-']);

/**
 * Tidies one raw value from CORE. Returns '' for values that carry no
 * information, so the caller can drop them.
 */
export function cleanCategoryLabel(raw: string, dimension: Dimension): string {
  let label = raw.replace(/\s+/g, ' ').trim();
  if (dimension === 'authors') {
    // Same clean-up as paper cards: "K Anderson (7837271)" is K Anderson.
    label = label.replace(/\s*\(\d+\)$/, '').trim();
  }
  if (JUNK.has(label.toLowerCase())) return '';
  if (dimension === 'documentType') {
    label = label.charAt(0).toUpperCase() + label.slice(1);
  }
  return label;
}

/**
 * Turns raw value → count data into a ranked list for charting.
 *
 * Values that differ only in case or in an appended id are merged. Different
 * spellings of the same thing ("IEEE" and "Institute of Electrical and
 * Electronics Engineers (IEEE)") are left apart: guessing which names are
 * aliases would put invented numbers on screen.
 */
export function buildCategorySeries(
  counts: Record<string, number>,
  dimension: Dimension,
  top = TOP_CATEGORIES,
): CategorySeries {
  const merged = new Map<string, CategoryItem>();

  for (const [raw, count] of Object.entries(counts)) {
    if (!(count > 0)) continue;
    const label = cleanCategoryLabel(raw, dimension);
    if (!label) continue;

    const key = label.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
      existing.value = null;
    } else {
      merged.set(key, { label, count, value: raw });
    }
  }

  const items = [...merged.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
  return { items: items.slice(0, top), distinct: items.length };
}

/** Counts loaded papers by a dimension; the fallback when CORE's totals are unavailable. */
export function countByDimension(papers: Paper[], dimension: Dimension): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (value: string | null) => {
    if (value) counts[value] = (counts[value] ?? 0) + 1;
  };

  for (const paper of papers) {
    if (dimension === 'authors') {
      paper.authors.forEach(add);
    } else {
      add(paper[dimension]);
    }
  }
  return counts;
}
