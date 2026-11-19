import { findQueryIssue, parseQuery } from './boolean-query';

const term = (value: string, field: string | null = null, text = value) => ({
  type: 'term',
  field,
  value,
  text,
});

function ast(text: string) {
  const result = parseQuery(text);
  if (!result.ok) throw new Error(result.issue.message);
  return result.ast;
}

describe('parseQuery', () => {
  it('parses the example from the brief', () => {
    expect(ast('(drone AND (package OR delivery))')).toEqual({
      type: 'and',
      children: [term('drone'), { type: 'or', children: [term('package'), term('delivery')] }],
    });
  });

  it('binds AND tighter than OR', () => {
    expect(ast('a OR b AND c')).toEqual({
      type: 'or',
      children: [term('a'), { type: 'and', children: [term('b'), term('c')] }],
    });
  });

  it('treats adjacent terms as an implicit AND', () => {
    expect(ast('drone delivery')).toEqual({
      type: 'and',
      children: [term('drone'), term('delivery')],
    });
  });

  it('reads operators in any case, as CORE does', () => {
    expect(ast('drone and (package or delivery)')).toEqual(ast('drone AND (package OR delivery)'));
    expect(ast('drone And Not military')).toEqual({
      type: 'and',
      children: [term('drone'), { type: 'not', child: term('military') }],
    });
  });

  it('supports NOT, including after AND', () => {
    expect(ast('drone AND NOT military')).toEqual({
      type: 'and',
      children: [term('drone'), { type: 'not', child: term('military') }],
    });
  });

  it('keeps quoted phrases and field prefixes together', () => {
    expect(ast('"climate change"')).toEqual(term('climate change', null, '"climate change"'));
    expect(ast('title:"machine learning (ML)" AND yearPublished>=2020')).toEqual({
      type: 'and',
      children: [
        term('machine learning (ML)', 'title', 'title:"machine learning (ML)"'),
        term('yearPublished>=2020'),
      ],
    });
  });

  it('does not treat a colon inside a phrase as a field', () => {
    expect(ast('"drones: a review"')).toEqual(term('drones: a review', null, '"drones: a review"'));
  });
});

describe('findQueryIssue', () => {
  it('accepts well-formed queries', () => {
    for (const query of [
      'drone',
      '(drone AND (package OR delivery))',
      'NOT drone',
      '_exists_:fullText AND title:"AI"',
    ]) {
      expect(findQueryIssue(query), query).toBeNull();
    }
  });

  it.each([
    ['(drone AND package', 'never closed', 0],
    ['drone AND package)', 'no matching', 17],
    ['drone AND', 'after AND', 9],
    ['AND drone', 'before AND', 0],
    ['drone AND OR package', 'cannot directly follow', 10],
    ['drone ()', 'empty', 6],
    ['(drone OR )', 'after OR', 10],
    ['"drone delivery', 'never closed', 0],
    ['   ', 'Enter a search term', 0],
  ])('rejects %s', (query, fragment, position) => {
    const issue = findQueryIssue(query);
    expect(issue?.message).toContain(fragment);
    expect(issue?.position).toBe(position);
  });
});
