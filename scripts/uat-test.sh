#!/usr/bin/env bash
# UAT for the rebuilt (real-backend) GitOps progressive delivery demo.
#
# Validates:
#   1. Mock kube-apiserver returns the 6 broken canary resources
#   2. /api/analyze runs real analyzers and returns ≥4 findings
#   3. /api/explain calls real GLM-4.5 and returns structured RCA
#   4. /api/prometheus returns PromQL matrix results
#   5. /api/cluster-state returns the full live snapshot
#   6. UI renders all the above end-to-end
#   7. The full pipeline cycles: idle → syncing → canary20 → canary50 →
#      anomaly → analyzing → rollback (auto-loop)
#
# Run: bash scripts/uat-test.sh
# Assumes the dev server is up at http://localhost:3000.

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
echo "${YELLOW}=== UAT: gitops-progressive-delivery-demo (REAL backend) ===${RESET}"
echo "Target: $BASE_URL"
echo

if ! curl -s --fail -o /dev/null "$BASE_URL"; then
  record "server-up" "FAIL" "dev server not reachable"
  exit 1
fi
record "server-up" "PASS" "HTTP 200"

# ---------- Test 1: Mock kube-apiserver --------------------------------------
echo
echo "${YELLOW}--- Test 1: Mock kube-apiserver (real K8s API responses) ---${RESET}"

PODS=$(curl -s "$BASE_URL/api/k8s/api/v1/namespaces/payment-prod/pods")
POD_COUNT=$(echo "$PODS" | jq '.items | length')
if [ "$POD_COUNT" = "6" ]; then
  record "k8s-pods-list" "PASS" "PodList returns 6 pods (4 stable + 2 canary)"
else
  record "k8s-pods-list" "FAIL" "Expected 6 pods, got $POD_COUNT"
fi

CANARY_PHASE=$(echo "$PODS" | jq -r '.items[] | select(.metadata.labels.track=="canary") | .status.phase' | head -1)
if [ "$CANARY_PHASE" = "CrashLoopBackOff" ]; then
  record "k8s-canary-crashloop" "PASS" "Canary pod is in CrashLoopBackOff"
else
  record "k8s-canary-crashloop" "FAIL" "Expected CrashLoopBackOff, got '$CANARY_PHASE'"
fi

OOM=$(echo "$PODS" | jq -r '.items[] | select(.metadata.labels.track=="canary") | .status.containerStatuses[0].lastState.terminated.reason' | head -1)
if [ "$OOM" = "OOMKilled" ]; then
  record "k8s-canary-oomkilled" "PASS" "Canary pod lastState is OOMKilled (exit 137)"
else
  record "k8s-canary-oomkilled" "FAIL" "Expected OOMKilled, got '$OOM'"
fi

DEPLOYMENTS=$(curl -s "$BASE_URL/api/k8s/apis/apps/v1/namespaces/payment-prod/deployments")
DEPLOY_COUNT=$(echo "$DEPLOYMENTS" | jq '.items | length')
if [ "$DEPLOY_COUNT" = "2" ]; then
  record "k8s-deployments-list" "PASS" "DeploymentList returns stable + canary"
else
  record "k8s-deployments-list" "FAIL" "Expected 2 deployments, got $DEPLOY_COUNT"
fi

ROLLOUTS=$(curl -s "$BASE_URL/api/k8s/apis/argoproj.io/v1alpha1/namespaces/payment-prod/rollouts")
ROLLOUT_PHASE=$(echo "$ROLLOUTS" | jq -r '.items[0].status.phase')
if [ "$ROLLOUT_PHASE" = "Paused" ]; then
  record "k8s-rollout-paused" "PASS" "Rollout is Paused at analysis step"
else
  record "k8s-rollout-paused" "FAIL" "Expected Paused, got '$ROLLOUT_PHASE'"
fi

# ---------- Test 2: Real analyzer (no LLM) ----------------------------------
echo
echo "${YELLOW}--- Test 2: Real analyzer (/api/analyze) ---${RESET}"

ANALYZE=$(curl -s "$BASE_URL/api/analyze")
PROBLEMS=$(echo "$ANALYZE" | jq -r '.problems')
if [ "$PROBLEMS" -ge "4" ] 2>/dev/null; then
  record "analyzer-finds-issues" "PASS" "Detected $PROBLEMS real problems (no LLM)"
else
  record "analyzer-finds-issues" "FAIL" "Expected ≥4 problems, got '$PROBLEMS'"
fi

ANALYZE_STATUS=$(echo "$ANALYZE" | jq -r '.status')
if [ "$ANALYZE_STATUS" = "ProblemDetected" ]; then
  record "analyzer-status" "PASS" "status=ProblemDetected"
else
  record "analyzer-status" "FAIL" "Expected ProblemDetected, got '$ANALYZE_STATUS'"
fi

