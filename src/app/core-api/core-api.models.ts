/**
 * Raw shapes returned by CORE v3, limited to the fields this app reads.
 * CORE is loose with types: missing values arrive as null, '' or are absent,
 * so everything here is optional and gets normalised in `toPaper`.
 */
export interface CoreWork {
  id: number | string;
  title?: string | null;
  abstract?: string | null;
  authors?: { name?: string | null }[] | null;
  yearPublished?: number | string | null;
  doi?: string | null;
  downloadUrl?: string | null;
  publisher?: string | null;
  documentType?: string | null;
  citationCount?: number | null;
}

export interface CoreSearchResponse {
  totalHits: number;
  limit: number;
  offset: number;
  results?: CoreWork[] | null;
}
