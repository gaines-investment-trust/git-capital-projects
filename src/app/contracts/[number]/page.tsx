import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/auth";
import { contractDetail } from "@/services/contracts";
import { myOpenApprovals } from "@/services/approvals";
import { compliance } from "@/services/vendors";
import { query } from "@/lib/db";
import { pacificLabel } from "@/lib/time";
import { Shell, money, unitMoney } from "../../shell";
import { PrepareButton, ExecutedForm, VoidForm } from "./forms";
import { docusignEnabled } from "@/lib/docusign";

export const dynamic = "force-dynamic";
const SIG: Record<string, string> = {
  sent: "Sent to the vendor", delivered: "Vendor has opened it", signed_by_vendor: "Vendor signed; waiting for GIT's signature",
  completed: "Signed by both parties", declined: "Declined", voided: "Voided",
};
const STATUS: Record<string, [string, string]> = { draft: ["Draft", ""], out_for_signature: ["Out for signature", "risk"], executed: ["Executed", "ok"] };

export default async function ContractPage({ params }: { params: Promise<{ number: string }> }) {
  const actor = await requireActor();
  const { number } = await params;
  const d = await contractDetail(actor, decodeURIComponent(number));
  if (!d) notFound();
  const { contract: k, sov } = d;
  const [inbox, comp, docs] = await Promise.all([
    myOpenApprovals(actor.userId), compliance(k.vendor_id, k.state),
    query<any>(`select id, file_name, created_at from document where id = any($1::uuid[]) order by created_at`, [[k.draft_document_id, k.executed_document_id].filter(Boolean)]),
  ]);
  const [label, cls] = STATUS[k.status] ?? [k.status, ""];
  const total = sov.reduce((a: number, s: any) => a + Number(s.scheduled_value), 0);
  return (
    <Shell actor={actor} active="" approvals={inbox.length}>
      <div className="card spread">
        <div>
          <div className="small muted"><Link href={`/projects/${k.project_code}`}>{k.project_code} · {k.project_name}</Link>{k.rfp_number && <> · <Link href={`/rfps/${k.rfp_number}/leveling`}>{k.rfp_number}</Link></>}</div>
          <h1>{k.contract_number} · {k.vendor_name}</h1>
          <div className="row" style={{ marginTop: 6 }}><span className={`pill ${cls}`}>{label}</span><span className="small muted">{money(k.original_value)} · retainage {Number(k.retainage_pct)}% · {k.payment_terms}</span></div>
        </div>
        {k.status === "draft" && actor.can("contract.edit") && <PrepareButton number={k.contract_number} docusign={docusignEnabled()} />}
      </div>
      {k.status === "draft" && k.signature_note && <div className="notice err">{k.signature_note}</div>}
      {!comp.ok && k.status !== "executed" && <div className="notice err">Paperwork missing for {k.vendor_name}: {comp.issues.join("; ")}.</div>}

      {k.status === "out_for_signature" && actor.can("contract.edit") && (
        <section className="card">
          <h2>Signature</h2>
          {k.docusign_envelope_id ? (
            <div style={{ marginBottom: 10 }}>
              <div><b>DocuSign:</b> {SIG[k.signature_status] ?? k.signature_status}</div>
              <div className="small muted">When both have signed, the signed copy files itself and the contract is executed. Envelope {k.docusign_envelope_id}.</div>
            </div>
          ) : (
            <div className="small muted" style={{ marginBottom: 8 }}>{docusignEnabled() ? "This contract was generated before DocuSign was connected." : "DocuSign is not connected yet."} Download the generated contract, have both parties sign, and upload the signed PDF here.</div>
          )}
          <VoidForm number={k.contract_number} />
          <details style={{ marginTop: 8 }}><summary className="small">Signed outside DocuSign? Upload the signed PDF</summary><div style={{ marginTop: 8 }}><ExecutedForm number={k.contract_number} /></div></details>
        </section>
      )}

      <section className="card">
        <h2>Schedule of values</h2>
        <table>
          <thead><tr><th>Line</th><th>Description</th><th>Budget line</th><th className="num">Scheduled value</th></tr></thead>
          <tbody>
            {sov.map((s: any) => <tr key={s.id}><td>{s.line_no}</td><td>{s.description}</td><td className="small muted">{s.cost_code ?? "—"}</td><td className="num">{money(s.scheduled_value)}</td></tr>)}
            <tr style={{ fontWeight: 700 }}><td></td><td>Total</td><td></td><td className="num">{money(total)}</td></tr>
          </tbody>
        </table>
        {k.key_terms?.unit_prices?.length > 0 && <div className="small" style={{ marginTop: 8 }}>Unit prices: {k.key_terms.unit_prices.map((u: any) => `line ${u.line_no} ${unitMoney(u.unit_price)}/${u.unit}`).join(" · ")}</div>}
        <div className="small muted" style={{ marginTop: 6 }}>Built from the winning bid with no re-keying. Committed in the budget once executed.</div>
      </section>

      <section className="card">
        <h2>Documents</h2>
        {docs.length === 0 ? <div className="muted">Generate the contract to create the draft.</div> : docs.map((x) => (
          <div key={x.id} className="row small" style={{ padding: "4px 0" }}><a href={`/api/documents/${x.id}`}>{x.file_name}</a><span className="muted">{pacificLabel(x.created_at)}</span></div>
        ))}
      </section>
    </Shell>
  );
}
