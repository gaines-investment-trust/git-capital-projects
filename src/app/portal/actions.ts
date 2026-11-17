"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { portalSetIntent, portalAsk, portalSubmitBid, PortalError } from "@/services/rfps";

export type PortalState = { error?: string; ok?: string } | undefined;

// Vendors see plain messages only; internal errors are not shown to people outside GIT.
const msg = (e: unknown) => (e instanceof PortalError ? e.message : e instanceof z.ZodError ? "Please check the highlighted values and try again." : "Something went wrong. Please try again or contact your GIT project manager.");

export async function intentAction(_: PortalState, fd: FormData): Promise<PortalState> {
  const token = String(fd.get("token"));
  try {
    const intent = fd.get("intent") === "declined" ? "declined" : "will_bid";
    await portalSetIntent(token, intent, String(fd.get("reason") ?? ""));
    revalidatePath(`/portal/${token}`);
    return { ok: intent === "declined" ? "Thanks for letting us know." : "Thanks. We've noted that you'll bid." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function askAction(_: PortalState, fd: FormData): Promise<PortalState> {
  const token = String(fd.get("token"));
  try {
    await portalAsk(token, String(fd.get("question") ?? ""));
    revalidatePath(`/portal/${token}`);
    return { ok: "Question sent. Answers are shared with all bidders." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function bidAction(_: PortalState, fd: FormData): Promise<PortalState> {
  const token = String(fd.get("token"));
  try {
    const ids = fd.getAll("lineId").map(String);
    const lines = ids.map((lineId) => {
      const up = String(fd.get(`unit_${lineId}`) ?? "");
      const amt = String(fd.get(`amount_${lineId}`) ?? "");
      return { lineId, unitPrice: up === "" ? null : Number(up), amount: amt === "" ? null : Number(amt), included: fd.get(`excl_${lineId}`) !== "on" };
    });
    const r = await portalSubmitBid(token, {
      lines, exclusions: String(fd.get("exclusions") ?? "") || undefined,
      scheduleDays: fd.get("scheduleDays") ? Number(fd.get("scheduleDays")) : null,
      warrantyYears: fd.get("warrantyYears") ? Number(fd.get("warrantyYears")) : null,
    });
    revalidatePath(`/portal/${token}`);
    return { ok: `Bid received (version ${r.version}). Base total ${r.totalBase.toLocaleString("en-US", { style: "currency", currency: "USD" })}.${r.late ? " Note: submitted after the deadline; the project manager decides whether to accept it." : ""}` };
  } catch (e) {
    return { error: msg(e) };
  }
}
