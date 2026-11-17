-- GIT Capital Projects Platform — PostgreSQL schema (Phase 1 + Yardi-ready fields)
-- Draft for sign-off, 2026-11-16. Section refs point to the build prompt.
-- Conventions:
--   * every table has id (uuid), status where relevant, created_at/by, updated_at/by
--   * every change is written to audit_log in the same transaction (trigger fn at end)
--   * documents are referenced by SharePoint drive item id, never stored here
--   * money is numeric(14,2) in USD

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Shared columns helper (applied by convention; shown expanded in each table)
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. People, roles, scope (section 5)
-- ===========================================================================
create table app_user (
  id               uuid primary key default gen_random_uuid(),
  entra_object_id  uuid unique,                 -- null for vendor contacts
  email            citext not null unique,
  display_name     text not null,
  job_title        text,
  department       text,
  office           text,
  kind             text not null check (kind in ('employee','vendor_contact')),
  vendor_id        uuid,                        -- fk added after vendor table
  is_active        boolean not null default true,
  last_sign_in_at  timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table role (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,           -- executive, admin, capex_pm, contracts_admin, design_lead, finance, operations, viewer, vendor
  name          text not null,
  entra_group_id uuid,                          -- maps to Entra security group
  is_custom     boolean not null default false,
  permissions   jsonb not null default '[]'     -- list of permission codes
);

create table user_role (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references app_user(id),
  role_id         uuid not null references role(id),
  scope_kind      text not null check (scope_kind in ('all','region','property','project')),
  scope_ids       uuid[] not null default '{}', -- region/property/project ids
  approval_limit  numeric(14,2),                -- null = cannot approve money
  starts_on       date, ends_on date,
  created_at timestamptz not null default now(), created_by uuid
);

-- ===========================================================================
-- 2. Portfolio: regions, properties (sections 2, 12)
-- ===========================================================================
create table region (
  id    uuid primary key default gen_random_uuid(),
  code  text not null unique,                   -- e.g. TX, WEST
  name  text not null,
  rvp_user_id uuid references app_user(id)
);

create table property (
  id                   uuid primary key default gen_random_uuid(),
  code                 char(3) not null unique, -- TUS, MON ...
  name                 text not null,
  address_line1        text, city text, state char(2) not null, postal_code text,
  region_id            uuid references region(id),
  units                int, buildings int,
  legal_description    text,                    -- used on lien releases
  latitude numeric(9,6), longitude numeric(9,6),
  yardi_property_code  text,                    -- YARDI
  rvp_user_id          uuid references app_user(id),
  regional_manager_id  uuid references app_user(id),
  sp_folder_item_id    text,                    -- {State}\{PROP} - {Name}
  status text not null default 'active',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- ===========================================================================
-- 3. Configuration (sections 3.9, 4.1, 11) — business rules live here
-- ===========================================================================
create table project_type (
  id    uuid primary key default gen_random_uuid(),
  code  text not null unique,                   -- roof, paint, asphalt, pool, landscape, irrigation, fire_alarm, amenity, interior_design, insurance_repair ...
  name  text not null,
  enabled_tools text[] not null default '{}',   -- which project-level tools show (Procore-style menu, trimmed)
  schedule_template_id uuid,
  rfp_template_id uuid,
  contract_template_id uuid,
  closeout_checklist_id uuid,
  is_active boolean not null default true
);

create table stage (
  id    uuid primary key default gen_random_uuid(),
  code  text not null unique,                   -- planning, rfp, bidding, award, contract, in_progress, punch, closeout, closed
  name  text not null,
  sort_order int not null
);

create table cost_code (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  yardi_job_cost_code text,                     -- YARDI mapping
  yardi_gl_account text,                        -- YARDI mapping
  is_active boolean not null default true
);

create table approval_threshold (
  id            uuid primary key default gen_random_uuid(),
  object_type   text not null,                  -- rfp, award, contract, change_order, pay_request, override, closeout
  min_amount    numeric(14,2) not null default 0,
  max_amount    numeric(14,2),                  -- null = no upper bound
  approver_chain jsonb not null                 -- ordered list of role codes / user ids, e.g. ["capex_pm","coo"]
);

create table template (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                   -- rfp, contract, addendum, regret_letter, award_letter, resident_notice, email, lien_release
  project_type_id uuid references project_type(id),
  state        char(2),                         -- for lien_release forms
  name         text not null,
  sp_item_id   text not null,                   -- .docx in 00 Portfolio\Templates
  version      int not null default 1,
  counsel_approved_at timestamptz,              -- required for lien_release before go-live
  is_active boolean not null default true
);

create table checklist_template (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                    -- inspection, payment_gate, closeout
  project_type_id uuid references project_type(id),
  name        text not null,
  items       jsonb not null                    -- [{key,label,required,photo_required,applies_to}]
);

create table naming_pattern (
  id       uuid primary key default gen_random_uuid(),
  kind     text not null unique,                -- project_folder, file_name, project_id, rfp_number, contract_number ...
  pattern  text not null                        -- e.g. {ProjectID}_{DocType}_{Party}_{YYYY-MM-DD}_v{n}.{ext}
);

create table rule (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  event       text not null,                    -- e.g. pay_request.submitted
  conditions  jsonb not null default '{}',      -- JSON-logic
  actions     jsonb not null,                   -- [{type:'email',...},{type:'block',...}]
  is_enabled  boolean not null default true,
  owner_user_id uuid references app_user(id),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table rule_firing (
  id         bigserial primary key,
  rule_id    uuid not null references rule(id),
  event_id   uuid not null,
  object_type text not null, object_id uuid not null,
  result     text not null,                     -- fired, skipped, failed
  detail     jsonb,
  fired_at   timestamptz not null default now()
);

-- ===========================================================================
-- 4. Capital plan (section 7.3) — Phase 2 UI, table now
-- ===========================================================================
create table capital_plan_line (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references property(id),
  plan_year     int not null,
  category      text,
  description   text not null,
  priority      int,
  estimate      numeric(14,2),
  funding_source text check (funding_source in ('operating','reserves','insurance','loan_draw')),
  scenario      text not null default 'base',
  status        text not null default 'proposed',
  project_id    uuid,                           -- set when promoted
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- ===========================================================================
-- 5. Projects (section 7.2)
-- ===========================================================================
create table project (
  id               uuid primary key default gen_random_uuid(),
  project_code     text not null unique,        -- {PROP}-{YY}-{###}, e.g. TUS-26-004
  property_id      uuid not null references property(id),
  project_type_id  uuid not null references project_type(id),
  name             text not null,
  stage_id         uuid not null references stage(id),
  manager_user_id  uuid not null references app_user(id),
  health           text not null default 'on_track' check (health in ('on_track','at_risk','late','blocked')),
  planned_start date, planned_end date,
  baseline_start date, baseline_end date,
  actual_start date, actual_end date,
  budget_source    text,                        -- capital plan / reserves / insurance ...
  budget_amount    numeric(14,2),
  insurance_claim_id uuid,                      -- optional, section 7.3
  enabled_tools    text[],                      -- overrides project_type defaults
  sp_folder_item_id text,                       -- project folder in SharePoint
  scope_summary    text,
  last_activity_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table project_member (
  project_id uuid not null references project(id),
  user_id    uuid not null references app_user(id),
  role_on_project text not null,                -- manager, inspector, design, operations, finance, viewer
  primary key (project_id, user_id)
);

create table insurance_claim (
  id           uuid primary key default gen_random_uuid(),
  claim_number text not null,
  carrier      text, adjuster_name text, adjuster_email citext,
  loss_date    date,
  reimbursed_to_date numeric(14,2) not null default 0,
  notes        text
);
alter table project add constraint project_claim_fk foreign key (insurance_claim_id) references insurance_claim(id);

-- ===========================================================================
-- 6. Budget (section 7.3) — committed/invoiced/paid are derived (view below)
-- ===========================================================================
create table budget_line (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references project(id),
  cost_code_id     uuid not null references cost_code(id),
  description      text,
  original_budget  numeric(14,2) not null default 0,
  approved_changes numeric(14,2) not null default 0,
  forecast_override numeric(14,2),              -- PM forecast at completion
  forecast_note    text,
  yardi_gl_account text, yardi_job_code text,   -- YARDI (defaults from cost_code)
  unique (project_id, cost_code_id)
);

create table contingency_draw (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  amount      numeric(14,2) not null,
  to_budget_line_id uuid references budget_line(id),
  reason      text not null,
  approved_by uuid references app_user(id),
  created_at timestamptz not null default now(), created_by uuid
);

-- ===========================================================================
-- 7. Schedule (section 7.4)
-- ===========================================================================
create table schedule_task (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references project(id),
  parent_id      uuid references schedule_task(id),
  name           text not null,
  kind           text not null default 'task' check (kind in ('phase','task','milestone')),
  start_date date, end_date date, duration_days int,
  baseline_start date, baseline_end date,
  percent_complete numeric(5,2) not null default 0,
  owner_user_id  uuid references app_user(id),
  is_payment_milestone boolean not null default false,
  is_inspection_hold_point boolean not null default false,
  inspection_template_id uuid references checklist_template(id),
  sort_order     int not null default 0
);

create table task_dependency (
  predecessor_id uuid not null references schedule_task(id),
  successor_id   uuid not null references schedule_task(id),
  kind  text not null default 'FS',             -- FS, SS, FF, SF
  lag_days int not null default 0,
  primary key (predecessor_id, successor_id)
);

create table schedule_change (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references schedule_task(id),
  old_end   date, new_end date,
  reason    text not null,                      -- required for any slip
  created_at timestamptz not null default now(), created_by uuid
);

create table weather_day (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  day        date not null,
  note       text,
  unique (project_id, day)
);

-- ===========================================================================
-- 8. Vendors (section 8.2)
-- ===========================================================================
create table vendor (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  short_name      text not null unique check (short_name !~ '\s'),  -- BrandpointRoofing
  trades          text[] not null default '{}',
  states_served   char(2)[] not null default '{}',
  regions_served  uuid[] not null default '{}',
  approved_status text not null default 'pending' check (approved_status in ('pending','approved','preferred','probation','do_not_use')),
  w9_doc_id       uuid,
  msa_doc_id      uuid,
  yardi_vendor_id text,                         -- YARDI
  tax_id_last4    char(4),                      -- never the full TIN
  sp_folder_item_id text,                       -- 01 Vendors\{ShortName}
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
alter table app_user add constraint app_user_vendor_fk foreign key (vendor_id) references vendor(id);

create table vendor_contact (
  id        uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor(id),
  user_id   uuid references app_user(id),       -- portal account when invited
  name text not null, email citext not null, phone text, title text,
  is_primary boolean not null default false
);

create table vendor_license (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references vendor(id),
  state      char(2) not null, license_number text not null, classification text,
  expires_on date,
  document_id uuid
);

create table vendor_coi (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references vendor(id),
  carrier       text,
  gl_each_occurrence numeric(14,2), gl_aggregate numeric(14,2),
  auto_limit numeric(14,2), wc_limit numeric(14,2), umbrella_limit numeric(14,2),
  additional_insured_ok boolean,
  effective_on date, expires_on date not null,
  document_id   uuid,
  extracted_confidence numeric(4,3)
);

create table vendor_rating (
  id         uuid primary key default gen_random_uuid(),
  vendor_id  uuid not null references vendor(id),
  project_id uuid not null references project(id),
  quality int check (quality between 1 and 5),
  schedule int check (schedule between 1 and 5),
  communication int check (communication between 1 and 5),
  comment text,
  created_at timestamptz not null default now(), created_by uuid
);

-- ===========================================================================
-- 9. Documents (sections 4.2, 6) — metadata + SharePoint ids only
-- ===========================================================================
create table document (
  id               uuid primary key default gen_random_uuid(),
  sp_drive_id      text not null,
  sp_item_id       text not null,
  sp_path          text not null,
  sp_version       text,
  file_name        text not null,               -- convention name
  original_file_name text,                      -- vendor's name, kept in metadata
  doc_type         text not null,               -- RFP, RFP-Addendum-01, Bid, Contract-Executed, PayRequest-03, LienRelease-..., COI, W9 ...
  version_n        int not null default 1,
  project_id       uuid references project(id),
  vendor_id        uuid references vendor(id),
  amount           numeric(14,2),
  doc_date         date,
  source           text not null,               -- upload, email, portal, docusign, generated
  classification_confidence numeric(4,3),
  filing_status    text not null default 'filed' check (filing_status in ('filed','unfiled','rejected')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (sp_drive_id, sp_item_id)
);

alter table vendor add constraint vendor_w9_fk foreign key (w9_doc_id) references document(id);
alter table vendor add constraint vendor_msa_fk foreign key (msa_doc_id) references document(id);

-- ===========================================================================
-- 10. RFP, invitations, bids, award (section 8)
-- ===========================================================================
create table rfp (
  id            uuid primary key default gen_random_uuid(),
  rfp_number    text not null unique,           -- RFP-{PROP}-{###}
  project_id    uuid not null references project(id),
  template_id   uuid references template(id),
  status        text not null default 'draft' check (status in ('draft','in_review','approved','issued','closed','awarded','cancelled')),
  scope         jsonb,                          -- numbered scope, inclusions, exclusions, specs
  requirements  jsonb,                          -- insurance minimums, license, bonding, prevailing wage, retainage ...
  issue_date date, site_walk_at timestamptz, questions_due_at timestamptz,
  bid_due_at timestamptz, target_award_date date, target_start_date date,
  rfp_document_id uuid references document(id),
  bid_form_document_id uuid references document(id),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table bid_form_line (
  id        uuid primary key default gen_random_uuid(),
  rfp_id    uuid not null references rfp(id),
  line_no   text not null,                      -- 1, 2, 2a ...
  description text not null,
  quantity  numeric(14,3), unit text,
  kind      text not null default 'base' check (kind in ('base','alternate','allowance','unit_price')),
  cost_code_id uuid references cost_code(id),
  sort_order int not null default 0,
  unique (rfp_id, line_no)
);

create table rfp_addendum (
  id         uuid primary key default gen_random_uuid(),
  rfp_id     uuid not null references rfp(id),
  number     int not null,                      -- Addendum No. n
  summary    text,
  issued_at  timestamptz,
  document_id uuid references document(id),
  unique (rfp_id, number)
);

create table invitation (
  id          uuid primary key default gen_random_uuid(),
  rfp_id      uuid not null references rfp(id),
  vendor_id   uuid not null references vendor(id),
  sent_by     uuid references app_user(id),
  sent_at timestamptz, opened_at timestamptz,
  intent      text check (intent in ('will_bid','declined')),
  decline_reason text,
  submitted_at timestamptz,
  is_late     boolean not null default false,
  late_accepted_by uuid references app_user(id),
  acknowledged_addenda int[] not null default '{}',
  reminders_sent jsonb not null default '[]',
  magic_link_hash text,
  unique (rfp_id, vendor_id)
);

create table rfp_question (
  id            uuid primary key default gen_random_uuid(),
  rfp_id        uuid not null references rfp(id),
  invitation_id uuid references invitation(id),
  question      text not null,
  answer        text,
  answered_by   uuid references app_user(id),
  published_at  timestamptz,
  addendum_id   uuid references rfp_addendum(id)
);

create table bid (
  id             uuid primary key default gen_random_uuid(),
  invitation_id  uuid not null references invitation(id),
  version        int not null default 1,
  source         text not null check (source in ('portal','email','upload')),
  total_base     numeric(14,2),
  schedule_days  int,
  warranty_years numeric(4,1),
  exclusions     text[],
  qualifications text[],
  insurance_compliant boolean,
  extraction_confidence numeric(4,3),
  document_id    uuid references document(id),
  received_at    timestamptz not null default now(),
  unique (invitation_id, version)
);

create table bid_line (
  id              uuid primary key default gen_random_uuid(),
  bid_id          uuid not null references bid(id),
  bid_form_line_id uuid not null references bid_form_line(id),
  unit_price      numeric(14,2),
  amount          numeric(14,2),
  included        boolean not null default true,
  note            text,
  field_confidence numeric(4,3),
  confirmed_by    uuid references app_user(id),
  unique (bid_id, bid_form_line_id)
);

create table bid_normalization (                -- plugs for missing scope, shown separately
  id         uuid primary key default gen_random_uuid(),
  bid_id     uuid not null references bid(id),
  bid_form_line_id uuid references bid_form_line(id),
  amount     numeric(14,2) not null,
  reason     text not null,
  created_by uuid
);

create table award (
  id            uuid primary key default gen_random_uuid(),
  rfp_id        uuid not null unique references rfp(id),
  bid_id        uuid not null references bid(id),
  memo          text,
  alternates_accepted text[] not null default '{}',
  leveling_document_id uuid references document(id),
  memo_document_id uuid references document(id),
  status        text not null default 'pending_approval',
  created_at timestamptz not null default now(), created_by uuid
);

-- ===========================================================================
-- 11. Contracts, SOV, change orders (section 9.1, 9.2)
-- ===========================================================================
create table contract (
  id             uuid primary key default gen_random_uuid(),
  contract_number text not null unique,         -- {ProjectID}-K{##}
  project_id     uuid references project(id),   -- null for portfolio service contracts
  property_ids   uuid[] not null default '{}',  -- service contracts may cover several properties
  vendor_id      uuid not null references vendor(id),
  award_id       uuid references award(id),
  kind           text not null default 'project' check (kind in ('project','service')),
  original_value numeric(14,2) not null,
  retainage_pct  numeric(5,2) not null default 10,
  payment_terms  text,
  start_date date, end_date date,
  warranty_years numeric(4,1),
  auto_renews    boolean not null default false,
  renewal_notice_date date,
  key_terms      jsonb,                         -- extracted by Claude
  review_report_id uuid,
  docusign_envelope_id text,
  executed_document_id uuid references document(id),
  status         text not null default 'draft' check (status in ('draft','in_review','negotiating','pending_approval','out_for_signature','executed','closed','terminated')),
  yardi_contract_number text, yardi_po_number text,   -- YARDI
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table sov_line (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references contract(id),
  line_no        text not null,
  description    text not null,
  scheduled_value numeric(14,2) not null,
  budget_line_id uuid references budget_line(id),
  schedule_task_id uuid references schedule_task(id),  -- payment milestone link
  source_bid_line_id uuid references bid_line(id),      -- no re-keying from award
  unique (contract_id, line_no)
);

create table contract_review (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contract(id),
  document_id uuid not null references document(id),
  findings    jsonb not null,                   -- [{clause, status:found|missing|changed, risk, explanation, suggested_redline}]
  ai_run_id   uuid,
  reviewed_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
alter table contract add constraint contract_review_fk foreign key (review_report_id) references contract_review(id);

create table contract_issue (                   -- redline negotiation tracker
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contract(id),
  clause      text not null,
  description text not null,
  owner_user_id uuid references app_user(id),
  decision    text,
  status      text not null default 'open'
);

create table change_event (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  title       text not null,
  reason      text not null check (reason in ('owner_request','unforeseen_condition','design_change','code','weather','other')),
  source      text,                             -- rfi, inspection, email, site_walk
  est_cost    numeric(14,2), est_days int,
  status      text not null default 'open',
  created_at timestamptz not null default now(), created_by uuid
);

create table change_order (
  id            uuid primary key default gen_random_uuid(),
  co_number     text not null unique,           -- {ProjectID}-CO{##}
  contract_id   uuid not null references contract(id),
  change_event_id uuid references change_event(id),
  amount        numeric(14,2) not null,
  schedule_days int not null default 0,
  description   text not null,
  status        text not null default 'pending' check (status in ('draft','pending','approved','rejected','executed','void')),
  docusign_envelope_id text,
  document_id   uuid references document(id),
  created_at timestamptz not null default now(), created_by uuid
);

create table change_order_line (
  id              uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references change_order(id),
  sov_line_id     uuid references sov_line(id), -- null = new SOV line
  description     text not null,
  amount          numeric(14,2) not null,
  budget_line_id  uuid references budget_line(id)
);

-- ===========================================================================
-- 12. Pay requests, gates, payments (section 9.3)
-- ===========================================================================
create table pay_request (
  id             uuid primary key default gen_random_uuid(),
  pr_number      text not null unique,          -- {ProjectID}-PR{##}
  contract_id    uuid not null references contract(id),
  period_end     date not null,
  gross_amount   numeric(14,2) not null,        -- work this period
  retainage_amount numeric(14,2) not null,
  net_amount     numeric(14,2) not null,
  is_final       boolean not null default false,
  source         text not null check (source in ('portal','email','upload')),
  status         text not null default 'submitted' check (status in ('draft','submitted','blocked','in_approval','approved','approved_for_payment','paid','rejected')),
  invoice_document_id uuid references document(id),
  packet_document_id  uuid references document(id),
  yardi_invoice_number text,                    -- YARDI
  exported_to_yardi_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table pay_request_line (
  id             uuid primary key default gen_random_uuid(),
  pay_request_id uuid not null references pay_request(id),
  sov_line_id    uuid not null references sov_line(id),
  percent_complete_to_date numeric(5,2),
  amount_this_period numeric(14,2) not null,
  unique (pay_request_id, sov_line_id)
);

create table gate_item (                        -- payment gate checklist instance
  id             uuid primary key default gen_random_uuid(),
  pay_request_id uuid not null references pay_request(id),
  key            text not null,                 -- pm_verified, inspection_passed, conditional_release, prior_unconditional, subtier_releases, coi_current, license_current, w9_on_file, no_hold
  label          text not null,
  status         text not null default 'missing' check (status in ('missing','satisfied','overridden','n_a')),
  evidence_type  text, evidence_id uuid,        -- inspection, lien_release, document ...
  override_by    uuid references app_user(id),
  override_reason text,
  satisfied_at   timestamptz,
  unique (pay_request_id, key)
);

create table payment (
  id             uuid primary key default gen_random_uuid(),
  pay_request_id uuid not null references pay_request(id),
  paid_on        date not null,
  method         text not null check (method in ('check','ach','wire')),
  reference_number text not null,               -- check / ACH number
  amount         numeric(14,2) not null,
  source         text not null default 'manual' check (source in ('manual','csv_import','yardi_sync')),
  created_at timestamptz not null default now(), created_by uuid
);

-- ===========================================================================
-- 13. Lien releases (section 9.4)
-- ===========================================================================
create table contract_party (                   -- subs and suppliers per contract
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contract(id),
  party_kind  text not null check (party_kind in ('prime','sub','supplier')),
  name        text not null,
  vendor_id   uuid references vendor(id),
  preliminary_notice_received_on date,
  releases_required boolean not null default true
);

create table lien_release (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references contract(id),
  pay_request_id uuid references pay_request(id),
  party_id       uuid not null references contract_party(id),
  release_type   text not null check (release_type in ('conditional_progress','unconditional_progress','conditional_final','unconditional_final')),
  state          char(2) not null,
  template_id    uuid references template(id),
  amount         numeric(14,2),
  through_date   date,
  check_number   text,
  status         text not null default 'requested' check (status in ('requested','received','validated','rejected','missing','waived')),
  validation     jsonb,                         -- Claude check: form, amounts, dates, signature, added conditions
  document_id    uuid references document(id),
  docusign_envelope_id text,
  requested_at timestamptz, received_at timestamptz, validated_at timestamptz
);

create table lien_deadline (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  completion_date date,
  notice_of_completion_recorded_on date,
  lien_period_days int,                         -- from state settings (admin + counsel)
  lien_period_ends_on date
);

create table state_lien_setting (
  state char(2) primary key,
  statute_reference text,                       -- e.g. Cal. Civ. Code 8132-8138
  lien_period_days_with_notice int,
  lien_period_days_without_notice int,
  counsel_approved_at timestamptz
);

-- ===========================================================================
-- 14. Field: inspections, punch, daily logs, photos (section 10)
-- ===========================================================================
create table inspection (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project(id),
  template_id   uuid not null references checklist_template(id),
  schedule_task_id uuid references schedule_task(id),
  kind          text not null,                  -- pre_con, delivery, milestone, municipal, substantial, final, warranty
  inspector_user_id uuid references app_user(id),
  scheduled_at  timestamptz, performed_at timestamptz,
  outcome       text check (outcome in ('pass','fail','partial')),
  inspector_signature text, vendor_signature text,
  report_document_id uuid references document(id),
  outlook_event_id text,
  offline_client_id text unique,                -- idempotent offline sync
  created_at timestamptz not null default now(), created_by uuid
);

create table inspection_result (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspection(id),
  item_key      text not null,
  result        text not null check (result in ('pass','fail','n_a')),
  note          text,
  unique (inspection_id, item_key)
);

create table photo (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  document_id uuid not null references document(id),
  taken_at    timestamptz, latitude numeric(9,6), longitude numeric(9,6),
  building    text, location text, milestone text,
  phase       text check (phase in ('before','during','after')),
  inspection_result_id uuid references inspection_result(id),
  markup      jsonb
);

create table punch_item (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references project(id),
  source_inspection_id uuid references inspection(id),
  title         text not null, location text,
  assignee_vendor_id uuid references vendor(id),
  assignee_user_id uuid references app_user(id),
  due_on        date,
  status        text not null default 'open' check (status in ('open','vendor_complete','verified','void')),
  holds_payment boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid
);

create table daily_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  log_date    date not null,
  author_user_id uuid references app_user(id),
  crew_count  int, work_done text, weather text, delays text, deliveries text, safety_notes text,
  offline_client_id text unique,
  created_at timestamptz not null default now()
);

create table warranty (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  property_id uuid not null references property(id),
  component   text not null,
  vendor_id   uuid references vendor(id),
  starts_on date not null, ends_on date not null,
  document_id uuid references document(id)
);

create table closeout_item (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  key         text not null, label text not null,
  status      text not null default 'missing' check (status in ('missing','satisfied','overridden','n_a')),
  evidence_id uuid,
  override_by uuid references app_user(id), override_reason text,
  unique (project_id, key)
);

-- ===========================================================================
-- 15. Approvals, decisions, tasks, comments (section 10.4)
-- ===========================================================================
create table approval (
  id            uuid primary key default gen_random_uuid(),
  object_type   text not null,                  -- rfp, award, contract, change_order, pay_request, override, closeout
  object_id     uuid not null,
  step          int not null default 1,
  approver_user_id uuid not null references app_user(id),
  threshold_id  uuid references approval_threshold(id),
  decision      text check (decision in ('approved','changes_requested','discuss','rejected')),
  note          text,
  channel       text check (channel in ('app','email','phone','teams')),
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz
);
create index approval_open_idx on approval (approver_user_id) where decision is null;

create table decision_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references project(id),
  decision    text not null,
  rationale   text,
  decided_by  uuid references app_user(id),
  decided_at  timestamptz not null default now(),
  approval_id uuid references approval(id)
);

create table task (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references project(id),
  title       text not null,
  assignee_user_id uuid references app_user(id),
  due_on      date,
  status      text not null default 'open',
  related_type text, related_id uuid,
  created_at timestamptz not null default now(), created_by uuid
);

create table comment (
  id          uuid primary key default gen_random_uuid(),
  object_type text not null, object_id uuid not null,
  body        text not null,
  mentions    uuid[] not null default '{}',
  created_at timestamptz not null default now(), created_by uuid not null
);

-- ===========================================================================
-- 16. Email and AI logs (sections 4.2, 4.4)
-- ===========================================================================
create table email_message (
  id              uuid primary key default gen_random_uuid(),
  graph_message_id text not null unique,
  conversation_id text,
  mailbox         citext not null,
  direction       text not null check (direction in ('in','out')),
  subject         text, from_address citext, to_addresses citext[],
  sent_at         timestamptz,
  project_id      uuid references project(id),
  rfp_id          uuid references rfp(id),
  vendor_id       uuid references vendor(id),
  match_method    text,                         -- plus_address, subject_number, thread, vendor_domain, manual
  match_confidence numeric(4,3),
  filed_document_ids uuid[] not null default '{}',
  needs_review    boolean not null default false
);

create table ai_run (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,                    -- classify, extract_bid, gap_analysis, contract_review, validate_release, draft ...
  model       text not null,
  object_type text, object_id uuid,
  input_document_ids uuid[] not null default '{}',
  prompt      text not null,                    -- redacted
  output      jsonb,
  confidence  numeric(4,3),
  tokens_in int, tokens_out int,
  status      text not null,
  created_at  timestamptz not null default now(), created_by uuid
);

-- ===========================================================================
-- 17. Audit log (section 13) — append only
-- ===========================================================================
create table audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_user_id uuid,
  actor_kind  text not null default 'user',     -- user, system, rule, ai
  action      text not null,                    -- insert, update, delete, approve, override, email, file
  object_type text not null,
  object_id   uuid,
  before      jsonb,
  after       jsonb,
  reason      text
);
revoke update, delete on audit_log from public;

create or replace function audit_row() returns trigger language plpgsql as $$
begin
  insert into audit_log(actor_user_id, action, object_type, object_id, before, after)
  values (nullif(current_setting('app.user_id', true), '')::uuid,
          lower(tg_op), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['property','project','budget_line','schedule_task','vendor','vendor_coi','rfp','invitation','bid','bid_line','award',
                               'contract','sov_line','change_order','pay_request','gate_item','payment','lien_release','inspection','punch_item',
                               'approval','rule','user_role','closeout_item','document'])
  loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row()', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 18. Derived views
-- ===========================================================================

-- Budget roll-up per line: committed / invoiced / paid / retainage come from contracts, COs, pay requests
create or replace view v_budget_line as
select bl.id, bl.project_id, bl.cost_code_id,
       bl.original_budget,
       bl.approved_changes,
       bl.original_budget + bl.approved_changes                              as revised_budget,
       coalesce(c.committed,0)                                                as committed,
       coalesce(pco.pending,0)                                                as pending_changes,
       coalesce(i.invoiced,0)                                                 as invoiced,
       coalesce(p.paid,0)                                                     as paid,
       coalesce(i.retainage,0)                                                as retainage_held,
       coalesce(bl.forecast_override, greatest(bl.original_budget + bl.approved_changes, coalesce(c.committed,0) + coalesce(pco.pending,0))) as forecast,
       coalesce(bl.forecast_override, greatest(bl.original_budget + bl.approved_changes, coalesce(c.committed,0) + coalesce(pco.pending,0)))
         - (bl.original_budget + bl.approved_changes)                         as variance
from budget_line bl
left join lateral (
  select sum(s.scheduled_value) + coalesce((select sum(col.amount) from change_order_line col join change_order co on co.id = col.change_order_id
                                            where col.budget_line_id = bl.id and co.status in ('approved','executed')),0) as committed
  from sov_line s join contract k on k.id = s.contract_id
  where s.budget_line_id = bl.id and k.status = 'executed') c on true
left join lateral (
  select sum(col.amount) as pending from change_order_line col join change_order co on co.id = col.change_order_id
  where col.budget_line_id = bl.id and co.status = 'pending') pco on true
left join lateral (
  select sum(prl.amount_this_period) as invoiced,
         round(sum(prl.amount_this_period * k.retainage_pct / 100),2) as retainage
  from pay_request_line prl join sov_line s on s.id = prl.sov_line_id
  join pay_request pr on pr.id = prl.pay_request_id join contract k on k.id = s.contract_id
  where s.budget_line_id = bl.id and pr.status in ('approved','approved_for_payment','paid')) i on true
left join lateral (
  select round(sum(prl.amount_this_period * (1 - k.retainage_pct / 100)),2) as paid
  from pay_request_line prl join sov_line s on s.id = prl.sov_line_id
  join pay_request pr on pr.id = prl.pay_request_id join contract k on k.id = s.contract_id
  where s.budget_line_id = bl.id and pr.status = 'paid') p on true;

-- Overbilling guard: billed-to-date per SOV line may not exceed scheduled value + approved COs
create or replace function check_overbilling() returns trigger language plpgsql as $$
declare cap numeric; billed numeric;
begin
  select s.scheduled_value + coalesce(sum(col.amount) filter (where co.status in ('approved','executed')),0)
    into cap
  from sov_line s
  left join change_order_line col on col.sov_line_id = s.id
  left join change_order co on co.id = col.change_order_id
  where s.id = new.sov_line_id group by s.scheduled_value;

  select coalesce(sum(amount_this_period),0) into billed
  from pay_request_line prl join pay_request pr on pr.id = prl.pay_request_id
  where prl.sov_line_id = new.sov_line_id and pr.status <> 'rejected' and prl.id <> new.id;

  if billed + new.amount_this_period > cap then
    raise exception 'Overbilling: SOV line % would bill % against cap %', new.sov_line_id, billed + new.amount_this_period, cap;
  end if;
  return new;
end $$;
create trigger pay_request_line_overbilling before insert or update on pay_request_line
  for each row execute function check_overbilling();

-- Payment gate: a pay request cannot move to approved while any gate item is missing
create or replace function check_payment_gate() returns trigger language plpgsql as $$
begin
  if new.status in ('approved','approved_for_payment') and exists (
       select 1 from gate_item g where g.pay_request_id = new.id and g.status = 'missing') then
    raise exception 'Payment gate: pay request % has missing gate items', new.pr_number;
  end if;
  return new;
end $$;
create trigger pay_request_gate before update of status on pay_request
  for each row execute function check_payment_gate();

-- Yardi export (section 4.5) — column layout is configurable in the app; this is the default
create or replace view v_yardi_export as
select pr.pr_number            as invoice_number,
       v.yardi_vendor_id       as vendor_id,
       p.yardi_property_code   as property_code,
       bl.yardi_gl_account     as gl_account,
       bl.yardi_job_code       as job_code,
       k.yardi_contract_number as contract_number,
       pr.period_end           as invoice_date,
       round(sum(prl.amount_this_period * (1 - k.retainage_pct / 100)),2) as net_amount,
       pr.id                   as pay_request_id
from pay_request pr
join contract k on k.id = pr.contract_id
join vendor v on v.id = k.vendor_id
join project pj on pj.id = k.project_id
join property p on p.id = pj.property_id
join pay_request_line prl on prl.pay_request_id = pr.id
join sov_line s on s.id = prl.sov_line_id
left join budget_line bl on bl.id = s.budget_line_id
where pr.status = 'approved_for_payment' and pr.exported_to_yardi_at is null
group by pr.id, v.yardi_vendor_id, p.yardi_property_code, bl.yardi_gl_account, bl.yardi_job_code, k.yardi_contract_number;
