"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Gauge, AlertOctagon } from "lucide-react";
import {
  METRICS,
  isSloViolated,
  type DemoState,
} from "@/lib/demo-state";

interface PrometheusMetricsCardProps {
  state: DemoState;
  /** Historical time-series of error-rate samples (0..100). */
  errorSeries: { t: string; v: number }[];
  /** Historical time-series of p99 latency samples (ms). */
  latencySeries: { t: string; v: number }[];
}

/**
 * Prometheus metrics panel. Two stacked line charts:
 *   1. HTTP Error Rate (%)  — emerald baseline, red when SLO violated
 *   2. P99 Latency (ms)     — emerald baseline, amber when elevated
 */
export function PrometheusMetricsCard({
  state,
  errorSeries,
  latencySeries,
}: PrometheusMetricsCardProps) {
  const slo = isSloViolated(state);
  const current = METRICS[state];

  const errorColor = slo ? "#f87171" : "#34d399"; // red-400 / emerald-400
  const latencyColor =
    current.p99Latency > 500 ? "#fbbf24" : "#34d399"; // amber-400 / emerald-400

  // Stable max so the chart axis doesn't jump around when the spike arrives.
  const latencyMax = useMemo(() => 2200, []);
  const errorMax = useMemo(() => 18, []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-md ${
              slo
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
              scrape: payments-api / 15s
            </p>
          </div>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${
            slo
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {slo ? "SLO VIOLATED" : "SLO HEALTHY"}
        </span>
      </div>

      {/* Error rate chart */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <AlertOctagon className="h-3 w-3" />
            <span className="uppercase tracking-widest text-zinc-500">
              http_error_rate
            </span>
          </div>
          <span
            className={`font-mono font-semibold ${
              slo ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {current.errorRate.toFixed(1)}%
          </span>
        </div>
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={errorSeries}
              margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
            >
              <defs>
                <linearGradient id="errGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={errorColor} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={errorColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#27272a"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 9, fill: "#52525b", fontFamily: "var(--font-geist-mono)" }}
                tickLine={false}
                axisLine={{ stroke: "#27272a" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, errorMax]}
                tick={{ fontSize: 9, fill: "#52525b", fontFamily: "var(--font-geist-mono)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "#09090b",
                  border: "1px solid #27272a",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono)",
                  color: "#e4e4e7",
                }}
                labelStyle={{ color: "#a1a1aa" }}
                formatter={(v: number) => [`${v.toFixed(2)}%`, "error_rate"]}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={errorColor}
                strokeWidth={1.6}
                fill="url(#errGrad)"
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Latency chart */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Gauge className="h-3 w-3" />
            <span className="uppercase tracking-widest text-zinc-500">
              http_request_duration_p99
            </span>
          </div>
          <span
            className={`font-mono font-semibold ${
              current.p99Latency > 500 ? "text-amber-400" : "text-emerald-400"
            }`}
          >
            {Math.round(current.p99Latency)} ms
          </span>
        </div>
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={latencySeries}
              margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
            >
              <CartesianGrid
                stroke="#27272a"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 9, fill: "#52525b", fontFamily: "var(--font-geist-mono)" }}
                tickLine={false}
                axisLine={{ stroke: "#27272a" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, latencyMax]}
                tick={{ fontSize: 9, fill: "#52525b", fontFamily: "var(--font-geist-mono)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "#09090b",
                  border: "1px solid #27272a",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono)",
                  color: "#e4e4e7",
                }}
                labelStyle={{ color: "#a1a1aa" }}
                formatter={(v: number) => [`${Math.round(v)} ms`, "p99"]}
              />
              <Line
                type="monotone"
                dataKey="v"
                stroke={latencyColor}
                strokeWidth={1.6}
                isAnimationActive={false}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SLO thresholds */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
          error budget{" "}
          <span className="font-mono text-zinc-300">≤ 1.0%</span>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
          p99 target{" "}
          <span className="font-mono text-zinc-300">≤ 500 ms</span>
        </div>
      </div>
    </div>
  );
}
