"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ClusterState } from "@/hooks/use-cluster-state";
import { REPLAY_FIXTURE, type ReplayKeyframe } from "@/lib/replay-fixture";

export interface ReplayController {
  state: ClusterState | null;
  /** 0..1 progress through the fixture. */
  progress: number;
  /** Elapsed milliseconds in current cycle. */
  elapsedMs: number;
  /** Total duration of fixture (default 30_000). */
  totalDurationMs: number;
  /** Whether the replay clock is advancing. */
  playing: boolean;
  /** Pre-recorded GLM-4.5 diagnosis for the current frame, if any. */
  diagnosis: string | null;
  /** Error loading fixture (PRD §4.6 edge case). */
  error: string | null;
  /** ISO timestamp of the recording. */
  recordedAt: string;
  /** Play/pause the clock. */
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Restart the replay from t=0. */
  restart: () => void;
  /** Seek to a specific progress 0..1. */
  seek: (progress: number) => void;
}

/**
 * Returns a ClusterState interpolated from REPLAY_FIXTURE by elapsed time.
 *
 * PRD §4.3.1 — replay duration is configurable (default 30s). Honors
 * visibility change: pauses the clock when the tab is backgrounded to prevent
 * timeline drift (PRD §4.6 edge case 3).
 */
export function useReplayState(opts?: { durationMs?: number }): ReplayController {
  const totalDurationMs = opts?.durationMs ?? REPLAY_FIXTURE.totalDurationMs;
  const keyframes = REPLAY_FIXTURE.keyframes;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  // Advance the clock on each animation frame while playing. Using rAF keeps
  // the UI smooth; when the tab is hidden the browser throttles rAF, which is
  // exactly the desired pause-on-background behavior (PRD §4.6 case 3).
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastTickRef.current == null) {
        lastTickRef.current = now;
      }
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;

      setElapsedMs((prev) => {
        const next = prev + delta;
        // Loop the replay at the end.
        if (next >= totalDurationMs) {
          return 0;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
    };
  }, [playing, totalDurationMs]);

  // Pause when tab is hidden — explicit guard so the behavior holds even if
  // the rAF throttle changes between browsers.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setPlaying(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const progress = Math.min(1, elapsedMs / totalDurationMs);

  // Derive the error inline — never call setState from inside useMemo, which
  // would cause an infinite re-render loop. The fixture is statically defined
  // at module load, so its emptiness is a build-time property, not a runtime
  // state change.
  const error = keyframes.length === 0 ? "replay fixture is empty" : null;

  // Find the surrounding keyframes and linearly interpolate.
  const { state, diagnosis } = useMemo(() => {
    if (keyframes.length === 0) {
      return { state: null, diagnosis: null };
    }

    // Clamp to last keyframe if past the end.
    if (elapsedMs >= keyframes[keyframes.length - 1].t) {
      const last = keyframes[keyframes.length - 1];
      return { state: last.state, diagnosis: last.diagnosis ?? null };
    }

    // Find surrounding pair.
    let prev: ReplayKeyframe = keyframes[0];
    let next: ReplayKeyframe = keyframes[keyframes.length - 1];
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (elapsedMs >= keyframes[i].t && elapsedMs < keyframes[i + 1].t) {
        prev = keyframes[i];
        next = keyframes[i + 1];
        break;
      }
    }

    const span = next.t - prev.t;
    const frac = span <= 0 ? 0 : (elapsedMs - prev.t) / span;
    const interpolated = interpolateState(prev.state, next.state, frac);
    return {
      state: interpolated,
      // Diagnosis appears the moment we cross the rollback keyframe — it is
      // not interpolated, it is "delivered" at the recorded event.
      diagnosis: next.diagnosis && frac > 0.5 ? next.diagnosis : prev.diagnosis ?? null,
    };
  }, [elapsedMs, keyframes]);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const restart = useCallback(() => {
    setElapsedMs(0);
    setPlaying(true);
  }, []);
  const seek = useCallback(
    (p: number) => {
      const clamped = Math.max(0, Math.min(1, p));
      setElapsedMs(clamped * totalDurationMs);
    },
    [totalDurationMs],
  );

  return {
    state,
    progress,
    elapsedMs,
    totalDurationMs,
    playing,
    diagnosis,
    error,
    recordedAt: REPLAY_FIXTURE.recordedAt,
    play,
    pause,
    toggle,
    restart,
    seek,
  };
}

