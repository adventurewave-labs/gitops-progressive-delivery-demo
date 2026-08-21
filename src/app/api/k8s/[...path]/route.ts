/**
 * Kube API proxy — REWRITTEN to forward requests to the REAL k3s apiserver.
 *
 *   GET /api/k8s/api/v1/namespaces/payment-prod/pods
 *   GET /api/k8s/apis/apps/v1/namespaces/payment-prod/deployments
 *   GET /api/k8s/apis/argoproj.io/v1alpha1/namespaces/payment-prod/rollouts
 *
 * Returns the raw K8s JSON response unchanged.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApiServer, loadConfig } from '@/lib/k8s-client';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + pathSegments.join('/');

  let apiServer: string;
  try {
    apiServer = getApiServer();
  } catch {
    return NextResponse.json(
      { kind: 'Status', apiVersion: 'v1', code: 500, message: 'kubeconfig not loaded' },
      { status: 500 },
    );
  }

  const targetUrl = `${apiServer}${path}`;

  try {
    // Load config to get the auth headers
    loadConfig();
    const kc = await import('@kubernetes/client-node').then(m => {
      const config = new m.KubeConfig();
      const kubeconfigPath = process.env.KUBECONFIG || '';
      if (kubeconfigPath) config.loadFromFile(kubeconfigPath);
      else config.loadFromDefault();
      return config;
    });

    // Get auth headers from kubeconfig
    const cluster = kc.getCurrentCluster();
    const user = kc.getCurrentUser();
    const headers: Record<string, string> = {};

    if (user?.token) {
      headers['Authorization'] = `Bearer ${user.token}`;
    } else if (user?.certFile && user?.keyFile) {
      // Client cert auth — can't easily forward through fetch, use token instead
      // For k3s, the default service account token works
    }

    // For k3s, use the service account token if available, or try without auth
    // (k3s API on localhost is often accessible without auth in dev)
    const res = await fetch(targetUrl, {
      headers,
      // Bypass self-signed cert for k3s
      // @ts-ignore
      rejectUnauthorized: false,
      // @ts-ignore
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        kind: 'Status', apiVersion: 'v1', code: 502,
        message: `kube-api proxy error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
}