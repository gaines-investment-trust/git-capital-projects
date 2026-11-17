import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";

const usd = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const p = (t: string, bold = false) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, bold })] });
const h = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t })] });
const cell = (t: string, bold = false, w?: number) => new TableCell({ width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined, children: [new Paragraph({ children: [new TextRun({ text: t, bold, size: 20 })] })] });

/**
 * Contract generated from the award (build prompt 9.1). This is a working draft built on GIT's
 * standard terms; counsel's approved template text replaces the "General terms" section before go-live.
 */
export async function buildContractDocx({ contract: k, sov }: { contract: any; sov: any[] }): Promise<Buffer> {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "C9D1DC" };
  const total = sov.reduce((a, s) => a + Number(s.scheduled_value), 0);
  const unitPrices: any[] = k.key_terms?.unit_prices ?? [];
  const doc = new Document({
    creator: "GIT Capital Projects Platform",
    title: `${k.contract_number} ${k.vendor_name}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: "GAINES INVESTMENT TRUST", bold: true, color: "1B3358", size: 24 })] }),
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `Construction Agreement ${k.contract_number}` })] }),
        p(`Owner: Gaines Investment Trust (and the property owner entity for ${k.pname})`),
        p(`Contractor: ${k.vendor_name}`),
        p(`Property: ${k.pname}, ${k.state}${k.legal_description ? ` · ${k.legal_description}` : ""}`),
        p(`Project: ${k.project_code} · ${k.project_name}${k.rfp_number ? ` · awarded under ${k.rfp_number}` : ""}`),
        h("1. Work"),
        p(`Contractor shall perform the work described in ${k.rfp_number ?? "the scope of work"}, including all addenda and the clarifications accepted at award, which are Exhibits A and B.`),
        ...(k.scope?.summary ? [p(k.scope.summary)] : []),
        h("2. Contract sum and schedule of values"),
        p(`Contract sum: ${usd(k.original_value)}, payable by schedule of value line as work is verified.`),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          rows: [
            new TableRow({ tableHeader: true, children: [cell("Line", true, 10), cell("Description", true, 65), cell("Scheduled value", true, 25)] }),
            ...sov.map((s) => new TableRow({ children: [cell(s.line_no, false, 10), cell(s.description, false, 65), cell(usd(s.scheduled_value), false, 25)] })),
            new TableRow({ children: [cell("", false, 10), cell("Total", true, 65), cell(usd(total), true, 25)] }),
          ],
        }),
        ...(unitPrices.length ? [p("Unit prices (for added quantities by change order):", true), ...unitPrices.map((u) => p(`Line ${u.line_no} ${u.description}: ${usd(u.unit_price)} per ${u.unit}`))] : []),
        h("3. Payment, retainage and lien releases"),
        p(`Payment terms: ${k.payment_terms ?? "Net 30 after approval"}. Retainage: ${Number(k.retainage_pct)}% of each payment, released at closeout.`),
        p("Each pay request must include an invoice, photos of the work, a conditional lien release for that payment on the statutory form of the property's state, and an unconditional release for the previous payment. Owner may withhold payment until required releases, inspections and current insurance are received."),
        h("4. Insurance and compliance"),
        p("Contractor shall keep in force the insurance stated in the RFP, naming the additional insureds stated there, and keep its license current. Lapsed insurance suspends payment."),
        h("5. Warranty"),
        p(`Contractor warrants the work for ${Number(k.warranty_years ?? 2)} years from final completion, in addition to manufacturer warranties, which Contractor shall deliver at closeout.`),
        h("6. General terms"),
        p("[GIT standard general conditions: indemnity, termination, disputes, safety, site rules, resident notice and change-order procedure. To be inserted from counsel's approved template before use.]"),
        h("Signatures"),
        p("Owner: ______________________________   Date: ____________"),
        p("Contractor: ______________________________   Date: ____________"),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
