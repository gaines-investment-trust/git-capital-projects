import type { Metadata } from "next";
import { portalView, PortalError } from "@/services/rfps";
import { pacificLabel } from "@/lib/time";
import { IntentForm, AskForm, BidForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gaines Investment Trust · Vendor portal", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let v;
  try {
    v = await portalView(token);
  } catch (e) {
    return (
      <Frame>
        <div className="card"><h1>Link not available</h1><p className="muted">{e instanceof PortalError ? e.message : "Something went wrong."}</p></div>
      </Frame>
    );
  }
  const { invitation: inv, rfp, lines, questions, bid, bidLines, closed } = v;
  const priced = new Map(bidLines.map((b: any) => [b.bid_form_line_id, b]));
  return (
    <Frame vendor={inv.vendor_name}>
      <div className="card">
        <div className="small muted">{rfp.property_name}{rfp.city ? `, ${rfp.city}` : ""}, {rfp.state}</div>
        <h1>{rfp.rfp_number} · {rfp.title}</h1>
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`pill ${closed ? "late" : "ok"}`}>{closed ? "Bids closed" : `Bids due ${pacificLabel(rfp.bid_due_at)} Pacific`}</span>
          {rfp.site_walk_at && <span className="small muted">Site walk {pacificLabel(rfp.site_walk_at)}</span>}
          {rfp.questions_due_at && <span className="small muted">Questions by {pacificLabel(rfp.questions_due_at)}</span>}
        </div>
      </div>

      <section className="card">
        <h2>Will you bid?</h2>
        <IntentForm token={token} intent={inv.intent} />
      </section>

      <section className="card">
        <h2>Scope of work</h2>
        <p style={{ marginTop: 0 }}>{rfp.scope?.summary}</p>
        <ol>{(rfp.scope?.items ?? []).map((x: string) => <li key={x}>{x}</li>)}</ol>
        {rfp.scope?.exclusions && <p><b>Declare these exclusions:</b> {rfp.scope.exclusions}</p>}
        <p className="small muted">The full RFP is attached to your invitation email.</p>
      </section>

      <section className="card">
        <h2>Questions and answers</h2>
        {questions.length === 0 ? <div className="muted">No questions yet.</div> : questions.map((q: any, i: number) => (
          <div key={i} style={{ borderTop: "1px solid #EEF1F5", padding: "8px 0" }}><b>Q:</b> {q.question}<br />{q.answer ? <><b>A:</b> {q.answer}</> : <span className="muted">Waiting for an answer</span>}</div>
        ))}
        {!closed && <AskForm token={token} />}
      </section>

      <section className="card">
        <h2>Your bid{bid ? ` (version ${bid.version} received ${pacificLabel(bid.received_at)})` : ""}</h2>
        {closed ? <div className="muted">Bidding has closed.</div> : (
          <BidForm token={token} lines={lines.map((l: any) => {
            const p: any = priced.get(l.id);
            return { id: l.id, line_no: l.line_no, description: l.description, quantity: l.quantity === null ? null : Number(l.quantity), unit: l.unit, kind: l.kind,
              unitPrice: p?.unit_price ?? null, amount: p?.amount ?? null, excluded: p ? !p.included : false };
          })} scheduleDays={bid?.schedule_days ?? null} warrantyYears={bid?.warranty_years ?? null} exclusions={bid?.exclusions?.[0] ?? ""} />
        )}
      </section>
    </Frame>
  );
}

function Frame({ vendor, children }: { vendor?: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #E1E5EB", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="logo" style={{ background: "#1B3358", color: "#fff" }}>GIT</div>
        <div><b>Gaines Investment Trust</b><div className="small muted">Vendor portal</div></div>
        <div style={{ flex: 1 }} />
        {vendor && <div className="small">{vendor}</div>}
      </header>
      <main style={{ maxWidth: 960, width: "100%", margin: "0 auto", padding: "20px 16px 48px", display: "flex", flexDirection: "column", gap: 16 }}>{children}</main>
    </div>
  );
}