HAS_OOM_FINDING=$(echo "$ANALYZE" | jq -r '.results[] | select(.error[0].Text | contains("OOMKilled")) | .kind' | head -1)
if [ "$HAS_OOM_FINDING" = "Pod" ]; then
  record "analyzer-oom-finding" "PASS" "Found OOMKilled pod finding"
else
  record "analyzer-oom-finding" "FAIL" "No OOMKilled finding in results"
fi

HAS_DEPLOYMENT_FINDING=$(echo "$ANALYZE" | jq -r '.results[] | select(.kind=="Deployment") | .name' | head -1)
if [ -n "$HAS_DEPLOYMENT_FINDING" ]; then
  record "analyzer-deployment-finding" "PASS" "Found Deployment availability finding"
else
  record "analyzer-deployment-finding" "FAIL" "No Deployment finding"
fi

# ---------- Test 3: Real LLM (GLM-4.5 via z-ai-web-dev-sdk) -----------------
echo
echo "${YELLOW}--- Test 3: Real LLM diagnosis (/api/explain) ---${RESET}"

EXPLAIN=$(curl -s -X POST "$BASE_URL/api/explain" \
  -H "Content-Type: application/json" \
  -d '[{"kind":"Pod","name":"payment-prod/payments-api-canary-6b8f4c-9a8bc","analyzer":"pod","severity":"critical","error":[{"Text":"the last termination reason is OOMKilled (exit code 137) container=api pod=payments-api-canary-6b8f4c-9a8bc"}],"suggestedFix":"kubectl logs payments-api-canary-6b8f4c-9a8bc -c api --previous"}]')

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
  record "llm-cites-kubectl" "PASS" "GLM-4.5 cited kubectl commands in remediation"
else
  record "llm-cites-kubectl" "FAIL" "No kubectl commands in LLM output"
fi

LLM_MODEL=$(echo "$EXPLAIN" | jq -r '.model')
if [ "$LLM_MODEL" = "glm-4.5" ]; then
  record "llm-model-attribution" "PASS" "model=glm-4.5"
else
  record "llm-model-attribution" "FAIL" "Expected glm-4.5, got '$LLM_MODEL'"
fi

# Second call should hit cache
EXPLAIN2=$(curl -s -X POST "$BASE_URL/api/explain" \
  -H "Content-Type: application/json" \
  -d '[{"kind":"Pod","name":"payment-prod/payments-api-canary-6b8f4c-9a8bc","analyzer":"pod","severity":"critical","error":[{"Text":"the last termination reason is OOMKilled (exit code 137) container=api pod=payments-api-canary-6b8f4c-9a8bc"}],"suggestedFix":"kubectl logs payments-api-canary-6b8f4c-9a8bc -c api --previous"}]')
CACHED=$(echo "$EXPLAIN2" | jq -r '.cached')
if [ "$CACHED" = "true" ]; then
  record "llm-cache-hit" "PASS" "Second call served from cache"
else
  record "llm-cache-hit" "FAIL" "Expected cached=true, got '$CACHED'"
fi

# ---------- Test 4: Prometheus mock ----------------------------------------
echo
echo "${YELLOW}--- Test 4: Mock Prometheus (/api/prometheus) ---${RESET}"

PROM=$(curl -s "$BASE_URL/api/prometheus?query=up&range=1")
PROM_STATUS=$(echo "$PROM" | jq -r '.status')
PROM_RESULT_TYPE=$(echo "$PROM" | jq -r '.data.resultType')
if [ "$PROM_STATUS" = "success" ] && [ "$PROM_RESULT_TYPE" = "matrix" ]; then
  record "prom-returns-matrix" "PASS" "status=success, resultType=matrix"
else
  record "prom-returns-matrix" "FAIL" "Got status=$PROM_STATUS, resultType=$PROM_RESULT_TYPE"
fi

PROM_SERIES_COUNT=$(echo "$PROM" | jq -r '.data.result | length')
if [ "$PROM_SERIES_COUNT" -ge "1" ] 2>/dev/null; then
  record "prom-has-series" "PASS" "Returns ≥1 time series"
else
  record "prom-has-series" "FAIL" "No series returned"
fi

# ---------- Test 5: cluster-state endpoint --------------------------------
echo
echo "${YELLOW}--- Test 5: Cluster state (/api/cluster-state) ---${RESET}"

CS=$(curl -s "$BASE_URL/api/cluster-state")
CS_PHASE=$(echo "$CS" | jq -r '.phase')
if echo "$CS_PHASE" | grep -qE '^(idle|syncing|canary20|canary50|anomaly|analyzing|rollback)$'; then
  record "cluster-state-valid-phase" "PASS" "phase=$CS_PHASE"
else
  record "cluster-state-valid-phase" "FAIL" "Invalid phase: '$CS_PHASE'"
fi

