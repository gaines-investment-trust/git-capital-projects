import { requireActor } from "@/auth";
import { one } from "@/lib/db";
import { docStore } from "@/lib/docstore";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
};

/** Staff download of a filed document; access follows the project's property scope. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const d = await one<any>(
    `select d.*, pr.id property_id, pr.region_id from document d left join project p on p.id = d.project_id left join property pr on pr.id = p.property_id where d.id = $1`,
    [id],
  );
  if (!d || (d.property_id && !actor.canAccessProperty(d.property_id, d.region_id))) return new Response("Not found", { status: 404 });
  const buf = await docStore().download(d.sp_item_id, d.sp_path);
  const ext = d.file_name.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${d.file_name}"`, "Cache-Control": "no-store" },
  });
}
