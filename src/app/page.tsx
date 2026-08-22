"use client";

import {
  Github,
  Rocket,
  Boxes,
  Activity,
  Bot,
  ChevronRight,
  CircleDot,
  Cpu,
  Database,
  Server,
} from "lucide-react";

import { ArgoSyncCard } from "@/components/ArgoSyncCard";
import { RolloutsTrafficCard } from "@/components/RolloutsTrafficCard";
import { PrometheusMetricsCard } from "@/components/PrometheusMetricsCard";
import { K8sGPTTerminalCard } from "@/components/K8sGPTTerminalCard";
import { useClusterState } from "@/hooks/use-cluster-state";
import type { ClusterState } from "@/hooks/use-cluster-state";

export default function Home() {
  const { state, error, loading } = useClusterState(1000);

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 bg-grid text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <Header state={state} />
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            ⚠ cluster-state API error: <code className="font-mono">{error}</code>
          </div>
        )}
        {loading && !state ? (
          <div className="py-20 text-center text-zinc-500">connecting to cluster…</div>
        ) : (
          <>
            <StateRail state={state!} />
            <StackLegend />
            <MainGrid state={state!} />
          </>
        )}
        <Footer state={state} />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function Header({ state }: { state: ClusterState | null }) {
  const phase = state?.phase ?? "idle";
  const busy = phase !== "idle" && phase !== "rollback";

  return (
    <header className="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
          <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          adventurewave-labs
          <ChevronRight className="h-3 w-3 text-zinc-700" />
          <span className="text-zinc-400">gitops-progressive-delivery-demo</span>
        </div>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">
          AI-Driven Progressive Delivery &amp; Incident Response
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          <span className="font-semibold text-emerald-400">LIVE DEMO · REAL KUBERNETES · REAL LLM.</span>{" "}
          Argo CD syncs a new release, Argo Rollouts shifts canary traffic, Prometheus detects an
          SLO burn, and K8sGPT diagnoses + auto-rolls back — all driven by a real k3s cluster, real Prometheus
          scrapes, and real GLM-4.5 calls.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <a
          href="https://github.com/adventurewave-labs/gitops-progressive-delivery-demo"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
        >
          <Github className="h-3.5 w-3.5" />
          source
        </a>
        {busy && (
          <span className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300">
            <CircleDot className="h-3.5 w-3.5 animate-spin" />
            pipeline running
          </span>
        )}
        {phase === "rollback" && (
          <span className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300">
            ✓ rolled back — auto-cycling in ~10s
          </span>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* StateRail + StackLegend                                            */
/* ------------------------------------------------------------------ */

function StateRail({ state }: { state: ClusterState }) {
  const allStates: ClusterState["phase"][] = [
    "idle",
    "syncing",
    "canary20",
    "canary50",
    "anomaly",
    "analyzing",
    "rollback",
  ];
  const currentIdx = allStates.indexOf(state.phase);

  return (
    <div className="mb-4 w-full max-w-full overflow-x-auto">
      <div className="flex min-w-max items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
        {allStates.map((s, i) => {
          const isCurrent = s === state.phase;
          const isPast = currentIdx > i;
          const labelMap: Record<ClusterState["phase"], string> = {
            idle: "IDLE",
            syncing: "SYNCING",
            canary20: "CANARY 20%",
            canary50: "CANARY 50%",
            anomaly: "ANOMALY DETECTED",
            analyzing: "AI ANALYZING",
            rollback: "ROLLED BACK",
          };
          return (
            <div key={s} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest transition-colors ${
                  isCurrent
                    ? "bg-zinc-800/80 text-amber-400"
                    : isPast
                      ? "text-zinc-500"
                      : "text-zinc-600"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isCurrent
                      ? s === "anomaly" || s === "analyzing"
                        ? "bg-red-400"
                        : s === "rollback"
                          ? "bg-emerald-400"
                          : "bg-amber-400"
                      : isPast
                        ? "bg-zinc-600"
                        : "bg-zinc-700"
                  }`}
                />
                {labelMap[s]}
              </div>
              {i < allStates.length - 1 && (
                <ChevronRight className="mx-0.5 h-3 w-3 text-zinc-700" />
              )}
            </div>
          );
        })}
        <div className="ml-2 hidden pl-2 font-mono text-[10px] text-zinc-600 sm:block">
          {`// ${state.findingsCount} findings`}
        </div>
      </div>
    </div>
  );
}

function StackLegend() {
  const items = [
    { icon: Boxes, name: "Argo CD", role: "GitOps sync", color: "text-blue-400", bg: "bg-blue-500/10" },
    { icon: Rocket, name: "Argo Rollouts", role: "Canary + traffic shift", color: "text-amber-400", bg: "bg-amber-500/10" },
    { icon: Activity, name: "Prometheus", role: "SLO metrics", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { icon: Bot, name: "K8sGPT + GLM-4.5", role: "Real LLM diagnosis", color: "text-purple-400", bg: "bg-purple-500/10" },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(({ icon: Icon, name, role, color, bg }) => (
        <div
          key={name}
          className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
        >
          <div className={`flex h-7 w-7 items-center justify-center rounded-md ${bg} ${color}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-zinc-200">{name}</div>
            <div className="truncate text-[10px] uppercase tracking-wider text-zinc-500">
              {role}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main 2-col grid                                                    */
/* ------------------------------------------------------------------ */

function MainGrid({ state }: { state: ClusterState }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
      <div className="flex flex-col gap-4 lg:gap-5">
        <ArgoSyncCard state={state.argoCdSync} phase={state.phase} />
        <RolloutsTrafficCard
          state={state.argoRollouts}
          traffic={state.traffic}
          phase={state.phase}
          pods={state.pods}
        />
        <KubeApiEvidence state={state} />
      </div>
      <div className="flex flex-col gap-4 lg:gap-5">
        <PrometheusMetricsCard metrics={state.metrics} slo={state.slo} />
        <K8sGPTTerminalCard phase={state.phase} findings={state.findings} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KubeApiEvidence — real pod + rollout state read from the cluster             */
/* ------------------------------------------------------------------ */

function KubeApiEvidence({ state }: { state: ClusterState }) {
  const canaryBroken =
    state.phase === "anomaly" ||
    state.phase === "analyzing" ||
    state.phase === "rollback";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-800 text-zinc-300">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
              kube-apiserver · payment-prod
            </h2>
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">
              live k8s api responses
            </p>
          </div>
        </div>
        <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
          GET /api/v1/…
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CodeBlock
          title="kubectl get rollout payments-api -o wide  # live"
          lines={[
            `TRACK    READY   IMAGE                STATUS`,
            `stable   ${state.pods.stable.ready}/${state.pods.stable.desired}     ${state.pods.stable.image}    Running`,
            `canary   ${state.pods.canary.ready}/${state.pods.canary.desired}     ${state.pods.canary.image}    ${state.pods.canary.phase}`,
          ]}
          highlight={canaryBroken ? ["canary"] : []}
        />
        <CodeBlock
          title="kubectl argo rollouts get rollout payments-api"
          lines={[
            `Name:            payments-api`,
            `Namespace:       payment-prod`,
            `Status:          ${state.argoRollouts.phase}`,
            `Message:         ${state.argoRollouts.phase === "Paused" ? "CanaryPauseStep" : "—"}`,
            `Strategy:        Canary`,
            `  Step:          ${state.argoRollouts.currentStep >= 0 ? state.argoRollouts.currentStep + 1 + "/5" : "—"}`,
            `  Weight:        ${state.argoRollouts.canaryWeight}% canary / ${state.argoRollouts.stableWeight}% stable`,
            `Images:          ${state.argoRollouts.stableImage} (stable)`,
            `                 ${state.argoRollouts.canaryImage} (canary)`,
          ]}
        />
      </div>
    </div>
  );
}

function CodeBlock({
  title,
  lines,
  highlight = [],
}: {
  title: string;
  lines: string[];
  highlight?: string[];
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        $ {title}
      </div>
      <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              highlight.some((h) => line.startsWith(h.split("-")[0].slice(0, 24)))
                ? "text-red-300"
                : line.startsWith("NAME") || line.startsWith("Name:") || line.startsWith("Status:") || line.startsWith("Strategy:") || line.startsWith("Images:")
                  ? "text-zinc-300"
                  : "text-zinc-400"
            }
          >
            {line || "\u00A0"}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function Footer({ state }: { state: ClusterState | null }) {
  return (
    <footer className="mt-8 border-t border-zinc-800 pt-5 text-[11px] text-zinc-500">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Database className="h-3 w-3" />
          backed by: live kube-apiserver via KUBECONFIG · prometheus (/api/prometheus) · glm-4.5 via z-ai-web-dev-sdk (/api/explain)
        </div>
        <div className="flex items-center gap-3">
          {state && (
            <span className="font-mono text-zinc-600">
              {`ts: ${new Date(state.timestamp).toLocaleTimeString("en-US", { hour12: false })}`}
            </span>
          )}
          <span className="text-zinc-700">·</span>
          <span className="flex items-center gap-1">
            <Cpu className="h-2.5 w-2.5" />
            state:{" "}
            <span className="font-mono text-zinc-400">
              {state?.phase ?? "—"}
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
