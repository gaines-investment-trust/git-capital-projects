"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor, graphToken } from "@/auth";
import { closeBidding, gapAnalysis } from "@/services/leveling";
import { requestAward, prepareForSignature, recordExecuted, sendRegrets, voidSignature } from "@/services/contracts";
import { sendMail, escapeHtml } from "@/lib/mail";
import { one } from "@/lib/db";

export type FormState = { error?: string; ok?: string } | undefined;
const msg = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e instanceof Error ? e.message : String(e));

export async function closeBiddingAction(fd: FormData) {
  const actor = await requireActor();
  await closeBidding(actor, String(fd.get("number")));
  redirect(`/rfps/${fd.get("number")}/leveling`);
}

export async function gapAnalysisAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const r = await gapAnalysis(actor, String(fd.get("number")));
    revalidatePath(`/rfps/${fd.get("number")}/leveling`);
    return { ok: `${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}${r.usedClaude ? " (rules and Claude)" : " (rules; Claude adds its review once the API key is configured)"}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function sendClarificationAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const vendorId = String(fd.get("vendorId"));
    const c = await one<any>(`select c.email, v.name from vendor v join lateral (select email from vendor_contact where vendor_id = v.id order by is_primary desc limit 1) c on true where v.id = $1`, [vendorId]);
    const rfp = await one<any>(`select id, project_id from rfp where rfp_number = $1`, [fd.get("number")]);
    if (!c || !rfp) throw new Error("Vendor or RFP not found");
    const body = String(fd.get("body") ?? "").trim();
    if (body.length < 20) throw new Error("The email is empty");
    await sendMail({
      fromUserId: actor.userId, fromAddress: actor.email, to: [c.email], subject: String(fd.get("subject")),
      html: body.split("\n").map((l) => `<p>${escapeHtml(l) || "&nbsp;"}</p>`).join(""), projectId: rfp.project_id, rfpId: rfp.id, vendorId,
    }, await graphToken());
    return { ok: `Sent to ${c.name}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function requestAwardAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const r = await requestAward(actor, String(fd.get("number")), {
      invitationId: fd.get("invitationId"), alternates: fd.getAll("alternates").map(String), memo: String(fd.get("memo") ?? ""),
    });
    revalidatePath(`/rfps/${fd.get("number")}/leveling`);
    return { ok: `Award sent for approval (${r.contractValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}): COO, then President.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function regretsAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const r = await sendRegrets(actor, String(fd.get("number")), await graphToken());
    return { ok: `Sent ${r.sent} regret letter${r.sent === 1 ? "" : "s"}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function prepareContractAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const r = await prepareForSignature(actor, String(fd.get("number")));
    revalidatePath(`/contracts/${fd.get("number")}`);
    return { ok: r.docusign ? `Sent through DocuSign: vendor signs first, then GIT` : `Contract generated and filed as ${r.file.name}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function executedAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose the signed PDF");
    const r = await recordExecuted(actor, String(fd.get("number")), { name: f.name, content: Buffer.from(await f.arrayBuffer()), contentType: f.type });
    revalidatePath(`/contracts/${fd.get("number")}`);
    return { ok: `Executed. Filed as ${r.file.name}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function voidSignatureAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    await voidSignature(actor, String(fd.get("number")), String(fd.get("reason") ?? ""));
    revalidatePath(`/contracts/${fd.get("number")}`);
    return { ok: "Pulled back; the contract is a draft again" };
  } catch (e) {
    return { error: msg(e) };
  }
}
