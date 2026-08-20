/**
 * Cluster state endpoint. Returns a single snapshot of the entire cluster
 * the UI can poll every second. Combines:
 *   - The Argo CD sync status (commit hash, sync phase)
 *   - The Argo Rollouts canary state (stable/canary weights, phase)
 *   - The current Prometheus metrics (error rate, p99)
 *   - The analyzer findings (cached — same shape as /api/analyze)
 *
 * The state evolves over time so the UI sees real progression:
 *   t=0..2s   idle       — 100/0, healthy, no findings
 *   t=2..5s   syncing    — Argo CD applying manifests
 *   t=5..9s   canary20   — 80/20, healthy
 *   t=9..12s  canary50   — 50/50, metrics start to rise
 *   t=12..14s anomaly    — 50/50, error rate 15%, p99 2000ms
 *   t=14..22s analyzing  — 50/50 paused, analyzers fire, LLM diagnoses
 *   t=22+     rollback   — 100/0, healthy
 */
import { NextResponse } from "next/server";
import { recordMetric } from "../prometheus/route";
import {
  canaryDeployment,
  canaryPods,
  rolloutResource,
  stableDeployment,
  stablePods,
} from "@/lib/k8s-mock-data";

export const dynamic = "force-dynamic";

const START_TIME = Date.now();

type Phase =
  | "idle"
  | "syncing"
  | "canary20"
  | "canary50"
  | "anomaly"
  | "analyzing"
  | "rollback";

function currentPhase(): { phase: Phase; elapsedMs: number } {
  const elapsed = Date.now() - START_TIME;
  // 30s loop. After rollback, hold for 10s then reset.
  const cycleLen = 40000;
  const t = elapsed % cycleLen;

  if (t < 2000) return { phase: "idle", elapsedMs: t };
  if (t < 5000) return { phase: "syncing", elapsedMs: t - 2000 };
  if (t < 9000) return { phase: "canary20", elapsedMs: t - 5000 };
  if (t < 12000) return { phase: "canary50", elapsedMs: t - 9000 };
  if (t < 14000) return { phase: "anomaly", elapsedMs: t - 12000 };
  if (t < 22000) return { phase: "analyzing", elapsedMs: t - 14000 };
  return { phase: "rollback", elapsedMs: t - 22000 };
}

function trafficSplit(phase: Phase) {
  switch (phase) {
    case "idle":
    case "syncing":
      return { stable: 100, canary: 0 };
    case "canary20":
      return { stable: 80, canary: 20 };
    case "canary50":
    case "anomaly":
    case "analyzing":
      return { stable: 50, canary: 50 };
    case "rollback":
      return { stable: 100, canary: 0 };
  }
}

function currentMetrics(phase: Phase) {
  switch (phase) {
    case "idle":
    case "syncing":
      return {
        stableErrorRate: 0.1,
        canaryErrorRate: 0,
        stableP99: 150,
        canaryP99: 0,
      };
    case "canary20":
      return {
        stableErrorRate: 0.1,
        canaryErrorRate: 0.2,
        stableP99: 150,
        canaryP99: 180,
      };
    case "canary50":
      return {
        stableErrorRate: 0.1,
        canaryErrorRate: 4.5,
        stableP99: 150,
        canaryP99: 850,
      };
    case "anomaly":
    case "analyzing":
      return {
        stableErrorRate: 0.1,
        canaryErrorRate: 15.2,
        stableP99: 150,
        canaryP99: 2042,
      };
    case "rollback":
      return {
        stableErrorRate: 0.1,
        canaryErrorRate: 0.1,
        stableP99: 150,
        canaryP99: 150,
      };
  }
}

interface Finding {
  kind: string;
  name: string;
  analyzer: string;
  severity: "critical" | "warning" | "info";
  error: string;
  suggestedFix?: string;
}

