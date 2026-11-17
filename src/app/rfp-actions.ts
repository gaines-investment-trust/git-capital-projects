"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor, graphToken } from "@/auth";
import * as rfps from "@/services/rfps";
import * as vendors from "@/services/vendors";
import { decide } from "@/services/approvals";
import { pacificToIso } from "@/lib/time";

export type FormState = { error?: string; ok?: string; detail?: string[] } | undefined;
const msg = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") : e instanceof Error ? e.message : String(e));

/* Approvals inbox */
export async function decideAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    void rfps; // registers the RFP approval handlers
    const r = await decide(actor, { approvalId: fd.get("approvalId"), decision: fd.get("decision"), note: String(fd.get("note") ?? "") || undefined });
    // No refresh here: the card keeps showing the confirmation so the tap visibly registered.
    // Every page is rendered fresh on the next visit (force-dynamic).
    return { ok: r.status === "fully_approved" ? "Approved. Final approval recorded." : r.status === "next_step" ? "Approved. Sent to the next approver." : r.status === "returned" ? "Sent back with your note." : "Marked for discussion." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/* RFPs */
export async function createRfpAction(fd: FormData) {
  const actor = await requireActor();
  const r = await rfps.createRfp(actor, String(fd.get("projectCode")));
  redirect(`/rfps/${r.number}`);
}

export async function updateRfpAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const number = String(fd.get("number"));
  try {
    const part = String(fd.get("part"));
    const tz = (v: FormDataEntryValue | null) => pacificToIso(v ? String(v) : null); // entered in Pacific time
    if (part === "scope") {
      await rfps.updateRfp(actor, number, {
        title: String(fd.get("title")),
        coverNote: String(fd.get("coverNote") ?? ""),
        scope: {
          summary: String(fd.get("summary") ?? ""),
          items: String(fd.get("items") ?? "").split("\n").map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean),
          inclusions: String(fd.get("inclusions") ?? ""), exclusions: String(fd.get("exclusions") ?? ""),
          phasing: String(fd.get("phasing") ?? ""), residentImpact: String(fd.get("residentImpact") ?? ""),
        },
      });
    } else if (part === "dates") {
      await rfps.updateRfp(actor, number, {
        siteWalkAt: tz(fd.get("siteWalkAt")), questionsDueAt: tz(fd.get("questionsDueAt")), bidDueAt: tz(fd.get("bidDueAt")),
        targetAwardDate: String(fd.get("targetAwardDate") || "") || null, targetStartDate: String(fd.get("targetStartDate") || "") || null,
      });
    } else if (part === "requirements") {
      const n = (k: string) => (fd.get(k) === "" ? null : Number(fd.get(k)));
      await rfps.updateRfp(actor, number, {
        requirements: {
          gl_each_occurrence: n("gl_each_occurrence"), gl_aggregate: n("gl_aggregate"), auto: n("auto"), umbrella: n("umbrella"),
          additional_insured: String(fd.get("additional_insured") ?? ""), retainage_pct: n("retainage_pct"), payment_terms: String(fd.get("payment_terms") ?? ""),
          prevailing_wage: fd.get("prevailing_wage") === "on",
        },
      });
    }
    revalidatePath(`/rfps/${number}`);
    return { ok: "Saved" };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function saveBidFormAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const number = String(fd.get("number"));
  try {
    const nos = fd.getAll("line_no").map(String);
    const lines = nos.map((line_no, i) => ({
      line_no: line_no.trim(), description: String(fd.getAll("description")[i]).trim(),
      quantity: String(fd.getAll("quantity")[i]) === "" ? null : Number(fd.getAll("quantity")[i]),
      unit: String(fd.getAll("unit")[i]).trim(), kind: String(fd.getAll("kind")[i]),
    })).filter((l) => l.line_no || l.description);
    await rfps.saveBidForm(actor, number, lines);
    revalidatePath(`/rfps/${number}`);
    return { ok: `Saved ${lines.length} lines` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function submitRfpAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const number = String(fd.get("number"));
  try {
    const r = await rfps.submitRfp(actor, number);
    revalidatePath(`/rfps/${number}`);
    return { ok: r.status === "approved" ? "Approved (you are the approver)." : `Submitted. Approval chain: ${r.approvers.join(" → ")}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function issueRfpAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const number = String(fd.get("number"));
  try {
    const r = await rfps.issueRfp(actor, number);
    revalidatePath(`/rfps/${number}`);
    return { ok: "Issued and filed", detail: [r.rfpFile.path, r.bidFormFile.path] };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function inviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const number = String(fd.get("number"));
  try {
    const ids = fd.getAll("vendorIds").map(String);
    if (!ids.length) throw new Error("Choose at least one vendor");
    const res = await rfps.inviteVendors(actor, number, ids, await graphToken());
    revalidatePath(`/rfps/${number}`);
    return { ok: "Invitations processed", detail: res.map((r) => `${r.vendor}: ${r.status}${r.issues.length ? ` (paperwork: ${r.issues.join(", ")})` : ""}${r.link ? ` · ${r.link}` : ""}`) };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function answerAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    await rfps.answerQuestion(actor, String(fd.get("questionId")), String(fd.get("answer")));
    revalidatePath(`/rfps/${fd.get("number")}`);
    return { ok: "Answer published to all bidders" };
  } catch (e) {
    return { error: msg(e) };
  }
}

/* Vendors */
export async function createVendorAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  let id: string;
  try {
    const list = (k: string) => String(fd.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    id = (await vendors.createVendor(actor, {
      name: fd.get("name"), shortName: fd.get("shortName") ?? "", trades: list("trades"), statesServed: list("statesServed"),
      contactName: fd.get("contactName"), contactEmail: fd.get("contactEmail"), contactPhone: fd.get("contactPhone") ?? undefined,
      yardiVendorId: fd.get("yardiVendorId") ?? undefined,
    })).id;
  } catch (e) {
    return { error: msg(e) };
  }
  redirect(`/vendors/${id}`);
}

export async function vendorPaperworkAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  const vendorId = String(fd.get("vendorId"));
  try {
    const kind = String(fd.get("kind"));
    if (kind === "coi") await vendors.addCoi(actor, Object.fromEntries(fd));
    else if (kind === "license") await vendors.addLicense(actor, Object.fromEntries(fd));
    else if (kind === "status") await vendors.setVendorStatus(actor, vendorId, String(fd.get("status")));
    revalidatePath(`/vendors/${vendorId}`);
    return { ok: "Saved" };
  } catch (e) {
    return { error: msg(e) };
  }
}
