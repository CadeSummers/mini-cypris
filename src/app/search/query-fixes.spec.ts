import { findQueryTip, normalizeForCore } from './query-fixes';

describe('normalizeForCore and authors', () => {
  it('sends authors: and author: as the field CORE really searches', () => {
    expect(normalizeForCore('drone AND authors:smith')).toBe('drone AND authors/name:smith');
    expect(normalizeForCore('(author:"Smith, Jane" OR Authors:"Jane Smith")')).toBe(
      '(authors/name:"Smith, Jane" OR authors/name:"Jane Smith")',
    );
  });

  it('leaves the word alone inside a phrase or as a search term', () => {
    expect(normalizeForCore('"authors: a study" AND coauthors:x AND authors')).toBe(
      '"authors: a study" AND coauthors:x AND authors',
    );
  });
});

describe('normalizeForCore', () => {
  it('removes quotes around single words, which CORE fails on', () => {
    expect(normalizeForCore('"Abiogenesis" AND "Exoplanet"')).toBe('Abiogenesis AND Exoplanet');
    expect(normalizeForCore('("drone" OR uav)')).toBe('(drone OR uav)');
  });

  it('leaves phrases, fielded values and quoted operators alone', () => {
    const untouched = [
      '"climate change" AND NOT policy',
      'title:"learning"',
      'documentType:"thesis"',
      'cats "AND" dogs',
      'drone AND delivery',
    ];
    for (const query of untouched) expect(normalizeForCore(query)).toBe(query);
  });

  it('straightens curly quotes', () => {
    expect(normalizeForCore('“climate change” AND drone')).toBe('"climate change" AND drone');
    expect(normalizeForCore('“drone”')).toBe('drone');
  });
});

describe('findQueryTip', () => {
  it('offers to uppercase a lowercase operator, outside quotes only', () => {
    const tip = findQueryTip('drone and "supply and demand" and uav');
    expect(tip?.action).toBe('Use AND');
    expect(tip?.fixed).toBe('drone AND "supply and demand" AND uav');
  });

  it('ignores operators inside quotes and inside other words', () => {
    expect(findQueryTip('"supply and demand"')).toBeNull();
    expect(findQueryTip('android notary')).toBeNull();
    expect(findQueryTip('drone AND delivery')).toBeNull();
  });

  it('corrects field names CORE does not have', () => {
    expect(findQueryTip('drone AND year>=2020')?.fixed).toBe('drone AND yearPublished>=2020');
    expect(findQueryTip('yearPublished:2020 AND authors:smith')).toBeNull();
    // "author" needs no fix: it is sent to CORE as the field that works.
    expect(findQueryTip('(author:"Jane Smith")')).toBeNull();
    expect(findQueryTip('"year: 2020"')).toBeNull();
  });
});
