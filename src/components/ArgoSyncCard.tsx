"use client";

import { motion } from "framer-motion";
import { GitBranch, Server, Check, RefreshCw, ArrowRight } from "lucide-react";
import type { DemoState } from "@/lib/demo-state";

interface ArgoSyncCardProps {
  state: DemoState;
}

/**
 * Argo CD sync view. Shows the Git commit being synced to the in-cluster
 * `payments-api` application. The middle arrow pulses amber while Argo CD
 * is applying manifests, then turns emerald once synced.
 */
export function ArgoSyncCard({ state }: ArgoSyncCardProps) {
  const isSyncing = state === "syncing";
  const isSynced =
    state === "canary20" ||
    state === "canary50" ||
    state === "anomaly" ||
    state === "analyzing" ||
    state === "rollback";

  const isReverted = state === "rollback";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
            <GitBranch className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
              Argo CD · GitOps Sync
            </h2>
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">
              application: payments-api
            </p>
          </div>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${
            isSyncing
              ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
              : isReverted
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : isSynced
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-800/60 text-zinc-400"
          }`}
        >
          {isSyncing
            ? "SYNCING"
            : isReverted
              ? "SYNCED · REVERTED"
              : isSynced
                ? "SYNCED"
                : "HEALTHY"}
        </span>
      </div>

      {/* Body: Git repo -> arrow -> cluster */}
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* Git repo side */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
            <GitBranch className="h-3 w-3" />
            Git Repository
          </div>
          <div className="mt-1.5 font-mono text-sm text-zinc-200">
            adventurewave-labs/payments
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-zinc-400">
            <span className="text-emerald-400">main</span>
            <span className="text-zinc-600">@</span>
            <span className="text-amber-300">a1b2c3d</span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-zinc-500">
            commit: &quot;feat: bump payments-api to v2.4&quot;
          </div>
        </div>

        {/* Arrow / sync indicator */}
        <div className="flex flex-col items-center justify-center px-2">
          <motion.div
            animate={
              isSyncing
                ? { scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }
                : { scale: 1, opacity: 1 }
            }
            transition={
              isSyncing
                ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.2 }
            }
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              isSyncing
                ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                : isSynced
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                  : "border-zinc-700 bg-zinc-800/40 text-zinc-500"
            }`}
          >
            {isSyncing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : isSynced ? (
              <Check className="h-4 w-4" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
          </motion.div>
          <div
            className={`mt-1.5 text-[10px] uppercase tracking-widest ${
              isSyncing
                ? "text-blue-400"
                : isSynced
                  ? "text-emerald-400"
                  : "text-zinc-500"
            }`}
          >
            {isSyncing ? "Applying" : isSynced ? "Synced" : "Idle"}
          </div>
        </div>

        {/* Cluster side */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
            <Server className="h-3 w-3" />
            Kubernetes Cluster
          </div>
          <div className="mt-1.5 font-mono text-sm text-zinc-200">
            payments-api
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-zinc-400">
            <span className="text-zinc-500">ns/</span>
            <span className="text-zinc-300">production</span>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-zinc-500">
            image:{" "}
            <span className="text-zinc-300">
              {isReverted ? "payments:v2.3" : "payments:v2.4"}
            </span>
          </div>
        </div>
      </div>

      {/* Manifest summary */}
      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
          manifest diff
        </div>
        <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-400">
{`- image: payments:v2.3   # stable
+ image: payments:v2.4   # canary
  replicas: 4
  strategy: canary
    steps:
    - setWeight: 20
    - setWeight: 50
    - analysis: prometheus-slo`}
        </pre>
      </div>
    </div>
  );
}
