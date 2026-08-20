/**
 * Mock Kubernetes cluster state for the progressive-delivery demo.
 *
 * This is a realistic snapshot of a `payment-prod` namespace mid-canary.
 * The canary Deployment (v2.4) is genuinely broken: its pods are
 * OOMKilled and CrashLoopBackOff, the Rollout is paused on the analysis
 * step, the HPA is maxed out, and there's a Pending PVC. Every value
 * here is what you'd actually see from `kubectl get` against a real
 * cluster in this state.
 */

export interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
    creationTimestamp: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  [key: string]: unknown;
}

// ---- Stable Deployment (v2.3) — healthy ----------------------------

export const stableDeployment: K8sResource = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "payments-api",
    namespace: "payment-prod",
    uid: "f4c2a1b8-9d3e-4c7b-8f1a-2b3c4d5e6f70",
    resourceVersion: "184729",
    creationTimestamp: "2026-08-12T09:14:32Z",
    labels: {
      app: "payments-api",
      "app.kubernetes.io/version": "v2.3",
      "rollouts.argoproj.io/controlled-by": "rollout",
    },
    annotations: {
      "deployment.kubernetes.io/revision": "12",
      "rollouts.argoproj.io/revision": "v2.3",
    },
  },
  spec: {
    replicas: 4,
    selector: { matchLabels: { app: "payments-api", track: "stable" } },
    template: {
      metadata: { labels: { app: "payments-api", track: "stable", version: "v2.3" } },
      spec: {
        containers: [
          {
            name: "api",
            image: "registry.internal.acme.io/payments:v2.3",
            ports: [{ containerPort: 8080, name: "http" }],
            resources: {
              requests: { cpu: "100m", memory: "256Mi" },
              limits: { cpu: "500m", memory: "1Gi" },
            },
          },
        ],
      },
    },
  },
  status: {
    observedGeneration: 12,
    replicas: 4,
    updatedReplicas: 4,
    readyReplicas: 4,
    availableReplicas: 4,
    conditions: [
      { type: "Available", status: "True", reason: "MinimumReplicasAvailable" },
      { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
    ],
  },
};

// ---- Canary Deployment (v2.4) — BROKEN ----------------------------

export const canaryDeployment: K8sResource = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "payments-api-canary",
    namespace: "payment-prod",
    uid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    resourceVersion: "184845",
    creationTimestamp: "2026-08-20T03:14:08Z",
    labels: {
      app: "payments-api",
      "app.kubernetes.io/version": "v2.4",
      "rollouts.argoproj.io/controlled-by": "rollout",
    },
    annotations: {
      "deployment.kubernetes.io/revision": "13",
      "rollouts.argoproj.io/revision": "v2.4",
    },
  },
  spec: {
    replicas: 2,
    selector: { matchLabels: { app: "payments-api", track: "canary" } },
    template: {
      metadata: { labels: { app: "payments-api", track: "canary", version: "v2.4" } },
      spec: {
        containers: [
          {
            name: "api",
            image: "registry.internal.acme.io/payments:v2.4",
            ports: [{ containerPort: 8080, name: "http" }],
            resources: {
              requests: { cpu: "100m", memory: "256Mi" },
              // ← This is the bug: limit is 1Gi but v2.4 leaks memory,
              //   so pods hit the limit and get OOMKilled.
              limits: { cpu: "500m", memory: "1Gi" },
            },
          },
        ],
      },
    },
  },
  status: {
    observedGeneration: 13,
    replicas: 2,
    updatedReplicas: 2,
    readyReplicas: 0,
    availableReplicas: 0,
    unavailableReplicas: 2,
    conditions: [
      { type: "Available", status: "False", reason: "MinimumReplicasUnavailable",
        message: "Deployment does not have minimum availability." },
      { type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded",
        message: "ReplicaSet has timed out progressing." },
    ],
  },
};

// ---- Stable pods — healthy -----------------------------------------

export const stablePods: K8sResource[] = [
  podResource("payments-api-7c4f5b-x9qkl", "stable", "v2.3", "Running", true, 0),
  podResource("payments-api-7c4f5b-2p3qr", "stable", "v2.3", "Running", true, 0),
  podResource("payments-api-7c4f5b-4r5st", "stable", "v2.3", "Running", true, 0),
  podResource("payments-api-7c4f5b-6u7vw", "stable", "v2.3", "Running", true, 0),
];

