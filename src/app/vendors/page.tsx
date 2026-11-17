import Link from "next/link";
import { requireActor } from "@/auth";
import { listVendors } from "@/services/vendors";
import { myOpenApprovals } from "@/services/approvals";
import { Shell } from "../shell";
import { NewVendorForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Vendors({ searchParams }: { searchParams: Promise<{ trade?: string; state?: string }> }) {
  const actor = await requireActor();
  const f = await searchParams;
  const [rows, inbox] = await Promise.all([listVendors({ trade: f.trade || undefined, state: f.state || undefined }), myOpenApprovals(actor.userId)]);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return (
    <Shell actor={actor} active="vendors" approvals={inbox.length}>
      <h1>Vendors</h1>
      <div className="muted">Contact card, paperwork and bid history for every contractor. Pattern: Jobber client hub.</div>
      <NewVendorForm />
      <section className="card">
        <form className="row" style={{ marginBottom: 10 }}>
          <label className="f" style={{ flexDirection: "row", alignItems: "center" }}>Trade <input name="trade" defaultValue={f.trade ?? ""} placeholder="e.g. roofing" style={{ width: 150 }} /></label>
          <label className="f" style={{ flexDirection: "row", alignItems: "center" }}>State <input name="state" defaultValue={f.state ?? ""} maxLength={2} placeholder="TX" style={{ width: 70 }} /></label>
          <button className="btn">Filter</button>
        </form>
        <div className="scroll"><table>
          <thead><tr><th>Vendor</th><th>Trades</th><th>States</th><th>Status</th><th>COI expires</th><th>Primary contact</th><th className="num">Invited</th><th className="num">Bids</th></tr></thead>
          <tbody>{rows.map((v) => (
            <tr key={v.id}>
              <td><Link href={`/vendors/${v.id}`} style={{ fontWeight: 600 }}>{v.name}</Link><div className="small muted">{v.short_name}</div></td>
              <td className="small">{v.trades.join(", ")}</td><td className="small">{v.states_served.join(", ")}</td>
              <td><span className={`pill ${v.approved_status === "do_not_use" ? "late" : v.approved_status === "probation" ? "risk" : v.approved_status === "pending" ? "" : "ok"}`}>{v.approved_status.replace(/_/g, " ")}</span></td>
              <td>{v.coi_expires ? <span className={`pill ${v.coi_expires < today ? "late" : v.coi_expires < soon ? "risk" : "ok"}`}>{v.coi_expires}</span> : <span className="pill late">none</span>}</td>
              <td className="small">{v.contact?.name}<div className="muted">{v.contact?.email}</div></td>
              <td className="num">{v.invitations}</td><td className="num">{v.bids}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {rows.length === 0 && <div className="muted">No vendors match.</div>}
      </section>
    </Shell>
  );
}
