import type { PoolClient } from "pg";
import { z } from "zod";
import { query, one, withTx } from "@/lib/db";
import type { Actor } from "@/lib/access";

export type ChainStep = { role: string; userId: string | null; name: string };

/**
 * Approval chain for an object and amount (section 6.1, confirmed by Joe 2026-11-16):
 *  under $10,000 PM; $10,000–$50,000 PM then COO; over $50,000 PM, COO, President;
 *  awards and contracts always end with the President; overrides need the President.
 */
export async function approvalChain(objectType: string, amount: number, projectManagerId: string | null): Promise<ChainStep[]> {
  const t = await one<{ approver_chain: string[] }>(
    `select approver_chain from approval_threshold
      where object_type = $1 and $2 >= min_amount and ($2 <= max_amount or max_amount is null)
      order by min_amount desc limit 1`,
    [objectType, amount],
  );
  if (!t) throw new Error(`No approval threshold configured for ${objectType} at ${amount}`);
  const steps: ChainStep[] = [];
  for (const role of t.approver_chain) {
    if (role === "capex_pm") {
      const pm = projectManagerId ? await one<{ id: string; display_name: string }>(`select id, display_name from app_user where id = $1`, [projectManagerId]) : null;
      steps.push({ role, userId: pm?.id ?? null, name: pm?.display_name ?? "Project manager" });
    } else {
      const s = await one<{ value: { email: string | null; name: string } }>(`select value from app_setting where key = $1`, [`approver.${role}`]);
      const u = s?.value.email ? await one<{ id: string }>(`select id from app_user where lower(email) = lower($1) and is_active`, [s.value.email]) : null;
      steps.push({ role, userId: u?.id ?? null, name: s?.value.name ?? role });
    }
  }
  return steps;
}

/** Pure version for tests and the UI preview. Amount boundaries match the seeded thresholds. */
export function chainRolesFor(objectType: string, amount: number): string[] {
  if (["award", "contract"].includes(objectType)) return ["capex_pm", "coo", "president"];
  if (objectType === "override") return ["president"];
  if (["rfp", "closeout"].includes(objectType)) return ["capex_pm", "coo"];
  if (amount < 10000) return ["capex_pm"];
  if (amount <= 50000) return ["capex_pm", "coo"];
  return ["capex_pm", "coo", "president"];
}

/**
 * Starts an approval: one row per chain step. Only the lowest undecided step is "current";
 * later approvers see it after earlier ones approve (Procore/Banner-style sequential chain).
 * A chain step with no named person (e.g. President not yet signed in) is still created, with
 * the approver left null, and is shown to executives so it is never silently skipped.
 */