// ---- Canary pods — BROKEN (OOMKilled + CrashLoopBackOff) ----------

export const canaryPods: K8sResource[] = [
  podResource(
    "payments-api-canary-6b8f4c-9a8bc",
    "canary",
    "v2.4",
    "CrashLoopBackOff",
    false,
    137, // OOMKilled exit code
    "OOMKilled",
  ),
  podResource(
    "payments-api-canary-6b8f4c-1d2ef",
    "canary",
    "v2.4",
    "CrashLoopBackOff",
    false,
    137,
    "OOMKilled",
  ),
];

function podResource(
  name: string,
  track: string,
  version: string,
  phase: string,
  ready: boolean,
  exitCode: number,
  reason?: string,
): K8sResource {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name,
      namespace: "payment-prod",
      uid: `pod-${name}`,
      resourceVersion: String(184800 + Math.floor(Math.random() * 100)),
      creationTimestamp: "2026-08-20T03:14:09Z",
      labels: { app: "payments-api", track, version },
    },
    spec: {
      containers: [
        {
          name: "api",
          image: `registry.internal.acme.io/payments:${version}`,
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: { cpu: "500m", memory: "1Gi" },
          },
        },
      ],
    },
    status: {
      phase,
      containerStatuses: [
        {
          name: "api",
          ready,
          restartCount: phase === "CrashLoopBackOff" ? 6 : 0,
          image: `registry.internal.acme.io/payments:${version}`,
          imageID: `sha256:${Math.random().toString(16).slice(2, 14)}`,
          containerID: `containerd://${Math.random().toString(16).slice(2, 18)}`,
          lastState: reason
            ? {
                terminated: {
                  exitCode,
                  reason,
                  startedAt: "2026-08-20T03:18:42Z",
                  finishedAt: "2026-08-20T03:24:18Z",
                  containerID: `containerd://${Math.random().toString(16).slice(2, 18)}`,
                },
              }
            : {},
          state: phase === "CrashLoopBackOff"
            ? { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s restarting failed container" } }
            : { running: { startedAt: "2026-08-12T09:14:33Z" } },
        },
      ],
    },
  };
}

// ---- Argo Rollouts Rollout CRD — paused at analysis step ----------

export const rolloutResource: K8sResource = {
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Rollout",
  metadata: {
    name: "payments-api",
    namespace: "payment-prod",
    uid: "rollout-payments-api",
    resourceVersion: "184847",
    creationTimestamp: "2026-08-12T09:14:32Z",
  },
  spec: {
    replicas: 6,
    strategy: {
      canary: {
        canaryService: "payments-api-canary",
        stableService: "payments-api-stable",
        trafficRouting: { nginx: { stableIngress: "payments-ingress" } },
        steps: [
          { setWeight: 20 },
          { pause: { duration: "30s" } },
          { setWeight: 50 },
          {
            analysis: {
              templates: [{ templateName: "prometheus-slo" }],
              args: [
                { name: "service-name", value: "payments-api-canary" },
              ],
            },
          },
          { setWeight: 100 },
        ],
      },
    },
  },
  status: {
    phase: "Paused",
    message: "CanaryPauseStep",
    availableReplicas: 4,
    readyReplicas: 4,
    currentPodHash: "6b8f4c",
    currentStepHash: "f5e4d3",
    stableRS: "payments-api-7c4f5b",
    currentRS: "payments-api-canary-6b8f4c",
    canary: {
      status: "Paused",
      weight: 50,
      stableWeight: 50,
      currentStep: 3, // 0-indexed: step 3 is the analysis step
      stepsCompleted: 3,
    },
    conditions: [
      {
        type: "Progressing",
        status: "True",
        reason: "RolloutPaused",
        message: "Rollout is paused on step 3 (Analysis)",
      },
    ],
  },
};

// ---- Services + Ingress -------------------------------------------

export const stableService: K8sResource = {
  apiVersion: "v1",
  kind: "Service",
  metadata: { name: "payments-api-stable", namespace: "payment-prod", uid: "svc-stable", resourceVersion: "184731" },
  spec: { selector: { app: "payments-api", track: "stable" }, ports: [{ port: 80, targetPort: 8080 }] },
  status: { loadBalancer: {} },
};

