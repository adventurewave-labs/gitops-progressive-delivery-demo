"use client";

import { useEffect, useState } from "react";

export interface ClusterState {
  timestamp: string;
  phase:
    | "idle"
    | "syncing"
    | "canary20"
    | "canary50"
    | "anomaly"
    | "analyzing"
    | "rollback";
  argoCdSync: {
    revision: string;
    shortRevision: string;
    message: string;
    author: string;
    branch: string;
    repo: string;
    status: "syncing" | "synced";
    targetRevision: string;
  };
  argoRollouts: {
    name: string;
    namespace: string;
    phase: "Paused" | "Aborted" | "Healthy" | "Progressing";
    currentStep: number;
    stableWeight: number;
    canaryWeight: number;
    stableRS: string;
    canaryRS: string;
    stableImage: string;
    canaryImage: string;
  };
  traffic: { stable: number; canary: number };
  metrics: {
    stableErrorRate: number;
    canaryErrorRate: number;
    stableP99: number;
    canaryP99: number;
  };
  slo: {
    status: "healthy" | "violated";
    errorBudget: number;
    canaryError: number;
  };
  pods: {
    stable: { desired: number; ready: number; image: string };
    canary: {
      desired: number;
      ready: number;
      image: string;
      phase: string;
    };
  };
  findings: Array<{
    kind: string;
    name: string;
    analyzer: string;
    severity: "critical" | "warning" | "info";
    error: string;
    suggestedFix?: string;
  }>;
  findingsCount: number;
}

export interface LlmDiagnosis {
  content: string;
  cached: boolean;
  model: string;
  timestamp: string;
}

/** Polls /api/cluster-state at the given cadence (default 1s). */
export function useClusterState(intervalMs = 1000) {
  const [state, setState] = useState<ClusterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch("/api/cluster-state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ClusterState;
        if (!cancelled) {
          setState(data);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchOnce, intervalMs);
        }
      }
    }

    fetchOnce();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  return { state, error, loading };
}

/** Calls /api/explain with the given findings. Idempotent (server caches). */
export async function fetchDiagnosis(
  findings: ClusterState["findings"],
): Promise<LlmDiagnosis> {
  const res = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(findings),
  });
  if (!res.ok) {
    throw new Error(`explain failed: HTTP ${res.status}`);
  }
  return (await res.json()) as LlmDiagnosis;
}
