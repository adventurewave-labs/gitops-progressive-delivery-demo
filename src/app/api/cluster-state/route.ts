/**
 * Cluster state endpoint — REWRITTEN to query the REAL k3s cluster.
 *
 * Derives the demo phase from actual Rollout CRD status + real pod states
 * + real Prometheus metrics. No timers, no hardcoded values.
 */
import { NextResponse } from 'next/server';
import { getCoreV1, getAppsV1, getCustomObjects, type PodInfo, type RolloutInfo, type DeploymentInfo, type ArgoCDAppInfo } from '@/lib/k8s-client';
import { queryInstant, extractValue } from '@/lib/prom-client';

export const dynamic = 'force-dynamic';

const NS = 'payment-prod';

type Phase = 'idle' | 'syncing' | 'canary20' | 'canary50' | 'anomaly' | 'analyzing' | 'rollback';

// ---- Helpers ----

function isPodReady(pod: any): boolean {
  return pod.status?.containerStatuses?.every(
    (cs: any) => cs.ready
  ) ?? false;
}

function podToInfo(pod: any): PodInfo {
  const cs = pod.status?.containerStatuses?.[0];
  return {
    name: pod.metadata?.name ?? '',
    namespace: pod.metadata?.namespace ?? NS,
    phase: pod.status?.phase ?? 'Unknown',
    ready: isPodReady(pod),
    restartCount: cs?.restartCount ?? 0,
    containerStatuses: (pod.status?.containerStatuses ?? []).map((c: any) => ({
      name: c.name,
      ready: c.ready,
      restartCount: c.restartCount,
      lastStateTerminated: c.lastState?.terminated ? {
        exitCode: c.lastState.terminated.exitCode,
        reason: c.lastState.terminated.reason,
        finishedAt: c.lastState.terminated.finishedAt,
      } : undefined,
      stateWaiting: c.state?.waiting ? {
        reason: c.state.waiting.reason,
        message: c.state.waiting.message,
      } : undefined,
      stateRunning: c.state?.running ? {
        startedAt: c.state.running.startedAt,
      } : undefined,
    })),
    labels: pod.metadata?.labels ?? {},
    node: pod.spec?.nodeName ?? '',
  };
}

function rolloutToInfo(rollout: any): RolloutInfo {
  const s = rollout?.status ?? {};
  const canary = s.canary ?? {};
  // status.canary is {} on a basic canary Rollout - Argo Rollouts only fills it
  // for traffic-routed strategies. The live weight is therefore the setWeight of
  // the most recent weighted step, not anything published in status.
  const steps = (rollout?.spec?.strategy?.canary?.steps ?? []) as Array<Record<string, unknown>>;
  const stepIndex = s.currentStepIndex as number | undefined;
  const hasCanary = Boolean(s.currentPodHash) && s.currentPodHash !== s.stableRS;
  let canaryWeight = 0;
  if (hasCanary && typeof stepIndex === 'number') {
    for (let i = Math.min(stepIndex, steps.length) - 1; i >= 0; i--) {
      const w = steps[i]?.setWeight;
      if (typeof w === 'number') { canaryWeight = w; break; }
    }
  }
  const curStep = (typeof stepIndex === 'number' ? steps[stepIndex] : undefined) ?? {};
  const currentStepKind =
    'analysis' in curStep ? 'analysis'
    : 'pause' in curStep ? 'pause'
    : 'setWeight' in curStep ? 'setWeight'
    : '';

  return {
    name: rollout?.metadata?.name ?? 'payments-api',
    namespace: rollout?.metadata?.namespace ?? NS,
    phase: s.phase ?? 'Unknown',
    message: s.message ?? '',
    canaryWeight,
    stableWeight: 100 - canaryWeight,
    currentStep: typeof s.currentStepIndex === 'number' ? s.currentStepIndex : -1,
    currentStepKind,
    stepsCompleted: typeof s.currentStepIndex === 'number' ? s.currentStepIndex : 0,
    stableRS: s.stableRS ?? '',
    // Argo Rollouts exposes the current pod-template hash as status.currentPodHash; status.currentRS does not exist in the API
    currentRS: s.currentPodHash ?? s.currentRS ?? '',
    availableReplicas: s.availableReplicas ?? 0,
    readyReplicas: s.readyReplicas ?? 0,
    replicas: s.replicas ?? 0,
    conditions: (s.conditions ?? []).map((c: any) => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
      message: c.message,
    })),
  };
}

