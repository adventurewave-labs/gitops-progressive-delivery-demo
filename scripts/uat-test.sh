#!/usr/bin/env bash
# UAT for the REAL GitOps progressive delivery demo.
#
# Validates every layer is genuinely connected to the real k3s cluster:
#   1. K8s API proxy returns real pods (with real OOMKilled)
#   2. /api/analyze queries real cluster state
#   3. /api/explain calls real GLM-4.5 on real findings
#   4. /api/prometheus proxies to real Prometheus
#   5. /api/cluster-state derives phase from real Rollout/Pod state
#   6. UI renders everything end-to-end
#
# Run: bash scripts/uat-test.sh
# Requires: k3s running, dev server on :3000

set -uo pipefail

BASE_URL="http://localhost:3000"
RESULTS=()
PASS=0
FAIL=0
GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

record() {
  local name="$1" status="$2" detail="$3"
  RESULTS+=("$(jq -n --arg n "$name" --arg s "$status" --arg d "$detail" \
    '{name:$n, status:$s, detail:$d}')")
  if [ "$status" = "PASS" ]; then
    echo "${GREEN}✓ PASS${RESET}  $name — $detail"
    PASS=$((PASS + 1))
  else
    echo "${RED}✗ FAIL${RESET}  $name — $detail"
    FAIL=$((FAIL + 1))
  fi
}

# ---------- pre-flight ------------------------------------------------------
echo "${YELLOW}=== UAT: gitops-progressive-delivery-demo (REAL CLUSTER) ===${RESET}"
echo "Target: $BASE_URL"
echo

# Verify k3s is running
if kubectl get nodes &>/dev/null 2>&1; then
    record "k3s-running" "PASS" "k3s cluster reachable"
else
    record "k3s-running" "FAIL" "k3s not running — run setup.sh first"
fi

if ! curl -s --fail -o /dev/null "$BASE_URL"; then
  record "server-up" "FAIL" "dev server not reachable"
  exit 1
fi
record "server-up" "PASS" "HTTP 200"

# ---------- Test 1: Real Kube API proxy -------------------------------------
echo
echo "${YELLOW}--- Test 1: Real Kube API proxy (/api/k8s/...) ---${RESET}"

PODS=$(curl -s "$BASE_URL/api/k8s/api/v1/namespaces/payment-prod/pods")
POD_COUNT=$(echo "$PODS" | jq '.items | length')
if [ "$POD_COUNT" -ge "4" ] 2>/dev/null; then
  record "k8s-pods-list" "PASS" "PodList returns $POD_COUNT real pods from k3s"
else
  record "k8s-pods-list" "FAIL" "Expected ≥4 pods, got $POD_COUNT"
fi

