# gitops-progressive-delivery-demo

> An interactive, web-based simulation of a modern **GitOps-driven Progressive Delivery** pipeline.
> Watch a new `payments-api` v2.4 release roll out via Argo Rollouts canary, trip a Prometheus SLO violation, get diagnosed by K8sGPT, and auto-rollback — all in ~20 seconds.

![CI](https://github.com/marcuspat/gitops-progressive-delivery-demo/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)
![Docker](https://img.shields.io/badge/Docker-standalone-2496ed)

---

## What it simulates

This app is a **visual demo** of how four CNCF open-source tools collaborate in a real production pipeline:

| Tool | Role in the demo |
|------|------------------|
| **Argo CD**        | Syncs the new Git commit (`main@a1b2c3d`) into the `production` namespace. |
| **Argo Rollouts**  | Drives the canary: 20% → 50% traffic shift, pauses on analysis, aborts on failure. |
| **Prometheus**     | Scrapes `http_error_rate` and `http_request_duration_p99` for the canary pods. |
| **K8sGPT**         | AI SRE — scans logs, correlates with Rollouts status, streams a natural-language RCA. |

No real cluster is required — every behaviour is driven by a central state machine in `src/app/page.tsx`.

---

## The state machine

```
                          ┌──────────────────────────────┐
                          │                              │
   idle ──▶ syncing ──▶ canary20 ──▶ canary50 ──▶ anomaly ──▶ analyzing ──▶ rollback
   100/0     100/0        80/20         50/50       50/50        50/50          100/0
   0.1%/150  0.1%/150     0.2%/180      4.5%/850    15%/2000     15%/2000       0.1%/150
                                                                              │
                                                                              ▼
                                                                          [Reset]
```

| # | State        | Duration | What happens |
|---|--------------|----------|--------------|
| 0 | `idle`       | —        | Argo CD healthy, 100% traffic to stable, metrics flat. |
| 1 | `syncing`    | 3s       | Git commit pushed; Argo CD applies manifests. |
| 2 | `canary20`   | 4s       | Argo Rollouts shifts 20% traffic to canary. Metrics healthy. |
| 3 | `canary50`   | 3s       | 50% canary. Error rate + latency begin to rise. |
| 4 | `anomaly`    | 2s       | Prometheus SLO burns: error 15%, p99 2000ms. |
| 5 | `analyzing`  | 8s       | Rollouts pauses. K8sGPT streams AI diagnosis (OOMKilled, memory leak, etc.). |
| 6 | `rollback`   | —        | Traffic reverts to 100% stable. Metrics return to baseline. |

---

## Quick start

### Run locally (dev)

```bash
git clone https://github.com/marcuspat/gitops-progressive-delivery-demo.git
cd gitops-progressive-delivery-demo

bun install            # or: npm install
bun run dev            # or: npm run dev

# Open http://localhost:3000 and click "Start Rollout (v2.4)"
```

### Run with Docker

```bash
docker build -t gitops-progressive-delivery-demo .
docker run --rm -p 3000:3000 gitops-progressive-delivery-demo
# -> http://localhost:3000
```

### Or with Docker Compose

```bash
docker compose up --build
# -> http://localhost:3000
```

---

## File structure

```
gitops-progressive-delivery-demo/
├── .github/
│   ├── workflows/ci.yml              # Lint + Docker build + smoke test
│   ├── ISSUE_TEMPLATE/               # Bug & feature templates
│   └── PULL_REQUEST_TEMPLATE.md
├── src/
│   ├── app/
│   │   ├── globals.css               # zinc-950 dark theme + monospace + terminal cursor
│   │   ├── layout.tsx                # Root layout, dark mode, metadata
│   │   └── page.tsx                  # State machine + 2-col dashboard grid
│   ├── components/
│   │   ├── ArgoSyncCard.tsx          # Git -> Cluster sync view
│   │   ├── RolloutsTrafficCard.tsx   # Canary traffic pipe
│   │   ├── PrometheusMetricsCard.tsx # Error rate + p99 latency charts
│   │   └── K8sGPTTerminalCard.tsx    # Mac-style streaming terminal
│   ├── lib/
│   │   └── demo-state.ts             # State machine constants + types
│   ├── hooks/
│   └── components/ui/                 # shadcn/ui primitives
├── Dockerfile                        # Multi-stage, node:20-alpine, standalone
├── docker-compose.yml
├── next.config.js                    # output: 'standalone'
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── .env.example
├── .nvmrc
├── .dockerignore
├── .gitignore
├── LICENSE
├── CONTRIBUTING.md
└── README.md
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
| Container    | Docker (node:20-alpine, standalone)      |
| CI           | GitHub Actions                           |

---

## UI / UX

The aesthetic strictly mirrors a terminal-heavy, dark-mode SRE dashboard:

- **Background** `zinc-950` · **Cards** `zinc-900` · **Borders** `zinc-800`
- **Monospace** everywhere (Geist Mono)
- **Status colours**: Emerald (healthy) · Blue (info/in-progress) · Amber (warning/analyzing) · Red (error/rollback)
- 2-column grid: left = Argo CD + Argo Rollouts, right = Prometheus + K8sGPT terminal
- Smooth `framer-motion` animations on the traffic pipe and pulsing status indicators
- Streamed terminal output with a blinking cursor

---

## CI

Every push / PR triggers `.github/workflows/ci.yml` which:

1. Installs deps with Bun
2. Runs ESLint
3. Builds the Docker image
4. Boots the container and smoke-tests `HTTP 200` on `/`

Status badge: ![CI](https://github.com/marcuspat/gitops-progressive-delivery-demo/actions/workflows/ci.yml/badge.svg)

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). PRs welcome — especially for:

- New simulated CNCF tools (FluxCD, Linkerd, etc.)
- Real-cluster wiring (mode that talks to an actual K8sGPT instance)
- Playwright e2e tests for the demo flow
- Accessibility improvements

---

## License

[MIT](./LICENSE) — © 2026 Marcus Patman and adventurewave-labs contributors.
