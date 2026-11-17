import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/auth";
import { level, savedFindings, clarificationDraft } from "@/services/leveling";
import { myOpenApprovals, approvalTrail } from "@/services/approvals";
import { one } from "@/lib/db";
import { Shell, money, unitMoney } from "../../../shell";
import { GapButton, ClarificationForm, AwardForm, RegretsButton } from "./forms";

export const dynamic = "force-dynamic";

export default async function Leveling({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ alt?: string | string[]; plugs?: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const sp = await searchParams;
  const alts = ([] as string[]).concat(sp.alt ?? []);
  const plugs = sp.plugs !== "off";
  let lv;
  try {
    lv = await level(actor, decodeURIComponent(number), { alternates: alts, plugs });
  } catch {
    notFound();
  }
  const { rfp, lines, bidders, recommended, budget } = lv;
  const [findings, inbox, award] = await Promise.all([savedFindings(rfp.id), myOpenApprovals(actor.userId), one<any>(`select a.*, k.contract_number from award a left join contract k on k.award_id = a.id where a.rfp_id = $1`, [rfp.id])]);
  const trail = award ? await approvalTrail("award", award.id) : [];
  const alternates = lines.filter((l: any) => l.kind === "alternate");
  const qs = (a: string[], p: boolean) => `?${[...a.map((x) => `alt=${x}`), ...(p ? [] : ["plugs=off"])].join("&")}`;
  const minLev = bidders.length ? Math.min(...bidders.map((b) => b.leveledTotal)) : 0;

  return (
    <Shell actor={actor} active="" approvals={inbox.length}>
      <div className="card spread">
        <div>
          <div className="small muted"><Link href={`/rfps/${rfp.rfp_number}`}>{rfp.rfp_number}</Link> · <Link href={`/projects/${rfp.project_code}`}>{rfp.project_code}</Link> · budget {money(budget)}</div>
          <h1>Bid leveling · {bidders.length} bid{bidders.length === 1 ? "" : "s"}</h1>
          <div className="small muted">Pattern: Procore bid leveling + Banner bidding. Plugs are GIT estimates (median of other bids) shown separately; they never become contract value.</div>
        </div>
        <span className={`pill ${rfp.status === "awarded" ? "ok" : rfp.status === "closed" ? "risk" : ""}`}>{rfp.status}</span>
      </div>

      <section className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          {alternates.map((l: any) => {
            const on = alts.includes(l.id);
            return <Link key={l.id} className={`btn ${on ? "primary" : ""}`} href={qs(on ? alts.filter((x) => x !== l.id) : [...alts, l.id], plugs)}>{on ? "✓ " : ""}Alternate {l.line_no}</Link>;
          })}
          <Link className={`btn ${plugs ? "primary" : ""}`} href={qs(alts, !plugs)}>{plugs ? "✓ " : ""}Plugs for missing scope</Link>
        </div>
        {bidders.length === 0 ? <div className="muted">No bids yet.</div> : (
          <div className="scroll"><table>
            <thead><tr><th>Line</th>{bidders.map((b) => <th key={b.bidId} className="num">{b.vendor}<div className="small muted" style={{ fontWeight: 400 }}>v{b.version}{b.late ? " · late" : ""}</div></th>)}</tr></thead>
            <tbody>
              {lines.map((l: any) => (
                <tr key={l.id} style={{ background: l.kind === "alternate" && !alts.includes(l.id) ? "#FAFBFC" : undefined }}>
                  <td>{l.line_no} · {l.description}{l.kind !== "base" && <span className="pill" style={{ marginLeft: 6 }}>{l.kind.replace("_", " ")}</span>}</td>
                  {bidders.map((b) => {
                    const c = b.cells[l.id];
                    const text = c.amount !== null ? money(c.amount) : c.unitPrice !== null ? `${unitMoney(c.unitPrice)}/${l.unit}` : c.plug !== null ? `plug ${money(c.plug)}` : c.included ? "—" : "Excluded";
                    return <td key={b.bidId} className="num" style={{ color: c.plug !== null ? "#7A4D00" : !c.included && l.kind === "base" ? "#A3271B" : c.outlier ? "#7A4D00" : undefined, fontStyle: c.plug !== null ? "italic" : undefined }}>{text}{c.outlier && <span title={`${c.outlier} vs median`}> ▲</span>}</td>;
                  })}
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>Base as bid</td>{bidders.map((b) => <td key={b.bidId} className="num">{money(b.baseTotal)}</td>)}</tr>
              <tr><td>Plugs</td>{bidders.map((b) => <td key={b.bidId} className="num" style={{ color: "#7A4D00" }}>{b.plugTotal ? money(b.plugTotal) : "—"}</td>)}</tr>
              <tr><td>Accepted alternates</td>{bidders.map((b) => <td key={b.bidId} className="num">{b.alternatesTotal ? money(b.alternatesTotal) : "—"}</td>)}</tr>
              <tr style={{ fontWeight: 700, background: "#F1F4FA" }}><td>Leveled total</td>{bidders.map((b) => <td key={b.bidId} className="num" style={{ color: b.leveledTotal === minLev ? "#17663F" : undefined }}>{money(b.leveledTotal)}</td>)}</tr>
              <tr><td>Contract value if awarded</td>{bidders.map((b) => <td key={b.bidId} className="num">{money(b.contractValue)}</td>)}</tr>
              <tr><td>Schedule / warranty</td>{bidders.map((b) => <td key={b.bidId} className="num">{b.scheduleDays ? `${b.scheduleDays} days` : "—"} / {b.warrantyYears !== null ? `${b.warrantyYears} yr` : "—"}</td>)}</tr>
              <tr><td>Paperwork</td>{bidders.map((b) => <td key={b.bidId} className="num"><span className={`pill ${b.compliant ? "ok" : "late"}`} title={b.complianceIssues.join("; ")}>{b.compliant ? "Complete" : "Missing items"}</span></td>)}</tr>
            </tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <div className="spread"><h2>Gap analysis</h2><GapButton number={rfp.rfp_number} /></div>
        {findings.length === 0 ? <div className="muted">Run the analysis to list missing scope, exclusions, outliers, late bids and paperwork gaps per bidder.</div> : (
          <>
            {findings.map((f: any) => (
              <div key={f.id} className="row small" style={{ padding: "4px 0", borderTop: "1px solid #EEF1F5" }}>
                <span className={`pill ${f.severity === "gap" ? "late" : f.severity === "warning" ? "risk" : ""}`}>{f.severity}</span><b>{f.vendor}</b>{f.finding}{f.source === "claude" && <span className="pill">Claude</span>}
              </div>
            ))}
            <h2 style={{ marginTop: 16 }}>Clarification emails</h2>
            <div className="small muted" style={{ marginBottom: 8 }}>One per bidder, listing only that bidder's open items. Edit before sending; it goes from your Outlook.</div>
            {bidders.map((b) => {
              const items = findings.filter((f: any) => f.vendor_id === b.vendorId && !/^Paperwork/.test(f.finding)).map((f: any) => f.finding);
              if (!items.length) return null;
              const d = clarificationDraft(b.vendor, rfp.rfp_number, rfp.title, items);
              return <ClarificationForm key={b.vendorId} number={rfp.rfp_number} vendorId={b.vendorId} vendor={b.vendor} subject={d.subject} body={d.body} />;
            })}
          </>
        )}
      </section>

      <section className="card">
        <h2>Award</h2>
        {award ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div>Status: <b>{award.status.replace(/_/g, " ")}</b> · contract value {money(award.contract_value)}{award.alternates_accepted?.length ? ` · alternates ${award.alternates_accepted.join(", ")}` : ""}</div>
            <div className="small">“{award.memo}”</div>
            {trail.map((a: any) => <div key={a.id} className="small muted">Step {a.step} · {a.approver_name ?? "awaiting account"} · {a.decision ? a.decision.replace("_", " ") : "waiting"}{a.note ? ` · “${a.note}”` : ""}</div>)}
            {award.contract_number && <div className="row"><Link className="btn primary" href={`/contracts/${award.contract_number}`}>Open contract {award.contract_number}</Link><RegretsButton number={rfp.rfp_number} /></div>}
          </div>
        ) : bidders.length > 0 ? (
          <AwardForm number={rfp.rfp_number} bidders={bidders.map((b) => ({ invitationId: b.invitationId, label: `${b.vendor} · ${money(b.contractValue)}${b.compliant ? "" : " · paperwork missing"}` }))}
            recommended={recommended?.invitationId ?? null} alternates={alternates.map((l: any) => ({ id: l.id, label: `Alternate ${l.line_no}: ${l.description}`, on: alts.includes(l.id) }))} />
        ) : <div className="muted">No bids to award yet.</div>}
      </section>
    </Shell>
  );
}
