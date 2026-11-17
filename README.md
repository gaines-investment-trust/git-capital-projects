# GIT Capital Projects Platform

Gaines Investment Trust's internal platform for capital, deferred-maintenance, landscape, irrigation and insurance projects: planning, RFPs, bids, contracts, payments with lien-release gates, and closeout. Built on Microsoft 365 (Entra ID sign-in, documents in SharePoint, email from Outlook), Azure, DocuSign and Claude.

- Build prompt and design package: see the claude.ai project "GIT Project Management Software Platform".
- Setup, deployment and operations: [docs/SETUP.md](docs/SETUP.md).

## Status

**Sprint 1 (foundation) complete:**
- Entra ID sign-in, with a bootstrap admin on the first sign-in.
- Role and scope checks enforced in services and in the database.
- Properties.
- Project wizard: project ID, the full SharePoint folder tree, a default schedule by project type, and budget lines.
- Filing service: convention names, never overwrites, SharePoint metadata, and an Unfiled queue for anything below 90% confidence.
- Add people: Microsoft 365 directory search, role, scope and approval limit, deactivation with hand-off of open work.
- Approval routing at the confirmed limits.
- Append-only audit log.
- Database-level overbilling and payment-gate controls.

**Sprint 2 complete:**
- Schedule editing. Any slip needs a written reason and is logged.
- Finish-to-start task links: later tasks move to follow a slipped task, and each move is logged.
- Schedule baselines.
- Automatic project health: late, or at risk against the baseline.
- Budget split across cost codes, locked from the contract stage on.
- Portfolio views: Grid, Board by stage and Gantt with baseline.
- Excel export of the portfolio and of each project budget.
- Installable app: manifest, icon, service worker and offline page.

**Sprint 3 complete:**
- Vendor directory:
  - duplicate detection;
  - insurance certificates, licenses and status;
  - a compliance check (insurance, license for the property's state, W-9, do-not-use);
  - bid history on each vendor.
- RFP builder:
  - numbered RFPs (`RFP-{PROP}-{###}`) with the project type's default bid form and GIT's insurance minimums;
  - scope, bid form editor, key dates in Pacific time, requirements;
  - a package check that blocks submission until everything required is in place.
- Approval engine:
  - sequential chains at the confirmed limits, with the PM's own step counting as their submission;
  - "Needs your OK" inbox with Approve, Request changes and Discuss; a note is required when sending back;
  - President steps wait for Jeff's account and are never taken by another executive;
  - every decision logged.
- Issuing an RFP generates the Word document and an Excel bid form and files both in `02 RFP/Issued` by the naming convention.
- Invitations:
  - sent from the manager's own Outlook, or a local outbox until Graph is approved, with the RFP attached;
  - a personal portal link per vendor, stored only as a hash and expiring 14 days after bids close;
  - do-not-use vendors skipped, never invited twice.
- Vendor portal, with no password and built for phones:
  - confirm intent, or decline with a reason;
  - ask questions, with answers published to all bidders;
  - electronic bid form with a live total; every resubmission is kept as a version and late bids are flagged.

**Sprint 4 complete:**
- Bid leveling (`/rfps/{number}/leveling`):
  - closing bidding from the RFP page;
  - side-by-side lines per bidder, using each bidder's latest bid version;
  - toggles for alternates and for plugs (median of other bids, priced for missing scope and shown separately, never part of contract value);
  - outlier flags at ±30% of the median with three or more bids;
  - a paperwork check per bidder;
  - the lowest compliant bidder recommended.
- Gap analysis:
  - rules (missing or excluded scope, outliers, late bids, paperwork), plus Claude's review once the API key is set, with vendor data redacted and every run logged;
  - an editable clarification email per bidder, sent from the manager's Outlook.
- Award:
  - a required memo, with the chosen alternates;
  - blocked if the winner's paperwork is incomplete or any base line is unpriced (a revised bid clears this);
  - approval goes PM, then COO, then President.
- Contract:
  - on final approval, `{PROJECT}-K##` is created with a schedule of values built straight from the winning bid and linked to budget lines, with no re-keying;
  - the Word contract is generated and filed (DocuSign sending waits for GIT's credentials);
  - uploading the signed PDF executes the contract, commits the budget, starts the closeout checklist and saves the schedule baseline;
  - regret letters go to the other bidders.
- Vendors: W-9 upload (PDF), filed under `00 Portfolio/Vendors/{Vendor}`.
- File names and date checks use the California calendar date, not UTC.

- DocuSign: contracts go out for signature (vendor, then GIT), progress tracked through Connect, the signed PDF with certificate filed automatically and the contract executed; declines return to draft with the reason; pull-back voids the envelope. Switches on once the private key and Connect key are in Key Vault (docs/SETUP.md).

Next: sprint 5, pay requests with the payment gate, lien releases, and change orders.

## Layout

| Path | What |
| --- | --- |
| `db/migrations` | Schema (68 tables) and GIT's starting configuration |
| `src/lib` | Settings, database, access control, naming rules, SharePoint document store |
| `src/services` | Projects, filing, people, approvals |
| `src/app` | Screens (Next.js App Router) and server actions |
| `infra/main.bicep` | Azure resources |
| `.github/workflows/deploy.yml` | Test, build, deploy, migrate, smoke check |
| `test/`, `e2e/` | Unit, integration (PostgreSQL) and browser tests |
