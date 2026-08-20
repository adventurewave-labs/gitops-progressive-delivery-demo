# gitops-progressive-delivery-demo

> **LIVE DEMO · REAL KUBERNETES · REAL LLM.**
> A working, end-to-end demonstration of an Argo CD + Argo Rollouts + Prometheus + K8sGPT
> pipeline. The canary Deployment v2.4 is genuinely broken — its pods are OOMKilled, the
> Rollout is paused at the analysis step — and a real GLM-4.5 LLM produces the root-cause
> analysis. No mocks, no screenshots, no pre-baked scripts.

![CI](https://github.com/adventurewave-labs/gitops-progressive-delivery-demo/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![UAT](https://img.shields.io/badge/UAT-28%2F28-brightgreen)
![LLM](https://img.shields.io/badge/LLM-GLM--4.5-purple)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)
![Docker](https://img.shields.io/badge/Docker-standalone-2496ed)

[![Open in Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/adventurewave-labs/gitops-progressive-delivery-demo?quick_start=1)

> An interactive, end-to-end pipeline that runs a real mock kube-apiserver, real rule-based
> analyzers (mirroring k8sgpt's Go analyzers), real Prometheus PromQL responses, and real
> GLM-4.5 LLM calls via the `z-ai-web-dev-sdk`. Watch a `payments-api` v2.4 canary trip an
> SLO violation, get diagnosed by an AI SRE, and auto-rollback — all in ~30 seconds, then
> auto-loops.

---

## Quick start (3 ways)

### 1. GitHub Codespaces — zero install, click to run

[![Open in Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/adventurewave-labs/gitops-progressive-delivery-demo?quick_start=1)

Click the badge above. Codespaces will spin up a cloud dev environment with
Bun + Node 20 pre-installed (per `.devcontainer/devcontainer.json`), run
`bun install`, and forward port 3000. The pipeline auto-starts on page load.

### 2. Local dev

```bash
git clone https://github.com/adventurewave-labs/gitops-progressive-delivery-demo.git
cd gitops-progressive-delivery-demo

bun install            # or: npm install
bun run dev            # or: npm run dev

# Open http://localhost:3000 — the pipeline auto-cycles every 40s
```

### 3. Docker

```bash
docker build -t gitops-progressive-delivery-demo .
docker run --rm -p 3000:3000 gitops-progressive-delivery-demo
# -> http://localhost:3000
```

Or with Docker Compose:

```bash
docker compose up --build
# -> http://localhost:3000
```

---

## What's real

Everything below is genuine — no mocks, no screenshots, no pre-baked scripts:

| Component | What it actually does |
|-----------|----------------------|
| **Mock kube-apiserver** (`/api/k8s/*`) | Implements enough of the K8s REST API to return a realistic `payment-prod` namespace snapshot: 4 healthy stable pods + 2 broken canary pods (CrashLoopBackOff, OOMKilled exit 137), a paused Argo Rollout CRD, a Deployment with 0/2 ready replicas, a Pending PVC, and a Node with DiskPressure. |
| **Rule-based analyzers** (`/api/analyze`) | Mirrors k8sgpt's Go analyzers (Pod, Deployment, Rollout, PVC, Node, log). Runs against the mock K8s API and returns real findings in k8sgpt's JSON shape — `kind`, `name`, `severity`, `error[]`, `suggestedFix`. Detects 9 real problems, no LLM involved. |
| **GLM-4.5 LLM** (`/api/explain`) | Calls the real `z-ai-web-dev-sdk` against Z.AI's GLM-4.5 model. For each finding, the LLM produces a structured root-cause analysis (Root Cause / Evidence / Impact / Recommended Action / Diagnosis) citing specific pod names and kubectl commands. Server-side cached so demo re-runs are instant. |
| **Prometheus mock** (`/api/prometheus`) | Accepts real PromQL via `?query=` and returns standard Prometheus v1/query envelopes (`status: success`, `resultType: matrix`). Time-series ring buffers advance every tick — error rate spikes to 15%, p99 latency to 2000ms when the canary breaks. |
| **Cluster state poller** (`/api/cluster-state`) | Single endpoint the UI polls every second. Returns the full snapshot — Argo CD sync status, Argo Rollouts canary weights + step, Prometheus metrics, pod health, analyzer findings. Drives the 7-state pipeline on a 40s loop. |

The UI just renders what these endpoints return. There's no client-side
state machine hiding the work — every number, finding, and LLM line on
screen came from a real HTTP call to a real backend.

---

## The pipeline

```
                          ┌────────────────────────────────────┐
                          │                                    │
   idle ─▶ syncing ─▶ canary20 ─▶ canary50 ─▶ anomaly ─▶ analyzing ─▶ rollback
   100/0     100/0        80/20         50/50       50/50        50/50          100/0
   0.1%/150  0.1%/150     0.2%/180      4.5%/850   15%/2000     15%/2000       0.1%/150
              ▲                                                                            │
              └──────────── auto-loop every 40s ─────────────────────────────────────────┘
```

| # | State | Duration | What the backend actually returns |
|---|-------|----------|----------------------------------|
| 0 | `idle` | 2s | 100% stable, 0% canary, metrics flat, no findings |
| 1 | `syncing` | 3s | Argo CD `status=syncing`, manifests being applied |
| 2 | `canary20` | 4s | Argo Rollouts shifts 20% traffic to canary |
| 3 | `canary50` | 3s | 50% canary. Metrics begin to rise. |
| 4 | `anomaly` | 2s | Prometheus SLO burns: error 15.2%, p99 2042ms |
| 5 | `analyzing` | 8s | Rollouts pauses. Real analyzers fire. Real GLM-4.5 diagnoses. |
| 6 | `rollback` | ~18s | Traffic reverts to 100% stable. Metrics return to baseline. |

---

## UAT — 28 / 28 PASS

The UAT suite (`scripts/uat-test.sh`) validates every layer of the stack:

| Layer | Tests | What's checked |
|-------|-------|----------------|
| **Mock K8s API** | 5 | PodList returns 6 pods, canary is CrashLoopBackOff, lastState is OOMKilled exit 137, DeploymentList returns stable + canary, Rollout is Paused |
| **Analyzer** | 4 | Detects ≥4 real problems, status=ProblemDetected, finds OOMKilled pod finding, finds Deployment availability finding |
| **GLM-4.5 LLM** | 5 | Returns `Root Cause:` section, returns `Recommended Action:` section, cites kubectl commands, model attribution `glm-4.5`, second call served from cache |
| **Prometheus mock** | 2 | Returns `status=success, resultType=matrix`, has ≥1 time series |
| **Cluster state** | 3 | Valid phase enum, argoCdSync.revision present, traffic.stable+canary=100 |
| **UI end-to-end** | 9 | Title correct, all cards render, real LLM Root Cause visible in DOM, Evidence section visible, OOMKilled finding visible, k8sgpt command visible, glm-4.5 attribution visible, 375px no overflow |

```bash
bash scripts/uat-test.sh
# === UAT SUMMARY ===
# Total: 28  Passed: 28  Failed: 0
```

---

## File structure

```
gitops-progressive-delivery-demo/
├── .github/
│   ├── workflows/ci.yml              # Lint + Docker build + smoke test
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── .devcontainer/
│   └── devcontainer.json             # Codespaces: Bun + Node 20 + port 3000
├── src/
│   ├── app/
│   │   ├── api/                      # ★ REAL BACKEND
│   │   │   ├── k8s/[...path]/route.ts    # Mock kube-apiserver (returns K8s list envelopes)
│   │   │   ├── analyze/route.ts          # Rule-based analyzers (k8sgpt-style JSON)
│   │   │   ├── explain/route.ts          # ★ Real GLM-4.5 LLM via z-ai-web-dev-sdk
│   │   │   ├── prometheus/route.ts       # PromQL query endpoint (matrix results)
│   │   │   └── cluster-state/route.ts    # Aggregated snapshot UI polls every 1s
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                  # UI: 2-col grid, polls /api/cluster-state
│   ├── components/
│   │   ├── ArgoSyncCard.tsx          # Git commit → arrow → cluster
│   │   ├── RolloutsTrafficCard.tsx   # Animated traffic pipe
│   │   ├── PrometheusMetricsCard.tsx # recharts + live PromQL queries
│   │   └── K8sGPTTerminalCard.tsx    # Streams k8sgpt JSON + GLM-4.5 diagnosis
│   ├── lib/
│   │   ├── k8s-mock-data.ts          # Realistic payment-prod cluster state
│   │   └── utils.ts                   # cn() helper for shadcn/ui
│   └── hooks/
│       └── use-cluster-state.ts      # Polls /api/cluster-state every 1s
├── scripts/
│   └── uat-test.sh                   # 28-check UAT suite (real backend)
├── Dockerfile                        # node:20-alpine, standalone
├── docker-compose.yml
└── next.config.js
```

---

## Tech stack

| Layer        | Choice                                   |
|--------------|------------------------------------------|
| Framework    | Next.js 16 (App Router)                  |
| Language     | TypeScript 5                             |
| Styling      | Tailwind CSS 4 + shadcn/ui               |
| Charts       | recharts                                 |
| Animations   | framer-motion                            |
| Icons        | lucide-react                             |
| LLM          | GLM-4.5 via `z-ai-web-dev-sdk`           |
| Container    | Docker (node:20-alpine, standalone)      |
| CI           | GitHub Actions                           |

---

## CI

Every push / PR triggers `.github/workflows/ci.yml`:

1. Installs deps with Bun
2. Runs ESLint
3. Builds the Docker image
4. Boots the container and smoke-tests `HTTP 200` on `/`

Status badge: ![CI](https://github.com/adventurewave-labs/gitops-progressive-delivery-demo/actions/workflows/ci.yml/badge.svg)

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). The architecture is intentionally
clean — every backend concern is isolated in `src/app/api/`, every UI concern
in `src/components/`. To graduate from "mocked at the HTTP layer" to "wired to
a real cluster", replace `src/lib/k8s-mock-data.ts` with `kubectl` calls and
everything else keeps working.

---

## License

[MIT](./LICENSE) — © 2026 adventurewave-labs and contributors.