/**
 * Interpolates numeric fields between two ClusterState snapshots.
 * Non-numeric fields (strings, enums, findings[]) use the "nearest-prev"
 * approach: the state of the most recent keyframe wins, which is what makes
 * the replay feel "phase-stepped" rather than smoothly morphing between
 * distinct error messages.
 */
function interpolateState(a: ClusterState, b: ClusterState, frac: number): ClusterState {
  const lerp = (x: number, y: number) => Math.round((x + (y - x) * frac) * 10) / 10;

  return {
    timestamp: frac < 1 ? a.timestamp : b.timestamp,
    phase: b.phase,
    argoCdSync: {
      revision: frac < 1 ? a.argoCdSync.revision : b.argoCdSync.revision,
      shortRevision: frac < 1 ? a.argoCdSync.shortRevision : b.argoCdSync.shortRevision,
      message: frac < 1 ? a.argoCdSync.message : b.argoCdSync.message,
      author: frac < 1 ? a.argoCdSync.author : b.argoCdSync.author,
      branch: b.argoCdSync.branch,
      repo: b.argoCdSync.repo,
      status: frac < 1 ? a.argoCdSync.status : b.argoCdSync.status,
      targetRevision: b.argoCdSync.targetRevision,
    },
    argoRollouts: {
      name: b.argoRollouts.name,
      namespace: b.argoRollouts.namespace,
      phase: b.argoRollouts.phase,
      currentStep: b.argoRollouts.currentStep,
      currentStepKind: b.argoRollouts.currentStepKind,
      stableWeight: lerp(a.argoRollouts.stableWeight, b.argoRollouts.stableWeight),
      canaryWeight: lerp(a.argoRollouts.canaryWeight, b.argoRollouts.canaryWeight),
      stableRS: frac < 1 ? a.argoRollouts.stableRS : b.argoRollouts.stableRS,
      canaryRS: frac < 1 ? a.argoRollouts.canaryRS : b.argoRollouts.canaryRS,
      stableImage: frac < 1 ? a.argoRollouts.stableImage : b.argoRollouts.stableImage,
      canaryImage: frac < 1 ? a.argoRollouts.canaryImage : b.argoRollouts.canaryImage,
    },
    traffic: {
      stable: lerp(a.traffic.stable, b.traffic.stable),
      canary: lerp(a.traffic.canary, b.traffic.canary),
    },
    metrics: {
      stableErrorRate: lerp(a.metrics.stableErrorRate, b.metrics.stableErrorRate),
      canaryErrorRate: lerp(a.metrics.canaryErrorRate, b.metrics.canaryErrorRate),
      stableP99: lerp(a.metrics.stableP99, b.metrics.stableP99),
      canaryP99: lerp(a.metrics.canaryP99, b.metrics.canaryP99),
    },
    slo: {
      status: b.slo.status,
      errorBudget: lerp(a.slo.errorBudget, b.slo.errorBudget),
      canaryError: lerp(a.slo.canaryError, b.slo.canaryError),
    },
    pods: {
      stable: {
        desired: Math.round(lerp(a.pods.stable.desired, b.pods.stable.desired)),
        ready: Math.round(lerp(a.pods.stable.ready, b.pods.stable.ready)),
        image: frac < 1 ? a.pods.stable.image : b.pods.stable.image,
      },
      canary: {
        desired: Math.round(lerp(a.pods.canary.desired, b.pods.canary.desired)),
        ready: Math.round(lerp(a.pods.canary.ready, b.pods.canary.ready)),
        image: frac < 1 ? a.pods.canary.image : b.pods.canary.image,
        phase: b.pods.canary.phase,
      },
    },
    findings: b.findings,
    findingsCount: b.findingsCount,
  };
}
