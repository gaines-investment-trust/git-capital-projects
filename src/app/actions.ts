"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor, graphToken } from "@/auth";
import { createProject } from "@/services/projects";
import { addPerson, searchDirectory } from "@/services/people";
import { fileDocument } from "@/services/filing";
import { withTx } from "@/lib/db";
import { assertCan } from "@/lib/access";

export type FormState = { error?: string; ok?: string } | undefined;

const msg = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : String(e));

export async function createProjectAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  let code: string;
  try {
    const r = await createProject(actor, Object.fromEntries(fd));
    code = r.code;
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/");
  redirect(`/projects/${code}?created=1`);
}

const PropertyInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "three letters"),
  name: z.string().trim().min(2),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "two letters"),
  city: z.string().trim().optional(),
  units: z.coerce.number().int().nonnegative().optional(),
  yardiPropertyCode: z.string().trim().optional(),
});

export async function addPropertyAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    assertCan(actor, "settings.edit");
    const p = PropertyInput.parse(Object.fromEntries(fd));
    await withTx(actor.userId, (c) =>
      c.query(
        `insert into property (code, name, state, city, units, yardi_property_code, region_id, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,(select id from region where code = $8),$7,$7)`,
        [p.code, p.name, p.state, p.city || null, p.units ?? null, p.yardiPropertyCode || null, actor.userId, p.state],
      ),
    );
  } catch (e) {
    return { error: String(msg(e)).includes("duplicate") ? "That property code already exists" : msg(e) };
  }
  revalidatePath("/admin/properties");
  return { ok: "Property added" };
}

export async function addPersonAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const scopeIds = fd.getAll("scopeIds").map(String).filter(Boolean);
    const limit = String(fd.get("approvalLimit") ?? "");
    await addPerson(actor, { ...Object.fromEntries(fd), scopeIds, approvalLimit: limit === "" ? null : Number(limit) });
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/admin/people");
  return { ok: "Added. Group, folder and Teams access are queued." };
}

export async function directorySearchAction(q: string) {
  const actor = await requireActor();
  assertCan(actor, "people.manage");
  const token = await graphToken();
  if (!token) return { error: "Directory search needs Microsoft sign-in (not available with development sign-in).", results: [] };
  try {
    return { results: await searchDirectory(token, q) };
  } catch (e) {
    return { error: msg(e), results: [] };
  }
}

export async function uploadDocumentAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file");
    if (f.size > 250 * 1024 * 1024) throw new Error("File is larger than 250 MB");
    // A person chose the project and type, so confidence is 1. Claude classification plugs in here in sprint 3.
    const r = await fileDocument(
      actor,
      { originalName: f.name, content: Buffer.from(await f.arrayBuffer()), contentType: f.type || "application/octet-stream", source: "upload" },
      {
        projectCode: String(fd.get("projectCode")),
        docType: String(fd.get("docType")),
        qualifier: String(fd.get("qualifier") ?? "") || undefined,
        party: String(fd.get("party") || "GIT"),
        docDate: String(fd.get("docDate") || new Date().toISOString().slice(0, 10)),
        amount: fd.get("amount") ? Number(fd.get("amount")) : null,
        confidence: 1,
      },
    );
    revalidatePath(`/projects/${fd.get("projectCode")}`);
    return { ok: r.status === "filed" ? `Filed as ${r.name}` : `Sent to Unfiled: ${r.reason}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

import { updateTask, saveBaseline } from "@/services/schedule";
import { setOriginalBudget } from "@/services/budget";

export async function updateTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const r = await updateTask(actor, Object.fromEntries(fd));
    revalidatePath(`/projects/${fd.get("projectCode")}`);
    return { ok: (r.slipDays > 0 ? `Saved. ${r.slipDays}-day slip logged.` : "Saved.") + (r.movedTasks ? ` ${r.movedTasks} later task${r.movedTasks === 1 ? "" : "s"} moved to follow it.` : "") };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function saveBaselineAction(fd: FormData) {
  const actor = await requireActor();
  await saveBaseline(actor, String(fd.get("projectId")));
  revalidatePath(`/projects/${fd.get("projectCode")}`);
}

export async function setBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActor();
  try {
    const r = await setOriginalBudget(actor, Object.fromEntries(fd));
    revalidatePath(`/projects/${fd.get("projectCode")}`);
    return { ok: `Saved. Project budget is now ${r.projectTotal.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.` };
  } catch (e) {
    return { error: msg(e) };
  }
}
