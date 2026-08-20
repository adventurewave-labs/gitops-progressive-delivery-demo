# UAT (User Acceptance Testing)

This document describes the automated UAT suite that validates the
`gitops-progressive-delivery-demo` end-to-end. The suite exercises every
state in the pipeline state machine plus edge cases (reset, mobile
responsiveness) and produces a machine-readable JSON report.

| | |
|---|---|
| **Test script** | [`scripts/uat-test.sh`](../scripts/uat-test.sh) |
| **Last run** | 2026-08-20 |
| **Result** | ✅ **31 / 31 PASS** |
| **Duration** | ~40s (matches one full pipeline cycle + edge cases) |

---

## How to run

```bash
# 1. Make sure the dev server is up
bun run dev

# 2. In another terminal, run the UAT suite
bash scripts/uat-test.sh

# 3. Inspect the machine-readable report
cat scripts/uat-report.json | jq
```

The script uses [agent-browser](https://github.com/vercel-labs/agent-browser)
to drive a headless Chromium against `http://localhost:3000`. It records every
test as PASS / FAIL and exits non-zero if anything fails.

---

## Test coverage

### Test 1: Idle state (7 checks)

Validates the initial render before the user clicks anything.

| Check | What it asserts |
|-------|-----------------|
| `server-up`              | Dev server responds `HTTP 200` |
| `title-correct`          | Page title is `GitOps Progressive Delivery & Incident Response Demo` |
| `all-4-cards-present`    | All 4 cards render: Argo CD · Argo Rollouts · Prometheus · K8sGPT |
| `start-rollout-button`  | The Start Rollout v2.4 button is visible + clickable |
| `initial-state-idle`    | Footer state pill says `idle` |
| `initial-traffic-100-0` | Traffic split starts at 100% stable / 0% canary |
| `initial-slo-healthy`   | Prometheus badge says `SLO HEALTHY` |
| `terminal-idle-prompt`  | K8sGPT terminal shows `awaiting trigger…` idle prompt |

### Test 2: Syncing state (2 checks)

Clicks Start Rollout and verifies Argo CD's syncing visual.

| Check | What it asserts |
|-------|-----------------|
| `transitions-to-syncing` | After click, footer state becomes `syncing` |
| `syncing-arrow-pulsing` | Argo CD sync arrow shows the `Applying` indicator |

### Test 3: Canary 20% state (3 checks)

After the 3-second syncing window.

| Check | What it asserts |
|-------|-----------------|
| `transitions-to-canary20`   | State advances to `canary20` |
| `canary20-traffic-split`    | Traffic pipe shows `80/20` |
| `canary20-argo-synced`       | Argo CD transitions from `Applying` → `Synced` |

### Test 4: Canary 50% state (2 checks)

After the 4-second canary20 window.

| Check | What it asserts |
|-------|-----------------|
| `transitions-to-canary50` | State advances to `canary50` |
| `canary50-traffic-split`  | Traffic pipe shows `50/50` |

### Test 5: Anomaly state (3 checks)

After the 3-second canary50 window.

| Check | What it asserts |
|-------|-----------------|
| `transitions-to-anomaly`  | State advances to `anomaly` |
| `anomaly-slo-violated`    | Prometheus badge flips to `SLO VIOLATED` |
| `anomaly-traffic-paused`  | Traffic pipe holds at `50/50` (Rollouts paused) |

### Test 6: AI Analyzing state (3 checks)

After the 2-second anomaly window.

| Check | What it asserts |
|-------|-----------------|
| `transitions-to-analyzing` | State advances to `analyzing` |
| `k8sgpt-streaming`        | Terminal has started streaming (≥3 lines visible) |
| `k8sgpt-trigger-line`     | The opening `K8sGPT Analyzer triggered by Prometheus SLO violation…` line is visible |

### Test 7: Rollback (final) state (6 checks)

After the 8-second analyzing window.

| Check | What it asserts |
|-------|-----------------|
| `transitions-to-rollback`    | State advances to `rollback` |
| `rollback-traffic-restored` | Traffic pipe returns to `100/0` |
| `rollback-slo-restored`     | Prometheus badge returns to `SLO HEALTHY` |
| `k8sgpt-all-9-lines`        | All 9 K8sGPT diagnosis lines have been streamed |
| `k8sgpt-final-line`         | The closing `Executing automated rollback via Argo Rollouts…` line is visible |
| `reset-button-visible`      | The `Reset Demo` button appears in the header |

### Test 8: Reset Demo (edge case) (4 checks)

| Check | What it asserts |
|-------|-----------------|
| `click-reset-demo`            | Reset Demo button is found and clicked |
| `reset-returns-to-idle`       | State returns to `idle` after reset |
| `reset-clears-terminal`       | K8sGPT terminal is empty (0 lines) after reset |
| `reset-restores-start-button` | The Start Rollout button reappears after reset |

### Test 9: Mobile responsive (1 check)

| Check | What it asserts |
|-------|-----------------|
| `mobile-no-overflow` | At 375px viewport width, `document.scrollWidth ≤ viewport.width` (no horizontal overflow) |

---

## Sample report

```json
{
  "total": 31,
  "passed": 31,
  "failed": 0,
  "results": [
    { "name": "server-up",                "status": "PASS", "detail": "HTTP 200 from http://localhost:3000" },
    { "name": "title-correct",            "status": "PASS", "detail": "Page title: GitOps Progressive Delivery & Incident Response Demo" },
    { "name": "all-4-cards-present",      "status": "PASS", "detail": "Argo CD + Argo Rollouts + Prometheus + K8sGPT all visible" },
    { "name": "start-rollout-button",     "status": "PASS", "detail": "Start Rollout v2.4 button present" },
    { "name": "initial-state-idle",       "status": "PASS", "detail": "Pipeline starts in IDLE state" },
    { "name": "initial-traffic-100-0",    "status": "PASS", "detail": "Initial traffic 100% stable / 0% canary" },
    { "name": "initial-slo-healthy",      "status": "PASS", "detail": "Initial SLO status: HEALTHY" },
    { "name": "terminal-idle-prompt",     "status": "PASS", "detail": "K8sGPT terminal shows 'awaiting trigger' idle prompt" },
    /* ... 23 more PASS entries ... */
    { "name": "mobile-no-overflow",       "status": "PASS", "detail": "375px viewport: no horizontal overflow" }
  ]
}
```

---

## Bugs found and fixed by this UAT suite

This UAT suite has paid for itself multiple times over. Bugs it caught:

1. **`K8sGPTTerminalCard` runtime crash** — `Cannot read properties of undefined (reading 'startsWith')` when the analyzing state fired. The `Line` component was receiving an undefined `text` prop. Fixed by adding a `typeof text === "string"` guard + filtering the stream array.

2. **K8sGPT stream timing race** — the stream interval wasn't clearing on re-entry, so when React fast-refresh re-invoked the effect, two intervals would compete and drop the first line. Fixed by clearing any existing interval at the start of `startStream()` and flushing remaining lines on `rollback`.

3. **Mobile horizontal overflow** — the StateRail's `min-w-max` inner div caused a 13px overflow at 375px viewport width. Fixed by adding `w-full max-w-full overflow-x-hidden` to the `<main>` wrapper.

Without the UAT suite, all three would have shipped to the public repo undetected.
