import { z } from "zod";
import { withTx, query } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";

export const AddPersonInput = z.object({
  entraObjectId: z.string().uuid().optional(),
  email: z.string().email(),
  displayName: z.string().min(1),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  office: z.string().optional(),
  roleCode: z.enum(["executive", "admin", "capex_pm", "contracts_admin", "design_lead", "finance", "operations", "viewer"]),
  scopeKind: z.enum(["all", "region", "property", "project"]),
  scopeIds: z.array(z.string().uuid()).default([]),
  approvalLimit: z.coerce.number().nonnegative().nullable().optional(),
});

/** Directory search through the signed-in user's delegated token (User.ReadBasic.All). */
export async function searchDirectory(accessToken: string, q: string) {
  const safe = q.replace(/'/g, "''").slice(0, 60);
  const url =
    `https://graph.microsoft.com/v1.0/users?$top=15&$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation` +
    `&$filter=${encodeURIComponent(`startswith(displayName,'${safe}') or startswith(mail,'${safe}') or startswith(surname,'${safe}')`)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Directory search failed: ${r.status}`);
  const j = await r.json();
  return (j.value as any[]).map((u) => ({
    entraObjectId: u.id as string,
    displayName: u.displayName as string,
    email: (u.mail ?? u.userPrincipalName) as string,
    jobTitle: u.jobTitle as string | null,
    department: u.department as string | null,
    office: u.officeLocation as string | null,
  }));
}

/**
 * Add people (section 5.1, steps 1–3 in the app). Entra group membership, SharePoint access,
 * Teams channels and the welcome message run in the worker once IT has approved the
 * GroupMember.ReadWrite.All permission; each is queued here so nothing is forgotten.
 */
export async function addPerson(actor: Actor, raw: unknown) {
  assertCan(actor, "people.manage");
  const i = AddPersonInput.parse(raw);
  if (i.roleCode === "executive" && !actor.has("executive")) throw new Error("Only an executive can add another executive");
  return withTx(actor.userId, async (c) => {
    const u = (
      await c.query(
        `insert into app_user (entra_object_id, email, display_name, job_title, department, office, kind, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,'employee',$7,$7)
         on conflict (email) do update set display_name = excluded.display_name, job_title = excluded.job_title,
           department = excluded.department, office = excluded.office, is_active = true, updated_at = now(), updated_by = excluded.updated_by
         returning id`,
        [i.entraObjectId ?? null, i.email, i.displayName, i.jobTitle ?? null, i.department ?? null, i.office ?? null, actor.userId],
      )
    ).rows[0];
    await c.query(
      `insert into user_role (user_id, role_id, scope_kind, scope_ids, approval_limit, created_by)
       select $1, r.id, $3, $4, $5, $6 from role r where r.code = $2`,
      [u.id, i.roleCode, i.scopeKind, i.scopeIds, i.approvalLimit ?? null, actor.userId],
    );
    await c.query(
      `insert into task (title, assignee_user_id, related_type, related_id, status, created_by)
       values ('Provision Entra group, SharePoint and Teams access; send welcome', null, 'app_user', $1, 'queued', $2)`,
      [u.id, actor.userId],
    );
    return { userId: u.id as string };
  });
}

export async function deactivatePerson(actor: Actor, userId: string, reassignTo: string) {
  assertCan(actor, "people.manage");
  return withTx(actor.userId, async (c) => {
    await c.query(`update app_user set is_active = false, updated_at = now(), updated_by = $2 where id = $1`, [userId, actor.userId]);
    await c.query(`update user_role set ends_on = current_date where user_id = $1 and ends_on is null`, [userId]);
    await c.query(`update task set assignee_user_id = $2 where assignee_user_id = $1 and status <> 'done'`, [userId, reassignTo]);
    await c.query(`update approval set approver_user_id = $2 where approver_user_id = $1 and decision is null`, [userId, reassignTo]);
  });
}

export async function peopleList() {
  return query(
    `select u.id, u.display_name, u.email, u.job_title, u.is_active, u.last_sign_in_at,
            string_agg(distinct r.name, ', ') roles, max(ur.approval_limit) approval_limit,
            string_agg(distinct ur.scope_kind, ', ') scopes
       from app_user u left join user_role ur on ur.user_id = u.id and (ur.ends_on is null or ur.ends_on >= current_date)
       left join role r on r.id = ur.role_id
      where u.kind = 'employee'
      group by u.id order by u.is_active desc, u.display_name`,
  );
}
