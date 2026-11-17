import { redirect } from "next/navigation";
import { requireActor } from "@/auth";
import { query } from "@/lib/db";
import { Shell } from "../../shell";
import { PropertyForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Properties() {
  const actor = await requireActor();
  if (!actor.can("settings.edit")) redirect("/");
  const rows = await query<any>(`select p.*, r.name region from property p left join region r on r.id = p.region_id order by p.state, p.code`);
  return (
    <Shell actor={actor} active="properties">
      <h1>Properties</h1>
      <div className="muted">The 3-letter code is used in every project ID, RFP number and folder name. Match it to Yardi's property code.</div>
      <PropertyForm />
      <section className="card">
        <table><thead><tr><th>Code</th><th>Name</th><th>State</th><th>City</th><th className="num">Units</th><th>Yardi code</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}><td><b>{p.code}</b></td><td>{p.name}</td><td>{p.state}</td><td>{p.city ?? "—"}</td><td className="num">{p.units ?? "—"}</td><td>{p.yardi_property_code ?? "—"}</td></tr>)}</tbody>
        </table>
        {rows.length === 0 && <div className="muted">No properties yet.</div>}
      </section>
    </Shell>
  );
}
