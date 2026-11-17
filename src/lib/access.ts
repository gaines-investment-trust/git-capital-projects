import { query } from "./db";

/**
 * Who is acting, what roles they hold, and which properties they may see (build prompt section 5).
 * Built once per request from user_role rows; enforced in services, not only in screens.
 */
export type Grant = { role: string; scopeKind: "all" | "region" | "property" | "project"; scopeIds: string[]; approvalLimit: number | null };

export class Actor {
  constructor(
    public userId: string,
    public email: string,
    public displayName: string,
    public grants: Grant[],
    private permissionsByRole: Record<string, string[]>,
  ) {}

  get roles() {
    return [...new Set(this.grants.map((g) => g.role))];
  }

  has(role: string) {
    return this.roles.includes(role);
  }

  /** Permission codes support "*" and prefix wildcards like "rfp.*". */
  can(permission: string): boolean {
    for (const r of this.roles) {
      for (const p of this.permissionsByRole[r] ?? []) {
        if (p === "*" || p === permission) return true;
        if (p.endsWith(".*") && permission.startsWith(p.slice(0, -1))) return true;
      }
    }
    return false;
  }

  get seesAll() {
    return this.grants.some((g) => g.scopeKind === "all");
  }

  canAccessProperty(propertyId: string, regionId: string | null): boolean {
    return this.grants.some(
      (g) =>
        g.scopeKind === "all" ||
        (g.scopeKind === "property" && g.scopeIds.includes(propertyId)) ||
        (g.scopeKind === "region" && regionId !== null && g.scopeIds.includes(regionId)),
    );
  }

  /** Highest money approval limit across grants; Infinity for executives with no limit set. */
  get approvalLimit(): number {
    let best = 0;
    for (const g of this.grants) {
      if (g.role === "executive" && g.approvalLimit === null) return Infinity;
      if (g.approvalLimit !== null) best = Math.max(best, g.approvalLimit);
    }
    return best;
  }
}

export class AccessDenied extends Error {}

export function assertCan(actor: Actor, permission: string) {
  if (!actor.can(permission)) throw new AccessDenied(`Not allowed: ${permission}`);
}

/** SQL fragment restricting a property alias to the actor's scope. */
export function scopeFilterSql(actor: Actor, propertyAlias: string): { sql: string; params: unknown[] } {
  if (actor.seesAll) return { sql: "true", params: [] };
  const props = actor.grants.filter((g) => g.scopeKind === "property").flatMap((g) => g.scopeIds);
  const regions = actor.grants.filter((g) => g.scopeKind === "region").flatMap((g) => g.scopeIds);
  return {
    sql: `(${propertyAlias}.id = any($1::uuid[]) or ${propertyAlias}.region_id = any($2::uuid[]))`,
    params: [props, regions],
  };
}

export async function loadActor(userId: string): Promise<Actor | null> {
  const rows = await query<any>(
    `select u.id, u.email, u.display_name, u.is_active, r.code role, ur.scope_kind, ur.scope_ids, ur.approval_limit, r.permissions
       from app_user u
       left join user_role ur on ur.user_id = u.id and (ur.ends_on is null or ur.ends_on >= current_date)
       left join role r on r.id = ur.role_id
      where u.id = $1`,
    [userId],
  );
  if (!rows.length || !rows[0].is_active) return null;
  const perms: Record<string, string[]> = {};
  const grants: Grant[] = [];
  for (const r of rows) {
    if (!r.role) continue;
    perms[r.role] = r.permissions;
    grants.push({ role: r.role, scopeKind: r.scope_kind, scopeIds: r.scope_ids ?? [], approvalLimit: r.approval_limit === null ? null : Number(r.approval_limit) });
  }
  return new Actor(rows[0].id, rows[0].email, rows[0].display_name, grants, perms);
}
