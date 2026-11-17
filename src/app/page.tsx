import Link from "next/link";
import { requireActor } from "@/auth";
import { portfolio } from "@/services/projects";
import { myOpenApprovals, unassignedApprovals } from "@/services/approvals";
import { query } from "@/lib/db";
import { Inbox, type InboxItem } from "./inbox";
import { Shell, money } from "./shell";
import { ViewTabs, Board, Gantt } from "./views";

export const dynamic = "force-dynamic";

const HEALTH: Record<string, string> = { on_track: "On track", at_risk: "At risk", late: "Late", blocked: "Blocked" };

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = ((await searchParams).view ?? "grid") as string;
  const actor = await requireActor();
  const [rows, approvals, unassigned] = await Promise.all([portfolio(actor), myOpenApprovals(actor.userId), actor.has("admin") ? unassignedApprovals() : Promise.resolve([])]);
  const rfpIds = approvals.filter((a: any) => a.object_type === "rfp").map((a: any) => a.object_id);
  const rfpNumbers = rfpIds.length ? Object.fromEntries((await query<any>(`select id, rfp_number from rfp where id = any($1::uuid[])`, [rfpIds])).map((r) => [r.id, r.rfp_number])) : {};
  const items: InboxItem[] = approvals.map((a: any) => ({ ...a, link: a.object_type === "rfp" ? `/rfps/${rfpNumbers[a.object_id]}` : a.project_code ? `/projects/${a.project_code}` : null }));
  const sum = (k: "budget" | "committed" | "invoiced" | "paid" | "forecast") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const budget = sum("budget"), forecast = sum("forecast");
  const variance = forecast - budget;
  const first = actor.displayName.split(" ")[0];

  return (
    <Shell actor={actor} active="home" approvals={approvals.length}>
      <div className="spread">
        <div>
          <h1>Hello, {first}</h1>
          <div className="muted">{rows.length} active project{rows.length === 1 ? "" : "s"} · {approvals.length} item{approvals.length === 1 ? "" : "s"} need your OK</div>
        </div>
        {actor.can("project.create") && <Link className="btn primary" href="/projects/new">+ New project</Link>}
      </div>

      <section id="needs" className="card">
        <h2>Needs your OK</h2>
        <Inbox items={items} />
        {unassigned.length > 0 && (
          <div className="notice info" style={{ marginTop: 10 }}>
            {unassigned.length} approval step{unassigned.length === 1 ? " is" : "s are"} waiting for someone without an account yet (for example Jeff Gaines as President). Add them in <Link href="/admin/people">People</Link>; the steps are assigned to them automatically.
          </div>
        )}
      </section>

      <section className="tiles">
        {[
          ["Active budget", money(budget)], ["Committed", money(sum("committed"))], ["Invoiced", money(sum("invoiced"))],
          ["Paid", money(sum("paid"))], ["Forecast at completion", money(forecast)], ["Variance", variance === 0 ? "—" : (variance > 0 ? "+" : "") + money(variance)],
        ].map(([l, v]) => (
          <div key={l} className="card tile"><div className="small muted">{l}</div><div className="v" style={l === "Variance" && variance > 0 ? { color: "#A3271B" } : undefined}>{v}</div></div>
        ))}
      </section>

      <section className="card">
        <div className="spread" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>All projects</h2><ViewTabs view={view} /></div>
        {rows.length > 0 && view === "board" ? <Board rows={rows} /> : rows.length > 0 && view === "gantt" ? <Gantt rows={rows as any} /> : rows.length === 0 ? (
          <div className="notice info">No projects yet. {actor.can("project.create") ? <Link href="/projects/new">Create the first one</Link> : "Projects you're assigned to will appear here."}</div>
        ) : (
          <div className="scroll"><table>
            <thead><tr><th>Project</th><th>Property</th><th>Type</th><th>Stage</th><th>Manager</th><th className="num">Budget</th><th className="num">Committed</th><th className="num">Invoiced</th><th className="num">Paid</th><th>Dates</th><th>Health</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/projects/${r.project_code}`} style={{ fontWeight: 600 }}>{r.project_code}</Link><div className="small muted">{r.name}</div></td>
                <td>{r.property_name} · {r.state}</td><td>{r.type_name}</td><td>{r.stage_name}</td><td>{r.manager}</td>
                <td className="num">{money(r.budget)}</td><td className="num">{money(r.committed)}</td><td className="num">{money(r.invoiced)}</td><td className="num">{money(r.paid)}</td>
                <td className="small">{r.planned_start ? new Date(r.planned_start).toLocaleDateString("en-US") : "—"} – {r.planned_end ? new Date(r.planned_end).toLocaleDateString("en-US") : "—"}</td>
                <td><span className={`pill ${r.health}`}>{HEALTH[r.health] ?? r.health}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </Shell>
  );
}
