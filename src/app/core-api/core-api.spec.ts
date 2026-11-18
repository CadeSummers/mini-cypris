import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CoreApi, SearchPage } from './core-api';

const SEARCH_URL = '/core-api/v3/search/works/';

describe('CoreApi', () => {
  let api: CoreApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CoreApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the boolean query untouched and maps the response', () => {
    let page: SearchPage | undefined;
    api.search('(drone AND (package OR delivery))', 25, 50).subscribe((p) => (page = p));

    const req = http.expectOne((r) => r.url === SEARCH_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('(drone AND (package OR delivery))');
    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('offset')).toBe('50');

    req.flush({ totalHits: 71213, limit: 25, offset: 50, results: [{ id: 7, title: 'A' }] });

    expect(page?.totalHits).toBe(71213);
    expect(page?.offset).toBe(50);
    expect(page?.papers.map((p) => p.id)).toEqual(['7']);
  });

  it('clamps the page size to what CORE accepts', () => {
    api.search('drone', 5000).subscribe();
    const req = http.expectOne((r) => r.url === SEARCH_URL);
    expect(req.request.params.get('limit')).toBe('100');
    req.flush({ totalHits: 0, limit: 100, offset: 0, results: null });
  });

  it('asks CORE to aggregate every match by year', () => {
    let counts: Record<string, number> | undefined;
    api.aggregateYears('(drone AND delivery)').subscribe((c) => (counts = c));

    const req = http.expectOne('/core-api/v3/search/works/aggregate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      q: '(drone AND delivery)',
      aggregations: ['yearPublished'],
    });

    req.flush({ aggregations: { yearPublished: { '2024': 7805, '2025': 7828 } } });
    expect(counts).toEqual({ '2024': 7805, '2025': 7828 });
  });

  it('treats a missing aggregation as empty', () => {
    let counts: Record<string, number> | undefined;
    api.aggregateYears('drone').subscribe((c) => (counts = c));
    http.expectOne('/core-api/v3/search/works/aggregate').flush({});
    expect(counts).toEqual({});
  });
});
