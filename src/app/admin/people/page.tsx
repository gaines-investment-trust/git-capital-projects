import { redirect } from "next/navigation";
import { requireActor } from "@/auth";
import { query } from "@/lib/db";
import { peopleList } from "@/services/people";
import { Shell, money } from "../../shell";
import { AddPersonForm } from "./form";

export const dynamic = "force-dynamic";

export default async function People() {
  const actor = await requireActor();
  if (!actor.can("people.manage")) redirect("/");
  const [people, properties, regions] = await Promise.all([
    peopleList(),
    query<any>(`select id, code, name from property order by code`),
    query<any>(`select id, code, name from region order by name`),
  ]);
  return (
    <Shell actor={actor} active="people">
      <h1>People</h1>
      <div className="muted">Search the Microsoft 365 directory, choose a role and scope, and set an approval limit for roles that approve money.</div>
      <AddPersonForm properties={properties} regions={regions} />
      <section className="card scroll">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Scope</th><th className="num">Approval limit</th><th>Last sign-in</th><th>Status</th></tr></thead>
          <tbody>{people.map((p: any) => (
            <tr key={p.id}><td><b>{p.display_name}</b><div className="small muted">{p.job_title}</div></td><td>{p.email}</td><td>{p.roles ?? "—"}</td><td>{p.scopes ?? "—"}</td>
              <td className="num">{p.approval_limit === null ? (p.roles?.includes("Executive") ? "No limit" : "—") : money(p.approval_limit)}</td>
              <td className="small">{p.last_sign_in_at ? new Date(p.last_sign_in_at).toLocaleString("en-US") : "Never"}</td>
              <td><span className={`pill ${p.is_active ? "ok" : "late"}`}>{p.is_active ? "Active" : "Deactivated"}</span></td></tr>
          ))}</tbody>
        </table>
      </section>
    </Shell>
  );
}
