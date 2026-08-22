#!/usr/bin/env bash
# Real end-to-end verification of the running stack.
# Requires: k3d cluster up (bash setup.sh) and the dev server up (bash dev-real.sh).
# Every check below queries a live component. Nothing is pre-baked.
set -uo pipefail

if [ -n "${KUBECONFIG:-}" ] && [ ! -f "${KUBECONFIG}" ]; then unset KUBECONFIG; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
NS="${NS:-payment-prod}"
OUT_JSON="${REPO_DIR}/public/showcase/uat-results.json"

PASS=0; FAIL=0; ROWS=""

chk() { # chk <id> <layer> <description> <command...>
  local id="$1" layer="$2" desc="$3"; shift 3
  local detail status
  if detail="$("$@" 2>&1)"; then status=pass; PASS=$((PASS+1)); else status=fail; FAIL=$((FAIL+1)); fi
  detail="$(printf '%s' "$detail" | tr -d '\r' | tail -1 | cut -c1-90)"
  printf '%-5s %-12s %-46s %s  %s\n' "$id" "$layer" "$desc" "$([ "$status" = pass ] && echo ' PASS' || echo ' FAIL')" "$detail"
  ROWS="${ROWS}{\"id\":\"${id}\",\"layer\":\"${layer}\",\"test\":\"${desc}\",\"status\":\"${status}\",\"detail\":\"$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g')\"},"
}

j() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

k_nodes()      { kubectl get nodes --no-headers | grep -c ' Ready '; }
k_rollout()    { kubectl get rollout payments-api -n "$NS" -o jsonpath='{.status.phase}' | grep -E 'Healthy|Progressing|Paused|Degraded'; }
k_stable()     { kubectl get rollout payments-api -n "$NS" -o jsonpath='{.status.stableRS}' | grep -E '.+'; }
k_svcs()       { kubectl get svc -n "$NS" payments-api-stable payments-api-canary -o name | wc -l | grep -x 2; }
k_argocd()     { kubectl get application payments-api -n argocd -o jsonpath='{.status.sync.status}' | grep -E 'Synced|OutOfSync'; }
k_analysis()   { kubectl get analysistemplate prometheus-slo -n "$NS" -o name; }
k_smon()       { kubectl get servicemonitor -n "$NS" -o name | grep -c payments; }
k_image()      { kubectl get rollout payments-api -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' | grep -E 'payments-api:v'; }

# Prometheus is queried through the app's own /api/prometheus proxy: the
# kube-prometheus-stack image is distroless, so `kubectl exec` has no shell.
p_up()      { api '/api/prometheus?query=up%7Bnamespace%3D%22payment-prod%22%7D' | j "len(d['data']['result'])" | grep -vx 0; }
p_reqs()    { api '/api/prometheus?query=http_requests_total' | j "len(d['data']['result'])" | grep -vx 0; }
p_buckets() { api '/api/prometheus?query=http_request_duration_seconds_bucket' | j "len(d['data']['result'])" | grep -vx 0; }

api()        { curl -fsS --max-time 10 "${BASE_URL}$1"; }
a_state()    { api /api/cluster-state | j "d['argoRollouts']['stableImage']" | grep -E 'payments-api:v'; }
a_pods()     { api /api/cluster-state | j "d['pods']['stable']['ready']" | grep -E '^[0-9]+$'; }
a_metrics()  { api /api/cluster-state | j "d['metrics']['stableP99']" | grep -E '^[0-9]'; }
a_analyze()  { api /api/analyze | j "d['status']"; }
a_promapi()  { api '/api/prometheus?query=up' | j "d['status']" | grep -x success; }
a_k8sproxy() { api "/api/k8s/api/v1/namespaces/${NS}/pods" | j "d['kind']" | grep -x PodList; }

echo "=== UAT: live stack verification ($(date -u +%FT%TZ)) ==="
echo
chk T01 cluster    "k3d nodes Ready"                        k_nodes
chk T02 argocd     "Application payments-api reports sync"  k_argocd
chk T03 rollouts   "Rollout payments-api has a phase"       k_rollout
chk T04 rollouts   "Rollout has a stable ReplicaSet hash"   k_stable
chk T05 rollouts   "stable + canary Services exist"         k_svcs
chk T06 rollouts   "AnalysisTemplate prometheus-slo exists" k_analysis
chk T07 rollouts   "rollout image is a payments-api tag"    k_image
chk T08 prometheus "ServiceMonitor for payments is applied" k_smon
chk T09 prometheus "payments scrape targets are up"         p_up
chk T10 prometheus "http_requests_total series exist"       p_reqs
chk T11 prometheus "duration histogram buckets exist"       p_buckets
chk T12 app        "/api/cluster-state returns a real image" a_state
chk T13 app        "/api/cluster-state returns pod counts"   a_pods
chk T14 app        "/api/cluster-state returns real p99"     a_metrics
chk T15 app        "/api/analyze responds"                   a_analyze
chk T16 app        "/api/prometheus proxies real PromQL"     a_promapi
chk T17 app        "/api/k8s proxies the kube-apiserver"     a_k8sproxy

TOTAL=$((PASS+FAIL))
echo
echo "=== ${PASS}/${TOTAL} passed, ${FAIL} failed ==="

mkdir -p "$(dirname "$OUT_JSON")"
printf '{"generated":"%s","passed":%d,"failed":%d,"total":%d,"results":[%s]}\n' \
  "$(date -u +%FT%TZ)" "$PASS" "$FAIL" "$TOTAL" "${ROWS%,}" > "$OUT_JSON"
echo "wrote ${OUT_JSON#"$REPO_DIR"/}"

[ "$FAIL" -eq 0 ]
