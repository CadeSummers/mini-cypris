import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SearchStore, toCoreQuery } from './search-store';

const isSearch = (r: { url: string }) => r.url === '/core-api/v3/search/works/';
const isAggregate = (r: { url: string }) => r.url === '/core-api/v3/search/works/aggregate';

const page = (ids: number[], totalHits = ids.length) => ({
  totalHits,
  limit: 10,
  offset: 0,
  results: ids.map((id) => ({ id, title: `Paper ${id}`, yearPublished: 2020 })),
});

describe('toCoreQuery', () => {
  it('passes the query through, or narrows it to a year', () => {
    expect(toCoreQuery({ query: 'a OR b', limit: 10 })).toBe('a OR b');
    expect(toCoreQuery({ query: 'a OR b', limit: 10, year: 2021 })).toBe(
      '(a OR b) AND yearPublished:2021',
    );
  });
});

describe('SearchStore', () => {
  let store: SearchStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SearchStore],
    });
    store = TestBed.inject(SearchStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Tests that are not about the chart leave its request pending.
    http.match(isAggregate);
    http.verify();
  });

  it('starts idle and ignores blank queries', () => {
    store.search({ query: '   ', limit: 10 });
    expect(store.status()).toBe('idle');
    http.expectNone(isSearch);
  });

  it('loads papers for a query', () => {
    store.search({ query: ' drone ', limit: 10 });
    expect(store.status()).toBe('loading');
    expect(store.request()).toEqual({ query: 'drone', limit: 10, year: null });

    http.expectOne(isSearch).flush(page([1, 2]));

    expect(store.status()).toBe('loaded');
    expect(store.totalHits()).toBe(2);
    expect(store.papers().length).toBe(2);
  });

  it('cancels the in-flight request when a newer search starts', () => {
    store.search({ query: 'first', limit: 10 });
    const first = http.expectOne(isSearch);

    store.search({ query: 'second', limit: 10 });
    expect(first.cancelled).toBe(true);

    http.expectOne(isSearch).flush(page([9]));

    expect(store.request()?.query).toBe('second');
    expect(store.papers().map((p) => p.id)).toEqual(['9']);
  });

  it('reports an error, clears old results and can retry', () => {
    store.search({ query: 'drone', limit: 10 });
    http.expectOne(isSearch).flush(page([1]));

    store.search({ query: 'broken', limit: 10 });
    http.expectOne(isSearch).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(store.status()).toBe('error');
    expect(store.papers()).toEqual([]);
    expect(store.totalHits()).toBe(0);
    expect(store.error()?.kind).toBe('server');

    store.retry();
    http.expectOne(isSearch).flush(page([3]));
    expect(store.status()).toBe('loaded');
    expect(store.request()?.query).toBe('broken');
    expect(store.error()).toBeNull();
  });

  it('serves a repeated search from the cache without a second request', () => {
    store.search({ query: 'drone', limit: 10 });
    http.expectOne(isSearch).flush(page([1]));

    store.search({ query: 'other', limit: 10 });
    http.expectOne(isSearch).flush(page([]));

    store.search({ query: 'drone', limit: 10 });
    http.expectNone(isSearch);
    expect(store.status()).toBe('loaded');
    expect(store.papers().map((p) => p.id)).toEqual(['1']);

    // A different limit is a different result set.
    store.search({ query: 'drone', limit: 20 });
    http.expectOne(isSearch).flush(page([1]));
  });

  it('narrows the search to a year without touching the base query', () => {
    store.search({ query: 'drone OR uav', limit: 10, year: 2021 });

    const req = http.expectOne(isSearch);
    expect(req.request.params.get('q')).toBe('(drone OR uav) AND yearPublished:2021');
    req.flush(page([1]));

    expect(store.request()).toEqual({ query: 'drone OR uav', limit: 10, year: 2021 });
  });

  it('returns to idle on reset and drops a late response', () => {
    store.search({ query: 'drone', limit: 10 });
    const pending = http.expectOne(isSearch);

    store.reset();
    expect(pending.cancelled).toBe(true);
    expect(store.status()).toBe('idle');
    expect(store.request()).toBeNull();
    expect(store.chart()).toBeNull();
  });

  describe('load more', () => {
    it('appends the next page, skipping duplicates', () => {
      store.search({ query: 'drone', limit: 2 });
      http.expectOne(isSearch).flush(page([1, 2], 5));
      expect(store.canLoadMore()).toBe(true);

      store.loadMore();
      expect(store.loadingMore()).toBe(true);
      store.loadMore(); // ignored while the first is in flight

      const req = http.expectOne(isSearch);
      expect(req.request.params.get('offset')).toBe('2');
      expect(req.request.params.get('limit')).toBe('2');
      req.flush(page([2, 3], 5));

      expect(store.loadingMore()).toBe(false);
      expect(store.papers().map((p) => p.id)).toEqual(['1', '2', '3']);
    });

    it('stops offering more once everything is loaded', () => {
      store.search({ query: 'drone', limit: 10 });
      http.expectOne(isSearch).flush(page([1, 2], 2));

      expect(store.canLoadMore()).toBe(false);
      store.loadMore();
      http.expectNone(isSearch);
    });

    it('keeps the loaded papers when the next page fails', () => {
      store.search({ query: 'drone', limit: 1 });
      http.expectOne(isSearch).flush(page([1], 5));

      store.loadMore();
      http.expectOne(isSearch).flush('slow down', { status: 429, statusText: 'Too Many' });

      expect(store.status()).toBe('loaded');
      expect(store.papers().length).toBe(1);
      expect(store.moreError()?.kind).toBe('rate-limit');
    });

    it('drops a pending page when a new search starts', () => {
      store.search({ query: 'drone', limit: 1 });
      http.expectOne(isSearch).flush(page([1], 5));

      store.loadMore();
      const more = http.expectOne(isSearch);

      store.search({ query: 'other', limit: 1 });
      expect(more.cancelled).toBe(true);
      http.expectOne(isSearch).flush(page([7], 1));

      expect(store.loadingMore()).toBe(false);
      expect(store.papers().map((p) => p.id)).toEqual(['7']);
    });
  });

  describe('chart data', () => {
    const years = (yearPublished: Record<string, number>) => ({ aggregations: { yearPublished } });

    it('uses CORE totals for every matching paper', () => {
      expect(store.chart()).toBeNull();

      store.search({ query: 'drone', limit: 10 });
      http.expectOne(isSearch).flush(page([1], 3));
      expect(store.chartLoading()).toBe(true);

      http.expectOne(isAggregate).flush(years({ '2020': 40, '2021': 60 }));

      expect(store.chartLoading()).toBe(false);
      expect(store.chart()?.source).toBe('all');
      expect(store.chart()?.series.total).toBe(100);
    });

    it('falls back to the loaded papers when the aggregate fails', () => {
      store.search({ query: 'drone', limit: 10 });
      http.expectOne(isSearch).flush(page([1], 3));
      http.expectOne(isAggregate).flush('boom', { status: 500, statusText: 'Server Error' });

      expect(store.status()).toBe('loaded');
      expect(store.chart()?.source).toBe('loaded');
      expect(store.chart()?.series.points).toEqual([{ year: 2020, count: 1 }]);
    });

    it('ranks document types, publishers and authors from the same aggregate', () => {
      expect(store.breakdowns()).toBeNull();

      store.search({ query: 'drone', limit: 10 });
      http.expectOne(isSearch).flush(page([1], 3));
      http.expectOne(isAggregate).flush({
        aggregations: {
          yearPublished: { '2020': 40 },
          documentType: { thesis: 30, 'research article': 10 },
          publisher: { IEEE: 25 },
          authors: { 'null null': 9, 'K Anderson (7837271)': 4 },
        },
      });

      const breakdowns = store.breakdowns();
      expect(breakdowns?.documentType.items).toEqual([
        { label: 'Thesis', count: 30 },
        { label: 'Research article', count: 10 },
      ]);
      expect(breakdowns?.publisher.items).toEqual([{ label: 'IEEE', count: 25 }]);
      expect(breakdowns?.authors.items).toEqual([{ label: 'K Anderson', count: 4 }]);
    });

    it('ranks the loaded papers when the aggregate fails', () => {
      store.search({ query: 'drone', limit: 10 });
      http.expectOne(isSearch).flush({
        totalHits: 2,
        limit: 10,
        offset: 0,
        results: [
          { id: 1, publisher: 'IEEE', authors: [{ name: 'A' }] },
          { id: 2, publisher: 'IEEE', authors: [{ name: 'A' }, { name: 'B' }] },
        ],
      });
      http.expectOne(isAggregate).flush('boom', { status: 500, statusText: 'Server Error' });

      expect(store.breakdowns()?.publisher.items).toEqual([{ label: 'IEEE', count: 2 }]);
      expect(store.breakdowns()?.authors.items).toEqual([
        { label: 'A', count: 2 },
        { label: 'B', count: 1 },
      ]);
      expect(store.breakdowns()?.documentType.items).toEqual([]);
    });

    it('keeps the whole-query aggregate when the limit or year changes', () => {
      store.search({ query: 'drone', limit: 10 });
      http.expectOne(isSearch).flush(page([1], 3));
      const aggregate = http.expectOne(isAggregate);
      expect(aggregate.request.body.q).toBe('drone');
      aggregate.flush(years({ '2020': 40 }));

      store.search({ query: 'drone', limit: 50 });
      http.expectOne(isSearch).flush(page([1], 3));
      store.search({ query: 'drone', limit: 50, year: 2020 });
      http.expectOne(isSearch).flush(page([1], 3));

      http.expectNone(isAggregate);
      expect(store.chart()?.series.total).toBe(40);
    });
  });
});