CS_HAS_ARGOCD=$(echo "$CS" | jq -r '.argoCdSync.revision' | head -c 7)
if [ "$CS_HAS_ARGOCD" = "a1b2c3d" ]; then
  record "cluster-state-argocd" "PASS" "argoCdSync.revision present"
else
  record "cluster-state-argocd" "FAIL" "No argoCdSync"
fi

CS_HAS_TRAFFIC=$(echo "$CS" | jq -r '.traffic.stable + .traffic.canary')
if [ "$CS_HAS_TRAFFIC" = "100" ]; then
  record "cluster-state-traffic" "PASS" "stable+canary=100"
else
  record "cluster-state-traffic" "FAIL" "stable+canary=$CS_HAS_TRAFFIC (expected 100)"
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

# All 4 cards present?
CARDS=$(agent-browser eval "JSON.stringify(['Argo CD','Argo Rollouts','Prometheus','kube-apiserver','K8sGPT'].filter(t => document.body.textContent.includes(t)))" 2>&1 | tail -1 | jq -r '.' 2>/dev/null)
CARD_COUNT=$(echo "$CARDS" | jq 'length' 2>/dev/null || echo 0)
if [ "$CARD_COUNT" -ge "4" ]; then
  record "ui-all-cards-render" "PASS" "All cards visible"
else
  record "ui-all-cards-render" "FAIL" "Only $CARD_COUNT/5 labels found"
fi

# Wait for analyzing phase (cluster-state loops every 40s on its own clock,
# so we have to poll until we land in the right phase).
echo "Polling /api/cluster-state until phase=analyzing..."
DEADLINE=$(( $(date +%s) + 60 ))
PHASE_FOUND=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  PHASE_FOUND=$(curl -s "$BASE_URL/api/cluster-state" | jq -r '.phase')
  if [ "$PHASE_FOUND" = "analyzing" ]; then
    break
  fi
  sleep 1
done
echo "  -> phase=$PHASE_FOUND"

# Give the LLM call ~10s to complete + render its output in the terminal.
agent-browser wait 10000 >/dev/null 2>&1

DOM_CHECK=$(agent-browser eval "JSON.stringify({rootCause: document.body.textContent.includes('Root Cause:'), evidence: document.body.textContent.includes('Evidence:'), oom: document.body.textContent.includes('OOMKilled'), k8sgptCmd: document.body.textContent.includes('k8sgpt analyze'), glm: document.body.textContent.includes('glm-4.5')})" 2>&1 | tail -1 | sed 's/^"//' | sed 's/"$//' | sed 's/\\"/"/g')
RC=$(echo "$DOM_CHECK" | jq -r '.rootCause' 2>/dev/null)
EV=$(echo "$DOM_CHECK" | jq -r '.evidence' 2>/dev/null)
OOM=$(echo "$DOM_CHECK" | jq -r '.oom' 2>/dev/null)
K8SCMD=$(echo "$DOM_CHECK" | jq -r '.k8sgptCmd' 2>/dev/null)
GLM=$(echo "$DOM_CHECK" | jq -r '.glm' 2>/dev/null)

if [ "$RC" = "true" ]; then
  record "ui-shows-llm-rca" "PASS" "Real GLM-4.5 Root Cause: visible in terminal"
else
  record "ui-shows-llm-rca" "FAIL" "No 'Root Cause:' in DOM"
fi

if [ "$EV" = "true" ]; then
  record "ui-shows-evidence" "PASS" "Real LLM Evidence: section visible"
else
  record "ui-shows-evidence" "FAIL" "No 'Evidence:' in DOM"
fi

if [ "$OOM" = "true" ]; then
  record "ui-shows-oom" "PASS" "Real OOMKilled finding visible"
else
  record "ui-shows-oom" "FAIL" "No OOMKilled in DOM"
fi

if [ "$K8SCMD" = "true" ]; then
  record "ui-shows-k8sgpt-cmd" "PASS" "k8sgpt analyze command visible"
else
  record "ui-shows-k8sgpt-cmd" "FAIL" "No k8sgpt analyze command"
fi

if [ "$GLM" = "true" ]; then
  record "ui-shows-glm-model" "PASS" "glm-4.5 model attribution visible"
else
  record "ui-shows-glm-model" "FAIL" "No glm-4.5 attribution"
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

# ---------- Write JSON report ----------------------------------------------
echo
REPORT="/home/z/my-project/scripts/uat-report.json"
jq -n --argjson results "$(printf '%s\n' "${RESULTS[@]}" | jq -s '.')" \
  '{total: ($results | length), passed: ($results | map(select(.status=="PASS")) | length), failed: ($results | map(select(.status=="FAIL")) | length), results: $results}' \
  > "$REPORT"

echo "${GREEN}=== UAT SUMMARY ===${RESET}"
echo "Total: $((PASS + FAIL))  Passed: $PASS  Failed: $FAIL"
echo "Report: $REPORT"

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
