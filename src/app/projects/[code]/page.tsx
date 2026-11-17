import { notFound } from "next/navigation";
import { requireActor } from "@/auth";
import { getProjectByCode } from "@/services/projects";
import { myOpenApprovals } from "@/services/approvals";
import { DOC_TYPES } from "@/lib/naming";
import { Shell, money } from "../../shell";
import { UploadForm } from "./upload";

export const dynamic = "force-dynamic";
const d = (v: any) => (v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireActor();
  const { code } = await params;
  const { created } = await searchParams;
  const data = await getProjectByCode(actor, code);
  if (!data) notFound();
  const { project: p, budget, schedule, decisions, documents } = data;
  const approvals = await myOpenApprovals(actor.userId);
  const tot = (k: string) => budget.reduce((a: number, b: any) => a + Number(b[k] ?? 0), 0);

  return (
    <Shell actor={actor} active="" approvals={approvals.length}>
      {created && <div className="notice ok">Project {p.project_code} created. Its SharePoint folder tree, schedule and budget lines are ready.</div>}
      <div className="card spread">
        <div>
          <div className="small muted">{p.property_name} · {p.state} · {p.type_name} · Manager: {p.manager}</div>
          <h1>{p.project_code} · {p.name}</h1>
          <div className="row" style={{ marginTop: 6 }}><span className="pill">{p.stage_name}</span><span className={`pill ${p.health}`}>{p.health.replace("_", " ")}</span></div>
        </div>
        <div className="small muted">SharePoint folder id: {p.sp_folder_item_id ?? "—"}</div>
      </div>

      <section className="tiles">
        {[["Revised budget", money(tot("revised_budget"))], ["Committed", money(tot("committed"))], ["Invoiced", money(tot("invoiced"))], ["Paid", money(tot("paid"))], ["Forecast", money(tot("forecast"))]].map(([l, v]) => (
          <div key={l} className="card tile"><div className="small muted">{l}</div><div className="v">{v}</div></div>
        ))}
      </section>

      <section className="card">
        <h2>Budget by cost code</h2>
        <div className="scroll"><table>
          <thead><tr><th>Cost code</th><th>Yardi GL / job</th><th className="num">Original</th><th className="num">Approved chg</th><th className="num">Revised</th><th className="num">Committed</th><th className="num">Pending</th><th className="num">Invoiced</th><th className="num">Paid</th><th className="num">Retainage</th><th className="num">Forecast</th><th className="num">Variance</th></tr></thead>
          <tbody>{budget.map((b: any) => (
            <tr key={b.id}><td>{b.code} {b.cost_name}</td><td className="muted">{b.yardi_gl_account ?? "—"} / {b.yardi_job_code ?? "—"}</td>
              <td className="num">{money(b.original_budget)}</td><td className="num">{money(b.approved_changes)}</td><td className="num">{money(b.revised_budget)}</td>
              <td className="num">{money(b.committed)}</td><td className="num">{money(b.pending_changes)}</td><td className="num">{money(b.invoiced)}</td><td className="num">{money(b.paid)}</td>
              <td className="num">{money(b.retainage_held)}</td><td className="num">{money(b.forecast)}</td><td className="num" style={{ color: Number(b.variance) > 0 ? "#A3271B" : undefined }}>{money(b.variance)}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="small muted">Committed, invoiced and paid are calculated from contracts, change orders and pay requests (sprints 4–5).</div>
      </section>

      <section className="card">
        <h2>Schedule</h2>
        <table><thead><tr><th>Task</th><th>Start</th><th>End</th><th>Flags</th><th className="num">% done</th></tr></thead>
          <tbody>{schedule.map((t: any) => (
            <tr key={t.id}><td>{t.kind === "milestone" ? "◆ " : ""}{t.name}</td><td>{d(t.start_date)}</td><td>{d(t.end_date)}</td>
              <td className="small">{[t.is_payment_milestone && "payment milestone", t.is_inspection_hold_point && "inspection hold point"].filter(Boolean).join(" · ")}</td>
              <td className="num">{Number(t.percent_complete)}%</td></tr>
          ))}</tbody></table>
      </section>

      <section className="card">
        <h2>Documents</h2>
        <UploadForm projectCode={p.project_code} docTypes={Object.entries(DOC_TYPES).map(([k, v]) => ({ key: k, label: v.label }))} />
        {documents.length > 0 && (
          <div className="scroll" style={{ marginTop: 12 }}><table>
            <thead><tr><th>File</th><th>Type</th><th>Folder</th><th>Status</th><th>Added</th></tr></thead>
            <tbody>{documents.map((x: any) => (
              <tr key={x.id}><td>{x.file_name}<div className="small muted">from “{x.original_file_name}”</div></td><td>{x.doc_type}</td>
                <td className="small muted">{x.sp_path.split("/").slice(4, -1).join(" / ")}</td><td>{x.filing_status}</td><td>{d(x.created_at)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Decisions</h2>
        {decisions.map((x: any) => <div key={x.id} className="small" style={{ padding: "6px 0", borderTop: "1px solid #EEF1F5" }}><b>{x.decision}</b> · {x.rationale} · {x.by_name} · {d(x.decided_at)}</div>)}
      </section>
    </Shell>
  );
}
