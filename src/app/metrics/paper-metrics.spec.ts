import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Paper } from '../core-api/paper';
import { PaperMetrics, PaperMetricsStore, sortPapers, toPaperMetrics } from './paper-metrics';

function paper(id: string, doi: string | null): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    abstract: '',
    year: 2024,
    doi,
    url: '',
    pdfUrl: null,
    publisher: null,
    documentType: null,
    citationCount: null,
  };
}

function metrics(values: Partial<PaperMetrics>): PaperMetrics {
  return {
    citations: null,
    fwci: null,
    percentile: null,
    rcr: null,
    author: null,
    journal: null,
    publisher: null,
    ...values,
  };
}

describe('toPaperMetrics', () => {
  it('keeps numbers and named h-indexes, and nothing else', () => {
    expect(
      toPaperMetrics({
        citations: 136,
        fwci: 12.41,
        percentile: 99,
        rcr: 'high',
        author: { name: 'X. Li', hIndex: 37 },
        journal: { name: '', hIndex: 103 },
        publisher: { name: 'MDPI' },
        extra: 'ignored',
      }),
    ).toEqual(
      metrics({
        citations: 136,
        fwci: 12.41,
        percentile: 99,
        author: { name: 'X. Li', hIndex: 37 },
      }),
    );
  });

  it('treats an answer with no usable value as no metrics', () => {
    expect(toPaperMetrics(null)).toBeNull();
    expect(toPaperMetrics('nothing')).toBeNull();
    expect(toPaperMetrics({ citations: null, fwci: 'n/a' })).toBeNull();
  });
});

describe('sortPapers', () => {
  const a = paper('a', '10.1/a');
  const b = paper('b', '10.1/b');
  const c = paper('c', null);
  const d = paper('d', '10.1/d');
  const known = new Map<string, PaperMetrics>([
    ['a', metrics({ citations: 5, fwci: 3 })],
    ['b', metrics({ citations: 50 })],
    ['d', metrics({ citations: 5, fwci: 0.4 })],
  ]);
  const lookup = (item: Paper) => known.get(item.id) ?? null;
  const ids = (papers: Paper[]) => papers.map((item) => item.id).join('');

  it("leaves CORE's order alone for relevance", () => {
    expect(ids(sortPapers([a, b, c, d], 'relevance', lookup))).toBe('abcd');
  });

  it('puts the most cited first, ties in their original order, papers without data last', () => {
    expect(ids(sortPapers([c, a, b, d], 'citations', lookup))).toBe('badc');
  });

  it('sorts by FWCI, treating a paper without one as having no data', () => {
    expect(ids(sortPapers([b, c, d, a], 'fwci', lookup))).toBe('adbc');
  });

  it('does not change the list it was given', () => {
    const papers = [a, b];
    sortPapers(papers, 'citations', lookup);
    expect(ids(papers)).toBe('ab');
  });
});

describe('PaperMetricsStore', () => {
  let store: PaperMetricsStore;
  let http: HttpTestingController;

  const first = paper('1', '10.1000/First');
  const second = paper('2', '10.1000/second');
  const noDoi = paper('3', null);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(PaperMetricsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for the DOIs of the papers given, in lower case, and skips papers without one', () => {
    store.ensure([first, noDoi, second]);

    const request = http.expectOne('/metrics');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ dois: ['10.1000/first', '10.1000/second'] });

    request.flush({ metrics: { '10.1000/first': { citations: 136, fwci: 12.41 } } });
    expect(store.for(first)).toEqual(metrics({ citations: 136, fwci: 12.41 }));
    expect(store.for(second)).toBeNull();
    expect(store.for(noDoi)).toBeNull();
    expect(store.unavailable()).toBe(false);
  });

  it('asks nothing when no paper has a DOI', () => {
    store.ensure([noDoi]);
    http.expectNone('/metrics');
  });

  it('asks only about DOIs it has not asked about before', () => {
    store.ensure([first]);
    http.expectOne('/metrics').flush({ metrics: { '10.1000/first': { citations: 1 } } });

    // The same paper again, a second request while the first is on its way,
    // and "Load more" adding one new paper.
    store.ensure([first]);
    store.ensure([first, second]);
    store.ensure([first, second]);

    const request = http.expectOne('/metrics');
    expect(request.request.body).toEqual({ dois: ['10.1000/second'] });
    request.flush({ metrics: {} });
  });

  it('splits a long list into requests of at most 100 DOIs', () => {
    const many = Array.from({ length: 130 }, (_, index) => paper(`p${index}`, `10.1000/p${index}`));
    store.ensure(many);

    const requests = http.match('/metrics');
    expect(
      requests.map((request) => (request.request.body as { dois: string[] }).dois.length),
    ).toEqual([100, 30]);
    for (const request of requests) request.flush({ metrics: {} });
  });

  it('reports a failure, keeps what it already knows, and tries again next time', () => {
    store.ensure([first]);
    http.expectOne('/metrics').flush({ metrics: { '10.1000/first': { citations: 1 } } });

    store.ensure([second]);
    http.expectOne('/metrics').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(store.unavailable()).toBe(true);
    expect(store.for(first)).toEqual(metrics({ citations: 1 }));

    store.ensure([first, second]);
    const retry = http.expectOne('/metrics');
    expect(retry.request.body).toEqual({ dois: ['10.1000/second'] });
    retry.flush({ metrics: { '10.1000/second': { citations: 2 } } });
    expect(store.unavailable()).toBe(false);
    expect(store.for(second)).toEqual(metrics({ citations: 2 }));
  });
});
