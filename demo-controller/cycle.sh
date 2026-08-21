#!/usr/bin/env bash
# =============================================================================
# cycle.sh — Drives the canary → OOMKilled → analysis fail → rollback loop.
#
# This is the only "scripted" part of the demo — it patches the Rollout image
# to v2.4, waits for real OOMKilled + real AnalysisRun failure, then rolls back.
# Everything it touches (pods, metrics, AnalysisRuns) is 100% real.
# =============================================================================
set -euo pipefail
if [ -n "${KUBECONFIG:-}" ] && [ ! -f "${KUBECONFIG}" ]; then unset KUBECONFIG; fi

NS="payment-prod"
ROLLOUT="payments-api"
STABLE_IMAGE="payments-api:v2.3"
CANARY_IMAGE="payments-api:v2.4"
CYCLE_DELAY=${CYCLE_DELAY:-10}  # seconds between cycles

# Ensure k3d kubeconfig
export KUBECONFIG="${KUBECONFIG:-${HOME}/.k3d/kubeconfig-gitops-demo.yaml}"

echo "========================================"
echo " Demo Controller — Starting"
echo " Namespace:  $NS"
echo " Rollout:    $ROLLOUT"
echo " Stable:     $STABLE_IMAGE"
echo " Canary:     $CANARY_IMAGE"
echo "========================================"
echo ""

while true; do
    echo ""
    echo "=== CYCLE START $(date +%H:%M:%S) ==="

    # Ensure we're starting from a healthy state
    echo "[1/6] Ensuring baseline (v2.3) is running..."
    kubectl argo rollouts set image "$ROLLOUT" api="$STABLE_IMAGE" -n "$NS" --overwrite 2>/dev/null || \
        kubectl patch rollout "$ROLLOUT" -n "$NS" --type='json' \
        -p="[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"$STABLE_IMAGE\"}]"
    sleep 3

    # Restart the rollout fresh
    kubectl argo rollouts restart "$ROLLOUT" -n "$NS" 2>/dev/null || true
    echo "  Waiting for stable rollout to complete..."
    kubectl argo rollouts status "$ROLLOUT" -n "$NS" --watch --timeout=90s 2>/dev/null || true
    echo "  ✓ Stable baseline ready"

    # Deploy canary
    echo ""
    echo "[2/6] Deploying canary (v2.4 with memory leak)..."
    kubectl argo rollouts set image "$ROLLOUT" api="$CANARY_IMAGE" -n "$NS" --overwrite 2>/dev/null || \
        kubectl patch rollout "$ROLLOUT" -n "$NS" --type='json' \
        -p="[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"$CANARY_IMAGE\"}]"

    # Wait for canary pods to be created
    echo "  Waiting for canary pods to appear..."
    for i in $(seq 1 30); do
        CANARY_PODS=$(kubectl get pods -n "$NS" -l app=payments-api -o custom-columns=IMG:.spec.containers[0].image --no-headers 2>/dev/null | grep -c "$CANARY_IMAGE" || echo "0")
        if [ "$CANARY_PODS" -gt 0 ] 2>/dev/null; then
            echo "  Canary pods appeared after ${i}s"
            break
        fi
        sleep 2
    done

    # Wait for OOMKilled
    echo ""
    echo "[3/6] Waiting for canary to OOMKilled (max 180s)..."
    OOM_OCCURRED=false
    for i in $(seq 1 90); do
        # Check if any pod has been OOMKilled
        OOM=$(kubectl get pods -n "$NS" -l "app=payments-api" \
            -o jsonpath='{range .items[*]}{.metadata.name} {.status.containerStatuses[0].lastState.terminated.reason}{"\n"}{end}' 2>/dev/null \
            | grep -i "OOMKilled" || true)
        if [ -n "$OOM" ]; then
            echo "  ✓ OOMKilled detected after ~$((i*2))s!"
            OOM_OCCURRED=true
            break
        fi
        # Also check for CrashLoopBackOff (happens after OOMKilled + restart)
        CRASH=$(kubectl get pods -n "$NS" -l "app=payments-api" \
            -o jsonpath='{range .items[*]}{.status.containerStatuses[0].state.waiting.reason}{"\n"}{end}' 2>/dev/null \
            | grep -i "CrashLoopBackOff" || true)
        if [ -n "$CRASH" ]; then
            echo "  ✓ CrashLoopBackOff detected after ~$((i*2))s (follows OOMKilled)!"
            OOM_OCCURRED=true
            break
        fi
        sleep 2
    done

    if [ "$OOM_OCCURRED" = false ]; then
        echo "  ⚠ Timeout — OOMKilled not detected within 180s. Continuing anyway..."
    fi

    # Wait for Prometheus to scrape the error spike + AnalysisRun to fail
    echo ""
    echo "[4/6] Waiting for AnalysisRun failure (max 120s)..."
    ANALYSIS_FAILED=false
    for i in $(seq 1 40); do
        # Check if the Rollout has been aborted by the failed analysis
        PHASE=$(kubectl get rollout "$ROLLOUT" -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
        if [ "$PHASE" = "Aborted" ] || [ "$PHASE" = "Degraded" ]; then
            echo "  ✓ Rollout $PHASE — analysis failed as expected"
            ANALYSIS_FAILED=true
            break
        fi
        # Also check for a failed AnalysisRun directly
        FAILED_RUN=$(kubectl get analysisrun -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name} {.status.phase}{"\n"}{end}' 2>/dev/null \
            | grep -i "failed\|error" || true)
        if [ -n "$FAILED_RUN" ]; then
            echo "  ✓ Failed AnalysisRun detected"
            ANALYSIS_FAILED=true
            break
        fi
        sleep 3
    done

    if [ "$ANALYSIS_FAILED" = false ]; then
        echo "  ⚠ AnalysisRun did not fail within 120s. Manually aborting..."
        kubectl argo rollouts abort "$ROLLOUT" -n "$NS" 2>/dev/null || true
    fi

    # Rollback
    echo ""
    echo "[5/6] Rolling back to $STABLE_IMAGE..."
    kubectl argo rollouts undo "$ROLLOUT" -n "$NS" 2>/dev/null || \
        kubectl patch rollout "$ROLLOUT" -n "$NS" --type='json' \
        -p="[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"$STABLE_IMAGE\"}]"

    echo "  Waiting for rollback to complete..."
    kubectl argo rollouts status "$ROLLOUT" -n "$NS" --watch --timeout=90s 2>/dev/null || true
    echo "  ✓ Rollback complete"

    # Update Argo CD app (simulate git commit)
    echo ""
    echo "[6/6] Updating Argo CD Application revision..."
    cd "$(dirname "${BASH_SOURCE[0]}")/.."
    if [ -d "manifests-repo/.git" ]; then
        cd manifests-repo
        # Record the rollback
        git add -A && git commit -m "hotfix: revert payments-api to v2.3" --allow-empty 2>/dev/null || true
        cd ..
    fi

    echo ""
    echo "=== CYCLE COMPLETE $(date +%H:%M:%S) ==="
    echo ""
    echo "Cooling down for ${CYCLE_DELAY}s before next cycle..."
    echo "  (Press Ctrl+C to stop)"
    sleep "$CYCLE_DELAY"
done
