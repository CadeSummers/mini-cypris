import { findQueryTip, normalizeForCore } from './query-fixes';

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
    expect(findQueryTip('(author:"Jane Smith")')?.fixed).toBe('(authors:"Jane Smith")');
    expect(findQueryTip('yearPublished:2020 AND authors:smith')).toBeNull();
    expect(findQueryTip('"year: 2020"')).toBeNull();
  });
});
