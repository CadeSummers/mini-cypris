import { toPaper } from '../core-api/paper';
import { buildYearSeries, countByYear, recentPoints } from './year-series';

describe('buildYearSeries', () => {
  it('sorts years and fills gaps with zero', () => {
    const series = buildYearSeries({ '2024': 5, '2021': 2, '2022': 1 }, 2026);
    expect(series.points).toEqual([
      { year: 2021, count: 2 },
      { year: 2022, count: 1 },
      { year: 2023, count: 0 },
      { year: 2024, count: 5 },
    ]);
    expect(series.total).toBe(8);
    expect(series.futureDated).toBe(0);
  });

  it('excludes future-dated papers but reports how many', () => {
    const series = buildYearSeries({ '2026': 3, '2027': 68, '2093': 14 }, 2026);
    expect(series.points).toEqual([{ year: 2026, count: 3 }]);
    expect(series.futureDated).toBe(82);
  });

  it('ignores junk keys and non-positive counts', () => {
    const series = buildYearSeries({ unknown: 9, '0': 4, '12': 1, '2020': 0, '2019': 2 }, 2026);
    expect(series.points).toEqual([{ year: 2019, count: 2 }]);
  });

  it('returns an empty series when nothing is usable', () => {
    expect(buildYearSeries({}, 2026)).toEqual({ points: [], total: 0, futureDated: 0 });
  });
});

describe('countByYear', () => {
  it('counts loaded papers per year and skips undated ones', () => {
    const papers = [
      { id: 1, yearPublished: 2020 },
      { id: 2, yearPublished: '2020' },
      { id: 3, yearPublished: 2021 },
      { id: 4, yearPublished: null },
    ].map(toPaper);
    expect(countByYear(papers)).toEqual({ '2020': 2, '2021': 1 });
  });
});

describe('recentPoints', () => {
  it('keeps only the trailing window', () => {
    const points = [2000, 2001, 2002, 2025, 2026].map((year) => ({ year, count: 1 }));
    expect(recentPoints(points, 25, 2026).map((p) => p.year)).toEqual([2002, 2025, 2026]);
  });
});