/** Derive the demo phase from the real Rollout + pod state */
function derivePhase(rollout: RolloutInfo, pods: PodInfo[], metrics: { canaryErrorRate: number; canaryP99: number }): Phase {
  const { phase: rPhase, canaryWeight, currentStepKind } = rollout;

  // Aborted / Degraded = the analysis failed, rollback in progress
  if (rPhase === 'Aborted' || rPhase === 'Degraded') {
    return 'rollback';
  }

  // On the analysis step. This used to test `rPhase === 'Paused' && currentStep
  // >= 3`, which is never true: Argo Rollouts stays *Progressing* through an
  // inline analysis step and only pauses for an explicit `pause` step. So
  // 'anomaly' and 'analyzing' were unreachable, the ANOMALY DETECTED / AI
  // ANALYZING rail chips never lit, runRealAnalyzers never ran outside a
  // rollback, and the GLM-4.5 card never had findings to explain.
  if (currentStepKind === 'analysis' && rPhase !== 'Healthy') {
    // Check if any canary pods are CrashLoopBackOff or OOMKilled
    const canaryPods = pods.filter(p => p.labels?.['rollouts-pod-template-hash'] === rollout.currentRS);
    const hasOOMKilled = canaryPods.some(p =>
      p.containerStatuses.some(cs =>
        cs.lastStateTerminated?.reason === 'OOMKilled' ||
        cs.stateWaiting?.reason === 'CrashLoopBackOff'
      )
    );

    if (hasOOMKilled || metrics.canaryErrorRate > 1.0) {
      return 'anomaly';
    }
    return 'analyzing';
  }

  // Paused at earlier step (step 0 = 20% pause)
  if (rPhase === 'Paused') {
    return canaryWeight >= 20 ? 'canary20' : 'syncing';
  }

  // Progressing through steps
  if (rPhase === 'Progressing') {
    if (canaryWeight >= 50) return 'canary50';
    if (canaryWeight >= 20) return 'canary20';
    return 'syncing';
  }

  // Healthy = no canary, all stable
  if (rPhase === 'Healthy') {
    return 'idle';
  }

  // Fallback
  if (canaryWeight > 0) {
    return canaryWeight >= 50 ? 'canary50' : 'canary20';
  }
  return 'idle';
}

// ---- Real Analyzer ----

interface Finding {
  kind: string;
  name: string;
  analyzer: string;
  severity: 'critical' | 'warning' | 'info';
  error: string;
  suggestedFix?: string;
}

function runRealAnalyzers(pods: PodInfo[], rollout: RolloutInfo): Finding[] {
  const findings: Finding[] = [];

  for (const pod of pods) {
    // Determine if this is a canary pod by checking its template hash

    for (const cs of pod.containerStatuses) {
      // OOMKilled detection
      if (cs.lastStateTerminated?.reason === 'OOMKilled') {
        findings.push({
          kind: 'Pod',
          name: `${pod.namespace}/${pod.name}`,
          analyzer: 'pod',
          severity: 'critical',
          error: `the last termination reason is OOMKilled (exit code ${cs.lastStateTerminated.exitCode}) container=${cs.name} pod=${pod.name}`,
          suggestedFix: `kubectl logs ${pod.name} -c ${cs.name} --previous`,
        });
      }

      // CrashLoopBackOff detection
      if (cs.stateWaiting?.reason === 'CrashLoopBackOff') {
        findings.push({
          kind: 'Pod',
          name: `${pod.namespace}/${pod.name}`,
          analyzer: 'pod',
          severity: 'critical',
          error: `Pod ${pod.name} is in CrashLoopBackOff (restarts: ${cs.restartCount})`,
          suggestedFix: `kubectl describe pod ${pod.name} -n ${pod.namespace}`,
        });
      }
    }

  }

  // Rollout paused detection
  if (rollout.currentStepKind === 'analysis' && rollout.phase !== 'Healthy') {
    findings.push({
      kind: 'Rollout',
      name: `${rollout.namespace}/${rollout.name}`,
      analyzer: 'rollout',
      severity: 'warning',
      error: `Rollout ${rollout.name} is on the analysis step (step ${rollout.currentStep}) with canary weight ${rollout.canaryWeight}%`,
      suggestedFix: `kubectl argo rollouts get rollout ${rollout.name} -n ${rollout.namespace}`,
    });
  }

  return findings;
}

