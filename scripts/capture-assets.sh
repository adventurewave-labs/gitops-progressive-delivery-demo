#!/usr/bin/env bash
# Captures REAL responses from the running cluster.
# Requires: k3s running, demo cycling, Next.js dev server on :3000.
set -euo pipefail
BASE_URL="http://localhost:3000"
OUT_DIR="/home/z/my-project/scripts/showcase-assets"
mkdir -p "$OUT_DIR"

echo "=== Capturing real backend responses ==="

if ! curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
    echo "FAIL: server not reachable at $BASE_URL"
    exit 1
fi

# 1. Real K8s pod list (proxied to real kube-api)
echo "  -> /api/k8s/api/v1/namespaces/payment-prod/pods"
curl -s "$BASE_URL/api/k8s/api/v1/namespaces/payment-prod/pods" \
    | jq . > "$OUT_DIR/k8s-pods.json"

# 2. Real analyzer output (queries real cluster)
echo "  -> /api/analyze"
curl -s "$BASE_URL/api/analyze" \
    | jq . > "$OUT_DIR/analyze.json"

# 3. Real GLM-4.5 LLM diagnosis (uses real findings from #2)
echo "  -> /api/explain (real GLM-4.5 call)"
curl -s -X POST "$BASE_URL/api/explain" \
    -H "Content-Type: application/json" \
    -d "$(cat "$OUT_DIR/analyze.json" | jq '.results | map({kind, name, analyzer, severity, error, suggestedFix})')" \
    | jq . > "$OUT_DIR/explain.json"

# 4. Real Prometheus query (proxied to real Prometheus)
echo "  -> /api/prometheus?query=...&range=1"
curl -s "$BASE_URL/api/prometheus?query=rate(http_requests_total%7Bservice%3D%22payments-api-canary%22%2Ccode%3D~%225..%22%7D)%5B2m%5D)%2Frate(http_requests_total%7Bservice%3D%22payments-api-canary%22%7D)%5B2m%5D)*100&range=1" \
    | jq . > "$OUT_DIR/prometheus.json"

# 5. Real cluster state
echo "  -> /api/cluster-state"
curl -s "$BASE_URL/api/cluster-state" \
    | jq . > "$OUT_DIR/cluster-state.json"

echo
echo "=== Saved to $OUT_DIR ==="
ls -la "$OUT_DIR"
echo
echo "=== LLM diagnosis preview ==="
jq -r '.content' "$OUT_DIR/explain.json" | head -15
