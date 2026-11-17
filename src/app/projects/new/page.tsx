import { requireActor } from "@/auth";
import { query } from "@/lib/db";
import { scopeFilterSql } from "@/lib/access";
import { Shell } from "../../shell";
import { NewProjectForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewProject() {
  const actor = await requireActor();
  const { sql, params } = scopeFilterSql(actor, "p");
  const [properties, types, managers] = await Promise.all([
    query<any>(`select p.id, p.code, p.name, p.state from property p where p.status = 'active' and ${sql} order by p.code`, params),
    query<any>(`select code, name from project_type where is_active order by name`),
    query<any>(
      `select distinct u.id, u.display_name from app_user u join user_role ur on ur.user_id = u.id join role r on r.id = ur.role_id
        where u.is_active and r.code in ('capex_pm','executive','design_lead') order by u.display_name`,
    ),
  ]);
  return (
    <Shell actor={actor} active="new">
      <h1>New project</h1>
      <div className="muted">Creates the project ID, the SharePoint folder tree, a default schedule and budget lines for the project type.</div>
      {properties.length === 0 ? (
        <div className="notice info">Add a property first in Admin › Properties.</div>
      ) : (
        <NewProjectForm properties={properties} types={types} managers={managers} me={actor.userId} />
      )}
    </Shell>
  );
}
