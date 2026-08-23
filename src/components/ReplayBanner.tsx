"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, RotateCcw, History, ExternalLink, AlertTriangle, Radio } from "lucide-react";
import type { ReplayController } from "@/hooks/use-replay-state";

interface Props {
  controller: ReplayController;
  /** When a live cluster becomes available mid-replay, show the switch notice. */
  liveAvailable?: boolean;
  onSwitchToLive?: () => void;
}

/**
 * Replay banner — PRD §4.3.1.
 *
 * Top of the page, prominent, clearly labeled as replay. Contains:
 *   - the "Replay Mode" pill
 *   - timestamp of the recording + source cluster
 *   - link to the full recorded video (showcase/index.html)
 *   - timeline scrubber + play/pause/restart controls
 */
export function ReplayBanner({ controller, liveAvailable, onSwitchToLive }: Props) {
  const { recordedAt, totalDurationMs, elapsedMs, progress, playing, play, pause, restart, seek, error } = controller;

  const recordedLabel = new Date(recordedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Phase marker labels for the timeline.
  const phaseMarkers: { t: number; label: string }[] = [
    { t: 0, label: "idle" },
    { t: 2_000, label: "sync" },
    { t: 5_000, label: "20%" },
    { t: 9_000, label: "50%" },
    { t: 13_000, label: "anomaly" },
    { t: 16_000, label: "AI" },
    { t: 20_000, label: "rollback" },
    { t: 30_000, label: "done" },
  ];

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/5 backdrop-blur">
      {/* Banner header */}
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-400">
            <History className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                Replay Mode
              </span>
              <span className="text-sm font-semibold text-zinc-100">
                Showing a recorded session from a live k3s cluster
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              Recorded on{" "}
              <time dateTime={recordedAt} className="font-mono text-zinc-300">
                {recordedLabel}
              </time>{" "}
              · {controller.totalDurationMs / 1000}s loop ·{" "}
              <a
                href="/showcase/index.html"
                className="inline-flex items-center gap-1 font-medium text-amber-400 underline-offset-2 hover:underline"
              >
                watch full recording <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>

        {/* Transport controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={playing ? pause : play}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={restart}
            aria-label="Restart replay"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <span className="ml-1.5 font-mono text-[11px] tabular-nums text-zinc-400">
            {(elapsedMs / 1000).toFixed(1)}s / {(totalDurationMs / 1000).toFixed(0)}s
          </span>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="border-t border-amber-500/20 px-4 py-3 sm:px-5">
        <TimelineScrubber
          progress={progress}
          onSeek={seek}
          markers={phaseMarkers}
          totalDurationMs={totalDurationMs}
        />
      </div>

      {/* Live-cluster switch notice (PRD §4.6 case 2) */}
      <AnimatePresence>
        {liveAvailable && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-emerald-500/30 bg-emerald-500/10"
          >
            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-2 text-sm text-emerald-200">
                <Radio className="h-4 w-4 animate-pulse" />
                <span>A live cluster just became reachable.</span>
              </div>
              <button
                type="button"
                onClick={onSwitchToLive}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/30"
              >
                Switch to live dashboard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixture load failure (PRD §4.6 case 1) */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="overflow-hidden border-t border-red-500/30 bg-red-500/10"
          >
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-200 sm:px-5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Fixture load failure: {error}. Falling back to a screenshot of the dashboard.</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TimelineScrubber                                                    */
/* ------------------------------------------------------------------ */

interface ScrubberProps {
  progress: number;
  onSeek: (p: number) => void;
  markers: { t: number; label: string }[];
  totalDurationMs: number;
}

function TimelineScrubber({ progress, onSeek, markers, totalDurationMs }: ScrubberProps) {
  const [hovering, setHovering] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillPct = Math.max(0, Math.min(100, progress * 100));

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek(x / rect.width);
  }

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Replay timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={totalDurationMs}
        aria-valuenow={Math.round(progress * totalDurationMs)}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.05));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.05));
          if (e.key === " ") {
            e.preventDefault();
          }
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="group relative h-8 cursor-pointer"
      >
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-800/80" />
        {/* Fill */}
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-500/60 to-amber-400 transition-[width] duration-75"
          style={{ width: `${fillPct}%` }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400 bg-zinc-950 shadow-md transition-transform group-hover:scale-110"
          style={{ left: `${fillPct}%` }}
        />
        {/* Phase markers */}
        <div className="absolute inset-x-0 top-0 flex h-full items-center pointer-events-none">
          {markers.map((m) => {
            const pct = (m.t / totalDurationMs) * 100;
            const passed = progress * totalDurationMs >= m.t;
            return (
              <div
                key={m.label}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${pct}%` }}
              >
                <div
                  className={`h-1 w-px ${passed ? "bg-amber-400/60" : "bg-zinc-700"}`}
                  style={{ marginTop: "0.875rem" }}
                />
                <span
                  className={`mt-1 font-mono text-[9px] uppercase tracking-wider ${
                    hovering || passed ? "text-zinc-400" : "text-zinc-600"
                  }`}
                >
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
