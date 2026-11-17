import Link from "next/link";
import { requireActor } from "@/auth";
import { portfolio } from "@/services/projects";
import { myOpenApprovals } from "@/services/approvals";
import { Shell, money } from "./shell";
import { ViewTabs, Board, Gantt } from "./views";

export const dynamic = "force-dynamic";

const HEALTH: Record<string, string> = { on_track: "On track", at_risk: "At risk", late: "Late", blocked: "Blocked" };

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = ((await searchParams).view ?? "grid") as string;
  const actor = await requireActor();
  const [rows, approvals] = await Promise.all([portfolio(actor), myOpenApprovals(actor.userId)]);
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
        {approvals.length === 0 ? (
          <div className="muted">Nothing waiting for you.</div>
        ) : (
          <table><tbody>{approvals.map((a: any) => (
            <tr key={a.id}><td><span className="pill">{a.object_type}</span></td><td>{a.object_id}</td><td className="num">{a.days_waiting} days waiting</td></tr>
          ))}</tbody></table>
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
