import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/auth";
import { vendorCard } from "@/services/vendors";
import { myOpenApprovals } from "@/services/approvals";
import { pacificLabel } from "@/lib/time";
import { Shell, money } from "../../shell";
import { PaperworkForms } from "../form";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [d, inbox] = await Promise.all([vendorCard(id), myOpenApprovals(actor.userId)]);
  if (!d) notFound();
  const { vendor: v, contacts, cois, licenses, history, compliance } = d;
  return (
    <Shell actor={actor} active="vendors" approvals={inbox.length}>
      <div className="card spread">
        <div>
          <div className="small muted"><Link href="/vendors">Vendors</Link> · {v.short_name}{v.yardi_vendor_id ? ` · Yardi ${v.yardi_vendor_id}` : ""}</div>
          <h1>{v.name}</h1>
          <div className="small muted">{v.trades.join(", ")} · {v.states_served.join(", ")}</div>
        </div>
        <span className={`pill ${compliance.ok ? "ok" : "late"}`}>{compliance.ok ? "Paperwork complete" : `${compliance.issues.length} paperwork item${compliance.issues.length === 1 ? "" : "s"} missing`}</span>
      </div>
      {!compliance.ok && <div className="notice err">{compliance.issues.join(" · ")}. Awards and payments wait until this is complete.</div>}
      <section className="card">
        <h2>Contacts</h2>
        {contacts.map((c: any) => <div key={c.id} className="small" style={{ padding: "4px 0" }}><b>{c.name}</b>{c.is_primary ? " (primary)" : ""} · {c.email}{c.phone ? ` · ${c.phone}` : ""}</div>)}
      </section>
      <section className="card">
        <h2>Insurance and licenses</h2>
        <table><thead><tr><th>Document</th><th>Detail</th><th>Expires</th></tr></thead>
          <tbody>
            {cois.map((c: any) => <tr key={c.id}><td>COI{c.carrier ? ` · ${c.carrier}` : ""}</td><td className="small">GL {money(c.gl_each_occurrence)} / {money(c.gl_aggregate)}</td><td>{c.expires_on}</td></tr>)}
            <tr><td>W-9</td><td className="small">{v.w9_doc_id ? <a href={`/api/documents/${v.w9_doc_id}`}>On file</a> : "Not on file"}</td><td>—</td></tr>
            {licenses.map((l: any) => <tr key={l.id}><td>License · {l.state}</td><td className="small">{l.license_number}</td><td>{l.expires_on ?? "—"}</td></tr>)}
          </tbody>
        </table>
        <div style={{ marginTop: 12 }}><PaperworkForms vendorId={v.id} status={v.approved_status} /></div>
        <div className="small muted" style={{ marginTop: 8 }}>Claude reads uploaded COIs and W-9s and fills these in once the API key is set up. Reminders go out 30, 15 and 0 days before expiry.</div>
      </section>
      <section className="card">
        <h2>Bid history</h2>
        {history.length === 0 ? <div className="muted">No invitations yet.</div> : (
          <table><thead><tr><th>RFP</th><th>Project</th><th>Invited</th><th>Response</th></tr></thead>
            <tbody>{history.map((h: any) => (
              <tr key={h.rfp_number}><td><Link href={`/rfps/${h.rfp_number}`}>{h.rfp_number}</Link><div className="small muted">{h.title}</div></td><td>{h.project_code}</td>
                <td className="small">{pacificLabel(h.sent_at, false)}</td><td>{h.submitted_at ? "Bid submitted" : h.intent === "declined" ? "Declined" : h.intent === "will_bid" ? "Will bid" : "No reply"}</td></tr>
            ))}</tbody></table>
        )}
      </section>
    </Shell>
  );
}
