/**
 * Central state machine + simulation constants for the GitOps progressive
 * delivery demo. All four cards derive their visuals from `DemoState`.
 */

export type DemoState =
  | "idle"
  | "syncing"
  | "canary20"
  | "canary50"
  | "anomaly"
  | "analyzing"
  | "rollback";

export interface TrafficSplit {
  stable: number;
  canary: number;
}

export interface MetricsSnapshot {
  /** 0..100 */
  errorRate: number;
  /** milliseconds */
  p99Latency: number;
}

/** How long each state lives (ms) before auto-advancing to the next one. */
export const STATE_DURATION_MS: Record<DemoState, number> = {
  idle: 0, // waits for user action
  syncing: 3000,
  canary20: 4000,
  canary50: 3000,
  anomaly: 2000,
  analyzing: 8000,
  rollback: 0, // terminal state
};

/** Ordered list of states the demo cycles through when started. */
export const STATE_ORDER: DemoState[] = [
  "syncing",
  "canary20",
  "canary50",
  "anomaly",
  "analyzing",
  "rollback",
];

export const TRAFFIC_SPLIT: Record<DemoState, TrafficSplit> = {
  idle: { stable: 100, canary: 0 },
  syncing: { stable: 100, canary: 0 },
  canary20: { stable: 80, canary: 20 },
  canary50: { stable: 50, canary: 50 },
  anomaly: { stable: 50, canary: 50 },
  analyzing: { stable: 50, canary: 50 },
  rollback: { stable: 100, canary: 0 },
};

export const METRICS: Record<DemoState, MetricsSnapshot> = {
  idle: { errorRate: 0.1, p99Latency: 150 },
  syncing: { errorRate: 0.1, p99Latency: 150 },
  canary20: { errorRate: 0.2, p99Latency: 180 },
  canary50: { errorRate: 4.5, p99Latency: 850 },
  anomaly: { errorRate: 15.0, p99Latency: 2000 },
  analyzing: { errorRate: 15.0, p99Latency: 2000 },
  rollback: { errorRate: 0.1, p99Latency: 150 },
};

/** K8sGPT terminal stream lines, emitted one-by-one during `analyzing`. */
export const K8SGPT_STREAM: string[] = [
  "K8sGPT Analyzer triggered by Prometheus SLO violation...",
  "Scanning namespace: production",
  "Fetching pod logs for payments-api-canary-6b8f...",
  "Detected anomaly: OOMKilled (Exit Code 137)",
  "Correlating with Argo Rollouts status: Canary phase 2 (50%)",
  "AI Diagnosis: The v2.4 image introduced a memory leak in the",
  "transaction validation module. Memory exceeded 1Gi limit.",
  "Recommended Action: Abort rollout and revert traffic to stable v2.3.",
  "Executing automated rollback via Argo Rollouts...",
];

/** Human-readable labels for the state machine badges. */
export const STATE_LABEL: Record<DemoState, string> = {
  idle: "IDLE",
  syncing: "SYNCING",
  canary20: "CANARY 20%",
  canary50: "CANARY 50%",
  anomaly: "ANOMALY DETECTED",
  analyzing: "AI ANALYZING",
  rollback: "ROLLED BACK",
};

/** Tailwind text color class per state, matching PRD palette. */
export const STATE_TEXT_COLOR: Record<DemoState, string> = {
  idle: "text-emerald-400",
  syncing: "text-blue-400",
  canary20: "text-emerald-400",
  canary50: "text-amber-400",
  anomaly: "text-red-400",
  analyzing: "text-amber-400",
  rollback: "text-emerald-400",
};

/** Tailwind border color class per state. */
export const STATE_BORDER_COLOR: Record<DemoState, string> = {
  idle: "border-zinc-800",
  syncing: "border-blue-500/60",
  canary20: "border-zinc-800",
  canary50: "border-amber-500/60",
  anomaly: "border-red-500/70",
  analyzing: "border-red-500/70",
  rollback: "border-emerald-500/60",
};

/** Whether the SLO is currently being violated (drives Prometheus badge). */
export function isSloViolated(state: DemoState): boolean {
  return state === "anomaly" || state === "analyzing";
}
