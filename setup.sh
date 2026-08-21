#!/usr/bin/env bash
# =============================================================================
# setup.sh — One-shot bootstrap for the real GitOps progressive delivery demo.
# Idempotent: safe to run multiple times.
#
# Uses k3d (k3s-in-Docker) for Codespace compatibility.
# Installs: k3d, kubectl, Helm, Argo CD, Argo Rollouts, Prometheus stack.
# Builds and loads: payments-api:v2.3 (stable) and payments-api:v2.4 (canary/OOMKilled).
# Applies: all K8s manifests to the cluster.
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="payment-prod"
CLUSTER_NAME="gitops-demo"

echo "========================================"
echo " GitOps Progressive Delivery Demo Setup"
echo "========================================"
echo ""

# -----------------------------------------------------------------------------
# 0. Bun (needed for dashboard build and dev server)
# -----------------------------------------------------------------------------
if command -v bun &>/dev/null; then
    echo "[✓] Bun already installed ($(bun --version))"
else
    echo "[0/8] Installing Bun..."
    curl -fsSL https://bun.com/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    echo "  Bun installed: $(bun --version)"
fi

# Install npm dependencies
cd "${REPO_DIR}"
bun install

echo ""

# -----------------------------------------------------------------------------
# 1. k3d + k3s cluster (runs k3s inside Docker — works in Codespaces)
# -----------------------------------------------------------------------------
if k3d cluster list 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
    echo "[✓] k3d cluster '${CLUSTER_NAME}' already running"
else
    # Install k3d
    if ! command -v k3d &>/dev/null; then
        echo "[1/8] Installing k3d..."
        curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
        echo "  k3d installed: $(k3d --version)"
    else
        echo "[1/8] k3d already installed ($(k3d --version))"
    fi

    # Install kubectl if missing
    if ! command -v kubectl &>/dev/null; then
        echo "  Installing kubectl..."
        sudo curl -fsSL https://dl.k8s.io/release/v1.32.0/bin/linux/amd64/kubectl -o /usr/local/bin/kubectl
        sudo chmod +x /usr/local/bin/kubectl
    fi

    echo "  Creating k3d cluster '${CLUSTER_NAME}'..."
    k3d cluster create "${CLUSTER_NAME}" \
        --agents 1 \
        --no-lb \
        -p "30800:30800@agent:0" \
        -p "30900:30900@agent:0" \
        -p "30910:30910@agent:0" \
        --k3s-arg "--disable=traefik@server:0" \
        --k3s-arg "--disable=metrics-server@server:0" \
        --wait \
        --timeout 120s

    # k3d automatically merges kubeconfig — point KUBECONFIG at it
    export KUBECONFIG="${HOME}/.k3d/kubeconfig-${CLUSTER_NAME}.yaml"
fi

# Ensure KUBECONFIG is set for all subsequent kubectl/helm commands
if [ -z "${KUBECONFIG:-}" ]; then
    export KUBECONFIG="${HOME}/.k3d/kubeconfig-${CLUSTER_NAME}.yaml"
fi

echo "  Waiting for cluster nodes to be Ready..."
for i in $(seq 1 60); do
    if kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null | grep -q "True"; then
        echo "  Cluster ready after $((i * 2))s"
        break
    fi
    sleep 2
done

if ! kubectl get nodes &>/dev/null 2>&1; then
    echo "FAIL: cluster did not become ready"
    exit 1
fi

echo "  Node: $(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')"

# -----------------------------------------------------------------------------
# 2. Helm
# -----------------------------------------------------------------------------
if command -v helm &>/dev/null; then
    echo "[✓] Helm already installed ($(helm version --short 2>/dev/null))"
else
    echo "[2/8] Installing Helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    echo "  Helm installed: $(helm version --short 2>/dev/null)"
fi

# -----------------------------------------------------------------------------
# 3. Argo Rollouts CRDs (must be installed before the controller)
# -----------------------------------------------------------------------------
echo "[3/8] Installing Argo Rollouts CRDs..."
kubectl apply -f https://raw.githubusercontent.com/argoproj/argo-rollouts/stable/manifests/crds.yaml 2>/dev/null || \
    kubectl apply -f https://github.com/argoproj/argo-rollouts/releases/latest/download/crds.yaml
echo "  CRDs applied"

# -----------------------------------------------------------------------------
# 4. Argo CD
# -----------------------------------------------------------------------------
if kubectl get namespace argocd &>/dev/null 2>&1 && \
   kubectl get deployment argocd-server -n argocd &>/dev/null 2>&1; then
    echo "[✓] Argo CD already installed"
