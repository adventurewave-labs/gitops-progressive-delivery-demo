#!/usr/bin/env bash
# =============================================================================
# setup.sh — One-shot bootstrap for the real GitOps progressive delivery demo.
# Idempotent: safe to run multiple times.
#
# Uses k3d (k3s-in-Docker) for Codespace compatibility.
# Installs: k3d, kubectl, Helm, Argo CD, Argo Rollouts, Prometheus stack.
# Builds and loads: payments-api:v2.3 (stable) and payments-api:v2.4 (canary/OOMKilled).
# Applies: all K8s manifests to the cluster.
#
# Requires a working Docker daemon. In Codespaces this comes from the
# docker-in-docker devcontainer feature (see .devcontainer/devcontainer.json).
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="payment-prod"
CLUSTER_NAME="gitops-demo"
K3D_KUBECONFIG="${HOME}/.k3d/kubeconfig-${CLUSTER_NAME}.yaml"

# Make sure anything we install in this run is on PATH for the rest of the run.
export PATH="${HOME}/.bun/bin:${HOME}/.local/bin:/usr/local/bin:${PATH}"

echo "========================================"
echo " GitOps Progressive Delivery Demo Setup"
echo "========================================"
echo ""

# -----------------------------------------------------------------------------
# Preflight: Docker must be reachable, otherwise k3d cannot create a cluster.
# -----------------------------------------------------------------------------
if ! command -v docker &>/dev/null || ! docker info &>/dev/null; then
    cat >&2 <<'EOF'
FAIL: Docker daemon is not reachable.

This demo runs a real k3s cluster inside Docker (k3d), so a working Docker
daemon is required. In a Codespace / devcontainer this is provided by the
docker-in-docker feature:

  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  }

Add it to .devcontainer/devcontainer.json and rebuild the container
(Command Palette -> "Codespaces: Rebuild Container"), then re-run this script.
EOF
    exit 1
fi
echo "[pre] Docker OK ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"

# -----------------------------------------------------------------------------
# 0. Bun (needed for dashboard build and dev server)
# -----------------------------------------------------------------------------
if command -v bun &>/dev/null; then
    echo "[0/8] Bun already installed ($(bun --version))"
else
    echo "[0/8] Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="${BUN_INSTALL}/bin:${PATH}"
    echo "  Bun installed: $(bun --version)"
fi

# Install npm dependencies
cd "${REPO_DIR}"
bun install

echo ""

# -----------------------------------------------------------------------------
# 1. Tooling: kubectl, Helm, k3d  (hoisted so they exist even if the cluster does)
# -----------------------------------------------------------------------------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

if ! command -v kubectl &>/dev/null; then
    echo "[1/8] Installing kubectl..."
    ${SUDO} curl -fsSL https://dl.k8s.io/release/v1.32.0/bin/linux/amd64/kubectl -o /usr/local/bin/kubectl
    ${SUDO} chmod +x /usr/local/bin/kubectl
else
    echo "[1/8] kubectl already installed ($(kubectl version --client 2>/dev/null | head -1))"
fi

if ! command -v helm &>/dev/null; then
    echo "  Installing Helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    echo "  Helm installed: $(helm version --short 2>/dev/null)"
else
    echo "  Helm already installed ($(helm version --short 2>/dev/null))"
fi

if ! command -v k3d &>/dev/null; then
    echo "  Installing k3d..."
    curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
    echo "  k3d installed: $(k3d --version | head -1)"
else
    echo "  k3d already installed ($(k3d --version | head -1))"
fi

# kubectl-argo-rollouts plugin (used for `kubectl argo rollouts status`)
if ! command -v kubectl-argo-rollouts &>/dev/null; then
    echo "  Installing kubectl-argo-rollouts plugin..."
    ${SUDO} curl -fsSL \
        https://github.com/argoproj/argo-rollouts/releases/latest/download/kubectl-argo-rollouts-linux-amd64 \
        -o /usr/local/bin/kubectl-argo-rollouts
    ${SUDO} chmod +x /usr/local/bin/kubectl-argo-rollouts
fi

# -----------------------------------------------------------------------------
# 1b. k3d + k3s cluster (runs k3s inside Docker — works in Codespaces)
# -----------------------------------------------------------------------------
if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}[[:space:]]"; then
    echo "  k3d cluster '${CLUSTER_NAME}' already exists"
    k3d cluster start "${CLUSTER_NAME}" >/dev/null 2>&1 || true
else
    # Delete any previous failed cluster
    k3d cluster delete "${CLUSTER_NAME}" >/dev/null 2>&1 || true

    echo "  Creating k3d cluster '${CLUSTER_NAME}'..."
    # k3d port format: hostPort:nodePort@nodeFilter
    # We map to NodePorts used by our Helm values.
    # --no-lb + @agent:0 uses direct mapping (no proxy needed)
    k3d cluster create "${CLUSTER_NAME}" \
        --agents 1 \
        --no-lb \
        -p "30800:30800@agent:0:direct" \
        -p "30900:30900@agent:0:direct" \
        -p "30910:30910@agent:0:direct" \
        --k3s-arg "--disable=traefik@server:0" \
        --k3s-arg "--disable=metrics-server@server:0" \
        --wait \
        --timeout 300s
fi

# k3d does NOT create this file on its own — write it explicitly, then point
# KUBECONFIG at it. (Previously KUBECONFIG referenced a file that never existed.)
mkdir -p "$(dirname "${K3D_KUBECONFIG}")"
k3d kubeconfig get "${CLUSTER_NAME}" > "${K3D_KUBECONFIG}"
chmod 600 "${K3D_KUBECONFIG}"
export KUBECONFIG="${K3D_KUBECONFIG}"

