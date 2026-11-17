import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/auth";
import { rfpDetail } from "@/services/rfps";
import { approvalTrail, myOpenApprovals } from "@/services/approvals";
import { listVendors, compliance } from "@/services/vendors";
import { query } from "@/lib/db";
import { isoToPacificLocal, pacificLabel } from "@/lib/time";
import { Shell, money } from "../../shell";
import { closeBiddingAction } from "../../award-actions";
import { ScopeForm, BidFormEditor, DatesForm, RequirementsForm, SubmitButton, IssueButton, InviteForm, AnswerForm } from "./forms";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  draft: ["Draft", ""], in_review: ["Waiting for approval", "risk"], approved: ["Approved, ready to issue", "ok"], issued: ["Issued, collecting bids", "ok"], closed: ["Closed", ""], awarded: ["Awarded", "ok"],
};

export default async function RfpPage({ params }: { params: Promise<{ number: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const d = await rfpDetail(actor, decodeURIComponent(number));
  if (!d) notFound();
  const { rfp, project, lines, invitations, questions, checks } = d;
  const [trail, inbox] = await Promise.all([approvalTrail("rfp", rfp.id), myOpenApprovals(actor.userId)]);
  const draft = rfp.status === "draft";
  const editable = draft && actor.can("rfp.edit");
  const blockers = checks.filter((c) => c.level === "blocker");
  const docs = rfp.rfp_document_id ? await query<any>(`select file_name, sp_path from document where id = any($1::uuid[])`, [[rfp.rfp_document_id, rfp.bid_form_document_id]]) : [];

  let vendorRows: any[] = [];
  if (rfp.status === "issued") {
    const all = await listVendors({});
    const invited = new Set(invitations.map((i: any) => i.vendor_id));
    vendorRows = await Promise.all(all.map(async (v: any) => {
      const c = await compliance(v.id, project.state);
      return { id: v.id, name: v.name, trades: v.trades, approved_status: v.approved_status, coi_expires: v.coi_expires, invited: invited.has(v.id), issues: c.issues, canInvite: c.canInvite };
    }));
  }
  const [label, cls] = STATUS[rfp.status] ?? [rfp.status, ""];

  return (
    <Shell actor={actor} active="" approvals={inbox.length}>
      <div className="card spread">
        <div>
          <div className="small muted"><Link href={`/projects/${project.project_code}`}>{project.project_code} · {project.name}</Link> · {project.pname}, {project.state} · Budget {money(project.budget_amount)}</div>
          <h1>{rfp.rfp_number} · {rfp.title}</h1>
          <div className="row" style={{ marginTop: 6 }}><span className={`pill ${cls}`}>{label}</span>{rfp.bid_due_at && <span className="small muted">Bids due {pacificLabel(rfp.bid_due_at)} Pacific</span>}</div>
        </div>
        {draft && <SubmitButton number={rfp.rfp_number} blocked={blockers.length > 0 || !editable} />}
        {rfp.status === "approved" && actor.can("rfp.edit") && <IssueButton number={rfp.rfp_number} />}
        {["issued", "closed", "awarded"].includes(rfp.status) && (
          <div className="row">
            {rfp.status === "issued" && actor.can("rfp.edit") && <form action={closeBiddingAction}><input type="hidden" name="number" value={rfp.rfp_number} /><button className="btn">Close bidding</button></form>}
            <Link className="btn primary" href={`/rfps/${rfp.rfp_number}/leveling`}>Bid leveling and award</Link>
          </div>
        )}
      </div>

      <section className="card">
        <h2>Package check</h2>
        {checks.length === 0 ? <div className="notice ok">Everything required is in place.</div> : checks.map((c) => (
          <div key={c.message} className="row small" style={{ padding: "4px 0" }}><span className={`pill ${c.level === "blocker" ? "late" : "risk"}`}>{c.level === "blocker" ? "Must fix" : "Check"}</span>{c.message}</div>
        ))}
      </section>

      {trail.length > 0 && (
        <section className="card">
          <h2>Approvals</h2>
          {trail.map((a: any) => (
            <div key={a.id} className="small" style={{ padding: "4px 0", borderTop: "1px solid #EEF1F5" }}>
              Step {a.step} · {a.approver_name ?? "awaiting account"} · <b>{a.decision ? a.decision.replace("_", " ") : "waiting"}</b>{a.note ? ` · “${a.note}”` : ""}{a.decided_at ? ` · ${pacificLabel(a.decided_at)}` : ""}
            </div>
          ))}
        </section>
      )}

      {["issued", "closed", "awarded"].includes(rfp.status) && (
        <>
          <section className="card">
            <h2>Issued documents</h2>
            {docs.map((x) => <div key={x.file_name} className="small">{x.file_name} <span className="muted">· {x.sp_path.split("/").slice(-2, -1)[0]}</span></div>)}
          </section>
          <section className="card">
            <h2>Bidders</h2>
            {invitations.length === 0 ? <div className="muted">No one invited yet.</div> : (
              <div className="scroll"><table>
                <thead><tr><th>Vendor</th><th>Sent</th><th>Opened</th><th>Intent</th><th>Bid</th><th className="num">Base total</th></tr></thead>
                <tbody>{invitations.map((i: any) => (
                  <tr key={i.id}>
                    <td>{i.vendor_name}</td><td className="small">{pacificLabel(i.sent_at)}</td><td className="small">{i.opened_at ? pacificLabel(i.opened_at) : "—"}</td>
                    <td>{i.intent === "will_bid" ? <span className="pill ok">Will bid</span> : i.intent === "declined" ? <span className="pill late" title={i.decline_reason}>Declined</span> : <span className="pill">No reply</span>}{i.intent === "declined" && <div className="small muted">{i.decline_reason}</div>}</td>
                    <td>{i.bid_version ? `Version ${i.bid_version}${i.is_late ? " (late)" : ""}` : "—"}</td>
                    <td className="num">{i.bid_total ? money(i.bid_total) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          {rfp.status === "issued" && <section className="card">
            <h2>Invite vendors</h2>
            <InviteForm number={rfp.rfp_number} vendors={vendorRows} />
            <div className="small muted" style={{ marginTop: 6 }}>No vendors yet? <Link href="/vendors">Add them in the vendor directory</Link>.</div>
          </section>}
          <section className="card">
            <h2>Questions and answers</h2>
            {questions.length === 0 ? <div className="muted">No questions yet.</div> : questions.map((q: any) => (
              <div key={q.id} style={{ borderTop: "1px solid #EEF1F5", padding: "10px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <div><b>Q</b> ({q.vendor_name ?? "GIT"}): {q.question}</div>
                {q.answer ? <div><b>A</b>: {q.answer} <span className="small muted">· published {pacificLabel(q.published_at)}</span></div> : <AnswerForm number={rfp.rfp_number} questionId={q.id} />}
              </div>
            ))}
          </section>
        </>
      )}

      <section className="card"><h2>Scope of work</h2><ScopeForm number={rfp.rfp_number} rfp={rfp} disabled={!editable} /></section>
      <section className="card"><h2>Bid form</h2><BidFormEditor number={rfp.rfp_number} lines={lines} disabled={!editable} /></section>
      <section className="card"><h2>Key dates</h2>
        <DatesForm number={rfp.rfp_number} disabled={!editable} v={{
          siteWalkAt: isoToPacificLocal(rfp.site_walk_at), questionsDueAt: isoToPacificLocal(rfp.questions_due_at), bidDueAt: isoToPacificLocal(rfp.bid_due_at),
          targetAwardDate: rfp.target_award_date ?? "", targetStartDate: rfp.target_start_date ?? "",
        }} />
      </section>
      <section className="card"><h2>Requirements</h2><RequirementsForm number={rfp.rfp_number} r={rfp.requirements ?? {}} disabled={!editable} /></section>
    </Shell>
  );
}
