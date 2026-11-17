import { query, one } from "@/lib/db";

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

export async function myOpenApprovals(userId: string) {
  return query(
    `select a.*, extract(day from now() - a.requested_at)::int days_waiting from approval a
      where a.approver_user_id = $1 and a.decision is null order by a.requested_at`,
    [userId],
  );
}
