import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { CoreAggregationResponse, CoreSearchResponse } from './core-api.models';
import { Paper, toPaper } from './paper';

/**
 * Where CORE requests are sent. Defaults to the dev-server proxy (see
 * proxy.conf.mjs), which adds the API key server-side. A deployment would
 * point this at its own backend rather than ship a key to the browser.
 */
export const CORE_API_BASE_URL = new InjectionToken<string>('CORE_API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/core-api/v3',
});

/** CORE rejects page sizes above this. */
export const MAX_PAGE_SIZE = 100;

/** The fields CORE is asked to count matching works by. */
export const AGGREGATION_FIELDS = [
  'yearPublished',
  'documentType',
  'publisher',
  'authors',
] as const;
export type AggregationField = (typeof AGGREGATION_FIELDS)[number];

/** For each field, a value (a year, a publisher name, ...) and how many works have it. */
export type Aggregations = Record<AggregationField, Record<string, number>>;

export interface SearchPage {
  totalHits: number;
  offset: number;
  papers: Paper[];
}

@Injectable({ providedIn: 'root' })
export class CoreApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(CORE_API_BASE_URL);

  /**
   * Searches CORE works. `query` uses CORE's own query language, which
   * understands boolean expressions such as (drone AND (package OR delivery)).
   */
  search(query: string, limit: number, offset = 0): Observable<SearchPage> {
    const params = new HttpParams()
      .set('q', query)
      .set('limit', Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE))
      .set('offset', Math.max(Math.trunc(offset), 0));

    // The trailing slash matters: CORE answers /search/works with a 301.
    return this.http.get<CoreSearchResponse>(`${this.baseUrl}/search/works/`, { params }).pipe(
      map((res) => ({
        totalHits: res.totalHits ?? 0,
        offset: res.offset ?? offset,
        papers: (res.results ?? []).map(toPaper),
      })),
    );
  }

  /**
   * Counts every work matching `query` by year, document type, publisher and
   * author. CORE computes this across the full result set, not the page that
   * happens to be loaded, and answers all four fields in a single request.
   * Years come back complete; the other fields as CORE's 100 largest values.
   */
  aggregate(query: string): Observable<Aggregations> {
    return this.http
      .post<CoreAggregationResponse>(`${this.baseUrl}/search/works/aggregate`, {
        q: query,
        aggregations: AGGREGATION_FIELDS,
      })
      .pipe(
        map((res) => {
          const counts = (field: AggregationField): Record<string, number> => {
            const value = res.aggregations?.[field];
            return value && !Array.isArray(value) ? value : {};
          };
          return {
            yearPublished: counts('yearPublished'),
            documentType: counts('documentType'),
            publisher: counts('publisher'),
            authors: counts('authors'),
          };
        }),
      );
  }
}
