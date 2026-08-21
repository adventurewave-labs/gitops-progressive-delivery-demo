# gitops-progressive-delivery-demo

> **REAL KUBERNETES · REAL ARGO CD · REAL ARGO ROLLOUTS · REAL PROMETHEUS · REAL LLM.**
> A genuine end-to-end GitOps progressive delivery pipeline running in a real k3s cluster.
> The canary Deployment v2.4 is genuinely broken — its pods are real OOMKilled by the
> kernel, the Rollout is genuinely paused by a real AnalysisRun, real Prometheus
> scrapes real error spikes — and a real GLM-4.5 LLM produces the root-cause
> analysis. Zero mock data. Zero hardcoded state machines.

![CI](https://github.com/adventurewave-labs/gitops-progressive-delivery-demo/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![LLM](https://img.shields.io/badge/LLM-GLM--4.5-purple)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Docker](https://img.shields.io/badge/Docker-standalone-2496ed)
![k3s](https://img.shields.io/badge/k3s-real_cluster-FFC72C)

[![Open in Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/adventurewave-labs/gitops-progressive-delivery-demo?quick_start=1)

---

## What's Real

| Component | What it actually does |
|-----------|----------------------|
| **k3s cluster** | Real single-node Kubernetes running inside the Codespace. Real kube-apiserver, real scheduler, real kubelet. |
| **Argo CD** | Real Argo CD (Helm chart) watching the `manifests-repo/` directory. Shows real sync status. |
| **Argo Rollouts** | Real Rollout CRD with real canary steps (20% → 50% → Analysis). The controller genuinely manages pod scaling and weight. |
| **Prometheus** | Real Prometheus (kube-prometheus-stack) scraping `/metrics` from pods every 5s. Real PromQL responses. |
| **payments-api:v2.3** | Real Go HTTP server (stable, healthy). Serves `/api/payments` with 0.1% error rate. |
| **payments-api:v2.4** | Real Go HTTP server with an **intentional memory leak**. Allocates 10MB every 5s until the kernel OOMKills it (exit code 137). |
| **Cluster analyzer** | Queries the **real kube-apiserver** for pod states. Detects real OOMKilled, real CrashLoopBackOff, real Rollout pause. |
| **GLM-4.5 LLM** | Real network call to Z.AI's GLM-4.5 via `z-ai-web-dev-sdk`. Produces root-cause analysis from real cluster findings. |
| **Dashboard** | Next.js app polls `/api/cluster-state` which derives phase from **real Rollout status + real pod states + real Prometheus metrics**. |

---

## Quick Start (Codespaces — one click)

[![Open in Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/adventurewave-labs/gitops-progressive-delivery-demo?quick_start=1)

The Codespace auto-runs `setup.sh` which installs k3s, Argo CD, Argo Rollouts, Prometheus, builds both app images, and applies all manifests.

Then:

```bash
# Terminal 1: Start the dashboard (connected to real cluster)
bun run dev:real

# Terminal 2: Start the auto-cycling demo controller
bun run demo

# Open http://localhost:3000
```

## Quick Start (Local Machine)

```bash
git clone https://github.com/adventurewave-labs/gitops-progressive-delivery-demo.git
cd gitops-progressive-delivery-demo

# 1. Bootstrap the cluster (k3s + Argo CD + Rollouts + Prometheus + images)
bash setup.sh

# 2. Start the dashboard
bash dev-real.sh

# 3. In another terminal, start the demo controller
bash demo-controller/cycle.sh

# Open http://localhost:3000
```

## The Real Pipeline

```
Canary deployed → Rollout steps: 20% → 50% → AnalysisRun
      ↓
v2.4 memory leak goroutine starts (10MB/5s)
      ↓
Kernel OOMKills canary pods (exit code 137, REAL)
      ↓
Pods enter CrashLoopBackOff (REAL kubelet behavior)
      ↓
Prometheus scrapes error rate spike (REAL /metrics endpoint)
      ↓
AnalysisRun queries Prometheus → error > 1% → FAIL (REAL)
      ↓
Argo Rollouts aborts the Rollout (REAL controller decision)
      ↓
Canary pods scaled to 0, traffic back to 100% stable (REAL)
      ↓
Dashboard shows the entire chain derived from real K8s API calls
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  k3s Cluster (real)                                  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │  Argo CD     │  │  Argo        │                  │
│  │  (real)      │  │  Rollouts    │                  │
│  └──────────────┘  └──────┬───────┘                  │
│                          │                           │
│  ┌───────────────────────┴────────────────────────┐  │
│  │  payment-prod namespace                        │  │
│  │  ┌──────────────┐  ┌─────────────────────┐   │  │
│  │  │ v2.3 (4 pods)│  │ v2.4 (OOMKilled!)  │   │  │
│  │  │ :8080/metrics│  │ :8080/metrics      │   │  │
│  │  └──────────────┘  └─────────────────────┘   │  │
│  └───────────────────────────────────────────────┘  │
│  ┌──────────────┐                                   │
│  │  Prometheus   │  ← scrapes real /metrics         │
│  └──────────────┘                                   │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Next.js Dashboard (port 3000)                       │
│  /api/cluster-state → real kube-api + Prometheus     │
│  /api/prometheus     → proxy to real Prometheus      │
│  /api/k8s/...        → proxy to real kube-apiserver  │
│  /api/analyze        → queries real cluster state     │
│  /api/explain        → GLM-4.5 (real LLM call)       │
└──────────────────────────────────────────────────────┘
```

## How the Canary Actually Breaks

`payments-app/canary/main.go` contains:

```go
func startMemoryLeak() {
    var leaked [][]byte
    ticker := time.NewTicker(5 * time.Second)
    for range ticker.C {
        chunk := make([]byte, 10*1024*1024) // 10MB
        for i := range chunk { chunk[i] = byte(i % 256) }
        leaked = append(leaked, chunk)
    }
}
```

With a `256Mi` memory limit, the kernel OOMKills the process after ~2 minutes.
This is not simulated. The Linux kernel genuinely sends SIGKILL.

## UAT

```bash
bash scripts/uat-test.sh
# Tests real K8s API, real Prometheus, real LLM, real cluster state
```

## Recording Demo GIFs

```bash
# Make sure cluster + controller + dashboard are running, then:
bash scripts/record-gifs.sh
```

The GIFs are screen-recordings of the real system operating.

## Tech Stack

| Layer        | Choice                                   |
|--------------|------------------------------------------|
| Cluster      | k3s (real Kubernetes)                     |
| GitOps       | Argo CD (Helm)                           |
| Delivery     | Argo Rollouts (real canary steps)        |
| Monitoring   | Prometheus (kube-prometheus-stack)       |
| App          | Go 1.22 (stable + canary with memory leak) |
| Framework    | Next.js 16 (App Router)                  |
| LLM          | GLM-4.5 via `z-ai-web-dev-sdk`           |
| Container    | Docker (multi-stage, alpine)             |

## License

[MIT](./LICENSE) — © 2026 adventurewave-labs and contributors.
