"use client";

import { Play, Pause, RotateCcw, Film, ExternalLink } from "lucide-react";
import { Slider } from "@/components/ui/slider";

export interface ReplayBannerProps {
  /** Whether the replay is currently playing */
  isPlaying: boolean;
  /** Progress as 0–1 */
  progress: number;
  /** Total duration in ms */
  duration: number;
  /** ISO timestamp of the original recording */
  recordingTimestamp: string | null;
  /** Resume playback */
  onPlay: () => void;
  /** Pause playback */
  onPause: () => void;
  /** Seek to 0–1 */
  onSeek: (pct: number) => void;
}

export function ReplayBanner({
  isPlaying,
  progress,
  duration,
  recordingTimestamp,
  onPlay,
  onPause,
  onSeek,
}: ReplayBannerProps) {
  const elapsed = progress * duration;
  const elapsedSec = (elapsed / 1000).toFixed(1);
  const totalSec = (duration / 1000).toFixed(1);

  const formattedDate = recordingTimestamp
    ? new Date(recordingTimestamp).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      {/* Top row: badge + label + link */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-300">
          <Film className="h-3.5 w-3.5" />
          Replay
        </span>
        <span className="text-sm font-medium text-amber-200">
          Replay Mode — Showing a recorded session from a live k3s cluster
        </span>
        <span className="hidden text-xs text-amber-400/70 sm:inline">
          recorded {formattedDate}
        </span>
        <a
          href="/showcase/index.html"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-amber-400 transition-colors hover:text-amber-200"
        >
          <ExternalLink className="h-3 w-3" />
          Full video
        </a>
      </div>

      {/* Mobile: recording date on its own line */}
      <div className="mt-1 text-xs text-amber-400/70 sm:hidden">
        recorded {formattedDate}
      </div>

      {/* Timeline scrubber */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-300 transition-colors hover:border-amber-500/60 hover:bg-amber-500/25"
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="flex-1">
          <Slider
            value={[progress * 100]}
            min={0}
            max={100}
            step={0.1}
            onValueChange={([v]) => onSeek(v / 100)}
            className="[&_[data-slot=slider-track]]:bg-amber-900/40 [&_[data-slot=slider-range]]:bg-amber-400 [&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-thumb]]:bg-amber-950 [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:w-3"
          />
        </div>

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-amber-400/80">
          {elapsedSec}s / {totalSec}s
        </span>

        <button
          onClick={() => onSeek(0)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-amber-500/60 transition-colors hover:bg-amber-500/10 hover:text-amber-300"
          aria-label="Restart replay"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
