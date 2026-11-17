import { requireActor } from "@/auth";
import { pacificDate } from "@/lib/time";
import { portfolio } from "@/services/projects";
import { workbook, xlsxResponse } from "@/lib/excel";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireActor();
  const rows = await portfolio(actor);
  const buf = await workbook(
    "Portfolio",
    [
      { header: "Project ID", key: "project_code", width: 13 }, { header: "Project", key: "name", width: 34 },
      { header: "Property", key: "property_name", width: 22 }, { header: "State", key: "state", width: 7 },
      { header: "Type", key: "type_name", width: 24 }, { header: "Stage", key: "stage_name", width: 13 },
      { header: "Manager", key: "manager", width: 18 }, { header: "Health", key: "health", width: 10 },
      { header: "Budget", key: "budget", money: true }, { header: "Committed", key: "committed", money: true },
      { header: "Invoiced", key: "invoiced", money: true }, { header: "Paid", key: "paid", money: true },
      { header: "Forecast", key: "forecast", money: true },
      { header: "Start", key: "planned_start", date: true, width: 12 }, { header: "End", key: "planned_end", date: true, width: 12 },
    ],
    rows,
    "GIT capital projects portfolio",
  );
  return xlsxResponse(buf, `GIT-Portfolio_${pacificDate()}.xlsx`);
}
