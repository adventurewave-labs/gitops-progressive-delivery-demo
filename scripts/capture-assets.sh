#!/usr/bin/env bash
# Captures a real GLM-4.5 diagnosis from the running app, saves to JSON.
# Also captures a real /api/analyze response + a real /api/k8s pods list.
# All outputs are embedded verbatim into the static showcase HTML.

set -euo pipefail
BASE_URL="http://localhost:3000"
OUT_DIR="/home/z/my-project/scripts/showcase-assets"
mkdir -p "$OUT_DIR"

echo "=== Capturing real backend responses ==="

# Start the dev server if it's not already running.
if ! curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
  echo "  dev server not running — starting it now..."
  cd /home/z/my-project
  setsid bun run dev > /tmp/dev.log 2>&1 < /dev/null &
  disown
  # Wait for it to be ready
  for i in {1..60}; do
    if curl -sf -o /dev/null "$BASE_URL/" 2>/dev/null; then
      echo "  dev server ready after ${i}s"
      break
    fi
    sleep 1
  done
fi

if ! curl -sf -o /dev/null "$BASE_URL/"; then
  echo "FAIL: server still not reachable at $BASE_URL"
  exit 1
fi

# 1. /api/k8s pods list (real mock K8s response)
echo "  -> /api/k8s/api/v1/namespaces/payment-prod/pods"
curl -s "$BASE_URL/api/k8s/api/v1/namespaces/payment-prod/pods" \
  | jq . > "$OUT_DIR/k8s-pods.json"

# 2. /api/analyze output (real analyzer findings, no LLM)
echo "  -> /api/analyze"
curl -s "$BASE_URL/api/analyze" \
  | jq . > "$OUT_DIR/analyze.json"

# 3. /api/explain output (real GLM-4.5 LLM diagnosis)
echo "  -> /api/explain (real GLM-4.5 call, ~3-10s)"
curl -s -X POST "$BASE_URL/api/explain" \
  -H "Content-Type: application/json" \
  -d '[{"kind":"Pod","name":"payment-prod/payments-api-canary-6b8f4c-9a8bc","analyzer":"pod","severity":"critical","error":[{"Text":"the last termination reason is OOMKilled (exit code 137) container=api pod=payments-api-canary-6b8f4c-9a8bc"}],"suggestedFix":"kubectl logs payments-api-canary-6b8f4c-9a8bc -c api --previous"},{"kind":"Pod","name":"payment-prod/payments-api-canary-6b8f4c-9a8bc","analyzer":"log","severity":"critical","error":[{"Text":"Container '"'"'api'"'"' logs show heap growth: 245MB → 1.0GB over 4m17s before OOMKill"}],"suggestedFix":"kubectl logs payments-api-canary-6b8f4c-9a8bc -c api --previous | grep -i memory"},{"kind":"Deployment","name":"payment-prod/payments-api-canary","analyzer":"deployment","severity":"critical","error":[{"Text":"Deployment payment-prod/payments-api-canary has 2 replicas but 0 are available"}],"suggestedFix":"kubectl rollout status deployment/payments-api-canary -n payment-prod"},{"kind":"Rollout","name":"payment-prod/payments-api","analyzer":"rollout","severity":"warning","error":[{"Text":"Rollout payments-api is paused at step 3 (Analysis) with canary weight 50%"}],"suggestedFix":"kubectl argo rollouts get rollout payments-api -n payment-prod"}]' \
  | jq . > "$OUT_DIR/explain.json"

# 4. /api/prometheus output (real PromQL matrix result)
echo "  -> /api/prometheus?query=...&range=1"
curl -s "$BASE_URL/api/prometheus?query=rate(http_requests_total%7Bservice%3D%22payments-api%22%2Ctrack%3D%22canary%22%2Ccode%3D~%225..%22%7D)%5B5m%5D)%2Frate(http_requests_total%7Bservice%3D%22payments-api%22%2Ctrack%3D%22canary%22%7D)%5B5m%5D)*100&range=1" \
  | jq . > "$OUT_DIR/prometheus.json"

echo
echo "=== Saved to $OUT_DIR ==="
ls -la "$OUT_DIR"
echo
echo "=== LLM diagnosis preview ==="
jq -r '.content' "$OUT_DIR/explain.json" | head -10
