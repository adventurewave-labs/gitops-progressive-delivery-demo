/**
 * Mock Prometheus query endpoint. Accepts PromQL via ?query= and returns
 * a realistic Prometheus v1/query response. Time-series are generated to
 * match the current demo state — when the canary is broken, the canary
 * series spike to ~15% error rate / ~2000ms p99.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Sample {
  timestamp: number;
  value: number;
}

// In-memory time-series ring buffers, one per metric.
const series = new Map<string, Sample[]>();
const MAX_POINTS = 30;

function pushSample(metric: string, value: number) {
  const arr = series.get(metric) ?? [];
  arr.push({ timestamp: Date.now(), value });
  if (arr.length > MAX_POINTS) arr.shift();
  series.set(metric, arr);
}

// Seed with healthy baseline so charts have history on first render.
function seedIfEmpty(metric: string, baseline: number, jitter: number) {
  if (series.has(metric) && series.get(metric)!.length > 0) return;
  const now = Date.now();
  const arr: Sample[] = [];
  for (let i = MAX_POINTS - 1; i >= 0; i--) {
    arr.push({
      timestamp: now - i * 15000,
      value: baseline + (Math.random() - 0.5) * jitter,
    });
  }
  series.set(metric, arr);
}

seedIfEmpty("stable_error_rate", 0.1, 0.05);
seedIfEmpty("canary_error_rate", 0.1, 0.05);
seedIfEmpty("stable_p99", 150, 20);
seedIfEmpty("canary_p99", 150, 20);

/** Allow the cluster-state endpoint to push fresh samples each tick. */
export function recordMetric(
  metric: "stable_error_rate" | "canary_error_rate" | "stable_p99" | "canary_p99",
  value: number,
) {
  pushSample(metric, value);
}

function makeResult(metric: string, value: number) {
  return [
    {
      metric: { __name__: metric, service: "payments-api" },
      value: [Math.floor(Date.now() / 1000), String(value)],
    },
  ];
}

function makeRangeResult(metric: string) {
  const samples = series.get(metric) ?? [];
  return [
    {
      metric: { __name__: metric, service: "payments-api" },
      values: samples.map((s) => [Math.floor(s.timestamp / 1000), String(s.value)]),
    },
  ];
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get("query") ?? "";
  const isRange = url.searchParams.get("range") === "1";

  // Simulate realistic Prometheus latency
  await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));

  // Pick the metric out of the query string. PromQL like:
  //   rate(http_requests_total{service="payments-api",track="canary",code=~"5.."}[5m]) / rate(http_requests_total{service="payments-api",track="canary"}[5m]) * 100
  let metric = "stable_error_rate";
  let value = 0.1;

  if (query.includes("canary") && query.includes("5..")) {
    metric = "canary_error_rate";
    value = 15.2;
  } else if (query.includes("canary") && query.includes("histogram_quantile")) {
    metric = "canary_p99";
    value = 2042;
  } else if (query.includes("stable") && query.includes("5..")) {
    metric = "stable_error_rate";
    value = 0.08;
  } else if (query.includes("stable") && query.includes("histogram_quantile")) {
    metric = "stable_p99";
    value = 142;
  } else if (query.includes("canary") && query.includes("memory")) {
    metric = "canary_memory";
    value = 1073741824; // 1 GiB (the limit)
  }

  // If a range query, push a fresh sample first so the chart advances.
  if (isRange) {
    pushSample(metric, value);
  }

  return NextResponse.json({
    status: "success",
    data: {
      resultType: isRange ? "matrix" : "vector",
      result: isRange ? makeRangeResult(metric) : makeResult(metric, value),
    },
  });
}
