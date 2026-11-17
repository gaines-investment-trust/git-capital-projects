import { notFound } from "next/navigation";
import { requireActor } from "@/auth";
import { getProjectByCode } from "@/services/projects";
import { myOpenApprovals } from "@/services/approvals";
import { DOC_TYPES } from "@/lib/naming";
import { Shell, money } from "../../shell";
import { UploadForm } from "./upload";
import { ScheduleTable, BudgetCell, type TaskRow } from "./editors";
import { scheduleChanges } from "@/services/schedule";
import { saveBaselineAction } from "../../actions";
import { createRfpAction } from "../../rfp-actions";
import { rfpsForProject } from "@/services/rfps";
import Link from "next/link";

export const dynamic = "force-dynamic";
const d = (v: any) => (v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requireActor();
  const { code } = await params;
  const { created } = await searchParams;
  const data = await getProjectByCode(actor, code);
  if (!data) notFound();
  const { project: p, budget, schedule, decisions, documents } = data;
  const [approvals, changes, rfpList] = await Promise.all([myOpenApprovals(actor.userId), scheduleChanges(p.id), rfpsForProject(p.id)]);
  const canEdit = actor.can("project.edit");
  const budgetOpen = canEdit && p.stage_order < 5;
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
        <div className="spread"><h2>RFPs and bidding</h2>
          {actor.can("rfp.create") && <form action={createRfpAction}><input type="hidden" name="projectCode" value={p.project_code} /><button className="btn primary">+ New RFP</button></form>}
        </div>
        {rfpList.length === 0 ? <div className="muted">No RFP yet.</div> : (
          <table><thead><tr><th>RFP</th><th>Status</th><th>Bids due</th><th className="num">Invited</th><th className="num">Bids</th></tr></thead>
            <tbody>{rfpList.map((r: any) => (
              <tr key={r.id}><td><Link href={`/rfps/${r.rfp_number}`} style={{ fontWeight: 600 }}>{r.rfp_number}</Link><div className="small muted">{r.title}</div></td>
                <td>{r.status.replace("_", " ")}</td><td className="small">{r.bid_due_at ? new Date(r.bid_due_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }) : "—"}</td>
                <td className="num">{r.invited}</td><td className="num">{r.submitted}</td></tr>
            ))}</tbody></table>
        )}
      </section>

      <section className="card">
        <h2>Budget by cost code</h2>
        <div className="scroll"><table>
          <thead><tr><th>Cost code</th><th>Yardi GL / job</th><th className="num">Original</th><th className="num">Approved chg</th><th className="num">Revised</th><th className="num">Committed</th><th className="num">Pending</th><th className="num">Invoiced</th><th className="num">Paid</th><th className="num">Retainage</th><th className="num">Forecast</th><th className="num">Variance</th></tr></thead>
          <tbody>{budget.map((b: any) => (
            <tr key={b.id}><td>{b.code} {b.cost_name}</td><td className="muted">{b.yardi_gl_account ?? "—"} / {b.yardi_job_code ?? "—"}</td>
              <td className="num">{budgetOpen ? <BudgetCell lineId={b.id} value={Number(b.original_budget)} projectCode={p.project_code} /> : money(b.original_budget)}</td><td className="num">{money(b.approved_changes)}</td><td className="num">{money(b.revised_budget)}</td>
              <td className="num">{money(b.committed)}</td><td className="num">{money(b.pending_changes)}</td><td className="num">{money(b.invoiced)}</td><td className="num">{money(b.paid)}</td>
              <td className="num">{money(b.retainage_held)}</td><td className="num">{money(b.forecast)}</td><td className="num" style={{ color: Number(b.variance) > 0 ? "#A3271B" : undefined }}>{money(b.variance)}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="row small muted" style={{ marginTop: 8 }}>
          <span>{budgetOpen ? "Split the budget across cost codes until the contract stage; after that, use change orders or contingency." : "Budget is locked at this stage: use change orders or contingency."} Committed, invoiced and paid are calculated from contracts, change orders and pay requests.</span>
          <a className="btn" href={`/api/export/budget/${p.project_code}`}>Export to Excel</a>
        </div>
      </section>

      <section className="card">
        <div className="spread"><h2>Schedule</h2>
          {canEdit && <form action={saveBaselineAction}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="projectCode" value={p.project_code} />
            <button className="btn">{p.baseline_end ? "Re-save baseline" : "Save baseline"}</button></form>}
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>{p.baseline_end ? `Baseline end ${d(p.baseline_end)}; current end ${d(p.planned_end)}.` : "No baseline yet. Save it at contract award; later slips are measured against it."}</div>
        <ScheduleTable tasks={schedule as TaskRow[]} projectCode={p.project_code} canEdit={canEdit} />
        {changes.length > 0 && (
          <details style={{ marginTop: 10 }}><summary className="small">Date changes ({changes.length})</summary>
            {changes.map((c: any) => <div key={c.id} className="small" style={{ padding: "4px 0" }}>{c.task_name}: {d(c.old_end)} → {d(c.new_end)} · “{c.reason}” · {c.by_name}</div>)}
          </details>
        )}
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
