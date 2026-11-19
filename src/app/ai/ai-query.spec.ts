import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AiOutcome, AiQuery } from './ai-query';

describe('AiQuery', () => {
  let ai: AiQuery;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    ai = TestBed.inject(AiQuery);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function ask(): { outcome: () => AiOutcome | undefined } {
    let outcome: AiOutcome | undefined;
    ai.ask('translate', 'papers about drones').subscribe((value) => (outcome = value));
    return { outcome: () => outcome };
  }

  it('posts the mode and text, and returns the queries', () => {
    const { outcome } = ask();
    const request = http.expectOne('/ai/query');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ mode: 'translate', text: 'papers about drones' });

    request.flush({ ok: true, queries: ['drone AND delivery'] });
    expect(outcome()).toEqual({ kind: 'queries', queries: ['drone AND delivery'] });
  });

  it('drops anything the search box itself would not accept', () => {
    const { outcome } = ask();
    http.expectOne('/ai/query').flush({ ok: true, queries: ['(drone AND', 7, 'uav OR drone'] });
    expect(outcome()).toEqual({ kind: 'queries', queries: ['uav OR drone'] });
  });

  it('reports a refusal by its code', () => {
    const refused = ask();
    http.expectOne('/ai/query').flush({ ok: false, reason: 'not_a_search' });
    expect(refused.outcome()).toEqual({ kind: 'refused', reason: 'not_a_search' });

    const empty = ask();
    http.expectOne('/ai/query').flush({ ok: true, queries: [] });
    expect(empty.outcome()).toEqual({ kind: 'refused', reason: 'unclear' });
  });

  it('tells the per-visitor limit apart from an outage', () => {
    const limited = ask();
    http.expectOne('/ai/query').flush(
      {},
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'x-ratelimit-retry-after': '2026-11-18T17:17:00.000Z' },
      },
    );
    expect(limited.outcome()).toEqual({
      kind: 'limited',
      retryAt: new Date('2026-11-18T17:17:00.000Z'),
    });

    const down = ask();
    http.expectOne('/ai/query').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(down.outcome()).toEqual({ kind: 'unavailable' });
  });
});
