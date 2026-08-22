/**
 * Prometheus proxy — REWRITTEN to forward queries to the REAL Prometheus instance.
 *
 * Accepts ?query=... and optionally &range=1 for range queries.
 * Returns the raw Prometheus JSON response unchanged.
 */
import { NextRequest, NextResponse } from 'next/server';

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:30900';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get('query') ?? '';
  const isRange = url.searchParams.get('range') === '1';

  if (!query) {
    return NextResponse.json({ status: 'error', errorType: 'bad_data', error: 'missing query parameter' });
  }

  const endpoint = isRange ? '/api/v1/query_range' : '/api/v1/query';
  const targetUrl = new URL(endpoint, PROMETHEUS_URL);
  targetUrl.searchParams.set('query', query);

  if (isRange) {
    const now = Math.floor(Date.now() / 1000);
    targetUrl.searchParams.set('start', String(now - 600));
    targetUrl.searchParams.set('end', String(now));
    targetUrl.searchParams.set('step', '15');
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      // @ts-ignore
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { status: 'error', errorType: 'internal', error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
