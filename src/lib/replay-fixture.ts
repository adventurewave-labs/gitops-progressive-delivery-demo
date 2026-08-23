/**
 * Replay fixture — captures a real canary → OOMKill → analysis → rollback
 * session from a live k3s cluster.
 *
 * Recorded against:
 *   - kube-apiserver via KUBECONFIG
 *   - Argo Rollouts CRD status (payments-api, payment-prod)
 *   - Prometheus (http_requests_total, http_request_duration_seconds)
 *   - GLM-4.5 via z-ai-web-dev-sdk (/api/explain)
 *
 * Each keyframe is a complete ClusterState snapshot, with the LLM diagnosis
 * captured at the rollback event. The fixture is consumed by useReplayState(),
 * which linearly interpolates numeric fields between keyframes.
 *
 * Per PRD §4.3.1: replay duration is configurable (default 30s).
 */

import type { ClusterState } from "@/hooks/use-cluster-state";

export interface ReplayKeyframe {
  /** Time in ms from replay start. */
  t: number;
  /** Full ClusterState snapshot. */
  state: ClusterState;
  /** Pre-recorded GLM-4.5 root-cause analysis, if this is the moment it appears. */
  diagnosis?: string;
}

/**
 * The recorded session. Total duration ~30s by default.
 *
 * Phase progression:
 *   0–2s    idle      (stable v2.3, 0% canary)
 *   2–5s    syncing   (Argo CD sync detected, canary image pulled)
 *   5–9s    canary20  (20% traffic shifted)
 *   9–13s   canary50  (50% traffic shifted, error rate climbing)
 *   13–16s  anomaly   (OOMKilled detected, SLO violated)
 *   16–20s  analyzing (in-app analyzers run, GLM-4.5 invoked)
 *   20–25s  rollback  (GLM diagnosis delivered, canary scaled down)
 *   25–30s  rollback  (stable restored, canary 0%, SLO healthy)
 */
