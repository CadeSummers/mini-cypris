import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Paper } from '../core-api/paper';
import { PaperMetrics } from '../metrics/paper-metrics';
import { PaperCard } from './paper-card';

const PAPER: Paper = {
  id: '1',
  title: 'Drone delivery of medical supplies',
  authors: ['A. Author'],
  abstract: 'An abstract.',
  year: 2023,
  doi: '10.3390/drones7030191',
  url: 'https://doi.org/10.3390/drones7030191',
  pdfUrl: null,
  publisher: 'MDPI',
  documentType: 'research',
  citationCount: 0,
};

const FULL: PaperMetrics = {
  citations: 1360,
  fwci: 12.4,
  percentile: 99,
  rcr: 1.966,
  author: { name: 'Xueping Li', hIndex: 37 },
  journal: { name: 'Drones', hIndex: 103 },
  publisher: { name: 'MDPI', hIndex: 1893 },
};

describe('PaperCard metrics', () => {
  let fixture: ComponentFixture<PaperCard>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (item: Element | null) => (item?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const row = () =>
    [...el().querySelectorAll('.metric')].map(
      (item) => `${text(item.querySelector('dt'))} ${text(item.querySelector('dd'))}`,
    );

  async function show(metrics: PaperMetrics | null): Promise<void> {
    fixture.componentRef.setInput('paper', PAPER);
    fixture.componentRef.setInput('metrics', metrics);
    await fixture.whenStable();
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(PaperCard);
  });

  it('shows every metric it has, in a fixed order', async () => {
    await show(FULL);
    expect(row()).toEqual([
      'Citations 1,360',
      'FWCI 12.40',
      'RCR 1.97',
      'Author h-index 37 (Xueping Li)',
      'Journal h-index 103',
      'Publisher h-index 1,893',
    ]);
  });

  it('explains each number where it is shown', async () => {
    await show(FULL);
    const meanings = [...el().querySelectorAll('.metric')].map((item) =>
      item.getAttribute('title'),
    );
    expect(meanings[1]).toContain('Field-Weighted Citation Impact');
    expect(meanings[1]).toContain('percentile 99');
    expect(meanings[2]).toContain('Relative Citation Ratio');
    expect(meanings[3]).toContain('first and last author');
  });

  it('leaves out what a paper does not have, but keeps a real count of zero', async () => {
    await show({ ...FULL, citations: 0, fwci: null, rcr: null, journal: null, publisher: null });
    expect(row()).toEqual(['Citations 0', 'Author h-index 37 (Xueping Li)']);
  });

  it('shows no metrics row at all for a paper without data', async () => {
    await show(null);
    expect(el().querySelector('.metrics')).toBeNull();
    // CORE's own citation count is always 0 and is no longer shown.
    expect(el().textContent).not.toContain('citation');
  });
});
