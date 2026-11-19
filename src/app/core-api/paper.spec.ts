import { cleanText, parseYear, toPaper } from './paper';

describe('cleanText', () => {
  it('strips tags, including one truncated at the end', () => {
    expect(cleanText('<p>Wind-aware  <b>drones</b></p')).toBe('Wind-aware drones');
  });

  it('keeps comparisons that merely look like tags', () => {
    expect(cleanText('where a < b and c > d')).toBe('where a < b and c > d');
  });

  it('removes escaped tags, even when the last entity is cut off', () => {
    expect(cleanText('&lt;p&gt;This is the first release.&lt;/p&gt')).toBe(
      'This is the first release.',
    );
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
      authors: [
        { name: 'Xiao Liu (13082469)' },
        { name: '' },
        { name: 'Richardson, Michael ; https://orcid.org/0000-0001-2345-6789' },
        { name: 'https://orcid.org/' },
      ],
      yearPublished: '2025',
      doi: '',
      downloadUrl: '',
      publisher: '',
    });

    expect(paper).toEqual({
      id: '42',
      title: 'Untitled',
      authors: ['Xiao Liu', 'Richardson, Michael'],
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

  it('drops an abstract that only repeats the title', () => {
    const paper = toPaper({ id: 1, title: 'Wind-Aware Drones', abstract: 'Wind-Aware Drones</p' });
    expect(paper.abstract).toBe('');
  });

  it('drops placeholder author names such as "null null"', () => {
    const paper = toPaper({
      id: 1,
      authors: [
        { name: 'null null' },
        { name: 'Rivera, Ana' },
        { name: 'Unknown' },
        { name: null },
      ],
    });
    expect(paper.authors).toEqual(['Rivera, Ana']);
  });

  it('drops a link stuck on the end of an abstract, and keeps one inside it', () => {
    const glued = toPaper({ id: 1, abstract: 'Drones in rural areas.https://doi.org/10.1/x' });
    expect(glued.abstract).toBe('Drones in rural areas.');
    const inside = toPaper({ id: 1, abstract: 'See https://example.org for the data set used.' });
    expect(inside.abstract).toBe('See https://example.org for the data set used.');
  });

  it('prefers the DOI as the landing page', () => {
    expect(toPaper({ id: 1, doi: '10.1000/xyz' }).url).toBe('https://doi.org/10.1000/xyz');
  });
});