echo "  Waiting for cluster nodes to be Ready..."
if ! kubectl wait --for=condition=Ready nodes --all --timeout=180s >/dev/null 2>&1; then
    echo "FAIL: cluster did not become ready"
    kubectl get nodes || true
    exit 1
fi
echo "  Node: $(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')"

# -----------------------------------------------------------------------------
# 2. (tooling installed above)
# -----------------------------------------------------------------------------
echo "[2/8] Tooling ready: kubectl / helm / k3d / kubectl-argo-rollouts"

# -----------------------------------------------------------------------------
# 3. Argo Rollouts CRDs (must be installed before the controller)
# -----------------------------------------------------------------------------
echo "[3/8] Installing Argo Rollouts CRDs..."
# CRDs are installed by the argo-rollouts Helm chart (installCRDs=true) in step 5
echo "  CRDs applied"

# -----------------------------------------------------------------------------
# 4. Argo CD
# -----------------------------------------------------------------------------
if kubectl get deployment argocd-server -n argocd &>/dev/null; then
    echo "[4/8] Argo CD already installed"
else
    echo "[4/8] Installing Argo CD..."
    kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
    helm repo add argo https://argoproj.github.io/argo-helm >/dev/null 2>&1 || true
    helm repo update >/dev/null

    helm upgrade --install argocd argo/argo-cd \
        -n argocd \
        -f "${REPO_DIR}/helm-values/argocd-values.yaml" \
        --wait --timeout 600s

    echo "  Waiting for Argo CD to be ready..."
    kubectl rollout status deployment/argocd-server -n argocd --timeout=180s || true
fi

# -----------------------------------------------------------------------------
# 5. Argo Rollouts Controller
# -----------------------------------------------------------------------------
if kubectl get deployment argo-rollouts -n argo-rollouts &>/dev/null; then
    echo "[5/8] Argo Rollouts already installed"
else
    echo "[5/8] Installing Argo Rollouts controller..."
    kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
    helm repo add argo https://argoproj.github.io/argo-helm >/dev/null 2>&1 || true
    helm repo update >/dev/null

    helm upgrade --install argo-rollouts argo/argo-rollouts \
        -n argo-rollouts \
        -f "${REPO_DIR}/helm-values/argo-rollouts-values.yaml" \
        --set installCRDs=true \
        --wait --timeout 600s

    echo "  Waiting for Rollouts controller to be ready..."
    kubectl rollout status deployment/argo-rollouts -n argo-rollouts --timeout=180s || true
fi

# -----------------------------------------------------------------------------
# 6. Prometheus Stack
# -----------------------------------------------------------------------------
if kubectl get statefulset -n monitoring -l app.kubernetes.io/name=prometheus 2>/dev/null | grep -q prometheus; then
    echo "[6/8] Prometheus stack already installed"
else
    echo "[6/8] Installing Prometheus stack..."
    kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
    helm repo update >/dev/null

    helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
        -n monitoring \
        -f "${REPO_DIR}/helm-values/prometheus-values.yaml" \
        --timeout 900s

    echo "  Waiting for Prometheus to be ready..."
    # The kube-prometheus-stack StatefulSet is named after the Prometheus CR,
    # i.e. prometheus-<release>-kube-prometheus-prometheus — resolve it instead
    # of hardcoding it.
    PROM_STS="$(kubectl get statefulset -n monitoring \
        -l app.kubernetes.io/name=prometheus \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    if [ -n "${PROM_STS}" ]; then
        kubectl rollout status "statefulset/${PROM_STS}" -n monitoring --timeout=300s || true
    fi
fi

# -----------------------------------------------------------------------------
# 7. Build & Load Payment App Images into k3d cluster
# -----------------------------------------------------------------------------
echo "[7/8] Building and loading payments-api images..."
cd "${REPO_DIR}/payments-app"

# Build stable image
echo "  Building payments-api:v2.3 (stable)..."
docker build -t payments-api:v2.3 stable/
k3d image import -c "${CLUSTER_NAME}" payments-api:v2.3
echo "  payments-api:v2.3 loaded into cluster"

# Build canary image (with memory leak)
echo "  Building payments-api:v2.4 (canary/OOMKilled)..."
docker build -t payments-api:v2.4 canary/
k3d image import -c "${CLUSTER_NAME}" payments-api:v2.4
echo "  payments-api:v2.4 loaded into cluster"

cd "${REPO_DIR}"

# -----------------------------------------------------------------------------
# 8. Apply K8s Manifests
# -----------------------------------------------------------------------------
echo "[8/8] Applying K8s manifests..."
kubectl apply -f "${REPO_DIR}/manifests-repo/namespace.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/services.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/analysis-template.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/servicemonitor.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/rollout.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/loadgen.yaml"

# Apply Argo CD Application (it watches the local manifests-repo)
kubectl apply -f "${REPO_DIR}/manifests-repo/argocd-app.yaml"

echo "  Waiting for Rollout to become Healthy..."
kubectl argo rollouts status payments-api -n "$NS" --watch --timeout 180s || true

echo ""
echo "========================================"
echo " CLUSTER READY"
echo "========================================"
echo ""
echo "Components running:"
echo "  k3d/k3s node ready: $(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}')"
echo "  Argo CD:         http://localhost:30800"
echo "  Rollouts:        http://localhost:30910"
echo "  Prometheus:      http://localhost:30900"
echo ""
echo "KUBECONFIG=${KUBECONFIG}"
echo ""
echo "Next steps:"
echo "  1. Start the demo controller:  bash dev-real.sh"
echo "     (or in a separate terminal: KUBECONFIG=${KUBECONFIG} bash demo-controller/cycle.sh)"
echo "  2. Open http://localhost:3000"
echo ""
