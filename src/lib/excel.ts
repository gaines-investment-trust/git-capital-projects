import ExcelJS from "exceljs";

export type Col = { header: string; key: string; width?: number; money?: boolean; date?: boolean };

/** One-sheet workbook with a bold frozen header, money formats and autofilter. */
export async function workbook(sheetName: string, cols: Col[], rows: Record<string, unknown>[], title?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GIT Capital Projects Platform";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  let headerRow = 1;
  if (title) {
    ws.addRow([title]).font = { bold: true, size: 13 };
    ws.addRow([`Exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`]).font = { italic: true, color: { argb: "FF5B6676" } };
    ws.addRow([]);
    headerRow = 4;
  }
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width ?? (c.money ? 14 : 18) }));
  const h = ws.getRow(headerRow);
  cols.forEach((c, i) => (h.getCell(i + 1).value = c.header));
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B3358" } };
  for (const r of rows) {
    const vals: Record<string, unknown> = {};
    for (const c of cols) {
      const v = r[c.key];
      vals[c.key] = c.money ? (v === null || v === undefined ? null : Number(v)) : c.date && v ? new Date(String(v).slice(0, 10) + "T00:00:00Z") : v ?? null;
    }
    ws.addRow(vals);
  }
  cols.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = '"$"#,##0;[Red]-"$"#,##0';
    if (c.date) ws.getColumn(i + 1).numFmt = "yyyy-mm-dd";
  });
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
