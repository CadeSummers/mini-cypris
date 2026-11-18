import { cleanText, parseYear, toPaper } from './paper';

describe('cleanText', () => {
  it('strips tags, including one truncated at the end', () => {
    expect(cleanText('<p>Wind-aware  <b>drones</b></p')).toBe('Wind-aware drones');
  });

  it('keeps comparisons that merely look like tags', () => {
    expect(cleanText('where a < b and c > d')).toBe('where a < b and c > d');
  });

  it('decodes common entities and handles empty input', () => {
    expect(cleanText('R&amp;D')).toBe('R&D');
    expect(cleanText(null)).toBe('');
  });
});

describe('parseYear', () => {
  it('accepts numbers and numeric strings, rejects the rest', () => {
    expect(parseYear(2019)).toBe(2019);
    expect(parseYear('2019')).toBe(2019);
    expect(parseYear('')).toBeNull();
    expect(parseYear(null)).toBeNull();
  });
});

describe('toPaper', () => {
  it('normalises a sparse CORE record', () => {
    const paper = toPaper({
      id: 42,
      title: null,
      abstract: '',
      authors: [{ name: 'Xiao Liu (13082469)' }, { name: '' }],
      yearPublished: '2025',
      doi: '',
      downloadUrl: '',
      publisher: '',
    });

    expect(paper).toEqual({
      id: '42',
      title: 'Untitled',
      authors: ['Xiao Liu'],
      abstract: '',
      year: 2025,
      doi: null,
      url: 'https://core.ac.uk/works/42',
      pdfUrl: null,
      publisher: null,
      documentType: null,
      citationCount: null,
    });
  });

  it('prefers the DOI as the landing page', () => {
    expect(toPaper({ id: 1, doi: '10.1000/xyz' }).url).toBe('https://doi.org/10.1000/xyz');
  });
});
