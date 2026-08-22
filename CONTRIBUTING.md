# Contributing

Thanks for your interest in improving this demo! This is a small, focused
project — the bar for contributions is correspondingly simple.

## Quick start

```bash
bun install
bun run dev      # http://localhost:3000
```

Click **Start Rollout (v2.4)** in the top-right to run the demo.

## Before opening a PR

- [ ] `bun run lint` passes with no errors
- [ ] `docker build .` succeeds
- [ ] The full demo still runs end-to-end: idle → syncing → canary20 → canary50 → anomaly → analyzing → rollback → reset
- [ ] No secrets, tokens, or `.env.local` files committed
- [ ] README updated if your change affects user-visible behaviour

## What kinds of changes we welcome

- Bug fixes for the state machine, terminal stream, or chart rendering
- Visual polish that stays true to the dark, monospace, terminal-heavy aesthetic
- Additional simulated CNCF tools (e.g., a FluxCD variant)
- Real-cluster wiring (e.g., a mode that talks to an actual K8sGPT instance)
- Tests / Playwright e2e for the demo flow
- Accessibility improvements

## What we won't take

- Light mode / theme toggle (the dark aesthetic is the whole point)
- Replacing the simulated state machine with a real GitOps loop without a
  fallback demo mode
- Heavy dependencies that bloat the Docker image

## Commit style

Conventional Commits preferred:

```
feat(rollouts): pulsing red border during anomaly
fix(terminal): guard against undefined stream lines
docs: add docker-compose example
chore(ci): add GitHub Actions workflow
```

## Reporting security issues

**Never** open a public issue for a security problem. Email
marcus@adventureonthewave.com instead.
