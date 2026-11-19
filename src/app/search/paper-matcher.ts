import { Paper } from '../core-api/paper';
import { QueryNode, parseQuery } from './boolean-query';
import { wordPattern } from './highlight';

/**
 * Evaluates a parsed boolean query against papers already in the browser.
 *
 * This is the "search through the documents collected" half of the brief:
 * the main search bar asks CORE, this narrows what came back without spending
 * another API request.
 *
 * A term matches where a word starts, in any case, and the rest of the word
 * is free: `deliver` and `deliver*` match "delivery" and "delivering", while
 * `ai` matches "AI" but not "said". This is the rule the highlighter uses, so
 * what is kept and what is marked agree. Recognised fields: title, abstract, author(s),
 * publisher, year (also as yearPublished, with >, >=, <, <=). Anything else is
 * matched against all of a paper's text.
 */

type TextField = 'title' | 'abstract' | 'authors' | 'publisher';

const FIELD_ALIASES: Record<string, TextField | 'year'> = {
  title: 'title',
  abstract: 'abstract',
  author: 'authors',
  authors: 'authors',
  publisher: 'publisher',
  year: 'year',
  yearpublished: 'year',
};

const YEAR_COMPARISON = /^(?:year|yearPublished)(>=|<=|>|<)(\d{1,4})$/i;

interface Searchable {
  title: string;
  abstract: string;
  authors: string;
  publisher: string;
  all: string;
  year: number | null;
}

function toSearchable(paper: Paper): Searchable {
  const title = paper.title.toLowerCase();
  const abstract = paper.abstract.toLowerCase();
  const authors = paper.authors.join(' ; ').toLowerCase();
  const publisher = (paper.publisher ?? '').toLowerCase();
  return {
    title,
    abstract,
    authors,
    publisher,
    year: paper.year,
    all: [title, abstract, authors, publisher, paper.year ?? ''].join('\n'),
  };
}

function compareYear(year: number | null, operator: string, target: number): boolean {
  if (year === null) return false;
  switch (operator) {
    case '>':
      return year > target;
    case '>=':
      return year >= target;
    case '<':
      return year < target;
    default:
      return year <= target;
  }
}

/** One pattern per term, kept because every paper is tested against the same few terms. */
const patterns = new Map<string, RegExp | null>();

function containsWord(text: string, value: string): boolean {
  // CORE allows a trailing wildcard (deliver*); a match already runs to the word's end.
  const term = value.replace(/[*?]+$/, '').trim();
  if (!patterns.has(term)) patterns.set(term, wordPattern([term], 'iu', 1));
  return patterns.get(term)?.test(text) ?? false;
}

function matchesTerm(field: string | null, value: string, doc: Searchable): boolean {
  if (!field) {
    const comparison = YEAR_COMPARISON.exec(value);
    if (comparison) return compareYear(doc.year, comparison[1], Number(comparison[2]));
    return containsWord(doc.all, value);
  }

  const known = FIELD_ALIASES[field.toLowerCase()];
  if (known === 'year') return doc.year !== null && String(doc.year) === value.trim();
  if (known) return containsWord(doc[known], value);
  // Unknown field (e.g. a CORE-only one): fall back to searching everything.
  return containsWord(doc.all, value);
}

function evaluate(node: QueryNode, doc: Searchable): boolean {
  switch (node.type) {
    case 'term':
      return matchesTerm(node.field, node.value, doc);
    case 'not':
      return !evaluate(node.child, doc);
    case 'and':
      return node.children.every((child) => evaluate(child, doc));
    case 'or':
      return node.children.some((child) => evaluate(child, doc));
  }
}

export function matchesQuery(ast: QueryNode, paper: Paper): boolean {
  return evaluate(ast, toSearchable(paper));
}

/** Keeps the papers matching `ast`, preserving their order. */
export function filterPapers(papers: readonly Paper[], ast: QueryNode): Paper[] {
  return papers.filter((paper) => matchesQuery(ast, paper));
}

/** Convenience for tests and one-off use: parse then filter; throws on bad syntax. */
export function filterPapersByText(papers: readonly Paper[], text: string): Paper[] {
  const result = parseQuery(text);
  if (!result.ok) throw new Error(result.issue.message);
  return filterPapers(papers, result.ast);
}
