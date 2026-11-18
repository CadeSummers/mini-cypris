/**
 * Synthetic data in the shape CORE v3 returns (see src/app/core-api/core-api.models.ts).
 * None of these papers exist; the titles only need to contain the words the tests search for.
 */

const TITLES = [
  'Drone delivery of medical supplies in rural areas',
  'Routing algorithms for urban drone package delivery',
  'Battery limits of delivery drones',
  'Public acceptance of drones in urban airspace',
  'A survey of last-mile package delivery',
  'Drone swarms for parcel logistics',
  'Noise from delivery drones over housing',
  'Regulating commercial drone flights',
  'Weather effects on drone delivery reliability',
  'Cost models for package delivery by drone',
];

const YEARS = [2025, 2024, 2024, 2023, 2023, 2023, 2022, 2021, 2020, 2019];

export const TOTAL_HITS = 1234;

export function makeWork(index: number) {
  const base = index % TITLES.length;
  const round = Math.floor(index / TITLES.length);
  return {
    id: 1000 + index,
    title: round ? `${TITLES[base]} (study ${round + 1})` : TITLES[base],
    abstract: `We study drones and delivery in setting ${index + 1}. Results are reported.`,
    authors: [{ name: `Author ${index + 1}` }, { name: 'Sam Example' }],
    yearPublished: YEARS[base],
    doi: `10.0000/example.${index + 1}`,
    downloadUrl: null,
    publisher: base % 2 ? 'Example Press' : 'Sample University',
    documentType: base % 3 ? 'research' : 'thesis',
    citationCount: base,
  };
}

/** A page of search results, as `GET /v3/search/works/` answers. */
export function searchResponse(limit: number, offset = 0, totalHits = TOTAL_HITS) {
  const count = Math.max(Math.min(limit, totalHits - offset), 0);
  return {
    totalHits,
    limit,
    offset,
    results: Array.from({ length: count }, (_, i) => makeWork(offset + i)),
  };
}

/** Counts over every matching paper, as `POST /v3/search/works/aggregate` answers. */
export const AGGREGATE_RESPONSE = {
  aggregations: {
    yearPublished: {
      '2019': 60,
      '2020': 95,
      '2021': 140,
      '2022': 210,
      '2023': 305,
      '2024': 280,
      '2025': 144,
    },
    documentType: { research: 900, thesis: 250, presentation: 84 },
    publisher: { 'Aerial Systems Society': 412, 'Logistics Review': 198, 'Open Flight Press': 77 },
    authors: { 'Rivera, Ana': 21, 'Chen, Wei': 17, 'Okafor, Ngozi': 9 },
  },
};
