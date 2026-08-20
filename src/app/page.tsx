"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Play,
  RotateCcw,
  Github,
  Rocket,
  Cpu,
  Boxes,
  Activity,
  Bot,
  ChevronRight,
} from "lucide-react";

import { ArgoSyncCard } from "@/components/ArgoSyncCard";
import { RolloutsTrafficCard } from "@/components/RolloutsTrafficCard";
import { PrometheusMetricsCard } from "@/components/PrometheusMetricsCard";
import { K8sGPTTerminalCard } from "@/components/K8sGPTTerminalCard";
import {
  K8SGPT_STREAM,
  METRICS,
  STATE_DURATION_MS,
  STATE_LABEL,
  STATE_ORDER,
  STATE_TEXT_COLOR,
  type DemoState,
} from "@/lib/demo-state";

const TICK_MS = 1000; // Prometheus scrape cadence for the time-series charts

export default function Home() {
  const [state, setState] = useState<DemoState>("idle");
  const [tick, setTick] = useState(0);
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [cursorActive, setCursorActive] = useState(false);

  // Prometheus time-series ring buffers (kept short so the chart scrolls).
  const [errorSeries, setErrorSeries] = useState<{ t: string; v: number }[]>(
    () => seedSeries(0.1),
  );
  const [latencySeries, setLatencySeries] = useState<{ t: string; v: number }[]>(
    () => seedSeries(150),
  );

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunning = state !== "idle";

  /* ---------- helpers ---------- */

  function clearAllTimers() {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
  }

  /* ---------- advance the state machine ---------- */

  const scheduleAdvance = useCallback((current: DemoState) => {
    const idx = STATE_ORDER.indexOf(current);
    if (idx === -1 || idx >= STATE_ORDER.length - 1) return; // rollback = terminal
    const duration = STATE_DURATION_MS[current];
    if (!duration) return;
    advanceTimer.current = setTimeout(() => {
      const next = STATE_ORDER[idx + 1];
      setState(next);
    }, duration);
  }, []);

  /* ---------- K8sGPT stream ---------- */

  const startStream = useCallback(() => {
    // Defensive: clear any prior stream interval before starting a fresh one
    // (prevents duplicate intervals if startStream is invoked twice, e.g.,
    // by React strict-mode / fast-refresh double-invocation).
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
    setVisibleLines([]);
    setCursorActive(true);
    let i = 0;
    streamTimer.current = setInterval(() => {
      if (i >= K8SGPT_STREAM.length) {
        if (streamTimer.current) {
          clearInterval(streamTimer.current);
          streamTimer.current = null;
        }
        setCursorActive(false);
        return;
      }
      const nextLine = K8SGPT_STREAM[i];
      if (typeof nextLine === "string") {
        setVisibleLines((prev) => [...prev, nextLine]);
      }
      i += 1;
    }, 700); // ~0.70s per line => 9 lines ≈ 6.3s, fits inside the 8s analyzing window with buffer
  }, []);

  /* ---------- state transitions ---------- */
  //
  // The setState calls inside this effect are intentional: when the state
  // machine enters a new phase, we synchronously derive the terminal cursor
  // + visible-lines state for that phase. They are not subscriptions and
  // they don't read from external systems, so the "set-state-in-effect" rule
  // doesn't really apply — disable it for the whole block.
  //
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (state === "idle") {
      clearAllTimers();
      setVisibleLines([]);
      setCursorActive(false);
      return;
    }
    if (state === "rollback") {
      clearAllTimers();
      // If the stream was still in flight when rollback began (e.g., timing
      // jitter), flush the remaining K8sGPT lines so the terminal tells the
      // complete story in the final state.
      setVisibleLines((prev) => {
        if (prev.length >= K8SGPT_STREAM.length) return prev;
        return [...K8SGPT_STREAM];
      });
      setCursorActive(false);
      return;
    }
    if (state === "syncing") {
      // Reset terminal for a fresh run.
      setVisibleLines([]);
      setCursorActive(false);
    } else if (state === "anomaly") {
      // SLO violation detected — start blinking the terminal cursor while
      // K8sGPT warms up.
      setCursorActive(true);
    } else if (state === "analyzing") {
      // Stream the AI diagnosis line-by-line.
      startStream();
    }

    scheduleAdvance(state);
    return () => {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current);
        advanceTimer.current = null;
      }
    };
  }, [state, scheduleAdvance, startStream]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ---------- Prometheus sampling loop ---------- */

  useEffect(() => {
    metricTimer.current = setInterval(() => {
      setTick((t) => t + 1);
      const target = METRICS[state];
      // Add a little jitter so the chart doesn't look like a flat line.
      const errJitter = (Math.random() - 0.5) * 0.15;
      const latJitter = (Math.random() - 0.5) * 30;
      const err = clamp(target.errorRate + errJitter, 0, 100);
      const lat = clamp(target.p99Latency + latJitter, 0, 5000);
      const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });

      setErrorSeries((prev) => pushSample(prev, { t: stamp, v: round2(err) }, 24));
      setLatencySeries((prev) =>
        pushSample(prev, { t: stamp, v: Math.round(lat) }, 24),
      );
    }, TICK_MS);
    return () => {
      if (metricTimer.current) {
        clearInterval(metricTimer.current);
        metricTimer.current = null;
      }
    };
  }, [state]);

  /* ---------- public actions ---------- */

  const startRollout = () => {
    if (state !== "idle") return;
    setErrorSeries(seedSeries(0.1));
    setLatencySeries(seedSeries(150));
    setVisibleLines([]);
    setCursorActive(false);
    setState("syncing");
  };

  const reset = () => {
    clearAllTimers();
    setState("idle");
    setVisibleLines([]);
    setCursorActive(false);
    setErrorSeries(seedSeries(0.1));
    setLatencySeries(seedSeries(150));
  };

  /* ---------- render ---------- */

  const busy = isRunning && state !== "rollback";

  return (
    <main className="min-h-screen bg-zinc-950 bg-grid text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        {/* ---- Header ---- */}
        <header className="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              adventurewave-labs
              <ChevronRight className="h-3 w-3 text-zinc-700" />
              <span className="text-zinc-400">gitops-progressive-delivery-demo</span>
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
              AI-Driven Progressive Delivery &amp; Incident Response
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              An interactive simulation of a GitOps pipeline: Argo CD syncs a new
              release, Argo Rollouts shifts canary traffic, Prometheus detects an
              SLO burn, and K8sGPT diagnoses + auto-rolls back.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href="https://github.com/adventurewave-labs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
            >
              <Github className="h-3.5 w-3.5" />
              adventurewave-labs
            </a>

            {state === "idle" && (
              <button
                onClick={startRollout}
                className="group inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition-all hover:border-emerald-500 hover:bg-emerald-500/20 hover:shadow-[0_0_20px_-4px_rgba(16,185,129,0.5)]"
              >
                <Play className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
                Start Rollout
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-200">
                  v2.4
                </span>
              </button>
            )}

            {busy && (
              <span className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-amber-400"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                />
                Pipeline running…
              </span>
            )}

            {state === "rollback" && (
              <button
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Demo
              </button>
            )}
          </div>
        </header>

        {/* ---- State pill row ---- */}
        <StateRail state={state} tick={tick} />

        {/* ---- Stack legend ---- */}
        <StackLegend />

        {/* ---- Main 2-col grid ---- */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <div className="flex flex-col gap-4 lg:gap-5">
            <ArgoSyncCard state={state} />
            <RolloutsTrafficCard state={state} />
          </div>
          <div className="flex flex-col gap-4 lg:gap-5">
            <PrometheusMetricsCard
              state={state}
              errorSeries={errorSeries}
              latencySeries={latencySeries}
            />
            <K8sGPTTerminalCard
              state={state}
              visibleLines={visibleLines}
              cursorActive={cursorActive}
            />
          </div>
        </div>

        {/* ---- Footer ---- */}
        <footer className="mt-8 border-t border-zinc-800 pt-5 text-[11px] text-zinc-500">
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              Built with Next.js · Argo CD · Argo Rollouts · Prometheus · K8sGPT
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-zinc-600">tick #{tick}</span>
              <span className="text-zinc-700">·</span>
              <span>state: <span className="font-mono text-zinc-400">{state}</span></span>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

/* ============================================================== */
/* Sub-components                                                  */
/* ============================================================== */

/** Horizontal pill row showing every state of the pipeline + current. */
function StateRail({ state, tick }: { state: DemoState; tick: number }) {
  const allStates: DemoState[] = [
    "idle",
    "syncing",
    "canary20",
    "canary50",
    "anomaly",
    "analyzing",
    "rollback",
  ];
  const currentIdx = allStates.indexOf(state);

  return (
    <div className="mb-4 overflow-x-auto">
      <div className="flex min-w-max items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
        {allStates.map((s, i) => {
          const isCurrent = s === state;
          const isPast = currentIdx > i;
          const isFuture = currentIdx < i;
          return (
            <div key={s} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest transition-colors ${
                  isCurrent
                    ? `${STATE_TEXT_COLOR[s]} bg-zinc-800/80`
                    : isPast
                      ? "text-zinc-500"
                      : "text-zinc-600"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isCurrent
                      ? s === "anomaly" || s === "analyzing"
                        ? "bg-red-400"
                        : s === "rollback"
                          ? "bg-emerald-400"
                          : "bg-amber-400"
                      : isPast
                        ? "bg-zinc-600"
                        : "bg-zinc-700"
                  }`}
                />
                {STATE_LABEL[s]}
              </div>
              {i < allStates.length - 1 && (
                <ChevronRight className="mx-0.5 h-3 w-3 text-zinc-700" />
              )}
            </div>
          );
        })}
        <div className="ml-2 hidden pl-2 font-mono text-[10px] text-zinc-600 sm:block">
          {`// tick ${tick}`}
        </div>
      </div>
    </div>
  );
}

/** Small legend explaining the simulated OSS stack. */
function StackLegend() {
  const items = [
    {
      icon: Boxes,
      name: "Argo CD",
      role: "GitOps sync",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      icon: Rocket,
      name: "Argo Rollouts",
      role: "Canary + traffic shift",
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      icon: Activity,
      name: "Prometheus",
      role: "SLO metrics",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      icon: Bot,
      name: "K8sGPT",
      role: "AI SRE diagnosis",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(({ icon: Icon, name, role, color, bg }) => (
        <div
          key={name}
          className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
        >
          <div className={`flex h-7 w-7 items-center justify-center rounded-md ${bg} ${color}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-zinc-200">{name}</div>
            <div className="truncate text-[10px] uppercase tracking-wider text-zinc-500">
              {role}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================== */
/* Utilities                                                      */
/* ============================================================== */

function seedSeries(baseline: number): { t: string; v: number }[] {
  const now = Date.now();
  const out: { t: string; v: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const stamp = new Date(now - i * TICK_MS).toLocaleTimeString("en-US", {
      hour12: false,
    });
    out.push({
      t: stamp,
      v: round2(baseline + (Math.random() - 0.5) * 0.1),
    });
  }
  return out;
}

function pushSample<T>(arr: T[], item: T, cap: number): T[] {
  const next = [...arr, item];
  if (next.length > cap) next.shift();
  return next;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
