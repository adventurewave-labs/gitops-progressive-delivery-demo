#!/usr/bin/env bash
# Run the Next.js dashboard against the REAL k3s cluster.
# Source this or run: bash dev-real.sh
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
export PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:30900}"
export NODE_TLS_REJECT_UNAUTHORIZED=0
echo "Starting Next.js dashboard connected to REAL cluster..."
echo "  KUBECONFIG=$KUBECONFIG"
echo "  PROMETHEUS_URL=$PROMETHEUS_URL"
echo ""
bun run dev -p 3000