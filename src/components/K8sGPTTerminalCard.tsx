"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Terminal as TerminalIcon, Loader2, Cpu } from "lucide-react";
import type { ClusterState, LlmDiagnosis } from "@/hooks/use-cluster-state";
import { fetchDiagnosis } from "@/hooks/use-cluster-state";

interface Props {
  phase: ClusterState["phase"];
  findings: ClusterState["findings"];
}

interface TerminalLine {
  kind: "command" | "output" | "finding" | "llm" | "fix";
  text: string;
}

export function K8sGPTTerminalCard({ phase, findings }: Props) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [diagnosis, setDiagnosis] = useState<LlmDiagnosis | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastPhaseRef = useRef<string>("idle");

  // When phase transitions into analyzing, run the real analyzer + LLM
  useEffect(() => {
    if (phase === "analyzing" && lastPhaseRef.current !== "analyzing") {
      runAnalyzer();
    }
    if (phase === "idle") {
      setLines([]);
      setDiagnosis(null);
      setError(null);
    }
    lastPhaseRef.current = phase;
  }, [phase]);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, diagnosis]);

  async function runAnalyzer() {
    setLines([]);
    setError(null);
    setDiagnosis(null);

    const cmds: TerminalLine[] = [
      { kind: "command", text: "$ k8sgpt analyze --namespace payment-prod --explain --output json" },
      { kind: "output", text: "" },
      { kind: "output", text: "INFO: activating analyzers: pod, deployment, service, ingress, pvc, node, rollout, log" },
      { kind: "output", text: "INFO: connecting to kube-apiserver (https://kubernetes.default.svc)" },
      { kind: "output", text: "INFO: 14 analyzers registered, 8 relevant to namespace payment-prod" },
      { kind: "output", text: "" },
    ];

    // Stream the command preamble
    for (const line of cmds) {
      await sleep(150);
      setLines((prev) => [...prev, line]);
    }

    // Fetch the analyzer results (real analyzer on /api/analyze)
    try {
      const res = await fetch("/api/analyze", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setLines((prev) => [
        ...prev,
        { kind: "output", text: `INFO: analyzer complete — ${data.problems} problems detected in ${data.durationMs ?? 126}ms` },
        { kind: "output", text: `INFO: routing ${data.problems} findings to LLM (glm-4.5 via z-ai-web-dev-sdk)` },
        { kind: "output", text: "" },
      ]);

      // Stream each finding
      for (const finding of data.results) {
        await sleep(400);
        setLines((prev) => [
          ...prev,
          {
            kind: "finding",
            text: `[${finding.severity.toUpperCase()}] ${finding.kind}: ${finding.name} — ${finding.error[0].Text}`,
          },
        ]);
      }

      await sleep(500);
      setLines((prev) => [
        ...prev,
        { kind: "output", text: "" },
        { kind: "command", text: "$ k8sgpt explain --backend glm-4.5 --cache" },
        { kind: "output", text: "" },
      ]);

      // Now make the REAL LLM call
      setDiagnosing(true);
      const diag = await fetchDiagnosis(findings.length > 0 ? findings : data.results);
      setDiagnosis(diag);
      setDiagnosing(false);

      // Stream the LLM output line by line, mimicking token streaming
      const diagLines = diag.content.split("\n").filter((l) => l.trim());
      for (const line of diagLines) {
        await sleep(120);
        setLines((prev) => [...prev, { kind: "llm", text: line }]);
      }

      await sleep(400);
      setLines((prev) => [
        ...prev,
        { kind: "output", text: "" },
        {
          kind: "fix",
          text: `✓ AI diagnosis complete (cached=${diag.cached}, model=${diag.model})`,
        },
        { kind: "fix", text: "✓ triggering automated rollback via Argo Rollouts" },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLines((prev) => [
        ...prev,
        { kind: "output", text: `ERROR: ${msg}` },
      ]);
    }
  }

  const active = phase === "analyzing" || phase === "anomaly";
  const done = phase === "rollback";

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
          {diagnosing && (
            <span className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              GLM-4.5 THINKING
            </span>
          )}
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
      <div
        ref={scrollRef}
        className="terminal-scroll h-[360px] overflow-y-auto bg-zinc-950/80 p-4 font-mono text-[12px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-zinc-600">
            <span className="text-emerald-500">k8sgpt@production</span>
            <span className="text-zinc-500">:</span>
            <span className="text-blue-400">~</span>
            <span className="text-zinc-500">$ </span>
            <span className="text-zinc-600">
              awaiting prometheus slo violation…
            </span>
            {phase === "idle" && <span className="terminal-cursor" />}
          </div>
        ) : (
          <div className="space-y-0.5">
            {lines.map((line, i) => (
              <Line key={i} line={line} />
            ))}
            {diagnosing && (
              <div className="flex items-center gap-2 text-amber-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-zinc-500">
                  awaiting glm-4.5 response via z-ai-web-dev-sdk…
                </span>
                <span className="terminal-cursor" />
              </div>
            )}
            {active && !diagnosing && <span className="terminal-cursor" />}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Cpu className="h-2.5 w-2.5" />
            backend: glm-4.5
          </span>
          <span className="text-zinc-700">·</span>
          <span>analyzers: 14</span>
          <span className="text-zinc-700">·</span>
          <span>namespace: payment-prod</span>
        </div>
        <div className="flex items-center gap-3">
          {diagnosis && (
            <button
              onClick={() => setShowJson((v) => !v)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              {showJson ? "hide json" : "view raw json"}
            </button>
          )}
          {error && <span className="text-red-400">error</span>}
          <span className="flex items-center gap-1.5">
            <motion.span
              className={`h-1.5 w-1.5 rounded-full ${
                active ? "bg-amber-400" : done ? "bg-emerald-400" : "bg-zinc-600"
              }`}
              animate={active ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
              transition={
                active
                  ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
            />
            <span>
              {active ? "streaming" : done ? "stream closed" : "ready"}
            </span>
          </span>
        </div>
      </div>

      {/* Raw JSON expandable panel */}
      {diagnosis && showJson && (
        <div className="border-t border-zinc-800 bg-zinc-950/90 p-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
            k8sgpt analyze --output json — structured result
          </div>
          <pre className="terminal-scroll max-h-48 overflow-auto font-mono text-[10px] leading-relaxed text-zinc-400">
{JSON.stringify(
  {
    provider: "glm-4.5",
    status: "ProblemDetected",
    problems: findings.length,
    cached: diagnosis.cached,
    timestamp: diagnosis.timestamp,
    results: findings.map((f) => ({
      kind: f.kind,
      name: f.name,
      severity: f.severity,
      error: [{ Text: f.error }],
      suggestedFix: f.suggestedFix,
    })),
  },
  null,
  2,
)}
          </pre>
        </div>
      )}
    </div>
  );
}

function Line({ line }: { line: TerminalLine }) {
  if (line.kind === "command") {
    return (
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-zinc-300"
      >
        {line.text}
      </motion.div>
    );
  }
  if (line.kind === "output") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-zinc-500"
      >
        {line.text || "\u00A0"}
      </motion.div>
    );
  }
  if (line.kind === "finding") {
    return (
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-red-300"
      >
        <span className="mr-2 select-none text-red-500">⚠</span>
        {line.text}
      </motion.div>
    );
  }
  if (line.kind === "llm") {
    // Highlight section headers (Root Cause:, Evidence:, etc.)
    const isHeader = /^(Root Cause|Evidence|Impact|Recommended Action|Diagnosis):/.test(line.text);
    const isStep = /^\d+\.\s/.test(line.text);
    const isBullet = /^-\s/.test(line.text);
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={
          isHeader
            ? "mt-1 font-semibold text-emerald-300"
            : isStep
              ? "pl-2 text-zinc-300"
              : isBullet
                ? "pl-2 text-zinc-400"
                : "text-zinc-300"
        }
      >
        {isHeader && <span className="mr-1.5 text-emerald-500">✦</span>}
        {line.text}
      </motion.div>
    );
  }
  // fix
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-emerald-300"
    >
      {line.text}
    </motion.div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
