# gitops-progressive-delivery-demo

> An interactive, web-based simulation of a modern **GitOps-driven Progressive Delivery** pipeline.
> Watch a new `payments-api` v2.4 release roll out via Argo Rollouts canary, trip a Prometheus SLO violation, get diagnosed by K8sGPT, and auto-rollback — all in ~20 seconds.

![stack](https://img.shields.io/badge/Next.js-16-black) ![ts](https://img.shields.io/badge/TypeScript-5-blue) ![tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8) ![docker](https://img.shields.io/badge/Docker-standalone-2496ed)

---

## 1. What it simulates

This app is a **visual demo** of how four CNCF open-source tools collaborate in a real production pipeline:

| Tool | Role in the demo |
|------|------------------|
| **Argo CD**        | Syncs the new Git commit (`main@a1b2c3d`) into the `production` namespace. |
| **Argo Rollouts**  | Drives the canary: 20% → 50% traffic shift, pauses on analysis, aborts on failure. |
| **Prometheus**     | Scrapes `http_error_rate` and `http_request_duration_p99` for the canary pods. |
| **K8sGPT**         | AI SRE — scans logs, correlates with Rollouts status, streams a natural-language RCA. |

No real cluster is required — every behaviour is driven by a central state machine in `src/app/page.tsx`.

---

## 2. The state machine

When the user clicks **Start Rollout (v2.4)**, the app cycles through these states automatically:

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

## 3. File structure

```
gitops-progressive-delivery-demo/
├── Dockerfile                 # Multi-stage, node:18-alpine, standalone output
├── .dockerignore
├── next.config.js             # output: 'standalone'
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json
├── public/
│   └── logo.svg
└── src/
    ├── app/
    │   ├── globals.css        # zinc-950 dark theme + monospace + terminal cursor
    │   ├── layout.tsx         # Root layout, dark mode, metadata
    │   └── page.tsx           # State machine + 2-col dashboard grid
    ├── components/
    │   ├── ArgoSyncCard.tsx        # Git -> Cluster sync view
    │   ├── RolloutsTrafficCard.tsx # Canary traffic pipe
    │   ├── PrometheusMetricsCard.tsx # Error rate + p99 latency charts
    │   └── K8sGPTTerminalCard.tsx  # Mac-style streaming terminal
    ├── lib/
    │   ├── demo-state.ts      # State machine constants + types
    │   ├── db.ts
    │   └── utils.ts
    └── hooks/
        └── use-mobile.ts
```

---

## 4. Run locally

```bash
# Install deps
bun install            # or: npm install

# Dev server (port 3000)
bun run dev            # or: npm run dev

# Open the app
# -> http://localhost:3000
```

Click **Start Rollout (v2.4)** in the top-right to kick off the demo.

---

## 5. Run with Docker

The repository is fully Dockerized. The image builds the Next.js **standalone** output and serves it via `node server.js` on port 3000.

```bash
# Build the image
docker build -t gitops-progressive-delivery-demo .

# Run the container
docker run --rm -p 3000:3000 gitops-progressive-delivery-demo

# Open the app
# -> http://localhost:3000
```

### Dockerfile highlights

- **Stage 1 (`deps`)** — installs dependencies with Bun (falls back to npm) on `node:18-alpine`.
- **Stage 2 (`builder`)** — runs `next build` to produce `.next/standalone`.
- **Stage 3 (`runner`)** — copies the standalone server + static assets, runs as non-root `nextjs` user, exposes port 3000, includes a `HEALTHCHECK`.

---

## 6. Tech stack

| Layer       | Choice                                   |
|-------------|------------------------------------------|
| Framework   | Next.js 16 (App Router)                  |
| Language    | TypeScript 5                             |
| Styling     | Tailwind CSS 4 + shadcn/ui               |
| Charts      | recharts                                 |
| Animations  | framer-motion                            |
| Icons       | lucide-react                             |
| Container    | Docker (node:18-alpine, standalone)      |

---

## 7. UI / UX

The aesthetic strictly mirrors a terminal-heavy, dark-mode SRE dashboard:

- **Background** `zinc-950` · **Cards** `zinc-900` · **Borders** `zinc-800`
- **Monospace** everywhere (Geist Mono)
- **Status colours**: Emerald (healthy) · Blue (info/in-progress) · Amber (warning/analyzing) · Red (error/rollback)
- 2-column grid: left = Argo CD + Argo Rollouts, right = Prometheus + K8sGPT terminal
- Smooth `framer-motion` animations on the traffic pipe and pulsing status indicators
- Streamed terminal output with a blinking cursor

---

## 8. Repository

Source: [`github.com/adventurewave-labs`](https://github.com/adventurewave-labs)

Live demo aesthetic reference: [aops-sre-pipeline.vercel.app](https://aops-sre-pipeline.vercel.app/)
