import { convertToParamMap } from '@angular/router';
import { paramsFromRequest, requestFromParams } from './search-page';

describe('search URL state', () => {
  it('reads a full search from the URL', () => {
    const params = convertToParamMap({
      q: ' (drone AND delivery) ',
      limit: '25',
      year: '2021',
      type: 'thesis',
      publisher: ' Institute of Electrical and Electronics Engineers (IEEE) ',
      author: 'Müller, J.-P.',
    });
    expect(requestFromParams(params)).toEqual({
      query: '(drone AND delivery)',
      limit: 25,
      year: 2021,
      documentType: 'thesis',
      publisher: 'Institute of Electrical and Electronics Engineers (IEEE)',
      author: 'Müller, J.-P.',
    });
  });

  it('applies defaults and ignores junk', () => {
    expect(requestFromParams(convertToParamMap({ q: 'drone' }))).toEqual({
      query: 'drone',
      limit: 10,
      year: null,
      documentType: null,
      publisher: null,
      author: null,
    });
    expect(
      requestFromParams(convertToParamMap({ q: 'drone', limit: '9999', year: 'soon' })),
    ).toEqual({
      query: 'drone',
      limit: 100,
      year: null,
      documentType: null,
      publisher: null,
      author: null,
    });
  });

  it('ignores a publisher or author that could break out of its quoted filter', () => {
    const request = requestFromParams(
      convertToParamMap({
        q: 'drone',
        publisher: 'Elsevier" OR title:"x',
        author: 'Smith\\',
      }),
    );
    expect(request?.publisher).toBeNull();
    expect(request?.author).toBeNull();

    const long = requestFromParams(convertToParamMap({ q: 'drone', author: 'a'.repeat(201) }));
    expect(long?.author).toBeNull();
  });

  it('ignores a document type that could break out of its quoted filter', () => {
    const type = 'thesis" OR documentType:"research';
    expect(requestFromParams(convertToParamMap({ q: 'drone', type }))?.documentType).toBeNull();
  });

  it('treats a missing or blank query as no search', () => {
    expect(requestFromParams(convertToParamMap({}))).toBeNull();
    expect(requestFromParams(convertToParamMap({ q: '  ', limit: '5' }))).toBeNull();
  });

  it('writes short URLs and round-trips', () => {
    expect(paramsFromRequest({ query: 'drone', limit: 10 })).toEqual({
      q: 'drone',
      limit: null,
      year: null,
      type: null,
      publisher: null,
      author: null,
    });

    const request = {
      query: 'a OR b',
      limit: 50,
      year: 2019,
      documentType: 'research article',
      publisher: 'MDPI AG',
      author: 'Chen, Wei',
    };
    const params = convertToParamMap(
      Object.fromEntries(Object.entries(paramsFromRequest(request)).map(([k, v]) => [k, `${v}`])),
    );
    expect(requestFromParams(params)).toEqual(request);
  });
});
