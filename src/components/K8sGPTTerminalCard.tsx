"use client";

import { motion } from "framer-motion";
import { Bot, Terminal as TerminalIcon } from "lucide-react";
import type { DemoState } from "@/lib/demo-state";

interface K8sGPTTerminalCardProps {
  state: DemoState;
  /** Lines of the K8sGPT stream that have already been printed. */
  visibleLines: string[];
  /** Whether the terminal cursor should currently blink. */
  cursorActive: boolean;
}

/**
 * K8sGPT terminal panel. Black mac-style window with traffic-light dots
 * on top, monospace body. Stays empty until the anomaly fires, then
 * streams the AI diagnosis line-by-line with a blinking cursor.
 */
export function K8sGPTTerminalCard({
  state,
  visibleLines,
  cursorActive,
}: K8sGPTTerminalCardProps) {
  const active = state === "analyzing" || state === "anomaly";
  const done = state === "rollback";

  return (
    <div
      className={`rounded-xl border bg-zinc-900/70 backdrop-blur transition-colors ${
        active
          ? "border-amber-500/50"
          : done
            ? "border-emerald-500/40"
            : "border-zinc-800"
      }`}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-500/80" />
          <span className="h-3 w-3 rounded-full bg-amber-500/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
        </div>
        <div className="ml-2 flex items-center gap-2 text-[11px] uppercase tracking-widest text-zinc-500">
          <TerminalIcon className="h-3 w-3" />
          <span>k8sgpt — analyze — zsh — 100×24</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium tracking-wide ${
              active
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : done
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-800/60 text-zinc-500"
            }`}
          >
            <Bot className="h-3 w-3" />
            {active ? "ANALYZING" : done ? "ANALYSIS COMPLETE" : "IDLE"}
          </span>
        </div>
      </div>

      {/* Terminal body */}
      <div className="terminal-scroll h-[300px] overflow-y-auto bg-zinc-950/80 p-4 font-mono text-[12px] leading-relaxed">
        {visibleLines.length === 0 ? (
          <div className="text-zinc-600">
            <span className="text-emerald-500">k8sgpt@production</span>
            <span className="text-zinc-500">:</span>
            <span className="text-blue-400">~</span>
            <span className="text-zinc-500">$ </span>
            <span className="text-zinc-600">awaiting trigger…</span>
            {state === "idle" && (
              <span className="terminal-cursor" />
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleLines
              .filter((l): l is string => typeof l === "string")
              .map((line, i, arr) => (
                <Line key={i} text={line} index={i} isLast={i === arr.length - 1} />
              ))}
            {cursorActive && <span className="terminal-cursor" />}
          </div>
        )}
      </div>

      {/* Footer status line */}
      <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <div className="flex items-center gap-3">
          <span>backend: openai</span>
          <span className="text-zinc-700">·</span>
          <span>namespace: production</span>
          <span className="text-zinc-700">·</span>
          <span>integrations: argo-rollouts, prometheus</span>
        </div>
        <div className="flex items-center gap-1.5">
          <motion.span
            className={`h-1.5 w-1.5 rounded-full ${
              active
                ? "bg-amber-400"
                : done
                  ? "bg-emerald-400"
                  : "bg-zinc-600"
            }`}
            animate={
              active
                ? { opacity: [1, 0.3, 1] }
                : { opacity: 1 }
            }
            transition={
              active
                ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.2 }
            }
          />
          <span>
            {active ? "streaming" : done ? "stream closed" : "ready"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Render a single streamed terminal line with appropriate coloring. */
function Line({
  text,
  isLast,
}: {
  text: string;
  index: number;
  isLast: boolean;
}) {
  // Color-code by content for that authentic CLI feel.
  // Guard against any undefined / non-string entry that could slip in during
  // HMR or fast-refresh re-renders.
  const line = typeof text === "string" ? text : "";
  let prefix: string | null = null;
  let color = "text-zinc-300";

  if (line.startsWith("K8sGPT Analyzer triggered")) {
    prefix = "▶";
    color = "text-amber-400";
  } else if (line.startsWith("Scanning namespace")) {
    prefix = "→";
    color = "text-blue-400";
  } else if (line.startsWith("Fetching pod logs")) {
    prefix = "→";
    color = "text-blue-400";
  } else if (line.startsWith("Detected anomaly")) {
    prefix = "⚠";
    color = "text-red-400";
  } else if (line.startsWith("Correlating")) {
    prefix = "→";
    color = "text-blue-400";
  } else if (line.startsWith("AI Diagnosis")) {
    prefix = "✦";
    color = "text-emerald-300";
  } else if (line.startsWith("Recommended Action")) {
    prefix = "✦";
    color = "text-amber-300";
  } else if (line.startsWith("Executing")) {
    prefix = "✓";
    color = "text-emerald-400";
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`flex gap-2 ${color}`}
    >
      {prefix && (
        <span className="select-none text-zinc-600">{prefix}</span>
      )}
      <span className="whitespace-pre-wrap break-words">{line}</span>
      {isLast && <span className="terminal-cursor" />}
    </motion.div>
  );
}
