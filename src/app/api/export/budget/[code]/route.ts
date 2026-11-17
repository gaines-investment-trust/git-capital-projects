import { requireActor } from "@/auth";
import { getProjectByCode } from "@/services/projects";
import { workbook, xlsxResponse } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const actor = await requireActor();
  const { code } = await params;
  const data = await getProjectByCode(actor, code);
  if (!data) return new Response("Not found", { status: 404 });
  const buf = await workbook(
    "Budget",
    [
      { header: "Cost code", key: "code", width: 10 }, { header: "Description", key: "cost_name", width: 28 },
      { header: "Yardi GL", key: "yardi_gl_account", width: 10 }, { header: "Yardi job", key: "yardi_job_code", width: 10 },
      { header: "Original", key: "original_budget", money: true }, { header: "Approved changes", key: "approved_changes", money: true },
      { header: "Revised", key: "revised_budget", money: true }, { header: "Committed", key: "committed", money: true },
      { header: "Pending changes", key: "pending_changes", money: true }, { header: "Invoiced", key: "invoiced", money: true },
      { header: "Paid", key: "paid", money: true }, { header: "Retainage held", key: "retainage_held", money: true },
      { header: "Forecast", key: "forecast", money: true }, { header: "Variance", key: "variance", money: true },
    ],
    data.budget as Record<string, unknown>[],
    `${data.project.project_code} · ${data.project.name} · budget by cost code`,
  );
  return xlsxResponse(buf, `${data.project.project_code}_Budget_GIT_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
