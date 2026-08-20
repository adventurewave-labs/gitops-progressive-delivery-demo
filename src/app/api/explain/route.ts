/**
 * LLM explainer endpoint. Calls GLM-4.5 via the z-ai-web-dev-sdk (real
 * LLM, real network call). For each finding returned by /api/analyze,
 * the LLM produces a step-by-step root-cause analysis + remediation plan.
 *
 * Output is the OpenAI-compatible chat-completion shape so the client can
 * either stream tokens (Accept: text/event-stream) or read a single JSON
 * payload. For determinism in the demo, we add a server-side cache:
 * once a finding has been explained, subsequent calls for the same finding
 * text return the cached response (mirrors the extravaganza's
 * zai_cache.json pattern).
 */
import ZAI from "z-ai-web-dev-sdk";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AnalyzeFinding {
  kind: string;
  name: string;
  analyzer: string;
  severity: string;
  error: { Text: string }[];
  suggestedFix?: string;
}

// In-memory cache for the demo. (A real deployment would use Redis / Vercel KV.)
const cache = new Map<string, string>();

function buildPrompt(findings: AnalyzeFinding[]): string {
  const findingsJson = JSON.stringify(
    findings.map((f) => ({
      kind: f.kind,
      name: f.name,
      severity: f.severity,
      error: f.error[0]?.Text,
      suggestedFix: f.suggestedFix,
    })),
    null,
    2,
  );

  return `You are K8sGPT, an AI SRE running inside the production Kubernetes cluster "payment-prod" at ACME Corp. Argo Rollouts has paused a canary deployment of payments-api v2.4 at step 3 (Analysis) because Prometheus detected the canary pods are failing SLOs.

You just ran k8sgpt analyze against the cluster and found ${findings.length} real issues. The canary Deployment (v2.4) has 0/2 ready replicas; the stable Deployment (v2.3) has 4/4 ready replicas.

The analyzer findings, in JSON:

${findingsJson}

Write a root-cause analysis. Use this EXACT format, with no preamble:

Root Cause: <one sentence identifying the most likely cause>

Evidence:
- <bullet 1, citing specific findings from the analyzer output>
- <bullet 2>
- <bullet 3>

Impact: <one sentence on user-facing impact>

Recommended Action:
1. <step 1, with exact kubectl command>
2. <step 2>
3. <step 3>

Diagnosis: <2-3 sentence technical explanation of why v2.4 is failing where v2.3 was healthy, specifically referencing memory limits, the OOMKilled exit code 137, and the canary traffic split>

Be concise. Do not include any text before "Root Cause:" or after the Diagnosis. Use kubectl commands verbatim where possible. Reference specific pod names, deployment names, and exit codes from the findings.`;
}

export async function POST(req: NextRequest) {
  let findings: AnalyzeFinding[];
  try {
    findings = (await req.json()) as AnalyzeFinding[];
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(findings) || findings.length === 0) {
    return NextResponse.json({ error: "findings[] required" }, { status: 400 });
  }

  // Cache key: hash of finding texts. Lets demo re-runs be instant
  // (matches the extravaganza's caching pattern).
  const cacheKey = findings
    .map((f) => f.error[0]?.Text ?? "")
    .join("||")
    .slice(0, 200);

  if (cache.has(cacheKey)) {
    return NextResponse.json({
      content: cache.get(cacheKey),
      cached: true,
      model: "glm-4.5",
      timestamp: new Date().toISOString(),
    });
  }

  const prompt = buildPrompt(findings);

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      model: "glm-4.5",
      messages: [
        {
          role: "system",
          content:
            "You are K8sGPT, an AI SRE assistant. You analyze Kubernetes cluster state and produce concise, technical root-cause analyses with concrete remediation steps. You never speculate beyond what the analyzer output shows you.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const content =
      completion.choices?.[0]?.message?.content ??
      "(no response from LLM)";

    cache.set(cacheKey, content);

    return NextResponse.json({
      content,
      cached: false,
      model: "glm-4.5",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "LLM call failed", detail: msg },
      { status: 500 },
    );
  }
}
