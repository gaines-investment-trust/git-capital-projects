-- Sprint 4: leveling, award, contracts.

alter table award add column if not exists leveled_total numeric(14,2);
alter table award add column if not exists contract_value numeric(14,2);
alter table award add column if not exists decided_at timestamptz;
alter table bid_normalization add column if not exists created_at timestamptz not null default now();
alter table contract add column if not exists sov_from_bid_id uuid references bid(id);
alter table contract add column if not exists draft_document_id uuid references document(id);
alter table contract add column if not exists signed_via text check (signed_via in ('docusign','upload'));
alter table contract add column if not exists executed_at timestamptz;

-- AI results are stored with their run for audit (build prompt 4.4)
create table if not exists ai_finding (
  id         uuid primary key default gen_random_uuid(),
  ai_run_id  uuid references ai_run(id),
  object_type text not null, object_id uuid not null,
  vendor_id  uuid references vendor(id),
  severity   text not null check (severity in ('info','warning','gap')),
  finding    text not null,
  source     text not null default 'rules' check (source in ('rules','claude')),
  created_at timestamptz not null default now()
);

-- Contract defaults and closeout checklist (admin-editable)
insert into app_setting (key, value) values
 ('contract.defaults', '{"warranty_years": 2, "retainage_pct": 10, "payment_terms": "Net 30 after approval of a complete pay request", "liquidated_damages": null}'),
 ('ai.models', '{"review": "claude-sonnet-5-5", "classify": "claude-haiku-5-5"}')
on conflict (key) do nothing;

insert into checklist_template (kind, name, items) values
 ('closeout','Default closeout','[
   {"key":"punch_complete","label":"Punch list complete"},
   {"key":"final_inspection","label":"Final inspection passed"},
   {"key":"final_releases","label":"Final unconditional releases (prime and sub-tier)"},
   {"key":"warranties","label":"Warranty certificates received"},
   {"key":"as_builts","label":"As-builts and manuals"},
   {"key":"permits_closed","label":"Permits closed"},
   {"key":"final_coi","label":"Final COI on file"},
   {"key":"retainage_release","label":"Final pay request and retainage release"},
   {"key":"vendor_rating","label":"Vendor rated"}
 ]');
