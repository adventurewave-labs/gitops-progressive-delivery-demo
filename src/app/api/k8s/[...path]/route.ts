/**
 * Read-only pass-through to the live kube-apiserver named by KUBECONFIG.
 *
 *   GET /api/k8s/api/v1/namespaces/payment-prod/pods
 *   GET /api/k8s/apis/argoproj.io/v1alpha1/namespaces/payment-prod/rollouts
 *
 * Returns the raw K8s JSON response unchanged, with the apiserver's status code.
 * Auth comes from the kubeconfig itself (client cert for k3d/k3s, bearer token
 * for in-cluster/SA kubeconfigs) via KubeConfig.applyToHTTPSOptions.
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';
import http from 'node:http';
import { loadConfig } from '@/lib/k8s-client';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: pathSegments } = await params;
  const path = '/' + pathSegments.join('/');

  try {
    const kc = loadConfig();
    const server = kc.getCurrentCluster()?.server;
    if (!server) throw new Error('no current cluster in kubeconfig');
    const target = new URL(server + path);

    // Pulls ca/cert/key or an Authorization header out of the kubeconfig.
    const opts: https.RequestOptions & { headers: Record<string, string> } = { headers: {} };
    await kc.applyToHTTPSOptions(opts);

    const { status, body } = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const mod = target.protocol === 'https:' ? https : http;
        const req = mod.request(
          {
            ...opts,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: 'GET',
            timeout: 10_000,
          },
          (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 502, body: data }));
          },
        );
        req.on('timeout', () => req.destroy(new Error('kube-apiserver request timed out')));
        req.on('error', reject);
        req.end();
      },
    );

    return new NextResponse(body, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      {
        kind: 'Status',
        apiVersion: 'v1',
        status: 'Failure',
        code: 502,
        message: `kube-api proxy error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
}
