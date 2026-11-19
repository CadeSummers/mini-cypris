import { Paper } from '../core-api/paper';
import { PaperMetrics } from '../metrics/paper-metrics';
import { buildCategoryMetrics, normalizeName } from './category-metrics';

function paper(id: string, fields: Partial<Paper> = {}): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    abstract: '',
    year: 2020,
    doi: null,
    url: '',
    pdfUrl: null,
    publisher: null,
    documentType: null,
    citationCount: null,
    ...fields,
  };
}

function metrics(fields: Partial<PaperMetrics>): PaperMetrics {
  return {
    citations: null,
    fwci: null,
    percentile: null,
    rcr: null,
    author: null,
    journal: null,
    publisher: null,
    ...fields,
  };
}

function lookup(byId: Record<string, PaperMetrics>) {
  return (item: Paper) => byId[item.id] ?? null;
}

describe('normalizeName', () => {
  it('reads "Last, First" and "First Last" as the same name', () => {
    expect(normalizeName('Li, Xueping')).toBe(normalizeName('Xueping Li'));
  });

  it('ignores case, accents, full stops and extra spaces', () => {
    expect(normalizeName('  J.  Müller ')).toBe('j muller');
  });
});

describe('buildCategoryMetrics', () => {
  it('adds up citations and counts loaded papers per publisher', () => {
    const papers = [
      paper('1', { publisher: 'MDPI AG' }),
      paper('2', { publisher: 'mdpi ag' }),
      paper('3', { publisher: 'Elsevier' }),
    ];
    const result = buildCategoryMetrics(
      papers,
      'publisher',
      lookup({
        '1': metrics({ citations: 136, publisher: { name: 'MDPI', hIndex: 893 } }),
        '2': metrics({ citations: 4 }),
      }),
    );

    expect(result.get('mdpi ag')).toEqual({ loaded: 2, citations: 140, hIndex: 893 });
    expect(result.get('elsevier')).toEqual({ loaded: 1, citations: null, hIndex: null });
  });

  it('keeps zero citations apart from no citation data', () => {
    const result = buildCategoryMetrics(
      [paper('1', { publisher: 'Elsevier' })],
      'publisher',
      lookup({ '1': metrics({ citations: 0 }) }),
    );

    expect(result.get('elsevier')?.citations).toBe(0);
  });

  it('gives the h-index only to the author the metrics name', () => {
    const papers = [paper('1', { authors: ['Li, Xueping', 'Zhang, Juan (7837271)'] })];
    const result = buildCategoryMetrics(
      papers,
      'authors',
      lookup({ '1': metrics({ citations: 136, author: { name: 'Xueping Li', hIndex: 37 } }) }),
    );

    expect(result.get('li, xueping')).toEqual({ loaded: 1, citations: 136, hIndex: 37 });
    expect(result.get('zhang, juan')).toEqual({ loaded: 1, citations: 136, hIndex: null });
  });

  it('counts a paper once for an author it lists twice', () => {
    const result = buildCategoryMetrics(
      [paper('1', { authors: ['K Anderson', 'K Anderson (7837271)'] })],
      'authors',
      lookup({ '1': metrics({ citations: 5 }) }),
    );

    expect(result.get('k anderson')).toEqual({ loaded: 1, citations: 5, hIndex: null });
  });

  it('skips papers with no usable name', () => {
    const result = buildCategoryMetrics(
      [paper('1', { publisher: 'unknown' }), paper('2')],
      'publisher',
      lookup({}),
    );

    expect(result.size).toBe(0);
  });
});
