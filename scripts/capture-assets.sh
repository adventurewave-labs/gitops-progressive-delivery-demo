#!/usr/bin/env bash
# Captures REAL responses from the running stack into showcase-assets/.
# The blocks in public/showcase/index.html are meant to be pasted from here,
# so they never drift back into invented output.
#
# Requires: bash setup.sh + bash dev-real.sh (and ideally cycle.sh) running.
set -uo pipefail

if [ -n "${KUBECONFIG:-}" ] && [ ! -f "${KUBECONFIG}" ]; then unset KUBECONFIG; fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
OUT_DIR="${OUT_DIR:-${REPO_DIR}/showcase-assets}"
mkdir -p "$OUT_DIR"

if ! curl -fsS -o /dev/null --max-time 5 "$BASE_URL/"; then
    echo "FAIL: dashboard not reachable at $BASE_URL (run: bash dev-real.sh)" >&2
    exit 1
fi

get() { # get <name> <path>
    printf '  -> %-22s ' "$2"
    if curl -fsS --max-time 15 "$BASE_URL$2" | python3 -m json.tool > "$OUT_DIR/$1.json" 2>/dev/null; then
        echo "$(wc -c < "$OUT_DIR/$1.json") bytes"
    else
        echo "FAILED"; rm -f "$OUT_DIR/$1.json"
    fi
}

echo "=== Capturing real backend responses ==="
get k8s-pods     "/api/k8s/api/v1/namespaces/payment-prod/pods"
get analyze      "/api/analyze"
get cluster-state "/api/cluster-state"
get prometheus   "/api/prometheus?query=up"

printf '  -> %-22s ' "/api/explain"
if [ -z "${ZAI_API_KEY:-}" ]; then
    echo "SKIPPED (no ZAI_API_KEY - the LLM section stays illustrative)"
else
    curl -fsS --max-time 60 -X POST "$BASE_URL/api/explain" \
        -H 'content-type: application/json' \
        --data "$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))' "$OUT_DIR/analyze.json" 2>/dev/null || echo '[]')" \
        | python3 -m json.tool > "$OUT_DIR/explain.json" 2>/dev/null \
        && echo "$(wc -c < "$OUT_DIR/explain.json") bytes" || echo "FAILED"
fi

echo
echo "=== Analyzer summary (paste-ready facts) ==="
python3 - "$OUT_DIR/analyze.json" <<'PY' 2>/dev/null || echo "  (no analyze.json)"
import json,sys
d=json.load(open(sys.argv[1]))
res=d.get("results") or []
print("  status   :", d.get("status"))
print("  problems :", d.get("problems", len(res)))
print("  kinds    :", ", ".join(sorted({r.get("kind","?") for r in res})) or "none")
for r in res[:6]:
    errs=r.get("error") or []
    txt=errs[0].get("Text") if errs and isinstance(errs[0],dict) else ""
    print(f"    - {r.get('kind')}/{r.get('name')}: {txt[:88]}")
PY

echo
echo "Wrote: ${OUT_DIR#"$REPO_DIR"/}"
ls -la "$OUT_DIR"
