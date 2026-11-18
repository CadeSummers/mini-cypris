import { toPaper } from '../core-api/paper';
import { filterPapersByText } from './paper-matcher';

const papers = [
  {
    id: 1,
    title: 'Drone package delivery in cities',
    abstract: 'Routing for last-mile logistics.',
    authors: [{ name: 'Ada Lovelace' }],
    yearPublished: 2021,
    publisher: 'IEEE',
  },
  {
    id: 2,
    title: 'Military drone ethics',
    abstract: 'A policy review of autonomous weapons.',
    authors: [{ name: 'Alan Turing' }],
    yearPublished: 2018,
    publisher: 'Oxford',
  },
  {
    id: 3,
    title: 'Parcel delivery by bicycle',
    abstract: 'No aircraft involved.',
    authors: [{ name: 'Grace Hopper' }],
    yearPublished: null,
  },
].map(toPaper);

const ids = (query: string) => filterPapersByText(papers, query).map((p) => p.id);

describe('filterPapersByText', () => {
  it('evaluates the example from the brief', () => {
    expect(ids('(drone AND (package OR delivery))')).toEqual(['1']);
  });

  it('handles OR, NOT and implicit AND', () => {
    expect(ids('drone OR bicycle')).toEqual(['1', '2', '3']);
    expect(ids('drone AND NOT military')).toEqual(['1']);
    expect(ids('NOT drone')).toEqual(['3']);
    expect(ids('delivery cities')).toEqual(['1']);
  });

  it('is case-insensitive and matches word stems', () => {
    expect(ids('DRONE')).toEqual(['1', '2']);
    expect(ids('deliver')).toEqual(['1', '3']);
  });

  it('matches phrases exactly', () => {
    expect(ids('"package delivery"')).toEqual(['1']);
    expect(ids('"delivery package"')).toEqual([]);
  });

  it('searches the abstract, authors and publisher too', () => {
    expect(ids('logistics')).toEqual(['1']);
    expect(ids('turing')).toEqual(['2']);
    expect(ids('ieee')).toEqual(['1']);
  });

  it('restricts a term to a field', () => {
    expect(ids('title:policy')).toEqual([]);
    expect(ids('abstract:policy')).toEqual(['2']);
    expect(ids('author:hopper')).toEqual(['3']);
    expect(ids('title:"drone package"')).toEqual(['1']);
  });

  it('filters by year, skipping undated papers', () => {
    expect(ids('year:2021')).toEqual(['1']);
    expect(ids('yearPublished>=2019')).toEqual(['1']);
    expect(ids('year<2020')).toEqual(['2']);
    expect(ids('NOT year>=2019')).toEqual(['2', '3']);
  });

  it('falls back to all text for fields it does not know', () => {
    expect(ids('fullText:bicycle')).toEqual(['3']);
  });
});
