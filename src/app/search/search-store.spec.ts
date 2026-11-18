import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SearchStore } from './search-store';

const isSearch = (r: { url: string }) => r.url === '/core-api/v3/search/works/';
const isAggregate = (r: { url: string }) => r.url === '/core-api/v3/search/works/aggregate';

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
    store.search('   ', 10);
    expect(store.status()).toBe('idle');
    http.expectNone(isSearch);
  });

  it('loads papers for a query', () => {
    store.search(' drone ', 10);
    expect(store.status()).toBe('loading');
    expect(store.request()).toEqual({ query: 'drone', limit: 10 });

    http
      .expectOne(isSearch)
      .flush({ totalHits: 2, limit: 10, offset: 0, results: [{ id: 1 }, { id: 2 }] });

    expect(store.status()).toBe('loaded');
    expect(store.totalHits()).toBe(2);
    expect(store.papers().length).toBe(2);
  });

  it('cancels the in-flight request when a newer search starts', () => {
    store.search('first', 10);
    const first = http.expectOne(isSearch);

    store.search('second', 10);
    expect(first.cancelled).toBe(true);

    http
      .expectOne(isSearch)
      .flush({ totalHits: 1, limit: 10, offset: 0, results: [{ id: 9, title: 'Second' }] });

    expect(store.request()?.query).toBe('second');
    expect(store.papers().map((p) => p.title)).toEqual(['Second']);
  });

  it('reports an error, clears old results and keeps working afterwards', () => {
    store.search('drone', 10);
    http.expectOne(isSearch).flush({ totalHits: 1, limit: 10, offset: 0, results: [{ id: 1 }] });

    store.search('broken', 10);
    http.expectOne(isSearch).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(store.status()).toBe('error');
    expect(store.papers()).toEqual([]);
    expect(store.totalHits()).toBe(0);
    expect(store.error()?.kind).toBe('server');

    store.retry();
    http.expectOne(isSearch).flush({ totalHits: 1, limit: 10, offset: 0, results: [{ id: 3 }] });
    expect(store.status()).toBe('loaded');
    expect(store.request()?.query).toBe('broken');
    expect(store.error()).toBeNull();
  });

  it('serves a repeated search from the cache without a second request', () => {
    store.search('drone', 10);
    http.expectOne(isSearch).flush({ totalHits: 1, limit: 10, offset: 0, results: [{ id: 1 }] });

    store.search('other', 10);
    http.expectOne(isSearch).flush({ totalHits: 0, limit: 10, offset: 0, results: [] });

    store.search('drone', 10);
    http.expectNone(isSearch);
    expect(store.status()).toBe('loaded');
    expect(store.papers().map((p) => p.id)).toEqual(['1']);

    // A different limit is a different result set.
    store.search('drone', 20);
    http.expectOne(isSearch).flush({ totalHits: 1, limit: 20, offset: 0, results: [{ id: 1 }] });
  });

  describe('chart data', () => {
    const page = { totalHits: 3, limit: 10, offset: 0, results: [{ id: 1, yearPublished: 2020 }] };
    const years = (yearPublished: Record<string, number>) => ({ aggregations: { yearPublished } });

    it('uses CORE totals for every matching paper', () => {
      expect(store.chart()).toBeNull();

      store.search('drone', 10);
      http.expectOne(isSearch).flush(page);
      expect(store.chartLoading()).toBe(true);

      http.expectOne(isAggregate).flush(years({ '2020': 40, '2021': 60 }));

      expect(store.chartLoading()).toBe(false);
      expect(store.chart()?.source).toBe('all');
      expect(store.chart()?.series.total).toBe(100);
    });

    it('falls back to the loaded papers when the aggregate fails', () => {
      store.search('drone', 10);
      http.expectOne(isSearch).flush(page);
      http.expectOne(isAggregate).flush('boom', { status: 500, statusText: 'Server Error' });

      expect(store.status()).toBe('loaded');
      expect(store.chart()?.source).toBe('loaded');
      expect(store.chart()?.series.points).toEqual([{ year: 2020, count: 1 }]);
    });

    it('does not refetch the aggregate when only the limit changes', () => {
      store.search('drone', 10);
      http.expectOne(isSearch).flush(page);
      http.expectOne(isAggregate).flush(years({ '2020': 40 }));

      store.search('drone', 50);
      http.expectOne(isSearch).flush(page);
      http.expectNone(isAggregate);
      expect(store.chart()?.series.total).toBe(40);
    });
  });
});
