import Anthropic from "@anthropic-ai/sdk";
import { withTx, one } from "./db";

/**
 * The one door to Claude (architecture 1.5). Every call:
 *  - redacts SSNs and bank/routing numbers before anything leaves (security 2.2),
 *  - logs prompt (redacted), output, model and token use to ai_run (governance, 4.4),
 *  - returns null when no key is configured, so callers fall back to their rule-based results.
 * Nothing Claude returns is sent, signed or paid without a person approving it.
 */

export function redact(text: string): string {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN REDACTED]")
    .replace(/\b(?:routing|aba|rtn)\D{0,12}\d{9}\b/gi, "[ROUTING REDACTED]")
    .replace(/\b(?:account|acct)\s*(?:no\.?|number|#)?\D{0,6}\d{6,17}\b/gi, "[ACCOUNT REDACTED]");
}

export type AiClient = { messages: { create: (args: any) => Promise<any> } };
let injected: AiClient | null = null;
/** Tests inject a fake client; production uses the SDK with ANTHROPIC_API_KEY from Key Vault. */
export function setAiClient(c: AiClient | null) {
  injected = c;
}

function client(): AiClient | null {
  if (injected) return injected;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as AiClient;
}

export function aiEnabled() {
  return !!(injected || process.env.ANTHROPIC_API_KEY);
}

async function modelFor(job: "review" | "classify"): Promise<string> {
  const s = await one<{ value: Record<string, string> }>(`select value from app_setting where key = 'ai.models'`);
  return s?.value?.[job] ?? (job === "review" ? "claude-sonnet-5-5" : "claude-haiku-5-5");
}

/**
 * Ask Claude for a JSON object via a single forced tool call (reliable structured output).
 * Returns { data, runId } or null when AI is not configured.
 */
export async function askJson<T>(opts: {
  job: string; tier: "review" | "classify"; system: string; prompt: string; schema: Record<string, unknown>;
  objectType?: string; objectId?: string; actorUserId?: string | null; maxTokens?: number;
}): Promise<{ data: T; runId: string } | null> {
  const c = client();
  if (!c) return null;
  const model = await modelFor(opts.tier);
  const prompt = redact(opts.prompt);
  let status = "ok";
  let output: any = null;
  let usage: any = {};
  try {
    const res = await c.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      tools: [{ name: "result", description: "Return the result", input_schema: opts.schema }],
      tool_choice: { type: "tool", name: "result" },
      messages: [{ role: "user", content: prompt }],
    });
    usage = res.usage ?? {};
    output = (res.content ?? []).find((b: any) => b.type === "tool_use")?.input ?? null;
    if (!output) status = "no_output";
  } catch (e) {
    status = "error";
    output = { error: e instanceof Error ? e.message : String(e) };
  }
  const run = await withTx(opts.actorUserId ?? null, async (tx) =>
    (await tx.query(
      `insert into ai_run (job, model, object_type, object_id, prompt, output, tokens_in, tokens_out, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [opts.job, model, opts.objectType ?? null, opts.objectId ?? null, prompt, output, usage.input_tokens ?? null, usage.output_tokens ?? null, status, opts.actorUserId ?? null],
    )).rows[0],
  );
  if (status !== "ok") return null;
  return { data: output as T, runId: run.id };
}