function currentFindings(phase: Phase): Finding[] {
  if (phase !== "anomaly" && phase !== "analyzing" && phase !== "rollback") {
    return [];
  }
  // Same set the /api/analyze endpoint would return — we inline it here
  // so the UI can render the findings list immediately without a second
  // round-trip.
  const findings: Finding[] = [];

  findings.push({
    kind: "Pod",
    name: canaryPods[0].metadata.name,
    analyzer: "pod",
    severity: "critical",
    error: `the last termination reason is OOMKilled (exit code 137) container=api pod=${canaryPods[0].metadata.name}`,
    suggestedFix: `kubectl logs ${canaryPods[0].metadata.name} -c api --previous`,
  });
  findings.push({
    kind: "Pod",
    name: canaryPods[0].metadata.name,
    analyzer: "log",
    severity: "critical",
    error: "Container 'api' logs show heap growth: 245MB → 1.0GB over 4m17s before OOMKill",
    suggestedFix: `kubectl logs ${canaryPods[0].metadata.name} -c api --previous | grep -i memory`,
  });
  findings.push({
    kind: "Deployment",
    name: canaryDeployment.metadata.name,
    analyzer: "deployment",
    severity: "critical",
    error: `Deployment ${canaryDeployment.metadata.namespace}/${canaryDeployment.metadata.name} has 2 replicas but 0 are available`,
    suggestedFix: `kubectl rollout status deployment/${canaryDeployment.metadata.name} -n ${canaryDeployment.metadata.namespace}`,
  });
  findings.push({
    kind: "Rollout",
    name: rolloutResource.metadata.name,
    analyzer: "rollout",
    severity: "warning",
    error: `Rollout ${rolloutResource.metadata.name} is paused at step 3 (Analysis) with canary weight 50%`,
    suggestedFix: `kubectl argo rollouts get rollout ${rolloutResource.metadata.name} -n ${rolloutResource.metadata.namespace}`,
  });

  return findings;
}

export async function GET() {
  const { phase } = currentPhase();
  const split = trafficSplit(phase);
  const metrics = currentMetrics(phase);

  // Push the current metrics into the Prometheus mock's ring buffer so
  // /api/prometheus returns a chart that matches the cluster state.
  recordMetric("stable_error_rate", metrics.stableErrorRate);
  recordMetric("canary_error_rate", metrics.canaryErrorRate);
  recordMetric("stable_p99", metrics.stableP99);
  recordMetric("canary_p99", metrics.canaryP99);

  // Argo CD sync status — always synced in this demo (the commit was
  // already applied before canary traffic shifted).
  const argoCdSync = {
    revision: "a1b2c3d4e5f67890abcdef1234567890abcdef12",
    shortRevision: "a1b2c3d",
    message: "feat: bump payments-api to v2.4",
    author: "marcuspat@adventurewave-labs",
    branch: "main",
    repo: "adventurewave-labs/payments",
    status: phase === "syncing" ? "syncing" : "synced",
    targetRevision: "v2.4",
  };

  // Argo Rollouts state — mirrors the Rollout CRD's status field.
  const argoRollouts = {
    name: rolloutResource.metadata.name,
    namespace: rolloutResource.metadata.namespace,
    phase:
      phase === "analyzing" || phase === "anomaly"
        ? "Paused"
        : phase === "rollback"
          ? "Aborted"
          : phase === "idle"
            ? "Healthy"
            : "Progressing",
    currentStep:
      phase === "canary20"
        ? 0
        : phase === "canary50" || phase === "anomaly" || phase === "analyzing"
          ? 3
          : phase === "rollback"
            ? -1
            : -1,
    stableWeight: split.stable,
    canaryWeight: split.canary,
    stableRS: "payments-api-7c4f5b",
    canaryRS: "payments-api-canary-6b8f4c",
    stableImage: "registry.internal.acme.io/payments:v2.3",
    canaryImage: "registry.internal.acme.io/payments:v2.4",
  };

  // Pod health summary
  const stableReady = stablePods.filter((p) => {
    const s = p.status as { phase: string };
    return s.phase === "Running";
  }).length;
  const canaryReady = canaryPods.filter((p) => {
    const s = p.status as { phase: string };
    return s.phase === "Running";
  }).length;

  const pods = {
    stable: {
      desired: (stableDeployment.status as { replicas: number }).replicas,
      ready: stableReady,
      image: "payments:v2.3",
    },
    canary: {
      desired:
        phase === "idle" || phase === "syncing"
          ? 0
          : (canaryDeployment.status as { replicas: number }).replicas,
      ready: phase === "rollback" ? 0 : canaryReady,
      image: "payments:v2.4",
      phase: phase === "rollback" ? "ScaledToZero" : canaryPods[0] ? ((canaryPods[0].status as { phase: string }).phase) : "Pending",
    },
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    phase,
    argoCdSync,
    argoRollouts,
    traffic: split,
    metrics,
    slo:
      phase === "anomaly" || phase === "analyzing"
        ? { status: "violated", errorBudget: 1.0, canaryError: metrics.canaryErrorRate }
        : { status: "healthy", errorBudget: 1.0, canaryError: metrics.canaryErrorRate },
    pods,
    findings: currentFindings(phase),
    findingsCount: currentFindings(phase).length,
  });
}
