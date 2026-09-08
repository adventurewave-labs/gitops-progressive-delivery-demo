"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClusterState } from "@/hooks/use-cluster-state";

interface ReplayFixture {
  recordingTimestamp: string;
  description: string;
  snapshots: ClusterState[];
}

export interface ReplayModeResult {
  /** Current interpolated ClusterState (null until fixture loads) */
  state: ClusterState | null;
  /** Always true when this hook is active */
  isReplay: boolean;
  /** Whether the replay is currently playing (vs paused) */
  isPlaying: boolean;
  /** Progress through the replay as a 0–1 fraction */
  progress: number;
  /** Total duration of the replay in milliseconds */
  duration: number;
  /** Recording timestamp from the fixture */
  recordingTimestamp: string | null;
  /** Start or resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Seek to a specific position (0–1) */
  seek: (pct: number) => void;
}

/**
 * Loads a replay fixture and steps through its snapshots based on
 * elapsed wall-clock time. Supports play/pause, seeking, and
 * auto-pause on tab background.
 */
export function useReplayMode(fixtureUrl: string): ReplayModeResult {
  const [fixture, setFixture] = useState<ReplayFixture | null>(null);
  const [state, setState] = useState<ClusterState | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);

  // Refs for the animation loop so we can read latest values without
  // re-creating the loop on every state change.
  const playingRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);        // performance.now() when playback started
  const offsetRef = useRef<number>(0);        // ms already played before current start
  const seekingRef = useRef(false);           // flag to suppress play during seek drag

  // ── Load fixture ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch(fixtureUrl)
      .then((r) => r.json())
      .then((data: ReplayFixture) => {
        if (!cancelled && data.snapshots?.length) {
          setFixture(data);
          setState(data.snapshots[0]);
        }
      })
      .catch(() => {
        /* fixture unavailable — state stays null */
      });
    return () => { cancelled = true; };
  }, [fixtureUrl]);

  // ── Derived timing ──────────────────────────────────────────────
  const duration = fixture
    ? new Date(fixture.snapshots[fixture.snapshots.length - 1].timestamp).getTime() -
      new Date(fixture.snapshots[0].timestamp).getTime()
    : 0;

  // ── Interpolation ───────────────────────────────────────────────
  const interpolate = useCallback(
    (elapsedMs: number): ClusterState | null => {
      if (!fixture || fixture.snapshots.length === 0) return null;
      const t0 = new Date(fixture.snapshots[0].timestamp).getTime();
      const target = t0 + elapsedMs;

      // Find the two snapshots that bracket `target`
      let lo = 0;
      let hi = fixture.snapshots.length - 1;
      for (let i = 0; i < fixture.snapshots.length; i++) {
        if (new Date(fixture.snapshots[i].timestamp).getTime() <= target) {
          lo = i;
        }
      }
      if (lo >= hi) return fixture.snapshots[hi];

      const loT = new Date(fixture.snapshots[lo].timestamp).getTime();
      const hiT = new Date(fixture.snapshots[lo + 1].timestamp).getTime();
      const frac = hiT === loT ? 0 : (target - loT) / (hiT - loT);

      // For most fields we just step (no interpolation needed — the
      // card components handle the visual transition).  But we
      // interpolate numeric traffic/weights/metrics so the bars move
      // smoothly.
      const s = fixture.snapshots[lo];
      const n = fixture.snapshots[lo + 1];
      const lerp = (a: number, b: number) => a + (b - a) * frac;

      return {
        ...s,
        traffic: {
          stable: Math.round(lerp(s.traffic.stable, n.traffic.stable)),
          canary: Math.round(lerp(s.traffic.canary, n.traffic.canary)),
        },
        argoRollouts: {
          ...s.argoRollouts,
          stableWeight: Math.round(lerp(s.argoRollouts.stableWeight, n.argoRollouts.stableWeight)),
          canaryWeight: Math.round(lerp(s.argoRollouts.canaryWeight, n.argoRollouts.canaryWeight)),
        },
        metrics: {
          stableErrorRate: lerp(s.metrics.stableErrorRate, n.metrics.stableErrorRate),
          canaryErrorRate: lerp(s.metrics.canaryErrorRate, n.metrics.canaryErrorRate),
          stableP99: lerp(s.metrics.stableP99, n.metrics.stableP99),
          canaryP99: lerp(s.metrics.canaryP99, n.metrics.canaryP99),
        },
        slo: {
          ...s.slo,
          errorBudget: lerp(s.slo.errorBudget, n.slo.errorBudget),
        },
      };
    },
    [fixture],
  );

  // ── Animation loop ──────────────────────────────────────────────
  useEffect(() => {
    if (!fixture || duration === 0) return;

    function tick(now: number) {
      if (!playingRef.current && !seekingRef.current) {
        // Paused — just keep the raf alive so we can resume
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const elapsed = offsetRef.current + (now - startRef.current);
      const clamped = Math.min(Math.max(elapsed, 0), duration);
      const pct = duration > 0 ? clamped / duration : 0;

      const s = interpolate(clamped);
      if (s) setState(s);
      setProgress(pct);

      // Loop back to start after completion
      if (clamped >= duration) {
        offsetRef.current = 0;
        startRef.current = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [fixture, duration, interpolate]);

  // ── Sync playingRef ─────────────────────────────────────────────
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  // ── Auto-pause on visibility change ─────────────────────────────
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        // Pause and record how far we got
        const now = performance.now();
        offsetRef.current += now - startRef.current;
        startRef.current = now;
        playingRef.current = false;
        setIsPlaying(false);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // ── Controls ────────────────────────────────────────────────────
  const play = useCallback(() => {
    startRef.current = performance.now();
    playingRef.current = true;
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    const now = performance.now();
    offsetRef.current += now - startRef.current;
    startRef.current = now;
    playingRef.current = false;
    setIsPlaying(false);
  }, []);

  const seek = useCallback(
    (pct: number) => {
      if (!fixture || duration === 0) return;
      const clamped = Math.min(Math.max(pct, 0), 1);
      const elapsedMs = clamped * duration;

      seekingRef.current = true;
      offsetRef.current = elapsedMs;
      startRef.current = performance.now();

      const s = interpolate(elapsedMs);
      if (s) setState(s);
      setProgress(clamped);

      // Reset the seeking flag after a tick so the rAF loop can
      // resume normal playback if isPlaying is true.
      requestAnimationFrame(() => {
        seekingRef.current = false;
      });
    },
    [fixture, duration, interpolate],
  );

  return {
    state,
    isReplay: true,
    isPlaying,
    progress,
    duration,
    recordingTimestamp: fixture?.recordingTimestamp ?? null,
    play,
    pause,
    seek,
  };
}
