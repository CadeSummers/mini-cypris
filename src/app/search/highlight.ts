import { QueryNode } from './boolean-query';

/**
 * Highlights the words of a query inside a paper's title and abstract, so a
 * reader can see at a glance why a paper matched.
 *
 * Text is split into plain and matching segments, which the template renders
 * as elements. Nothing is ever inserted as HTML, so a title containing markup
 * stays inert text.
 */

/** The words and phrases to mark, per part of the card. */
export interface HighlightTerms {
  title: string[];
  abstract: string[];
}

export interface Segment {
  text: string;
  match: boolean;
}

export const NO_HIGHLIGHT: HighlightTerms = { title: [], abstract: [] };

/** `year>=2020` and friends are comparisons, not words to look for. */
const COMPARISON = /^\w+(>=|<=|>|<)/;

/** Shorter terms would light up half the text without telling the reader anything. */
const MIN_TERM_LENGTH = 2;

/**
 * Collects the terms worth highlighting from parsed queries (the CORE search
 * and, if present, the in-browser refine).
 *
 * - Terms under NOT are skipped: they describe what the paper must not say.
 * - `title:x` marks titles only and `abstract:x` abstracts only.
 * - Terms on other fields (author, publisher, year) are skipped, because the
 *   title and abstract are not where they matched.
 */
export function collectHighlightTerms(
  ...queries: (QueryNode | null | undefined)[]
): HighlightTerms {
  const title = new Set<string>();
  const abstract = new Set<string>();

  const visit = (node: QueryNode): void => {
    if (node.type === 'not') return;
    if (node.type !== 'term') {
      node.children.forEach(visit);
      return;
    }

    // CORE allows a trailing wildcard (deliver*); the match already extends to the word's end.
    const value = node.value
      .replace(/[*?]+$/, '')
      .trim()
      .toLowerCase();
    if (value.length < MIN_TERM_LENGTH) return;

    const field = node.field?.toLowerCase() ?? null;
    if (field === null) {
      if (COMPARISON.test(value)) return;
      title.add(value);
      abstract.add(value);
    } else if (field === 'title') {
      title.add(value);
    } else if (field === 'abstract') {
      abstract.add(value);
    }
  };

  for (const query of queries) {
    if (query) visit(query);
  }
  return { title: [...title], abstract: [...abstract] };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds one pattern for all terms. A term matches where a word starts and the
 * match runs to the end of that word, so `drone` marks "drones" but not
 * "androne". CORE's search stems words in a similar way.
 */
function toPattern(terms: string[]): RegExp | null {
  const alternatives = terms
    .filter((term) => term.trim().length >= MIN_TERM_LENGTH)
    // Longest first, so "drone delivery" wins over "drone" where both apply.
    .sort((a, b) => b.length - a.length)
    .map((term) => term.trim().split(/\s+/).map(escapeRegExp).join('\\s+'));

  if (!alternatives.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})[\\p{L}\\p{N}]*`, 'giu');
}

/** Splits `text` into alternating plain and matching segments, in order. */
export function highlightSegments(text: string, terms: string[]): Segment[] {
  if (!text) return [];
  const pattern = toPattern(terms);
  if (!pattern) return [{ text, match: false }];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const found of text.matchAll(pattern)) {
    if (found.index > cursor)
      segments.push({ text: text.slice(cursor, found.index), match: false });
    segments.push({ text: found[0], match: true });
    cursor = found.index + found[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
