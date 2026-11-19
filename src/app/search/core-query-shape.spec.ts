import { shapeForCore } from './core-query-shape';

describe('shapeForCore', () => {
  it('drops outer parentheses, which CORE miscounts around a nested group', () => {
    expect(shapeForCore('(drone AND (package OR delivery))')).toBe(
      'drone AND (package OR delivery)',
    );
    expect(shapeForCore('((drone AND (package OR delivery)))')).toBe(
      'drone AND (package OR delivery)',
    );
    expect(shapeForCore('(drone)')).toBe('drone');
  });

  it('keeps a query that is already one level deep', () => {
    for (const query of [
      'drone',
      'drone AND delivery',
      'drone OR uav',
      'drone AND (package OR delivery) AND NOT medical',
      '(drone OR uav) AND (package OR delivery)',
      '(drone AND package) OR (uav AND delivery) OR robot',
      'title:"machine learning (ML)" AND yearPublished>=2020',
    ]) {
      expect(shapeForCore(query)).toBe(query);
    }
  });

  it('writes out the operators CORE would otherwise read differently', () => {
    // CORE reads adjacent words as OR; this app reads them as AND.
    expect(shapeForCore('drone delivery')).toBe('drone AND delivery');
    // CORE does not apply "AND before OR" without parentheses.
    expect(shapeForCore('drone AND package OR delivery')).toBe('(drone AND package) OR delivery');
    expect(shapeForCore('drone and (package or delivery)')).toBe('drone AND (package OR delivery)');
  });

  it('flattens groups nested inside groups', () => {
    expect(shapeForCore('(drone AND (package OR delivery)) AND yearPublished:2021')).toBe(
      'drone AND (package OR delivery) AND yearPublished:2021',
    );
    expect(shapeForCore('safety AND (drone AND (package OR delivery))')).toBe(
      'safety AND drone AND (package OR delivery)',
    );
    expect(shapeForCore('drone AND (package OR (delivery AND medical))')).toBe(
      'drone AND (package OR delivery) AND (package OR medical)',
    );
    expect(shapeForCore('((a AND b) OR c) AND d')).toBe('(a OR c) AND (b OR c) AND d');
  });

  it('moves NOT from a group to its terms', () => {
    expect(shapeForCore('drone AND NOT (package OR delivery)')).toBe(
      'drone AND NOT package AND NOT delivery',
    );
    expect(shapeForCore('NOT (a AND b)')).toBe('NOT a OR NOT b');
    expect(shapeForCore('a AND NOT NOT b')).toBe('a AND b');
  });

  it('returns the query as written when it cannot be parsed or would grow too long', () => {
    expect(shapeForCore('(drone AND')).toBe('(drone AND');
    // An OR of six AND-pairs is flat already, but would be 64 groups as an AND of ORs...
    const pairs = Array.from({ length: 6 }, (_, i) => `(a${i} AND b${i})`).join(' OR ');
    expect(shapeForCore(pairs)).toBe(pairs);
    // ...so joined to its mirror image it is too long either way, and is left alone.
    const mirror = Array.from({ length: 6 }, (_, i) => `(c${i} OR d${i})`).join(' AND ');
    const both = `(${pairs}) AND ((${mirror}) OR e)`;
    expect(shapeForCore(both)).toBe(both);
  });
});
