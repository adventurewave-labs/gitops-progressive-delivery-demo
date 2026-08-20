"use client";

import { motion } from "framer-motion";
import { Shuffle, AlertTriangle, ShieldCheck } from "lucide-react";
import type { ClusterState } from "@/hooks/use-cluster-state";

interface Props {
  state: ClusterState["argoRollouts"];
  traffic: ClusterState["traffic"];
  phase: ClusterState["phase"];
  pods: ClusterState["pods"];
}

export function RolloutsTrafficCard({ state, traffic, phase, pods }: Props) {
  const isAnomaly = phase === "anomaly" || phase === "analyzing";
  const isRollback = phase === "rollback";
  const isPaused = state.phase === "Paused";

  return (
    <div
      className={`rounded-xl border bg-zinc-900/70 p-5 backdrop-blur transition-colors ${
        isAnomaly
          ? "border-red-500/70"
          : isRollback
            ? "border-emerald-500/60"
            : "border-zinc-800"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-md ${
              isAnomaly
                ? "bg-red-500/10 text-red-400"
                : isRollback
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-amber-500/10 text-amber-400"
            }`}
          >
            <Shuffle className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
              Argo Rollouts · Traffic Router
            </h2>
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">
              strategy: canary · step {state.currentStep >= 0 ? state.currentStep + 1 : "—"} of 5
            </p>
          </div>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${
            isPaused
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : isRollback
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700 bg-zinc-800/60 text-zinc-400"
          }`}
        >
          {isPaused
            ? "PAUSED · ANALYZING"
            : isRollback
              ? "ABORTED"
              : phase === "syncing"
                ? "PENDING"
                : "ACTIVE"}
        </span>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-500">
          <span>live traffic split</span>
          <span>
            stable <span className="text-emerald-400">{traffic.stable}%</span>
            <span className="mx-1.5 text-zinc-700">/</span>
            canary{" "}
            <span className={isAnomaly ? "text-red-400" : "text-amber-400"}>
              {traffic.canary}%
            </span>
          </span>
        </div>

        <motion.div
          className="relative h-8 w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-950"
          animate={
            isAnomaly
              ? {
                  boxShadow: [
                    "0 0 0 0 rgba(239,68,68,0.0)",
                    "0 0 0 3px rgba(239,68,68,0.35)",
                    "0 0 0 0 rgba(239,68,68,0.0)",
                  ],
                }
              : {}
          }
          transition={
            isAnomaly
              ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        >
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-500"
            initial={false}
            animate={{ width: `${traffic.stable}%` }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          >
            <div className="flex h-full items-center pl-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-50">
              {traffic.stable > 12 ? `STABLE · ${traffic.stable}%` : ""}
            </div>
          </motion.div>
          <motion.div
            className={`absolute inset-y-0 right-0 ${
              isRollback
                ? "bg-gradient-to-l from-emerald-600 to-emerald-500"
                : "bg-gradient-to-l from-amber-600 to-amber-500"
            }`}
            initial={false}
            animate={{ width: `${traffic.canary}%` }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
          >
            <div className="flex h-full items-center justify-end pr-2 text-[10px] font-semibold uppercase tracking-wider text-amber-50">
              {traffic.canary > 12 ? `CANARY · ${traffic.canary}%` : ""}
            </div>
          </motion.div>
        </motion.div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              stable
            </div>
            <div className="mt-0.5 font-mono text-zinc-200">{state.stableRS}</div>
            <div className="font-mono text-[10px] text-zinc-500">
              {pods.stable.ready}/{pods.stable.desired} pods ready
            </div>
            <div className="font-mono text-[10px] text-zinc-600">
              {pods.stable.image}
            </div>
          </div>
          <div
            className={`rounded-lg border bg-zinc-950/60 p-2.5 ${
              isAnomaly ? "border-red-500/40" : "border-zinc-800"
            }`}
          >
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
              <AlertTriangle
                className={`h-3 w-3 ${
                  isAnomaly ? "text-red-400" : "text-amber-400"
                }`}
              />
              canary
            </div>
            <div className="mt-0.5 font-mono text-zinc-200">{state.canaryRS}</div>
            <div
              className={`font-mono text-[10px] ${
                isAnomaly ? "text-red-400" : "text-zinc-500"
              }`}
            >
              {traffic.canary === 0
                ? "scaled to 0"
                : isAnomaly
                  ? `${pods.canary.phase}`
                  : `${pods.canary.ready}/${pods.canary.desired} pods ready`}
            </div>
            <div className="font-mono text-[10px] text-zinc-600">
              {pods.canary.image}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-zinc-500">
          rollout phases
        </div>
        <div className="flex items-center gap-1.5">
          {[
            { label: "20%", reached: ["canary20", "canary50", "anomaly", "analyzing", "rollback"].includes(phase) },
            { label: "50%", reached: ["canary50", "anomaly", "analyzing"].includes(phase) },
            { label: "analysis", reached: ["anomaly", "analyzing"].includes(phase) },
            { label: "abort", reached: phase === "rollback" },
          ].map((p, i) => {
            const current =
              (i === 0 && phase === "canary20") ||
              (i === 1 && phase === "canary50") ||
              (i === 2 && (phase === "anomaly" || phase === "analyzing")) ||
              (i === 3 && phase === "rollback");
            return (
              <div key={p.label} className="flex flex-1 flex-col items-center">
                <div
                  className={`h-1 w-full rounded-full ${
                    current && isAnomaly
                      ? "bg-red-500"
                      : p.reached
                        ? "bg-emerald-500"
                        : current
                          ? "bg-amber-400"
                          : "bg-zinc-800"
                  }`}
                />
                <span
                  className={`mt-1 font-mono text-[10px] ${
                    current && isAnomaly
                      ? "text-red-400"
                      : p.reached
                        ? "text-emerald-400"
                        : current
                          ? "text-amber-400"
                          : "text-zinc-600"
                  }`}
                >
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
