import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";
import ExcelJS from "exceljs";

type Input = { rfp: any; lines: any[]; project: any };

const usd = (n: unknown) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Los_Angeles" }) + " (Pacific)" : "To be announced");
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }) : "To be announced");

const p = (text: string, opts: { bold?: boolean; size?: number } = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, bold: opts.bold, size: opts.size })] });
const h = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun({ text })] });

function cell(text: string, bold = false, width?: number) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] })],
  });
}

/** The RFP document (build prompt 8.1 step 8). Plain, consistent, editable in Word. */
export async function buildRfpDocx({ rfp, lines, project }: Input): Promise<Buffer> {
  const s = rfp.scope ?? {};
  const r = rfp.requirements ?? {};
  const border = { style: BorderStyle.SINGLE, size: 4, color: "C9D1DC" };
  const doc = new Document({
    creator: "GIT Capital Projects Platform",
    title: `${rfp.rfp_number} ${rfp.title}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "GAINES INVESTMENT TRUST", bold: true, color: "1B3358", size: 24 })] }),
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `Request for Proposal ${rfp.rfp_number}` })] }),
        p(rfp.title, { bold: true, size: 26 }),
        p(`${project.pname}${project.city ? `, ${project.city}` : ""}, ${project.state} · Project ${project.project_code}`),

        h("1. Key dates"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows: [
            ["Issued", day(rfp.issue_date ?? new Date().toISOString())],
            ["Site walk", when(rfp.site_walk_at)],
            ["Questions due", when(rfp.questions_due_at)],
            ["Bids due", when(rfp.bid_due_at)],
            ["Target award", day(rfp.target_award_date)],
            ["Target start", day(rfp.target_start_date)],
          ].map(([a, b]) => new TableRow({ children: [cell(a, true, 30), cell(b, false, 70)] })),
        }),

        h("2. Contacts"),
        p(`${project.manager}, Capital Project Manager · ${project.manager_email}`),
        p("Submit questions and your bid through the personal portal link in your invitation email. Answers are shared with all bidders."),

        h("3. Scope of work"),
        p(s.summary || ""),
        ...(s.items ?? []).filter(Boolean).map((it: string, i: number) => p(`${i + 1}. ${it}`)),
        ...(s.inclusions ? [p("Inclusions", { bold: true }), p(s.inclusions)] : []),
        ...(s.exclusions ? [p("Exclusions", { bold: true }), p(s.exclusions)] : []),
        ...(s.phasing ? [p("Phasing", { bold: true }), p(s.phasing)] : []),
        ...(s.residentImpact ? [p("Resident impact", { bold: true }), p(s.residentImpact)] : []),

        h("4. Bid form"),
        p("Price every line. Every bidder prices the same lines so bids compare on equal terms. Declare any exclusions."),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows: [
            new TableRow({ tableHeader: true, children: [cell("#", true, 8), cell("Description", true, 52), cell("Type", true, 14), cell("Qty", true, 10), cell("Unit", true, 16)] }),
            ...lines.map((l) => new TableRow({ children: [cell(l.line_no, false, 8), cell(l.description, false, 52), cell(String(l.kind).replace("_", " "), false, 14), cell(l.quantity === null ? "—" : String(Number(l.quantity)), false, 10), cell(l.unit, false, 16)] })),
          ],
        }),

        h("5. Requirements"),
        p(`Insurance: general liability ${usd(r.gl_each_occurrence)} each occurrence / ${usd(r.gl_aggregate)} aggregate; auto ${usd(r.auto)}; umbrella ${usd(r.umbrella)}; workers' compensation ${r.workers_comp ?? "statutory"}.`),
        p(`Additional insured: ${r.additional_insured ?? "Gaines Investment Trust"}.`),
        p(`Contractor license for ${project.state} required. ${r.prevailing_wage ? "Prevailing wage applies." : "Prevailing wage does not apply."}`),
        p(`Payment terms: ${r.payment_terms ?? "Net 30"}; retainage ${r.retainage_pct ?? 10}%.`),
        p(`Lien releases: ${r.lien_releases ?? "State statutory releases with every pay request"}.`),
        p(`The successful bidder signs ${r.contract ?? "GIT's standard agreement"}.`),

        h("6. Submission"),
        p("Submit through the portal link by the due date and time. Late bids may not be accepted. Acknowledge every addendum."),
        new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 360 }, children: [new TextRun({ text: `Generated by the GIT Capital Projects Platform for ${rfp.rfp_number}.`, italics: true, size: 18, color: "5B6676" })] }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Bid form workbook: vendors who prefer Excel fill this; the portal form has the same lines. */
export async function buildBidFormXlsx({ rfp, lines, project }: Input): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GIT Capital Projects Platform";
  const ws = wb.addWorksheet("Bid form");
  ws.addRow([`${rfp.rfp_number} · ${rfp.title}`]).font = { bold: true, size: 13 };
  ws.addRow([`${project.pname}, ${project.state} · Bids due ${when(rfp.bid_due_at)}`]);
  ws.addRow(["Bidder:", ""]);
  ws.addRow([]);
  const head = ws.addRow(["#", "Description", "Type", "Qty", "Unit", "Unit price", "Amount", "Included? (Y/N)", "Notes"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B3358" } };
  const first = ws.rowCount + 1;
  for (const l of lines) {
    const row = ws.addRow([l.line_no, l.description, String(l.kind).replace("_", " "), l.quantity === null ? null : Number(l.quantity), l.unit, null, null, "Y", ""]);
    const r = row.number;
    if (l.quantity !== null) row.getCell(7).value = { formula: `IF(F${r}="","",D${r}*F${r})` };
  }
  const last = ws.rowCount;
  const total = ws.addRow(["", "Total base bid", "", "", "", "", { formula: `SUMIFS(G${first}:G${last},C${first}:C${last},"base")` }]);
  total.font = { bold: true };
  ws.columns = [{ width: 6 }, { width: 48 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 30 }];
  ws.getColumn(6).numFmt = '"$"#,##0.00';
  ws.getColumn(7).numFmt = '"$"#,##0.00';
  ws.addRow([]);
  ws.addRow(["", "Schedule (calendar days):"]);
  ws.addRow(["", "Labor warranty (years):"]);
  ws.addRow(["", "Exclusions and qualifications:"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