// ---- Main Handler ----

export async function GET() {
  try {
    const coreV1 = getCoreV1();
    const appsV1 = getAppsV1();
    const customObjects = getCustomObjects();

    // 1. Fetch Rollout CRD
    let rollout: RolloutInfo;
    let rolloutUnreadable = false;
    try {
      const res = await customObjects.getNamespacedCustomObject(
        'argoproj.io', 'v1alpha1', NS, 'rollouts', 'payments-api'
      );
      rollout = rolloutToInfo(res.body);
    } catch {
      // Fallback if CRD not available
      rolloutUnreadable = true;
      rollout = {
        name: 'payments-api', namespace: NS, phase: 'Unknown', message: '',
        canaryWeight: 0, stableWeight: 100, currentStep: -1, currentStepKind: '', stepsCompleted: 0,
        stableRS: '', currentRS: '', availableReplicas: 0, readyReplicas: 0,
        replicas: 0, conditions: [],
      };
    }

    // 2. Fetch pods
    let pods: PodInfo[] = [];
    let podsUnreadable = false;
    const imageByHash: Record<string, string> = {};
    try {
      const res = await coreV1.listNamespacedPod(NS, undefined, undefined, undefined, undefined, 'app=payments-api');
      const items = res.body.items ?? [];
      pods = items.map(podToInfo);
      for (const p of items) {
        const h = (p.metadata?.labels ?? {})['rollouts-pod-template-hash'];
        const img = p.spec?.containers?.[0]?.image;
        if (h && img) imageByHash[h] = img;
      }
    } catch {
      podsUnreadable = true;
    }

    // Both primary reads failed: there is no reachable cluster. Falling through
    // to the defaults would render a green "Synced" / "SLO healthy" dashboard
    // for a cluster that does not exist, so fail loudly instead.
    if (rolloutUnreadable && podsUnreadable) {
      return NextResponse.json(
        {
          error:
            'cannot reach a Kubernetes API - this dashboard reads a live cluster via KUBECONFIG on the same host',
        },
        { status: 503 }
      );
    }

    // 3. Fetch Deployments
    let deployments: DeploymentInfo[] = [];
    try {
      const res = await appsV1.listNamespacedDeployment(NS);
      deployments = (res.body.items ?? []).map((d: any) => ({
        name: d.metadata?.name ?? '',
        namespace: d.metadata?.namespace ?? NS,
        replicas: d.spec?.replicas ?? 0,
        readyReplicas: d.status?.readyReplicas ?? 0,
        availableReplicas: d.status?.availableReplicas ?? 0,
        image: d.spec?.template?.spec?.containers?.[0]?.image ?? '',
        conditions: (d.status?.conditions ?? []).map((c: any) => ({
          type: c.type, status: c.status, reason: c.reason,
        })),
      }));
    } catch {
      // Continue
    }

    // 4. Fetch real Prometheus metrics
    let canaryErrorRate = 0;
    let canaryP99 = 0;
    let stableErrorRate = 0;
    let stableP99 = 0;
    try {
      const [errRes, p99Res, sErrRes, sP99Res] = await Promise.allSettled([
        queryInstant(`sum(rate(http_requests_total{service="payments-api-canary",code=~"5.."}[2m])) / sum(rate(http_requests_total{service="payments-api-canary"}[2m])) * 100`),
        queryInstant(`histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="payments-api-canary"}[2m])) by (le)) * 1000`),
        queryInstant(`sum(rate(http_requests_total{service="payments-api-stable",code=~"5.."}[2m])) / sum(rate(http_requests_total{service="payments-api-stable"}[2m])) * 100`),
        queryInstant(`histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{service="payments-api-stable"}[2m])) by (le)) * 1000`),
      ]);

      canaryErrorRate = errRes.status === 'fulfilled' ? extractValue(errRes.value, 0) : 0;
      canaryP99 = p99Res.status === 'fulfilled' ? extractValue(p99Res.value, 0) : 0;
      stableErrorRate = sErrRes.status === 'fulfilled' ? extractValue(sErrRes.value, 0) : 0;
      stableP99 = sP99Res.status === 'fulfilled' ? extractValue(sP99Res.value, 0) : 0;
    } catch {
      // Prometheus not available yet
    }

    const metrics = { stableErrorRate, canaryErrorRate, stableP99, canaryP99 };

    // 5. Derive phase from real state
    const phase = derivePhase(rollout, pods, metrics);

    // 6. Fetch Argo CD Application status
    let argoCdSync: {
      revision: string; shortRevision: string; message: string;
      author: string; branch: string; repo: string; status: string; targetRevision: string;
    } = {
      revision: '', shortRevision: '', message: '',
      author: '', branch: 'main', repo: '',
      status: 'Unknown', targetRevision: '',
    };
    try {
      const appRes = await customObjects.getNamespacedCustomObject(
        'argoproj.io', 'v1alpha1', 'argocd', 'applications', 'payments-api'
      );
      const appBody = appRes.body as any;
      const sync = appBody?.status?.sync ?? {};
      argoCdSync = {
        revision: sync.revision ?? '',
        shortRevision: (sync.revision ?? '').slice(0, 7),
        message: appBody?.status?.operationState?.message ?? '',
        author: appBody?.status?.operationState?.operation?.initiatedBy?.username ?? 'argocd',
        branch: 'main',
        repo: appBody?.spec?.source?.repoURL ?? '',
        status: sync.status ?? 'Unknown',
        targetRevision: appBody?.spec?.source?.targetRevision ?? '',
      };
    } catch {
      // Argo CD not available
    }

    // 7. Compute pod health
    // Argo Rollouts keeps currentPodHash == stableRS when no canary is in flight; treat that as zero canary pods.
    const canaryPods = rollout.currentRS && rollout.currentRS !== rollout.stableRS ? pods.filter(p => p.labels?.['rollouts-pod-template-hash'] === rollout.currentRS) : [];
    const stablePods = pods.filter(p => p.labels?.['rollouts-pod-template-hash'] === rollout.stableRS);
    const stableReady = stablePods.filter(p => p.ready).length;
    const canaryReady = canaryPods.filter(p => p.ready).length;

    // Get the canary pod phase (Running, CrashLoopBackOff, Pending, etc.)
    const canaryPhase = canaryPods.length > 0
      ? canaryPods[0].containerStatuses[0]?.stateWaiting?.reason ?? canaryPods[0].phase
      : 'ScaledToZero';

    // 8. Run real analyzers (only when there's something to analyze)
    const findings = (phase === 'anomaly' || phase === 'analyzing' || phase === 'rollback')
      ? runRealAnalyzers(pods, rollout)
      : [];

    // 9. Build Argo Rollouts response object
    const argoRollouts = {
      name: rollout.name,
      namespace: rollout.namespace,
      phase: rollout.phase,
      currentStep: rollout.currentStep,
      currentStepKind: rollout.currentStepKind,
      stableWeight: rollout.stableWeight,
      canaryWeight: rollout.canaryWeight,
      stableRS: rollout.stableRS,
      canaryRS: rollout.currentRS,
      stableImage: imageByHash[rollout.stableRS] ?? deployments.find(d => d.name === 'payments-api')?.image ?? '',
      canaryImage: imageByHash[rollout.currentRS] ?? '',
    };

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      phase,
      argoCdSync,
      argoRollouts,
      traffic: { stable: rollout.stableWeight, canary: rollout.canaryWeight },
      metrics,
      slo: {
        status: (canaryErrorRate > 1.0 || canaryP99 > 500) ? 'violated' : 'healthy',
        errorBudget: 1.0,
        canaryError: canaryErrorRate,
      },
      pods: {
        stable: {
          desired: rollout.replicas || stablePods.length,
          ready: stableReady,
          image: imageByHash[rollout.stableRS] ?? '',
        },
        canary: {
          desired: canaryPods.length > 0 ? canaryPods.length : 0,
          ready: canaryReady,
          image: imageByHash[rollout.currentRS] ?? '',
          phase: canaryPhase,
        },
      },
      findings: findings.map(f => ({
        kind: f.kind,
        name: f.name,
        analyzer: f.analyzer,
        severity: f.severity,
        error: f.error,
        suggestedFix: f.suggestedFix,
      })),
      findingsCount: findings.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'cluster-state failed', detail: msg, phase: 'idle' },
      { status: 500 }
    );
  }
}