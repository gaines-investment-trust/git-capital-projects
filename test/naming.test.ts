import { describe, expect, it } from "vitest";
import {
  projectCode, rfpNumber, addendumName, contractNumber, changeOrderNumber, payRequestNumber, fileName, docFolder,
  projectFolderPath, vendorShortName, parseFileName, cleanSegment,
} from "@/lib/naming";
import { chainRolesFor } from "@/services/approvals";

describe("identifiers (section 6.1)", () => {
  it("formats project, RFP, contract, CO and pay request numbers", () => {
    expect(projectCode("tus", 2026, 4)).toBe("TUS-26-004");
    expect(rfpNumber("TUS", 2)).toBe("RFP-TUS-002");
    expect(addendumName("RFP-TUS-002", 1)).toBe("RFP-TUS-002 Addendum No. 1");
    expect(contractNumber("TUS-26-004", 1)).toBe("TUS-26-004-K01");
    expect(changeOrderNumber("TUS-26-004", 2)).toBe("TUS-26-004-CO02");
    expect(payRequestNumber("TUS-26-004", 3)).toBe("TUS-26-004-PR03");
  });
  it("makes vendor short names without spaces or suffixes", () => {
    expect(vendorShortName("Brandpoint Roofing, LLC")).toBe("BrandpointRoofing");
    expect(vendorShortName("green line landscape inc.")).toBe("GreenLineLandscape");
  });
});

describe("file names reproduce every example in section 6.3", () => {
  const P = "TUS-26-004";
  const cases: [Parameters<typeof fileName>[0], string][] = [
    [{ projectId: P, docType: "RFP", party: "GIT", date: "2026-11-02", version: 1, ext: "pdf" }, "TUS-26-004_RFP_GIT_2026-11-02_v1.pdf"],
    [{ projectId: P, docType: "RFP-Addendum", qualifier: 1, party: "GIT", date: "2026-11-09", version: 1, ext: "pdf" }, "TUS-26-004_RFP-Addendum-01_GIT_2026-11-09_v1.pdf"],
    [{ projectId: P, docType: "Bid", party: "Brandpoint Roofing", date: "2026-11-20", version: 1, ext: "PDF" }, "TUS-26-004_Bid_BrandpointRoofing_2026-11-20_v1.pdf"],
    [{ projectId: P, docType: "BidLeveling", party: "GIT", date: "2026-11-24", version: 2, ext: "xlsx" }, "TUS-26-004_BidLeveling_GIT_2026-11-24_v2.xlsx"],
    [{ projectId: P, docType: "Contract-Executed", party: "BrandpointRoofing", date: "2026-12-03", version: 1, ext: "pdf" }, "TUS-26-004_Contract-Executed_BrandpointRoofing_2026-12-03_v1.pdf"],
    [{ projectId: P, docType: "CO", qualifier: 2, party: "BrandpointRoofing", date: "2027-01-15", version: 1, ext: "pdf" }, "TUS-26-004_CO-02_BrandpointRoofing_2027-01-15_v1.pdf"],
    [{ projectId: P, docType: "PayRequest", qualifier: 3, party: "BrandpointRoofing", date: "2027-02-01", version: 1, ext: "pdf" }, "TUS-26-004_PayRequest-03_BrandpointRoofing_2027-02-01_v1.pdf"],
    [{ projectId: P, docType: "LienRelease", qualifier: "Conditional-Progress-03", party: "BrandpointRoofing", date: "2027-02-01", version: 1, ext: "pdf" }, "TUS-26-004_LienRelease-Conditional-Progress-03_BrandpointRoofing_2027-02-01_v1.pdf"],
    [{ projectId: P, docType: "Inspection", qualifier: "Final", party: "GIT", date: "2027-03-10", version: 1, ext: "pdf" }, "TUS-26-004_Inspection-Final_GIT_2027-03-10_v1.pdf"],
  ];
  it.each(cases)("%o", (input, expected) => expect(fileName(input)).toBe(expected));

  it("round-trips through the parser used by the nightly audit", () => {
    expect(parseFileName("TUS-26-004_CO-02_BrandpointRoofing_2027-01-15_v1.pdf")).toEqual({
      projectId: "TUS-26-004", docType: "CO-02", party: "BrandpointRoofing", date: "2027-01-15", version: 1, ext: "pdf",
    });
    expect(parseFileName("scan0001.pdf")).toBeNull();
  });
});

describe("folders (section 6.2)", () => {
  it("builds the project folder path", () => {
    expect(projectFolderPath({ state: "tx", propertyCode: "TUS", propertyName: "Tuscany Square", year: 2026, projectId: "TUS-26-004", projectName: "Bldg 1/8 roof: phase 1" }))
      .toBe("TX/TUS - Tuscany Square/2026/TUS-26-004 - Bldg 1-8 roof- phase 1");
  });
  it("routes doc types to subfolders, with vendor and date folders", () => {
    expect(docFolder("Bid", "BrandpointRoofing")).toBe("03 Bids/BrandpointRoofing");
    expect(docFolder("Inspection", undefined, "2027-03-10")).toBe("11 Inspections and Photos/2027-03-10");
    expect(docFolder("LienRelease")).toBe("08 Lien Releases");
    expect(() => docFolder("Nope")).toThrow();
  });
  it("strips characters SharePoint rejects", () => {
    expect(cleanSegment(' a*b:c?"d ')).toBe("a-b-c--d");
  });
});

describe("approval limits confirmed by Joe on 2026-11-16", () => {
  it("routes money by amount", () => {
    expect(chainRolesFor("pay_request", 9999.99)).toEqual(["capex_pm"]);
    expect(chainRolesFor("pay_request", 10000)).toEqual(["capex_pm", "coo"]);
    expect(chainRolesFor("change_order", 50000)).toEqual(["capex_pm", "coo"]);
    expect(chainRolesFor("pay_request", 50000.01)).toEqual(["capex_pm", "coo", "president"]);
  });
  it("sends every award and override to the President", () => {
    expect(chainRolesFor("award", 5000)).toEqual(["capex_pm", "coo", "president"]);
    expect(chainRolesFor("override", 1)).toEqual(["president"]);
  });
});

import { pacificToIso, isoToPacificLocal } from "@/lib/time";
describe("Pacific time for RFP deadlines", () => {
  it("converts winter (PST, UTC-8) and summer (PDT, UTC-7) correctly and round-trips", () => {
    expect(pacificToIso("2027-01-22T14:00")).toBe("2027-01-22T22:00:00.000Z");
    expect(pacificToIso("2027-07-15T14:00")).toBe("2027-07-15T21:00:00.000Z");
    expect(isoToPacificLocal("2027-01-22T22:00:00.000Z")).toBe("2027-01-22T14:00");
    expect(isoToPacificLocal("2027-07-15T21:00:00.000Z")).toBe("2027-07-15T14:00");
  });
});
