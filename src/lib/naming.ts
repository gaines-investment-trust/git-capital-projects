/**
 * GIT naming convention (build prompt section 6). Pure functions, unit tested.
 */

/** Characters SharePoint does not allow in file or folder names. */
const ILLEGAL = /["*:<>?/\\|#%]/g;

export function cleanSegment(s: string): string {
  return s.replace(ILLEGAL, "-").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 120);
}

/** Vendor short names have no spaces: "Brandpoint Roofing, LLC" -> "BrandpointRoofing" */
export function vendorShortName(name: string): string {
  return name
    .replace(/\b(llc|inc|co|corp|corporation|company|ltd|lp)\b\.?/gi, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function projectCode(propertyCode: string, year: number, n: number): string {
  return `${propertyCode.toUpperCase()}-${pad(year % 100, 2)}-${pad(n, 3)}`;
}

export function rfpNumber(propertyCode: string, n: number): string {
  return `RFP-${propertyCode.toUpperCase()}-${pad(n, 3)}`;
}

export function addendumName(rfp: string, n: number): string {
  return `${rfp} Addendum No. ${n}`;
}

export const contractNumber = (projectId: string, n: number) => `${projectId}-K${pad(n, 2)}`;
export const changeOrderNumber = (projectId: string, n: number) => `${projectId}-CO${pad(n, 2)}`;
export const payRequestNumber = (projectId: string, n: number) => `${projectId}-PR${pad(n, 2)}`;

/** The 14 standard subfolders of every project folder (section 6.2). */
export const PROJECT_SUBFOLDERS = [
  "01 Planning",
  "02 RFP",
  "02 RFP/Issued",
  "02 RFP/Questions and Answers",
  "03 Bids",
  "04 Bid Leveling and Award",
  "05 Contracts",
  "06 Change Orders",
  "07 Pay Requests and Invoices",
  "08 Lien Releases",
  "09 Insurance and Compliance",
  "10 Schedule",
  "11 Inspections and Photos",
  "12 Daily Logs and Field Reports",
  "13 Correspondence",
  "14 Closeout",
] as const;

export const PORTFOLIO_FOLDERS = [
  "00 Portfolio",
  "00 Portfolio/Capital Plans",
  "00 Portfolio/Templates",
  "00 Portfolio/Reports",
  "01 Vendors",
] as const;

export type ProjectFolderInput = {
  state: string;
  propertyCode: string;
  propertyName: string;
  year: number;
  projectId: string;
  projectName: string;
};

/** Path of the project folder under the main folder, using "/" separators. */
export function projectFolderPath(p: ProjectFolderInput): string {
  return [
    cleanSegment(p.state.toUpperCase()),
    cleanSegment(`${p.propertyCode.toUpperCase()} - ${p.propertyName}`),
    String(p.year),
    cleanSegment(`${p.projectId} - ${p.projectName}`),
  ].join("/");
}

export function vendorFolderPaths(short: string): string[] {
  const base = `01 Vendors/${cleanSegment(short)}`;
  return [base, `${base}/Insurance (COIs)`, `${base}/W-9 and Licenses`, `${base}/Agreements (MSAs)`];
}

/** Document types and the project subfolder each one files into. */
export const DOC_TYPES: Record<string, { folder: string; label: string }> = {
  "Budget": { folder: "01 Planning", label: "Budget" },
  "ScopeNotes": { folder: "01 Planning", label: "Scope notes" },
  "SitePhoto": { folder: "01 Planning", label: "Site photo" },
  "RFP": { folder: "02 RFP/Issued", label: "RFP" },
  "RFP-Addendum": { folder: "02 RFP/Issued", label: "RFP addendum" },
  "BidForm": { folder: "02 RFP/Issued", label: "Bid form" },
  "QandA": { folder: "02 RFP/Questions and Answers", label: "Questions and answers" },
  "Bid": { folder: "03 Bids/{Vendor}", label: "Bid" },
  "BidLeveling": { folder: "04 Bid Leveling and Award", label: "Bid leveling" },
  "AwardMemo": { folder: "04 Bid Leveling and Award", label: "Award memo" },
  "Contract-Draft": { folder: "05 Contracts", label: "Contract draft" },
  "Contract-Redline": { folder: "05 Contracts", label: "Contract redline" },
  "Contract-Executed": { folder: "05 Contracts", label: "Executed contract" },
  "CO": { folder: "06 Change Orders", label: "Change order" },
  "PayRequest": { folder: "07 Pay Requests and Invoices", label: "Pay request" },
  "Invoice": { folder: "07 Pay Requests and Invoices", label: "Invoice" },
  "PaymentPacket": { folder: "07 Pay Requests and Invoices", label: "Payment packet" },
  "LienRelease": { folder: "08 Lien Releases", label: "Lien release" },
  "COI": { folder: "09 Insurance and Compliance", label: "Certificate of insurance" },
  "W9": { folder: "09 Insurance and Compliance", label: "W-9" },
  "License": { folder: "09 Insurance and Compliance", label: "License" },
  "Schedule": { folder: "10 Schedule", label: "Schedule" },
  "Inspection": { folder: "11 Inspections and Photos/{Date}", label: "Inspection report" },
  "Photo": { folder: "11 Inspections and Photos/{Date}", label: "Photo" },
  "DailyLog": { folder: "12 Daily Logs and Field Reports", label: "Daily log" },
  "Correspondence": { folder: "13 Correspondence", label: "Correspondence" },
  "Warranty": { folder: "14 Closeout", label: "Warranty" },
  "AsBuilt": { folder: "14 Closeout", label: "As-built" },
  "PunchList": { folder: "14 Closeout", label: "Punch list" },
  "CloseoutReport": { folder: "14 Closeout", label: "Closeout report" },
};

/**
 * Doc type as written in the file name. Some carry a qualifier:
 *  RFP-Addendum + 1 -> "RFP-Addendum-01"; CO + 2 -> "CO-02"; PayRequest + 3 -> "PayRequest-03";
 *  LienRelease + "Conditional-Progress-03" -> "LienRelease-Conditional-Progress-03"; Inspection + "Final".
 */
export function docTypeToken(docType: string, qualifier?: string | number): string {
  if (qualifier === undefined || qualifier === "") return docType;
  const q = typeof qualifier === "number" ? pad(qualifier, 2) : qualifier;
  return `${docType}-${q}`;
}

export function isoDate(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

export type FileNameInput = {
  projectId: string;
  docType: string;
  qualifier?: string | number;
  party: string; // vendor short name or "GIT"
  date: Date | string;
  version: number;
  ext: string;
};

/** {ProjectID}_{DocType}_{Vendor or Party}_{YYYY-MM-DD}_v{n}.{ext} */
export function fileName(i: FileNameInput): string {
  const ext = i.ext.replace(/^\./, "").toLowerCase();
  const party = i.party === "GIT" ? "GIT" : vendorShortName(i.party) || "Unknown";
  return `${i.projectId}_${docTypeToken(i.docType, i.qualifier)}_${party}_${isoDate(i.date)}_v${i.version}.${ext}`;
}

/** Destination subfolder for a doc type, with {Vendor} and {Date} filled in. */
export function docFolder(docType: string, vendorShort?: string, date?: Date | string): string {
  const t = DOC_TYPES[docType];
  if (!t) throw new Error(`Unknown document type: ${docType}`);
  return t.folder
    .replace("{Vendor}", cleanSegment(vendorShort ?? "Unknown"))
    .replace("{Date}", date ? isoDate(date) : isoDate(new Date()));
}

/** Parse a convention file name back into parts (used by the nightly folder audit). */
export function parseFileName(name: string): { projectId: string; docType: string; party: string; date: string; version: number; ext: string } | null {
  const m = name.match(/^([A-Z]{3}-\d{2}-\d{3})_([A-Za-z0-9-]+)_([A-Za-z0-9]+)_(\d{4}-\d{2}-\d{2})_v(\d+)\.([a-z0-9]+)$/);
  if (!m) return null;
  return { projectId: m[1], docType: m[2], party: m[3], date: m[4], version: Number(m[5]), ext: m[6] };
}
