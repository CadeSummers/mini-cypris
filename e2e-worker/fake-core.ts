// A stand-in for CORE that the Worker talks to during the routing tests.
// Started by playwright.worker.config.ts; run by Node directly (it strips the types).
//
// It answers the two endpoints the app uses with the same made-up data as the
// browser tests, and remembers what it was asked so tests can check it.

import { createServer } from 'node:http';
import { AGGREGATE_RESPONSE, searchResponse } from '../e2e/fixtures.ts';

const PORT = Number(process.env['FAKE_CORE_PORT'] ?? 8789);
const EXPECTED_KEY = process.env['FAKE_CORE_KEY'] ?? '';

interface Call {
  method: string;
  path: string;
  /** Whether the Worker attached the key. The key itself is never stored or printed. */
  hasKey: boolean;
}

const calls: Call[] = [];

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  // For the tests, not part of CORE.
  if (url.pathname === '/__calls') return send(200, calls);

  calls.push({
    method: request.method ?? '',
    path: url.pathname,
    hasKey: request.headers.authorization === `Bearer ${EXPECTED_KEY}`,
  });

  if (request.method === 'GET' && url.pathname === '/v3/search/works/') {
    const limit = Number(url.searchParams.get('limit') ?? 10);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return send(200, searchResponse(limit, offset));
  }
  if (request.method === 'POST' && url.pathname === '/v3/search/works/aggregate') {
    request.resume();
    return send(200, AGGREGATE_RESPONSE);
  }
  return send(404, { message: 'The fake CORE does not serve this path.' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake CORE listening on ${PORT}`));
