import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Paper } from '../core-api/paper';

/** An author, journal or publisher with its h-index. */
export interface NamedIndex {
  name: string;
  hIndex: number;
}

/**
 * Citation context for one paper. Every value can be missing: a paper that is
 * not in PubMed has no RCR, one outside a journal has no journal h-index.
 */
export interface PaperMetrics {
  citations: number | null;
  /** Field-Weighted Citation Impact, as OpenAlex calculates it; 1.0 is average. */
  fwci: number | null;
  /** Where the paper sits among similar papers by citations, 0 to 100. */
  percentile: number | null;
  /** NIH's Relative Citation Ratio; 1.0 is the median NIH-funded paper. */
  rcr: number | null;
  /** The highest h-index among the paper's authors. */
  author: NamedIndex | null;
  journal: NamedIndex | null;
  publisher: NamedIndex | null;
}

/** The most DOIs one request may carry (worker/paper-metrics.js enforces the same). */
const MAX_DOIS = 100;

interface MetricsResponse {
  metrics?: Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNamed(value: unknown): NamedIndex | null {
  const item = value as { name?: unknown; hIndex?: unknown } | null;
  const hIndex = toNumber(item?.hIndex);
  return typeof item?.name === 'string' && item.name && hIndex !== null
    ? { name: item.name, hIndex }
    : null;
}

/** Reads one paper's metrics defensively; null if there is nothing usable. */
export function toPaperMetrics(value: unknown): PaperMetrics | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const metrics: PaperMetrics = {
    citations: toNumber(raw['citations']),
    fwci: toNumber(raw['fwci']),
    percentile: toNumber(raw['percentile']),
    rcr: toNumber(raw['rcr']),
    author: toNamed(raw['author']),
    journal: toNamed(raw['journal']),
    publisher: toNamed(raw['publisher']),
  };
  return Object.values(metrics).some((item) => item !== null) ? metrics : null;
}

/** DOIs are matched without regard to case. */
function doiKey(paper: Paper): string | null {
  return paper.doi ? paper.doi.trim().toLowerCase() : null;
}

/**
 * Citation metrics for the papers on screen, fetched from the app's own
 * /metrics endpoint (worker/paper-metrics.js), which asks OpenAlex and NIH
 * iCite. Papers are matched by DOI, so a paper without one has no metrics.
 *
 * Answers are kept for the session: going back to an earlier search, or
 * loading more papers, only asks about DOIs not seen before.
 */
@Injectable({ providedIn: 'root' })
export class PaperMetricsStore {
  private readonly http = inject(HttpClient);

  /** Every DOI asked about so far; null means "looked up, nothing found". */
  private readonly known = signal<ReadonlyMap<string, PaperMetrics | null>>(new Map());
  private readonly requested = new Set<string>();
  private readonly _unavailable = signal(false);

  /** True when the last lookup failed; the papers themselves are unaffected. */
  readonly unavailable = this._unavailable.asReadonly();

  /** The metrics for a paper, or null if it has none (or they have not arrived yet). */
  for(paper: Paper): PaperMetrics | null {
    const key = doiKey(paper);
    return key ? (this.known().get(key) ?? null) : null;
  }

  /** Asks for the metrics of any of these papers not already asked about. */
  ensure(papers: readonly Paper[]): void {
    const missing = new Set<string>();
    for (const paper of papers) {
      const key = doiKey(paper);
      if (key && !this.requested.has(key)) missing.add(key);
    }
    const dois = [...missing];
    for (let start = 0; start < dois.length; start += MAX_DOIS) {
      this.fetch(dois.slice(start, start + MAX_DOIS));
    }
  }

  private fetch(dois: string[]): void {
    for (const doi of dois) this.requested.add(doi);

    this.http.post<MetricsResponse>('/metrics', { dois }).subscribe({
      next: (response) => {
        const found = response?.metrics ?? {};
        this.known.update((known) => {
          const next = new Map(known);
          for (const doi of dois) next.set(doi, toPaperMetrics(found[doi]));
          return next;
        });
        this._unavailable.set(false);
      },
      error: () => {
        // Forget the attempt so the next search or "Load more" tries again.
        for (const doi of dois) this.requested.delete(doi);
        this._unavailable.set(true);
      },
    });
  }
}

export type PaperSort = 'relevance' | 'citations' | 'fwci';

/**
 * Orders papers by a metric, highest first. Papers without that metric keep
 * their original order at the end; 'relevance' is the order CORE returned.
 */
export function sortPapers(
  papers: readonly Paper[],
  sort: PaperSort,
  metricsFor: (paper: Paper) => PaperMetrics | null,
): Paper[] {
  if (sort === 'relevance') return [...papers];
  const value = (paper: Paper) => metricsFor(paper)?.[sort] ?? null;
  return papers
    .map((paper, index) => ({ paper, index, value: value(paper) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      return b.value - a.value || a.index - b.index;
    })
    .map((entry) => entry.paper);
}