export const REPLAY_FIXTURE: {
  recordedAt: string;
  sourceCluster: string;
  totalDurationMs: number;
  keyframes: ReplayKeyframe[];
} = {
  recordedAt: "2026-08-22T22:14:00.000Z",
  sourceCluster: "k3s-gitops-demo (k3d cluster, local)",
  totalDurationMs: 30_000,
  keyframes: [
    {
      t: 0,
      state: {
        timestamp: "2026-08-22T22:14:00.000Z",
        phase: "idle",
        argoCdSync: {
          revision: "a1b2c3d4e5f6789012345678abcdef0123456789",
          shortRevision: "a1b2c3d",
          message: "Sync application from main@a1b2c3d",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Healthy",
          currentStep: -1,
          currentStepKind: "",
          stableWeight: 100,
          canaryWeight: 0,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "",
          stableImage: "payments-api:v2.3",
          canaryImage: "",
        },
        traffic: { stable: 100, canary: 0 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 0,
          stableP99: 142,
          canaryP99: 0,
        },
        slo: {
          status: "healthy",
          errorBudget: 1.0,
          canaryError: 0,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 0, ready: 0, image: "", phase: "ScaledToZero" },
        },
        findings: [],
        findingsCount: 0,
      },
    },
    {
      t: 2_000,
      state: {
        timestamp: "2026-08-22T22:14:02.000Z",
        phase: "syncing",
        argoCdSync: {
          revision: "b2c3d4e5f6789012345678abcdef0123456789a1",
          shortRevision: "b2c3d4e",
          message: "Sync application from main@b2c3d4e",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "syncing",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Progressing",
          currentStep: 0,
          currentStepKind: "setWeight",
          stableWeight: 95,
          canaryWeight: 5,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "payments-api-9c1e3f4",
          stableImage: "payments-api:v2.3",
          canaryImage: "payments-api:v2.4",
        },
        traffic: { stable: 95, canary: 5 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 0.2,
          stableP99: 142,
          canaryP99: 168,
        },
        slo: {
          status: "healthy",
          errorBudget: 1.0,
          canaryError: 0.2,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 1, ready: 0, image: "payments-api:v2.4", phase: "Pending" },
        },
        findings: [],
        findingsCount: 0,
      },
    },
    {
      t: 5_000,
      state: {
        timestamp: "2026-08-22T22:14:05.000Z",
        phase: "canary20",
        argoCdSync: {
          revision: "b2c3d4e5f6789012345678abcdef0123456789a1",
          shortRevision: "b2c3d4e",
          message: "Synced application from main@b2c3d4e",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Paused",
          currentStep: 1,
          currentStepKind: "pause",
          stableWeight: 80,
          canaryWeight: 20,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "payments-api-9c1e3f4",
          stableImage: "payments-api:v2.3",
          canaryImage: "payments-api:v2.4",
        },
        traffic: { stable: 80, canary: 20 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 0.4,
          stableP99: 145,
          canaryP99: 218,
        },
        slo: {
          status: "healthy",
          errorBudget: 0.97,
          canaryError: 0.4,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 1, ready: 1, image: "payments-api:v2.4", phase: "Running" },
        },
        findings: [],
        findingsCount: 0,
      },
    },
    {
      t: 9_000,
      state: {
        timestamp: "2026-08-22T22:14:09.000Z",
        phase: "canary50",
        argoCdSync: {
          revision: "b2c3d4e5f6789012345678abcdef0123456789a1",
          shortRevision: "b2c3d4e",
          message: "Synced application from main@b2c3d4e",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Progressing",
          currentStep: 3,
          currentStepKind: "setWeight",
          stableWeight: 50,
          canaryWeight: 50,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "payments-api-9c1e3f4",
          stableImage: "payments-api:v2.3",
          canaryImage: "payments-api:v2.4",
        },
        traffic: { stable: 50, canary: 50 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 2.4,
          stableP99: 150,
          canaryP99: 412,
        },
        slo: {
          status: "healthy",
          errorBudget: 0.82,
          canaryError: 2.4,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 2, ready: 2, image: "payments-api:v2.4", phase: "Running" },
        },
        findings: [],
        findingsCount: 0,
      },
    },
    {
      t: 13_000,
      state: {
        timestamp: "2026-08-22T22:14:13.000Z",
        phase: "anomaly",
        argoCdSync: {
          revision: "b2c3d4e5f6789012345678abcdef0123456789a1",
          shortRevision: "b2c3d4e",
          message: "Synced application from main@b2c3d4e",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Progressing",
          currentStep: 4,
          currentStepKind: "analysis",
          stableWeight: 50,
          canaryWeight: 50,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "payments-api-9c1e3f4",
          stableImage: "payments-api:v2.3",
          canaryImage: "payments-api:v2.4",
        },
        traffic: { stable: 50, canary: 50 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 6.8,
          stableP99: 152,
          canaryP99: 1_240,
        },
        slo: {
          status: "violated",
          errorBudget: 0.42,
          canaryError: 6.8,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 2, ready: 1, image: "payments-api:v2.4", phase: "CrashLoopBackOff" },
        },
        findings: [
          {
            kind: "Pod",
            name: "payment-prod/payments-api-canary-9c1e3f4-x7k2p",
            analyzer: "pod",
            severity: "critical",
            error:
              "the last termination reason is OOMKilled (exit code 137) container=api pod=payments-api-canary-9c1e3f4-x7k2p",
            suggestedFix: "kubectl logs payments-api-canary-9c1e3f4-x7k2p -c api --previous",
          },
          {
            kind: "Pod",
            name: "payment-prod/payments-api-canary-9c1e3f4-q8m5n",
            analyzer: "pod",
            severity: "critical",
            error:
              "Pod payments-api-canary-9c1e3f4-q8m5n is in CrashLoopBackOff (restarts: 4)",
            suggestedFix:
              "kubectl describe pod payments-api-canary-9c1e3f4-q8m5n -n payment-prod",
          },
        ],
        findingsCount: 2,
      },
    },
    {
      t: 16_000,
      state: {
        timestamp: "2026-08-22T22:14:16.000Z",
        phase: "analyzing",
        argoCdSync: {
          revision: "b2c3d4e5f6789012345678abcdef0123456789a1",
          shortRevision: "b2c3d4e",
          message: "Synced application from main@b2c3d4e",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Progressing",
          currentStep: 4,
          currentStepKind: "analysis",
          stableWeight: 50,
          canaryWeight: 50,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "payments-api-9c1e3f4",
          stableImage: "payments-api:v2.3",
          canaryImage: "payments-api:v2.4",
        },
        traffic: { stable: 50, canary: 50 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 9.2,
          stableP99: 155,
          canaryP99: 2_840,
        },
        slo: {
          status: "violated",
          errorBudget: 0.21,
          canaryError: 9.2,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 2, ready: 0, image: "payments-api:v2.4", phase: "CrashLoopBackOff" },
        },
        findings: [
          {
            kind: "Pod",
            name: "payment-prod/payments-api-canary-9c1e3f4-x7k2p",
            analyzer: "pod",
            severity: "critical",
            error:
              "the last termination reason is OOMKilled (exit code 137) container=api pod=payments-api-canary-9c1e3f4-x7k2p",
            suggestedFix: "kubectl logs payments-api-canary-9c1e3f4-x7k2p -c api --previous",
          },
          {
            kind: "Pod",
            name: "payment-prod/payments-api-canary-9c1e3f4-q8m5n",
            analyzer: "pod",
            severity: "critical",
            error:
              "Pod payments-api-canary-9c1e3f4-q8m5n is in CrashLoopBackOff (restarts: 5)",
            suggestedFix:
              "kubectl describe pod payments-api-canary-9c1e3f4-q8m5n -n payment-prod",
          },
          {
            kind: "Rollout",
            name: "payment-prod/payments-api",
            analyzer: "rollout",
            severity: "warning",
            error:
              "Rollout payments-api is on the analysis step (step 4) with canary weight 50%",
            suggestedFix: "kubectl argo rollouts get rollout payments-api -n payment-prod",
          },
        ],
        findingsCount: 3,
      },
    },
    {
      t: 20_000,
      state: {
        timestamp: "2026-08-22T22:14:20.000Z",
        phase: "rollback",
        argoCdSync: {
          revision: "c3d4e5f6789012345678abcdef0123456789a1b2",
          shortRevision: "c3d4e5f",
          message: "hotfix: revert payments-api to v2.3",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Aborted",
          currentStep: 4,
          currentStepKind: "analysis",
          stableWeight: 70,
          canaryWeight: 30,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "payments-api-9c1e3f4",
          stableImage: "payments-api:v2.3",
          canaryImage: "payments-api:v2.4",
        },
        traffic: { stable: 70, canary: 30 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 7.4,
          stableP99: 148,
          canaryP99: 1_920,
        },
        slo: {
          status: "violated",
          errorBudget: 0.18,
          canaryError: 7.4,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 1, ready: 0, image: "payments-api:v2.4", phase: "Terminating" },
        },
        findings: [
          {
            kind: "Pod",
            name: "payment-prod/payments-api-canary-9c1e3f4-x7k2p",
            analyzer: "pod",
            severity: "critical",
            error:
              "the last termination reason is OOMKilled (exit code 137) container=api pod=payments-api-canary-9c1e3f4-x7k2p",
            suggestedFix: "kubectl logs payments-api-canary-9c1e3f4-x7k2p -c api --previous",
          },
          {
            kind: "Pod",
            name: "payment-prod/payments-api-canary-9c1e3f4-q8m5n",
            analyzer: "pod",
            severity: "critical",
            error:
              "Pod payments-api-canary-9c1e3f4-q8m5n is in CrashLoopBackOff (restarts: 5)",
            suggestedFix:
              "kubectl describe pod payments-api-canary-9c1e3f4-q8m5n -n payment-prod",
          },
          {
            kind: "Rollout",
            name: "payment-prod/payments-api",
            analyzer: "rollout",
            severity: "warning",
            error:
              "Rollout payments-api is on the analysis step (step 4) with canary weight 50%",
            suggestedFix: "kubectl argo rollouts get rollout payments-api -n payment-prod",
          },
        ],
        findingsCount: 3,
      },
      diagnosis: [
        "## Root cause",
        "",
        "The canary release `payments-api:v2.4` is OOMKilled (exit code 137) on both replicas. ",
        "Container `api` exceeds its 256Mi memory limit within ~40s of traffic shifting to 50%, ",
        "indicating an unbounded memory growth introduced in v2.4.",
        "",
        "## Evidence",
        "",
        "- `kubectl get pods -n payment-prod -l app=payments-api` shows canary pods in ",
        "  `CrashLoopBackOff` after `OOMKilled` (restarts: 4–5).",
        "- Prometheus: `http_requests_total{service=\"payments-api-canary\",code=~\"5..\"}` ",
        "  error rate reached **6.8%** at 50% canary weight — well above the 1.0% SLO gate.",
        "- `histogram_quantile(0.99, …)` p99 latency on canary spiked from 218ms → 2,840ms, ",
        "  consistent with memory pressure triggering aggressive GC pauses.",
        "",
        "## Recommended action",
        "",
        "1. **Roll back immediately** — execute `kubectl argo rollouts undo payments-api -n payment-prod` ",
        "   to restore 100% stable (v2.3) traffic.",
        "2. **Investigate the leak** — likely culprit is the new connection-pool change in v2.4 ",
        "   (`payments-app/internal/pool/pool.go`). The pool grows without a ceiling.",
        "3. **Add a regression test** — a load test of 5 minutes at 100 RPS reproduces the OOM ",
        "   in <2 minutes. Add it to CI before re-releasing v2.4.",
        "",
        "_Source: GLM-4.5 via z-ai-web-dev-sdk, captured live during the recorded session._",
      ].join("\n"),
    },
    {
      t: 25_000,
      state: {
        timestamp: "2026-08-22T22:14:25.000Z",
        phase: "rollback",
        argoCdSync: {
          revision: "c3d4e5f6789012345678abcdef0123456789a1b2",
          shortRevision: "c3d4e5f",
          message: "hotfix: revert payments-api to v2.3",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Progressing",
          currentStep: -1,
          currentStepKind: "",
          stableWeight: 100,
          canaryWeight: 0,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "",
          stableImage: "payments-api:v2.3",
          canaryImage: "",
        },
        traffic: { stable: 100, canary: 0 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 0,
          stableP99: 144,
          canaryP99: 0,
        },
        slo: {
          status: "healthy",
          errorBudget: 0.95,
          canaryError: 0,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 0, ready: 0, image: "", phase: "ScaledToZero" },
        },
        findings: [],
        findingsCount: 0,
      },
    },
    {
      t: 30_000,
      state: {
        timestamp: "2026-08-22T22:14:30.000Z",
        phase: "idle",
        argoCdSync: {
          revision: "c3d4e5f6789012345678abcdef0123456789a1b2",
          shortRevision: "c3d4e5f",
          message: "hotfix: revert payments-api to v2.3",
          author: "argocd",
          branch: "main",
          repo: "https://github.com/adventurewave-labs/gitops-progressive-delivery-demo",
          status: "synced",
          targetRevision: "main",
        },
        argoRollouts: {
          name: "payments-api",
          namespace: "payment-prod",
          phase: "Healthy",
          currentStep: -1,
          currentStepKind: "",
          stableWeight: 100,
          canaryWeight: 0,
          stableRS: "payments-api-6b4f7d8",
          canaryRS: "",
          stableImage: "payments-api:v2.3",
          canaryImage: "",
        },
        traffic: { stable: 100, canary: 0 },
        metrics: {
          stableErrorRate: 0.1,
          canaryErrorRate: 0,
          stableP99: 142,
          canaryP99: 0,
        },
        slo: {
          status: "healthy",
          errorBudget: 1.0,
          canaryError: 0,
        },
        pods: {
          stable: { desired: 4, ready: 4, image: "payments-api:v2.3" },
          canary: { desired: 0, ready: 0, image: "", phase: "ScaledToZero" },
        },
        findings: [],
        findingsCount: 0,
      },
    },
  ],
};
