import { z } from "zod";
import { withTx, one, query } from "@/lib/db";
import { docStore } from "@/lib/docstore";
import { DOC_TYPES, docFolder, fileName, projectFolderPath, vendorShortName } from "@/lib/naming";
import type { Actor } from "@/lib/access";

/** What Claude (or a person) decided about a document. Confidence 0..1. */
export const Classification = z.object({
  projectCode: z.string().regex(/^[A-Z]{3}-\d{2}-\d{3}$/).nullable(),
  docType: z.string().refine((t) => t in DOC_TYPES, "unknown document type").nullable(),
  qualifier: z.union([z.string(), z.number()]).optional(),
  party: z.string().min(1).default("GIT"), // vendor name or "GIT"
  docDate: z.string().date(),
  amount: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
});
export type Classification = z.infer<typeof Classification>;

export type IncomingFile = { originalName: string; content: Buffer; contentType: string; source: "upload" | "email" | "portal" | "docusign" | "generated" };

const UNFILED_FOLDER = "00 Portfolio/Unfiled";

async function autoFileThreshold(): Promise<number> {
  const s = await one<{ value: number }>(`select value from app_setting where key = 'filing.autoFileConfidence'`);
  return s ? Number(s.value) : 0.9;
}

/**
 * Files a document by the convention (section 6.3): never overwrites (next version instead),
 * writes SharePoint metadata, records ids. Below the confidence threshold, or when the project
 * or type is unknown, it goes to the Unfiled queue for a person — nothing is silently misfiled.
 */
export async function fileDocument(actor: Actor | null, file: IncomingFile, rawClass: unknown) {
  const cls = Classification.parse(rawClass);
  const threshold = await autoFileThreshold();
  const ext = (file.originalName.split(".").pop() ?? "bin").toLowerCase();
  const store = docStore();

  const project = cls.projectCode
    ? await one<any>(
        `select p.id, p.project_code, p.name, p.created_at, p.planned_start, pr.code pcode, pr.name pname, pr.state
           from project p join property pr on pr.id = p.property_id where p.project_code = $1`,
        [cls.projectCode],
      )
    : null;

  const unfiled = !project || !cls.docType || cls.confidence < threshold;
  if (unfiled) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const item = await store.upload(UNFILED_FOLDER, `${stamp}_${file.originalName.replace(/[\\/:*?"<>|#%]/g, "-")}`, file.content, file.contentType);
    const doc = await withTx(actor?.userId ?? null, async (c) =>
      (await c.query(
        `insert into document (sp_drive_id, sp_item_id, sp_path, file_name, original_file_name, doc_type, project_id, amount, doc_date,
                               source, classification_confidence, filing_status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'unfiled',$12) returning id`,
        [item.driveId, item.itemId, item.path, item.name, file.originalName, cls.docType ?? "Unknown", project?.id ?? null, cls.amount ?? null,
         cls.docDate, file.source, cls.confidence, actor?.userId ?? null],
      )).rows[0],
    );
    return { status: "unfiled" as const, documentId: doc.id as string, path: item.path, reason: !project ? "project not identified" : !cls.docType ? "document type not identified" : `confidence ${Math.round(cls.confidence * 100)}% below ${Math.round(threshold * 100)}%` };
  }

  const docType = cls.docType!;
  const vendorShort = cls.party === "GIT" ? "GIT" : vendorShortName(cls.party);
  const year = new Date(project.planned_start ?? project.created_at).getUTCFullYear();
  const base = projectFolderPath({ state: project.state, propertyCode: project.pcode, propertyName: project.pname, year, projectId: project.project_code, projectName: project.name });
  const folder = `${base}/${docFolder(docType, vendorShort, cls.docDate)}`;

  // Next version: highest existing version for the same name stem in this folder + 1.
  const stem = fileName({ projectId: project.project_code, docType, qualifier: cls.qualifier, party: cls.party, date: cls.docDate, version: 0, ext }).replace(/_v0\.[a-z0-9]+$/, "");
  const prior = await one<{ v: number }>(`select max(version_n) v from document where project_id = $1 and file_name like $2`, [project.id, `${stem}_v%`]);
  let version = (prior?.v ?? 0) + 1;
  let name = fileName({ projectId: project.project_code, docType, qualifier: cls.qualifier, party: cls.party, date: cls.docDate, version, ext });
  while (await store.exists(`${folder}/${name}`)) {
    version += 1;
    name = fileName({ projectId: project.project_code, docType, qualifier: cls.qualifier, party: cls.party, date: cls.docDate, version, ext });
  }

  const item = await store.upload(folder, name, file.content, file.contentType);
  await store.setMetadata(item, {
    ProjectID: project.project_code, Property: `${project.pcode} - ${project.pname}`, DocType: docType, Vendor: vendorShort,
    Status: "Filed", Amount: cls.amount ?? undefined, DocDate: cls.docDate, OriginalFileName: file.originalName,
  });

  const doc = await withTx(actor?.userId ?? null, async (c) => {
    const vendor = vendorShort === "GIT" ? null : (await c.query(`select id from vendor where short_name = $1`, [vendorShort])).rows[0];
    return (await c.query(
      `insert into document (sp_drive_id, sp_item_id, sp_path, sp_version, file_name, original_file_name, doc_type, version_n, project_id, vendor_id,
                             amount, doc_date, source, classification_confidence, filing_status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'filed',$15) returning id`,
      [item.driveId, item.itemId, item.path, item.version ?? null, name, file.originalName, docType, version, project.id, vendor?.id ?? null,
       cls.amount ?? null, cls.docDate, file.source, cls.confidence, actor?.userId ?? null],
    )).rows[0];
  });
  return { status: "filed" as const, documentId: doc.id as string, path: item.path, name };
}

export async function unfiledQueue() {
  return query(`select d.*, p.project_code from document d left join project p on p.id = d.project_id where filing_status = 'unfiled' order by created_at desc`);
}
