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

Next: sprint 2 (portfolio Gantt, schedules, budgets UI, Excel import and export, PWA), then the RFP, bidding, contract and payment modules.

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
