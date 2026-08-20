/**
 * Mock kube-apiserver. Implements enough of the K8s REST API to satisfy
 * `kubectl`-style GET requests against the payment-prod namespace.
 *
 *   GET /api/k8s/api/v1/namespaces/payment-prod/pods
 *   GET /api/k8s/apis/apps/v1/namespaces/payment-prod/deployments
 *   GET /api/k8s/apis/argoproj.io/v1alpha1/namespaces/payment-prod/rollouts
 *
 * Returns standard Kubernetes list envelopes:
 *
 *   { kind: "PodList", apiVersion: "v1", items: [...] }
 */
import { NextRequest, NextResponse } from "next/server";
import { listResources } from "@/lib/k8s-mock-data";

export const dynamic = "force-dynamic";

function kindFromPath(path: string): string {
  if (path.includes("/pods")) return "Pod";
  if (path.includes("/deployments")) return "Deployment";
  if (path.includes("/services")) return "Service";
  if (path.includes("/ingresses")) return "Ingress";
  if (path.includes("/persistentvolumeclaims")) return "PersistentVolumeClaim";
  if (path.includes("/rollouts")) return "Rollout";
  if (path.endsWith("/nodes")) return "Node";
  return "Unknown";
}

function apiVersionFromPath(path: string): string {
  if (path.includes("/apis/apps/v1/")) return "apps/v1";
  if (path.includes("/apis/networking.k8s.io/v1/")) return "networking.k8s.io/v1";
  if (path.includes("/apis/argoproj.io/v1alpha1/")) return "argoproj.io/v1alpha1";
  return "v1";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = "/" + pathSegments.join("/");

  // Simulate realistic K8s API latency (50-150ms)
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));

  const items = listResources(path);
  const kind = `${kindFromPath(path)}List`;
  const apiVersion = apiVersionFromPath(path);

  return NextResponse.json({
    kind,
    apiVersion,
    metadata: {
      resourceVersion: String(Date.now()),
      continue: "",
    },
    items,
  });
}
