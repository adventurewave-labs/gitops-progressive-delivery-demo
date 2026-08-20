"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Activity, Gauge, AlertOctagon, Database } from "lucide-react";
import type { ClusterState } from "@/hooks/use-cluster-state";

interface Props {
  metrics: ClusterState["metrics"];
  slo: ClusterState["slo"];
}

interface Sample { t: string; v: number; }

function usePromSeries(query: string) {
  const [series, setSeries] = useState<Sample[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(
          `/api/prometheus?query=${encodeURIComponent(query)}&range=1`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = await res.json();
        const values = data?.data?.result?.[0]?.values ?? [];
        const samples: Sample[] = values.map(([ts, val]: [number, string]) => ({
          t: new Date(ts * 1000).toLocaleTimeString("en-US", { hour12: false }),
          v: Number(val),
        }));
        if (!cancelled) setSeries(samples);
      } catch {
        /* swallow — chart just won't update this tick */
      }
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [query]);
  return series;
}

export function PrometheusMetricsCard({ metrics, slo }: Props) {
  const errSeries = usePromSeries(
    'rate(http_requests_total{service="payments-api",track="canary",code=~"5.."}[5m]) / rate(http_requests_total{service="payments-api",track="canary"}[5m]) * 100',
  );
  const latSeries = usePromSeries(
    'histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{service="payments-api",track="canary"}[5m])) * 1000',
  );

  const violated = slo.status === "violated";
  const errColor = violated ? "#f87171" : "#34d399";
  const latColor = metrics.canaryP99 > 500 ? "#fbbf24" : "#34d399";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-md ${
              violated
                ? "bg-red-500/10 text-red-400"
                : "bg-emerald-500/10 text-emerald-400"
            }`}
          >
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
              Prometheus · SLO Metrics
            </h2>
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">
              scrape: payments-api / 15s · prometheus.internal.acme.io
            </p>
          </div>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${
            violated
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {violated ? "SLO VIOLATED" : "SLO HEALTHY"}
        </span>
      </div>

      {/* Error rate */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <AlertOctagon className="h-3 w-3" />
            <code className="font-mono text-zinc-500">http_error_rate</code>
            <span className="text-zinc-600">(canary)</span>
          </div>
          <span
            className={`font-mono font-semibold ${
              violated ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {metrics.canaryErrorRate.toFixed(1)}%
          </span>
        </div>
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={errSeries} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={errColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={errColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#52525b" }} tickLine={false} axisLine={{ stroke: "#27272a" }} interval="preserveStartEnd" />
              <YAxis domain={[0, 18]} tick={{ fontSize: 9, fill: "#52525b" }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "#09090b",
                  border: "1px solid #27272a",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#e4e4e7",
                }}
                formatter={(v: number) => [`${v.toFixed(2)}%`, "error_rate"]}
              />
              <Area type="monotone" dataKey="v" stroke={errColor} strokeWidth={1.6} fill="url(#errGrad)" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Latency */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Gauge className="h-3 w-3" />
            <code className="font-mono text-zinc-500">http_request_duration_p99</code>
            <span className="text-zinc-600">(canary, ms)</span>
          </div>
          <span
            className={`font-mono font-semibold ${
              metrics.canaryP99 > 500 ? "text-amber-400" : "text-emerald-400"
            }`}
          >
            {Math.round(metrics.canaryP99)} ms
          </span>
        </div>
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={latSeries} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={latColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={latColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#52525b" }} tickLine={false} axisLine={{ stroke: "#27272a" }} interval="preserveStartEnd" />
              <YAxis domain={[0, 2200]} tick={{ fontSize: 9, fill: "#52525b" }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "#09090b",
                  border: "1px solid #27272a",
                  borderRadius: 6,
                  fontSize: 11,
                  color: "#e4e4e7",
                }}
                formatter={(v: number) => [`${Math.round(v)} ms`, "p99"]}
              />
              <Area type="monotone" dataKey="v" stroke={latColor} strokeWidth={1.6} fill="url(#latGrad)" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* PromQL query bar — shows the actual query being executed */}
      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
          <Database className="h-3 w-3" />
          promql · live query
        </div>
        <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-zinc-400">
{`rate(http_requests_total{service="payments-api",track="canary",code=~"5.."}[5m])
/ rate(http_requests_total{service="payments-api",track="canary"}[5m]) * 100`}
        </pre>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
          error budget <span className="font-mono text-zinc-300">≤ 1.0%</span>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
          p99 target <span className="font-mono text-zinc-300">≤ 500 ms</span>
        </div>
      </div>
    </div>
  );
}
