import { toPaper } from '../core-api/paper';
import { buildCategorySeries, cleanCategoryLabel, countByDimension } from './category-series';

describe('cleanCategoryLabel', () => {
  it('drops placeholder values', () => {
    expect(cleanCategoryLabel('null null', 'authors')).toBe('');
    expect(cleanCategoryLabel('  ', 'publisher')).toBe('');
    expect(cleanCategoryLabel('Unknown', 'documentType')).toBe('');
  });

  it('strips repository ids from author names only', () => {
    expect(cleanCategoryLabel('K Anderson (7837271)', 'authors')).toBe('K Anderson');
    expect(cleanCategoryLabel('Press (2019)', 'publisher')).toBe('Press (2019)');
  });

  it('capitalises document types', () => {
    expect(cleanCategoryLabel('research article', 'documentType')).toBe('Research article');
  });
});

describe('buildCategorySeries', () => {
  it('ranks values largest first and keeps the top N', () => {
    const series = buildCategorySeries({ a: 1, b: 5, c: 3, d: 4 }, 'publisher', 3);

    expect(series.items).toEqual([
      { label: 'b', count: 5, value: 'b' },
      { label: 'd', count: 4, value: 'd' },
      { label: 'c', count: 3, value: 'c' },
    ]);
    expect(series.distinct).toBe(4);
  });

  it('merges values that differ only by case or an appended id', () => {
    const series = buildCategorySeries(
      { 'K Anderson (7837271)': 114, 'K Anderson': 6, 'k anderson': 1, 'null null': 327 },
      'authors',
    );

    // Three raw values were merged, so no single CORE filter would match the bar.
    expect(series.items).toEqual([{ label: 'K Anderson', count: 121, value: null }]);
  });

  it("keeps CORE's exact value beside the tidied label, for filtering", () => {
    const series = buildCategorySeries({ thesis: 30, ' Research ': 10 }, 'documentType');

    expect(series.items).toEqual([
      { label: 'Thesis', count: 30, value: 'thesis' },
      { label: 'Research', count: 10, value: ' Research ' },
    ]);
  });

  it('does not guess that different spellings are the same publisher', () => {
    const series = buildCategorySeries(
      { IEEE: 1622, 'Institute of Electrical and Electronics Engineers (IEEE)': 1610 },
      'publisher',
    );

    expect(series.items.length).toBe(2);
  });

  it('ignores zero and invalid counts, and breaks ties by name', () => {
    const series = buildCategorySeries(
      { zeta: 2, alpha: 2, none: 0, bad: Number.NaN },
      'publisher',
    );

    expect(series.items.map((item) => item.label)).toEqual(['alpha', 'zeta']);
  });

  it('is empty for no data', () => {
    expect(buildCategorySeries({}, 'documentType')).toEqual({ items: [], distinct: 0 });
  });
});

describe('countByDimension', () => {
  const papers = [
    toPaper({ id: 1, publisher: 'IEEE', documentType: 'thesis', authors: [{ name: 'A' }] }),
    toPaper({ id: 2, publisher: 'IEEE', authors: [{ name: 'A' }, { name: 'B' }] }),
    toPaper({ id: 3, publisher: '', documentType: 'thesis' }),
  ];

  it('counts single-valued fields, skipping papers without one', () => {
    expect(countByDimension(papers, 'publisher')).toEqual({ IEEE: 2 });
    expect(countByDimension(papers, 'documentType')).toEqual({ thesis: 2 });
  });

  it('counts every author of every paper', () => {
    expect(countByDimension(papers, 'authors')).toEqual({ A: 2, B: 1 });
  });
});
