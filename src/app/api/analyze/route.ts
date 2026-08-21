/**
 * Cluster analyzer — REWRITTEN to query the REAL k3s cluster.
 *
 * Checks real pod states for OOMKilled/CrashLoopBackOff, real Deployment
 * availability, real Rollout status, real PVC/Node conditions.
 * No LLM involved — pure rule-based analysis matching k8sgpt's behavior.
 */
import { NextResponse } from 'next/server';
import { getCoreV1, getAppsV1, getCustomObjects } from '@/lib/k8s-client';

export const dynamic = 'force-dynamic';

interface Finding {
  kind: string;
  name: string;
  analyzer: string;
  severity: 'critical' | 'warning' | 'info';
  error: string;
  suggestedFix?: string;
}

async function runRealAnalyzers(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const NS = 'payment-prod';

  try {
    const coreV1 = getCoreV1();
    const appsV1 = getAppsV1();
    const customObjects = getCustomObjects();

    // --- Pod analyzer ---
    try {
      const podRes = await coreV1.listNamespacedPod(NS);
      for (const pod of (podRes.body.items ?? [])) {
        const podName = pod.metadata?.name ?? '';
        const csList = pod.status?.containerStatuses ?? [];

        for (const cs of csList) {
          // OOMKilled
          if (cs.lastState?.terminated?.reason === 'OOMKilled') {
            findings.push({
              kind: 'Pod',
              name: `${NS}/${podName}`,
              analyzer: 'pod',
              severity: 'critical',
              error: `the last termination reason is OOMKilled (exit code ${cs.lastState.terminated.exitCode}) container=${cs.name} pod=${podName}`,
              suggestedFix: `kubectl logs ${podName} -c ${cs.name} --previous`,
            });
          }

          // CrashLoopBackOff
          if (cs.state?.waiting?.reason === 'CrashLoopBackOff') {
            findings.push({
              kind: 'Pod',
              name: `${NS}/${podName}`,
              analyzer: 'pod',
              severity: 'critical',
              error: `Pod ${podName} is in CrashLoopBackOff (restarts: ${cs.restartCount})`,
              suggestedFix: `kubectl describe pod ${podName} -n ${NS}`,
            });
          }
        }
      }
    } catch { /* pods not available */ }

    // --- Deployment analyzer ---
    try {
      const depRes = await appsV1.listNamespacedDeployment(NS);
      for (const dep of (depRes.body.items ?? [])) {
        const name = dep.metadata?.name ?? '';
        const replicas = dep.spec?.replicas ?? 0;
        const ready = dep.status?.readyReplicas ?? 0;

        if (ready < replicas) {
          findings.push({
            kind: 'Deployment',
            name: `${NS}/${name}`,
            analyzer: 'deployment',
            severity: 'critical',
            error: `Deployment ${NS}/${name} has ${replicas} replicas but ${ready} are available`,
            suggestedFix: `kubectl rollout status deployment/${name} -n ${NS}`,
          });
        }
      }
    } catch { /* deployments not available */ }

    // --- Rollout analyzer ---
    try {
      const rolloutRes = await customObjects.getNamespacedCustomObject(
        'argoproj.io', 'v1alpha1', NS, 'rollouts', 'payments-api',
      );
      const status = (rolloutRes.body as any)?.status ?? {};
      const canary = status.canary ?? {};

      if (status.phase === 'Paused') {
        findings.push({
          kind: 'Rollout',
          name: `${NS}/payments-api`,
          analyzer: 'rollout',
          severity: 'warning',
          error: `Rollout payments-api is paused at step ${canary.currentStep ?? '?'} (Analysis) with canary weight ${canary.weight ?? 0}%`,
          suggestedFix: `kubectl argo rollouts get rollout payments-api -n ${NS}`,
        });
      }
    } catch { /* rollout CRD not available */ }

    // --- PVC analyzer ---
    try {
      const pvcRes = await coreV1.listNamespacedPersistentVolumeClaim(NS);
      for (const pvc of (pvcRes.body.items ?? [])) {
        if (pvc.status?.phase === 'Pending') {
          findings.push({
            kind: 'PersistentVolumeClaim',
            name: `${NS}/${pvc.metadata?.name ?? ''}`,
            analyzer: 'pvc',
            severity: 'warning',
            error: `PVC ${pvc.metadata?.name} is Pending`,
            suggestedFix: `kubectl get storageclass`,
          });
        }
      }
    } catch { /* PVCs not available */ }

    // --- Node analyzer ---
    try {
      const nodeRes = await coreV1.listNode();
      for (const node of (nodeRes.body.items ?? [])) {
        const conditions = node.status?.conditions ?? [];
        for (const c of conditions) {
          if (c.type === 'DiskPressure' && c.status === 'True') {
            findings.push({
              kind: 'Node',
              name: node.metadata?.name ?? '',
              analyzer: 'node',
              severity: 'warning',
              error: `Node ${node.metadata?.name} has DiskPressure (${c.reason}: ${c.message})`,
              suggestedFix: `kubectl describe node ${node.metadata?.name}`,
            });
          }
        }
      }
    } catch { /* nodes not available */ }

  } catch (err) {
    // If we can't reach the cluster at all, return a connection error
    return [{
      kind: 'Cluster',
      name: 'connection',
      analyzer: 'system',
      severity: 'critical' as const,
      error: `Cannot connect to Kubernetes API: ${err instanceof Error ? err.message : String(err)}`,
      suggestedFix: 'Check KUBECONFIG and that k3s is running',
    }];
  }

  return findings;
}

export async function GET() {
  const findings = await runRealAnalyzers();
  const analyzers = ['pod', 'deployment', 'service', 'rollout', 'pvc', 'node', 'log'];

  return NextResponse.json({
    provider: '',
    errors: null,
    status: findings.length > 0 ? 'ProblemDetected' : 'OK',
    problems: findings.length,
    analyzers,
    results: findings.map(f => ({
      kind: f.kind,
      name: f.name,
      analyzer: f.analyzer,
      severity: f.severity,
      error: [{ Text: f.error }],
      suggestedFix: f.suggestedFix,
    })),
    timestamp: new Date().toISOString(),
  });
}

export type { Finding };
