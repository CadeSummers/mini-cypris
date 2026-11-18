import { parseQuery } from './boolean-query';
import { collectHighlightTerms, highlightSegments } from './highlight';

function ast(text: string) {
  const result = parseQuery(text);
  if (!result.ok) throw new Error(result.issue.message);
  return result.ast;
}

describe('collectHighlightTerms', () => {
  it('collects every positive term for both title and abstract', () => {
    const terms = collectHighlightTerms(ast('(drone AND (package OR delivery))'));

    expect(terms.title).toEqual(['drone', 'package', 'delivery']);
    expect(terms.abstract).toEqual(['drone', 'package', 'delivery']);
  });

  it('skips terms under NOT', () => {
    const terms = collectHighlightTerms(ast('"climate change" AND NOT (policy OR tax)'));

    expect(terms.title).toEqual(['climate change']);
  });

  it('keeps field-scoped terms to their own field and ignores other fields', () => {
    const terms = collectHighlightTerms(
      ast('title:"machine learning" AND abstract:robot AND author:smith AND yearPublished>=2020'),
    );

    expect(terms.title).toEqual(['machine learning']);
    expect(terms.abstract).toEqual(['robot']);
  });

  it('merges several queries, drops duplicates, wildcards and one-letter terms', () => {
    const terms = collectHighlightTerms(ast('Drone AND a'), ast('drone AND deliver*'), null);

    expect(terms.title).toEqual(['drone', 'deliver']);
  });
});

describe('highlightSegments', () => {
  const marked = (text: string, terms: string[]) =>
    highlightSegments(text, terms)
      .filter((segment) => segment.match)
      .map((segment) => segment.text);

  it('returns the text unchanged when there is nothing to mark', () => {
    expect(highlightSegments('Aero Drone', [])).toEqual([{ text: 'Aero Drone', match: false }]);
    expect(highlightSegments('', ['drone'])).toEqual([]);
  });

  it('splits text into plain and matching segments that rebuild the original', () => {
    const text = 'Aero Drone Package Delivery System';
    const segments = highlightSegments(text, ['drone', 'delivery']);

    expect(segments).toEqual([
      { text: 'Aero ', match: false },
      { text: 'Drone', match: true },
      { text: ' Package ', match: false },
      { text: 'Delivery', match: true },
      { text: ' System', match: false },
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('matches at the start of a word and marks the whole word', () => {
    expect(marked('Drones, androne and DRONE-based', ['drone'])).toEqual(['Drones', 'DRONE']);
  });

  it('matches phrases across any whitespace', () => {
    expect(marked('Deep machine\n learning models', ['machine learning'])).toEqual([
      'machine\n learning',
    ]);
  });

  it('prefers the longest term and treats special characters literally', () => {
    expect(marked('drone delivery (UAV) c++ code', ['drone', 'drone delivery', 'c++'])).toEqual([
      'drone delivery',
      'c++',
    ]);
  });

  it('handles accented words', () => {
    expect(marked('Étude des drones', ['étude'])).toEqual(['Étude']);
  });
});