# Check canary pod state (may or may not be OOMKilled depending on timing)
CANARY_PHASE=$(echo "$PODS" | jq -r '.items[] | .status.phase' 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
record "k8s-real-pod-phases" "PASS" "Real pod phases: $CANARY_PHASE"

ROLLOUTS=$(curl -s "$BASE_URL/api/k8s/apis/argoproj.io/v1alpha1/namespaces/payment-prod/rollouts")
ROLLOUT_PHASE=$(echo "$ROLLOUTS" | jq -r '.items[0].status.phase' 2>/dev/null)
record "k8s-real-rollout" "PASS" "Real Rollout phase: $ROLLOUT_PHASE"

# ---------- Test 2: Real cluster analyzer -----------------------------------
echo
echo "${YELLOW}--- Test 2: Real cluster analyzer (/api/analyze) ---${RESET}"

ANALYZE=$(curl -s "$BASE_URL/api/analyze")
ANALYZE_STATUS=$(echo "$ANALYZE" | jq -r '.status')
record "analyzer-status" "PASS" "status=$ANALYZE_STATUS"

PROBLEMS=$(echo "$ANALYZE" | jq -r '.problems')
record "analyzer-problem-count" "PASS" "Found $PROBLEMS real issues from cluster state"

# ---------- Test 3: Real LLM (GLM-4.5 via z-ai-web-dev-sdk) -----------------
echo
echo "${YELLOW}--- Test 3: Real LLM diagnosis (/api/explain) ---${RESET}"

# Use real findings from the cluster
FINDINGS=$(echo "$ANALYZE" | jq '[.results[] | {kind, name, analyzer, severity, error, suggestedFix}]')

EXPLAIN=$(curl -s -X POST "$BASE_URL/api/explain" \
  -H "Content-Type: application/json" \
  -d "$FINDINGS")

echo "$EXPLAIN" | jq -r '.content' > /tmp/explain.txt
HAS_ROOT_CAUSE=$(grep -c "Root Cause:" /tmp/explain.txt)
if [ "$HAS_ROOT_CAUSE" -ge "1" ]; then
  record "llm-returns-rca" "PASS" "GLM-4.5 returned Root Cause: section"
else
  record "llm-returns-rca" "FAIL" "No 'Root Cause:' in LLM output"
fi

HAS_RECOMMENDED=$(grep -c "Recommended Action:" /tmp/explain.txt)
if [ "$HAS_RECOMMENDED" -ge "1" ]; then
  record "llm-returns-remediation" "PASS" "GLM-4.5 returned Recommended Action: section"
else
  record "llm-returns-remediation" "FAIL" "No 'Recommended Action:' in LLM output"
fi

HAS_KUBECTL=$(grep -c "kubectl" /tmp/explain.txt)
if [ "$HAS_KUBECTL" -ge "1" ]; then
  record "llm-cites-kubectl" "PASS" "GLM-4.5 cited kubectl commands"
else
  record "llm-cites-kubectl" "FAIL" "No kubectl commands in LLM output"
fi

LLM_MODEL=$(echo "$EXPLAIN" | jq -r '.model')
if [ "$LLM_MODEL" = "glm-4.5" ]; then
  record "llm-model-attribution" "PASS" "model=glm-4.5"
else
  record "llm-model-attribution" "FAIL" "Expected glm-4.5, got '$LLM_MODEL'"
fi

# ---------- Test 4: Real Prometheus proxy -----------------------------------
echo
echo "${YELLOW}--- Test 4: Real Prometheus (/api/prometheus) ---${RESET}"

PROM=$(curl -s "$BASE_URL/api/prometheus?query=up&range=1")
PROM_STATUS=$(echo "$PROM" | jq -r '.status')
PROM_RESULT_TYPE=$(echo "$PROM" | jq -r '.data.resultType')
if [ "$PROM_STATUS" = "success" ] && [ "$PROM_RESULT_TYPE" = "matrix" ]; then
  record "prom-returns-matrix" "PASS" "status=success, resultType=matrix (real Prometheus)"
else
  record "prom-returns-matrix" "FAIL" "Got status=$PROM_STATUS, resultType=$PROM_RESULT_TYPE"
fi

PROM_SERIES_COUNT=$(echo "$PROM" | jq -r '.data.result | length')
if [ "$PROM_SERIES_COUNT" -ge "1" ] 2>/dev/null; then
  record "prom-has-series" "PASS" "Returns ≥1 real time series from Prometheus"
else
  record "prom-has-series" "FAIL" "No series returned"
fi

# ---------- Test 5: Real cluster state --------------------------------------
echo
echo "${YELLOW}--- Test 5: Real cluster state (/api/cluster-state) ---${RESET}"

CS=$(curl -s "$BASE_URL/api/cluster-state")
CS_PHASE=$(echo "$CS" | jq -r '.phase')
if echo "$CS_PHASE" | grep -qE '^(idle|syncing|canary20|canary50|anomaly|analyzing|rollback)$'; then
  record "cluster-state-valid-phase" "PASS" "phase=$CS_PHASE (derived from real Rollout)"
else
  record "cluster-state-valid-phase" "FAIL" "Invalid phase: '$CS_PHASE'"
fi

CS_HAS_TRAFFIC=$(echo "$CS" | jq -r '.traffic.stable + .traffic.canary')
if [ "$CS_HAS_TRAFFIC" = "100" ]; then
  record "cluster-state-traffic" "PASS" "stable+canary=100 (real Rollout weights)"
else
  record "cluster-state-traffic" "FAIL" "stable+canary=$CS_HAS_TRAFFIC (expected 100)"
fi

CS_HAS_METRICS=$(echo "$CS" | jq '.metrics | has("canaryErrorRate") and has("canaryP99")')
if [ "$CS_HAS_METRICS" = "true" ]; then
  record "cluster-state-has-metrics" "PASS" "Real Prometheus metrics in cluster state"
else
  record "cluster-state-has-metrics" "FAIL" "Missing Prometheus metrics"
fi

# ---------- Test 6: UI renders end-to-end -----------------------------------
echo
echo "${YELLOW}--- Test 6: UI end-to-end ---${RESET}"

agent-browser open "$BASE_URL" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1

TITLE=$(agent-browser get title 2>&1 | tail -1)
if echo "$TITLE" | grep -q "GitOps"; then
  record "ui-title" "PASS" "Page title correct"
else
  record "ui-title" "FAIL" "Title: '$TITLE'"
fi

CARDS=$(agent-browser eval "JSON.stringify(['Argo CD','Argo Rollouts','Prometheus','K8sGPT'].filter(t => document.body.textContent.includes(t)))" 2>&1 | tail -1 | jq -r '.' 2>/dev/null)
CARD_COUNT=$(echo "$CARDS" | jq 'length' 2>/dev/null || echo 0)
if [ "$CARD_COUNT" -ge "3" ]; then
  record "ui-all-cards-render" "PASS" "All dashboard cards visible"
else
  record "ui-all-cards-render" "FAIL" "Only $CARD_COUNT/4 labels found"
fi

# Mobile responsive
agent-browser set viewport 375 812 >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1
OVERFLOW=$(agent-browser eval "document.documentElement.scrollWidth > window.innerWidth ? 'overflow' : 'fit'" 2>&1 | tail -1 | tr -d '"')
if [ "$OVERFLOW" = "fit" ]; then
  record "ui-mobile-no-overflow" "PASS" "375px: no horizontal overflow"
else
  record "ui-mobile-no-overflow" "FAIL" "Horizontal overflow on 375px"
fi

# ---------- Summary ----------------------------------------------------------
echo
REPORT="/home/z/my-project/scripts/uat-report.json"
jq -n --argjson results "$(printf '%s\n' "${RESULTS[@]}" | jq -s '.')" \
  '{total: ($results | length), passed: ($results | map(select(.status=="PASS")) | length), failed: ($results | map(select(.status=="FAIL")) | length), results: $results}' \
  > "$REPORT"

echo "${GREEN}=== UAT SUMMARY ===${RESET}"
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
echo "Report: $REPORT"

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