export const canaryService: K8sResource = {
  apiVersion: "v1",
  kind: "Service",
  metadata: { name: "payments-api-canary", namespace: "payment-prod", uid: "svc-canary", resourceVersion: "184732" },
  spec: { selector: { app: "payments-api", track: "canary" }, ports: [{ port: 80, targetPort: 8080 }] },
  status: { loadBalancer: {} },
};

export const ingressResource: K8sResource = {
  apiVersion: "networking.k8s.io/v1",
  kind: "Ingress",
  metadata: {
    name: "payments-ingress",
    namespace: "payment-prod",
    uid: "ingress-payments",
    resourceVersion: "184733",
    annotations: {
      "nginx.ingress.kubernetes.io/canary": "true",
      "nginx.ingress.kubernetes.io/canary-weight": "50",
    },
  },
  spec: {
    ingressClassName: "nginx",
    rules: [
      {
        host: "payments.internal.acme.io",
        http: {
          paths: [
            { path: "/", pathType: "Prefix", backend: { service: { name: "payments-api-stable", port: { number: 80 } } } },
          ],
        },
      },
    ],
  },
  status: { loadBalancer: { ingress: [{ ip: "10.0.32.18" }] } },
};

// ---- Pending PVC (bonus finding) ---------------------------------

export const pendingPVC: K8sResource = {
  apiVersion: "v1",
  kind: "PersistentVolumeClaim",
  metadata: { name: "payments-data-pvc", namespace: "payment-prod", uid: "pvc-payments-data", resourceVersion: "184734" },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: { requests: { storage: "10Gi" } },
    storageClassName: "fast-ssd",
  },
  status: { phase: "Pending" },
};

// ---- Node with DiskPressure (bonus finding) ----------------------

export const diskPressureNode: K8sResource = {
  apiVersion: "v1",
  kind: "Node",
  metadata: { name: "worker-3", uid: "node-worker-3", resourceVersion: "184735" },
  status: {
    conditions: [
      { type: "Ready", status: "True", reason: "KubeletReady" },
      { type: "DiskPressure", status: "True", reason: "KubeletHasNoDiskSpace",
        message: "kubelet has disk pressure" },
      { type: "MemoryPressure", status: "False" },
      { type: "PIDPressure", status: "False" },
    ],
  },
};

// ---- Convenience: namespace + everything together ----------------

export const namespaceResource: K8sResource = {
  apiVersion: "v1",
  kind: "Namespace",
  metadata: { name: "payment-prod", uid: "ns-payment-prod", resourceVersion: "184720" },
  status: { phase: "Active" },
};

/** Every resource in the mock cluster, indexed by (kind, name). */
export const ALL_RESOURCES: K8sResource[] = [
  namespaceResource,
  stableDeployment,
  canaryDeployment,
  ...stablePods,
  ...canaryPods,
  rolloutResource,
  stableService,
  canaryService,
  ingressResource,
  pendingPVC,
  diskPressureNode,
];

/** Returns resources matching the given K8s list URL, e.g. /api/v1/namespaces/payment-prod/pods */
export function listResources(path: string): K8sResource[] {
  // /api/v1/namespaces/payment-prod/pods -> kind=Pod, ns=payment-prod
  const podsMatch = path.match(/\/api\/v1\/namespaces\/[^/]+\/pods/);
  if (podsMatch) return [...stablePods, ...canaryPods];

  const deploymentsMatch = path.match(/\/apis\/apps\/v1\/namespaces\/[^/]+\/deployments/);
  if (deploymentsMatch) return [stableDeployment, canaryDeployment];

  const servicesMatch = path.match(/\/api\/v1\/namespaces\/[^/]+\/services/);
  if (servicesMatch) return [stableService, canaryService];

  const ingressesMatch = path.match(/\/apis\/networking\.k8s\.io\/v1\/namespaces\/[^/]+\/ingresses/);
  if (ingressesMatch) return [ingressResource];

  const pvcsMatch = path.match(/\/api\/v1\/namespaces\/[^/]+\/persistentvolumeclaims/);
  if (pvcsMatch) return [pendingPVC];

  const rolloutsMatch = path.match(/\/apis\/argoproj\.io\/v1alpha1\/namespaces\/[^/]+\/rollouts/);
  if (rolloutsMatch) return [rolloutResource];

  const nodesMatch = path.match(/\/api\/v1\/nodes$/);
  if (nodesMatch) return [diskPressureNode];

  return [];
}
