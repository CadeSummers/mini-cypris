import { CoreWork } from './core-api.models';

/** A research paper as the UI wants it: every field clean and predictable. */
export interface Paper {
  id: string;
  title: string;
  authors: string[];
  /** Plain text, '' when CORE has no abstract. */
  abstract: string;
  year: number | null;
  doi: string | null;
  /** Best landing page: DOI if present, otherwise the CORE record. */
  url: string;
  pdfUrl: string | null;
  publisher: string | null;
  documentType: string | null;
  citationCount: number | null;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Strips HTML remnants (including a tag cut off at the end) and tidies whitespace. */
export function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<\/?[a-zA-Z][^>]*(>|$)/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

function orNull(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  return cleaned ? cleaned : null;
}

/** Some repositories append an internal id to names: "Xiao Liu (13082469)". */
function cleanAuthor(name: string | null | undefined): string {
  return cleanText(name).replace(/\s*\(\d+\)$/, '');
}

export function parseYear(value: number | string | null | undefined): number | null {
  const year = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof year === 'number' && Number.isInteger(year) && year > 0 ? year : null;
}

export function toPaper(work: CoreWork): Paper {
  const id = String(work.id);
  const doi = orNull(work.doi);
  return {
    id,
    title: cleanText(work.title) || 'Untitled',
    authors: (work.authors ?? []).map((a) => cleanAuthor(a?.name)).filter(Boolean),
    abstract: cleanText(work.abstract),
    year: parseYear(work.yearPublished),
    doi,
    url: doi ? `https://doi.org/${doi}` : `https://core.ac.uk/works/${id}`,
    pdfUrl: orNull(work.downloadUrl),
    publisher: orNull(work.publisher),
    documentType: orNull(work.documentType),
    citationCount: typeof work.citationCount === 'number' ? work.citationCount : null,
  };
}
