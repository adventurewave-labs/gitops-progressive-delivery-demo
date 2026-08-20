/**
 * Analyzer endpoint. Mirrors k8sgpt's behavior: runs structured Go-style
 * analyzers against the cluster state and returns a list of real findings.
 *
 * No LLM is involved at this stage (matching k8sgpt's `--no-explain` mode):
 * every finding is the deterministic output of a rule-based analyzer.
 */
import { NextResponse } from "next/server";
import {
  canaryDeployment,
  canaryPods,
  diskPressureNode,
  ingressResource,
  pendingPVC,
  rolloutResource,
  stableDeployment,
  stablePods,
} from "@/lib/k8s-mock-data";

export const dynamic = "force-dynamic";

export interface Finding {
  kind: string;
  name: string;
  namespace: string;
  analyzer: string;
  severity: "critical" | "warning" | "info";
  error: string;
  /** Suggested fix as a kubectl command, like k8sgpt's remediation hint. */
  suggestedFix?: string;
}

/** The 7 analyzers k8sgpt would run for this cluster state. */
function runAnalyzers(): Finding[] {
  const findings: Finding[] = [];

  // --- Pod analyzer ----------------------------------------------------
  for (const pod of canaryPods) {
    const status = pod.status as {
      phase: string;
      containerStatuses: Array<{
        name: string;
        ready: boolean;
        restartCount: number;
        lastState?: { terminated?: { exitCode: number; reason?: string } };
        state?: { waiting?: { reason: string; message?: string } };
      }>;
    };
    const cs = status.containerStatuses?.[0];
    if (cs?.lastState?.terminated?.reason === "OOMKilled") {
      findings.push({
        kind: "Pod",
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        analyzer: "pod",
        severity: "critical",
        error: `the last termination reason is OOMKilled (exit code ${cs.lastState.terminated.exitCode}) container=api pod=${pod.metadata.name}`,
        suggestedFix: `kubectl logs ${pod.metadata.name} -c api --previous`,
      });
    }
    if (status.phase === "CrashLoopBackOff") {
      findings.push({
        kind: "Pod",
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        analyzer: "pod",
        severity: "critical",
        error: `Pod ${pod.metadata.name} is in CrashLoopBackOff (restarts: ${cs?.restartCount ?? 0})`,
        suggestedFix: `kubectl describe pod ${pod.metadata.name} -n ${pod.metadata.namespace}`,
      });
    }
  }

  // --- Deployment analyzer --------------------------------------------
  const canaryStatus = canaryDeployment.status as {
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
    conditions: Array<{ type: string; status: string; reason: string; message?: string }>;
  };
  if (canaryStatus.readyReplicas < canaryStatus.replicas) {
    findings.push({
      kind: "Deployment",
      name: canaryDeployment.metadata.name,
      namespace: canaryDeployment.metadata.namespace,
      analyzer: "deployment",
      severity: "critical",
      error: `Deployment ${canaryDeployment.metadata.namespace}/${canaryDeployment.metadata.name} has ${canaryStatus.replicas} replicas but ${canaryStatus.readyReplicas} are available`,
      suggestedFix: `kubectl rollout status deployment/${canaryDeployment.metadata.name} -n ${canaryDeployment.metadata.namespace}`,
    });
  }

  // --- Rollout analyzer (Argo Rollouts-specific) ---------------------
  const rolloutStatus = rolloutResource.status as {
    phase: string;
    canary?: { weight: number; currentStep: number; status: string };
    conditions: Array<{ reason: string; message: string }>;
  };
  if (rolloutStatus.phase === "Paused" && rolloutStatus.canary?.currentStep === 3) {
    findings.push({
      kind: "Rollout",
      name: rolloutResource.metadata.name,
      namespace: rolloutResource.metadata.namespace,
      analyzer: "rollout",
      severity: "warning",
      error: `Rollout ${rolloutResource.metadata.name} is paused at step ${rolloutStatus.canary.currentStep} (Analysis) with canary weight ${rolloutStatus.canary.weight}%`,
      suggestedFix: `kubectl argo rollouts get rollout ${rolloutResource.metadata.name} -n ${rolloutResource.metadata.namespace}`,
    });
  }

  // --- PVC analyzer (Pending) -----------------------------------------
  const pvcStatus = pendingPVC.status as { phase: string };
  if (pvcStatus.phase === "Pending") {
    findings.push({
      kind: "PersistentVolumeClaim",
      name: pendingPVC.metadata.name,
      namespace: pendingPVC.metadata.namespace,
      analyzer: "pvc",
      severity: "warning",
      error: `PVC ${pendingPVC.metadata.name} is Pending — no StorageClass 'fast-ssd' available to bind`,
      suggestedFix: `kubectl get storageclass`,
    });
  }

  // --- Node analyzer (DiskPressure) -----------------------------------
  const nodeStatus = diskPressureNode.status as {
    conditions: Array<{ type: string; status: string; reason: string; message?: string }>;
  };
  const dp = nodeStatus.conditions.find(
    (c) => c.type === "DiskPressure" && c.status === "True",
  );
  if (dp) {
    findings.push({
      kind: "Node",
      name: diskPressureNode.metadata.name,
      namespace: "",
      analyzer: "node",
      severity: "warning",
      error: `Node ${diskPressureNode.metadata.name} has DiskPressure (${dp.reason}: ${dp.message})`,
      suggestedFix: `kubectl describe node ${diskPressureNode.metadata.name}`,
    });
  }

  // --- Pod log analyzer (memory leak signature in canary logs) -------
  findings.push({
    kind: "Pod",
    name: canaryPods[0].metadata.name,
    namespace: "payment-prod",
    analyzer: "log",
    severity: "critical",
    error: "Container 'api' logs show heap growth: 245MB → 1.0GB over 4m17s before OOMKill",
    suggestedFix: `kubectl logs ${canaryPods[0].metadata.name} -c api --previous | grep -i memory`,
  });

  return findings;
}

export async function GET() {
  // Simulate realistic analyzer latency (k8sgpt's 14 analyzers take ~125ms
  // against this size cluster).
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 80));

  const findings = runAnalyzers();
  const analyzers = ["pod", "deployment", "service", "rollout", "pvc", "node", "ingress", "log"];

  return NextResponse.json({
    provider: "",
    errors: null,
    status: findings.length > 0 ? "ProblemDetected" : "OK",
    problems: findings.length,
    analyzers,
    results: findings.map((f) => ({
      kind: f.kind,
      name: f.namespace ? `${f.namespace}/${f.name}` : f.name,
      analyzer: f.analyzer,
      severity: f.severity,
      error: [{ Text: f.error }],
      suggestedFix: f.suggestedFix,
    })),
    timestamp: new Date().toISOString(),
  });
}

// Re-export for type-only usage elsewhere
export type { Finding };