export async function requestApproval(
  c: PoolClient,
  a: { objectType: string; objectId: string; amount: number; projectId: string | null; pmId: string | null; requestedBy: string; summary: string },
) {
  const open = (await c.query(`select 1 from approval where object_type = $1 and object_id = $2 and decision is null limit 1`, [a.objectType, a.objectId])).rows[0];
  if (open) throw new Error("This is already waiting for approval");
  const chain = await approvalChain(a.objectType, a.amount, a.pmId);
  let step = 1;
  for (const s of chain) {
    // The requester's own step counts as their submission when they are that approver.
    const self = s.userId === a.requestedBy && step === 1;
    await c.query(
      `insert into approval (object_type, object_id, step, approver_user_id, decision, note, channel, decided_at, requested_by, summary, amount, project_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [a.objectType, a.objectId, step, s.userId, self ? "approved" : null, self ? "Submitted by approver" : null, self ? "app" : null, self ? new Date() : null,
       a.requestedBy, a.summary, a.amount, a.projectId],
    );
    step++;
  }
  return chain;
}

type Handler = { approved: (c: PoolClient, objectId: string, actor: Actor) => Promise<void>; returned: (c: PoolClient, objectId: string, actor: Actor, note: string) => Promise<void> };
const handlers: Record<string, Handler> = {};
export function onApproval(objectType: string, h: Handler) {
  handlers[objectType] = h;
}

const Decision = z.object({ approvalId: z.string().uuid(), decision: z.enum(["approved", "changes_requested", "discuss"]), note: z.string().trim().optional() });

/** Approve / Request changes / Discuss (principle 6). Everything is logged with channel and time. */
export async function decide(actor: Actor, raw: unknown, channel: "app" | "email" | "phone" | "teams" = "app") {
  const d = Decision.parse(raw);
  return withTx(actor.userId, async (c) => {
    const a = (await c.query(`select * from approval where id = $1 for update`, [d.approvalId])).rows[0];
    if (!a) throw new Error("Approval not found");
    if (a.decision && a.decision !== "discuss") throw new Error("Already decided");
    const earlier = (await c.query(`select 1 from approval where object_type = $1 and object_id = $2 and step < $3 and (decision is null or decision = 'discuss')`, [a.object_type, a.object_id, a.step])).rows[0];
    if (earlier) throw new Error("An earlier approver hasn't decided yet");
    if (a.approver_user_id === null) throw new Error("This step's approver doesn't have an account yet. Add them in Admin › People; the step is assigned to them automatically.");
    if (a.approver_user_id !== actor.userId) throw new Error("This approval is assigned to someone else");
    if (d.decision !== "approved" && !d.note) throw new Error("Add a note so the requester knows what to change or discuss");
    await c.query(`update approval set decision = $2, note = $3, channel = $4, decided_at = now() where id = $1`,
      [a.id, d.decision, d.note ?? null, channel]);
    if (a.project_id) {
      await c.query(`insert into decision_log (project_id, decision, rationale, decided_by, approval_id) values ($1,$2,$3,$4,$5)`, [
        a.project_id, `${a.object_type.replace("_", " ")} ${d.decision.replace("_", " ")} (step ${a.step})`, d.note ?? a.summary, actor.userId, a.id,
      ]);
    }
    const h = handlers[a.object_type];
    if (d.decision === "changes_requested") {
      // Close the remaining steps; the requester revises and resubmits.
      await c.query(`update approval set decision = 'rejected', note = 'Closed: changes requested at step ' || $3, decided_at = now() where object_type = $1 and object_id = $2 and decision is null`, [a.object_type, a.object_id, a.step]);
      if (h) await h.returned(c, a.object_id, actor, d.note!);
      return { status: "returned" as const };
    }
    if (d.decision === "approved") {
      const remaining = (await c.query(`select count(*)::int n from approval where object_type = $1 and object_id = $2 and decision is null`, [a.object_type, a.object_id])).rows[0].n;
      if (remaining === 0) {
        if (h) await h.approved(c, a.object_id, actor);
        return { status: "fully_approved" as const };
      }
      return { status: "next_step" as const };
    }
    return { status: "discuss" as const };
  });
}

/** The "Needs your OK" inbox: only approvals whose earlier steps are all approved. */
export async function myOpenApprovals(userId: string) {
  return query(
    `select a.*, extract(day from now() - coalesce(prev.decided_at, a.requested_at))::int days_waiting, p.project_code, u.display_name requested_by_name
       from approval a
       left join project p on p.id = a.project_id
       left join app_user u on u.id = a.requested_by
       left join lateral (select max(decided_at) decided_at from approval x where x.object_type = a.object_type and x.object_id = a.object_id and x.step < a.step) prev on true
      where (a.decision is null or a.decision = 'discuss')
        and a.approver_user_id = $1
        and not exists (select 1 from approval e where e.object_type = a.object_type and e.object_id = a.object_id and e.step < a.step and (e.decision is null or e.decision <> 'approved'))
      order by a.requested_at`,
    [userId],
  );
}

/** Steps waiting on someone who has no account yet (shown to admins as a warning). */
export async function unassignedApprovals() {
  return query(`select a.*, p.project_code from approval a left join project p on p.id = a.project_id where a.approver_user_id is null and a.decision is null order by requested_at`);
}

/** When a named approver (COO, President) gets an account, hand them their waiting steps. */
export async function assignPendingApprovers(c: PoolClient) {
  const pending = (await c.query(`select id, object_type, amount, step from approval where approver_user_id is null and decision is null`)).rows;
  for (const a of pending) {
    const roles = chainRolesFor(a.object_type, Number(a.amount ?? 0));
    const role = roles[a.step - 1];
    if (!role || role === "capex_pm") continue;
    const u = (await c.query(
      `select u.id from app_setting s join app_user u on lower(u.email) = lower(s.value->>'email') and u.is_active where s.key = $1`,
      [`approver.${role}`],
    )).rows[0];
    if (u) await c.query(`update approval set approver_user_id = $2 where id = $1`, [a.id, u.id]);
  }
}

export async function approvalTrail(objectType: string, objectId: string) {
  return query(
    `select a.*, u.display_name approver_name from approval a left join app_user u on u.id = a.approver_user_id
      where object_type = $1 and object_id = $2 order by requested_at, step`,
    [objectType, objectId],
  );
}
