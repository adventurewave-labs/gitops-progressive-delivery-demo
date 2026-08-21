/**
 * Real Prometheus client.
 * Proxies queries to the actual Prometheus instance in the cluster.
 */

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:30900';

export interface PrometheusQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: [number, string][];
    }>;
  };
}

/** Execute an instant query against real Prometheus */
export async function queryInstant(promql: string): Promise<PrometheusQueryResult> {
  const url = new URL(`${PROMETHEUS_URL}/api/v1/query`);
  url.searchParams.set('query', promql);

  const res = await fetch(url.toString(), {
    // @ts-ignore — Node 20 supports this
    signal: AbortSignal.timeout(5000),
  });
  return res.json();
}

/** Execute a range query against real Prometheus */
export async function queryRange(promql: string, rangeSeconds = 600, step = 15): Promise<PrometheusQueryResult> {
  const url = new URL(`${PROMETHEUS_URL}/api/v1/query_range`);
  url.searchParams.set('query', promql);
  url.searchParams.set('start', String(Math.floor(Date.now() / 1000) - rangeSeconds));
  url.searchParams.set('end', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('step', String(step));

  const res = await fetch(url.toString(), {
    // @ts-ignore — Node 20 supports this
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

/** Extract a single numeric value from a Prometheus instant query result */
export function extractValue(result: PrometheusQueryResult, fallback = 0): number {
  try {
    const val = result.data?.result?.[0]?.value?.[1];
    return val !== undefined ? parseFloat(val) : fallback;
  } catch {
    return fallback;
  }
}