else
    echo "[4/8] Installing Argo CD..."
    kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
    helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null || true
    helm repo update

    helm upgrade --install argocd argo/argo-cd \
        -n argocd \
        -f "${REPO_DIR}/helm-values/argocd-values.yaml" \
        --wait --timeout 300s

    echo "  Waiting for Argo CD to be ready..."
    kubectl rollout status deployment/argocd-server -n argocd --timeout=120s
fi

# -----------------------------------------------------------------------------
# 5. Argo Rollouts Controller
# -----------------------------------------------------------------------------
if kubectl get namespace argo-rollouts &>/dev/null 2>&1 && \
   kubectl get deployment argo-rollouts -n argo-rollouts &>/dev/null 2>&1; then
    echo "[✓] Argo Rollouts already installed"
else
    echo "[5/8] Installing Argo Rollouts controller..."
    kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
    helm repo add argo-rollouts https://argoproj.github.io/argo-rollouts 2>/dev/null || true
    helm repo update

    helm upgrade --install argo-rollouts argo-rollouts/argo-rollouts \
        -n argo-rollouts \
        -f "${REPO_DIR}/helm-values/argo-rollouts-values.yaml" \
        --wait --timeout 300s

    echo "  Waiting for Rollouts controller to be ready..."
    kubectl rollout status deployment/argo-rollouts -n argo-rollouts --timeout=120s
fi

# -----------------------------------------------------------------------------
# 6. Prometheus Stack
# -----------------------------------------------------------------------------
if kubectl get namespace monitoring &>/dev/null 2>&1 && \
   kubectl get statefulset prometheus-prometheus -n monitoring &>/dev/null 2>&1; then
    echo "[✓] Prometheus stack already installed"
else
    echo "[6/8] Installing Prometheus stack..."
    kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
    helm repo update

    helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
        -n monitoring \
        -f "${REPO_DIR}/helm-values/prometheus-values.yaml" \
        --timeout 600s

    echo "  Waiting for Prometheus to be ready..."
    kubectl rollout status statefulset/prometheus-prometheus -n monitoring --timeout=180s || true
fi

# -----------------------------------------------------------------------------
# 7. Build & Load Payment App Images into k3d cluster
# -----------------------------------------------------------------------------
echo "[7/8] Building and loading payments-api images..."
cd "${REPO_DIR}/payments-app"

# Build stable image
echo "  Building payments-api:v2.3 (stable)..."
docker build -t payments-api:v2.3 stable/
k3d image load -c "${CLUSTER_NAME}" payments-api:v2.3
echo "  ✓ payments-api:v2.3 loaded into cluster"

# Build canary image (with memory leak)
echo "  Building payments-api:v2.4 (canary/OOMKilled)..."
docker build -t payments-api:v2.4 canary/
k3d image load -c "${CLUSTER_NAME}" payments-api:v2.4
echo "  ✓ payments-api:v2.4 loaded into cluster"

cd "${REPO_DIR}"

# -----------------------------------------------------------------------------
# 8. Apply K8s Manifests
# -----------------------------------------------------------------------------
echo "[8/8] Applying K8s manifests..."
kubectl apply -f "${REPO_DIR}/manifests-repo/namespace.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/services.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/analysis-template.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/podmonitor.yaml"
kubectl apply -f "${REPO_DIR}/manifests-repo/rollout.yaml"

# Apply Argo CD Application (it watches the local manifests-repo)
kubectl apply -f "${REPO_DIR}/manifests-repo/argocd-app.yaml"

echo "  Waiting for Rollout to become Healthy..."
kubectl rollout status rollout payments-api -n "$NS" --timeout=120s || true

echo ""
echo "========================================"
echo " ✓ CLUSTER READY"
echo "========================================"
echo ""
echo "Components running:"
echo "  k3d/k3s:         $(kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}')"
echo "  Argo CD:         http://localhost:30800"
echo "  Rollouts:        http://localhost:30910"
echo "  Prometheus:      http://localhost:30900"
echo ""
echo "KUBECONFIG=${KUBECONFIG}"
echo ""
echo "Next steps:"
echo "  1. Start the demo controller:  KUBECONFIG=${KUBECONFIG} bash demo-controller/cycle.sh"
echo "  2. Start the Next.js dashboard: KUBECONFIG=${KUBECONFIG} PROMETHEUS_URL=http://localhost:30900 NODE_TLS_REJECT_UNAUTHORIZED=0 bun run dev"
echo "  3. Open http://localhost:3000"
echo ""