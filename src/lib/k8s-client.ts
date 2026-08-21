/**
 * Real Kubernetes API client.
 * Reads kubeconfig from KUBECONFIG env or ~/.kube/config.
 * Used by all API routes to query the real k3s cluster.
 */
import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();

export function loadConfig() {
  const kubeconfigPath = process.env.KUBECONFIG || '';
  if (kubeconfigPath) {
    kc.loadFromFile(kubeconfigPath);
  } else {
    kc.loadFromDefault();
  }
  return kc;
}

// Lazy-load: only initialize once first called
let _loaded = false;
function ensureLoaded() {
  if (!_loaded) {
    loadConfig();
    _loaded = true;
  }
}

/** Get the k8s core-v1 API client */
export function getCoreV1(): k8s.CoreV1Api {
  ensureLoaded();
  return kc.makeApiClient(k8s.CoreV1Api);
}

/** Get the k8s apps-v1 API client */
export function getAppsV1(): k8s.AppsV1Api {
  ensureLoaded();
  return kc.makeApiClient(k8s.AppsV1Api);
}

/** Get a custom objects API client (for Rollout CRD, Argo CD Application CRD) */
export function getCustomObjects(): k8s.CustomObjectsApi {
  ensureLoaded();
  return kc.makeApiClient(k8s.CustomObjectsApi);
}

/** Get the current cluster's API server URL */
export function getApiServer(): string {
  ensureLoaded();
  return kc.getCurrentCluster()?.server ?? 'https://localhost:6443';
}

// ---- Type helpers ----

export interface PodInfo {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  restartCount: number;
  containerStatuses: {
    name: string;
    ready: boolean;
    restartCount: number;
    lastStateTerminated?: {
      exitCode: number;
      reason: string;
      finishedAt: string;
    };
    stateWaiting?: {
      reason: string;
      message: string;
    };
    stateRunning?: {
      startedAt: string;
    };
  }[];
  labels: Record<string, string>;
  node: string;
}

export interface RolloutInfo {
  name: string;
  namespace: string;
  phase: string;
  message: string;
  canaryWeight: number;
  stableWeight: number;
  currentStep: number;
  stepsCompleted: number;
  stableRS: string;
  currentRS: string;
  availableReplicas: number;
  readyReplicas: number;
  replicas: number;
  conditions: Array<{ type: string; status: string; reason: string; message: string }>;
}

export interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  image: string;
  conditions: Array<{ type: string; status: string; reason: string }>;
}

export interface ArgoCDAppInfo {
  name: string;
  namespace: string;
  syncStatus: string;
  healthStatus: string;
  revision: string;
  repoURL: string;
}
