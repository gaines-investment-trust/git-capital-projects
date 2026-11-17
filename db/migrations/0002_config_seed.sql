-- GIT starting configuration (design package section 6). Admin-editable after go-live.

-- Extra columns and counters the app needs
alter table project_type add column if not exists default_schedule jsonb not null default '[]';
alter table project_type add column if not exists default_cost_codes text[] not null default '{}';

create table if not exists number_counter (
  scope  text not null,          -- e.g. project:TUS:26, rfp:TUS
  last_n int  not null default 0,
  primary key (scope)
);

create table if not exists app_setting (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Roles (section 5)
insert into role (code, name, permissions) values
 ('executive',       'Executive',                 '["*"]'),
 ('admin',           'Admin',                     '["admin.*","people.manage","settings.edit"]'),
 ('capex_pm',        'Capital Project Manager',   '["project.create","project.edit","rfp.*","bid.*","contract.*","co.*","inspection.*","approve.money"]'),
 ('contracts_admin', 'Contracts Administrator',   '["contract.*","lien.*","compliance.*","closeout.*"]'),
 ('design_lead',     'Design Lead',               '["project.edit","rfp.scope","approve.design"]'),
 ('finance',         'Finance',                   '["budget.view","payment.record","export.yardi"]'),
 ('operations',      'Regional / Property Operations', '["project.view","request.submit","dailylog.*","inspection.run","signoff"]'),
 ('viewer',          'Viewer',                    '["project.view"]'),
 ('vendor',          'Vendor (external)',         '["portal.*"]')
on conflict (code) do nothing;

-- Stages (section 7.1)
insert into stage (code, name, sort_order) values
 ('planning','Planning',1),('rfp','RFP',2),('bidding','Bidding',3),('award','Award',4),('contract','Contract',5),
 ('in_progress','In Progress',6),('punch','Punch',7),('closeout','Closeout',8),('closed','Closed',9)
on conflict (code) do nothing;

-- Cost codes: STARTER SET, to be mapped to Yardi job cost codes and GL accounts by Finance (Q7)
insert into cost_code (code, name) values
 ('01-100','General conditions'),('01-900','Contingency'),('02-200','Site work'),('03-300','Concrete'),
 ('07-310','Roofing'),('07-320','Roof deck repair'),('07-330','Gutters and downspouts'),('07-400','Siding'),
 ('09-900','Painting'),('13-100','Pools'),('23-000','HVAC'),('28-300','Fire alarm'),('32-120','Asphalt paving'),
 ('32-170','Striping'),('32-300','Gates and enclosures'),('32-800','Irrigation'),('32-900','Landscape'),
 ('12-000','Interior design and furnishings'),('05-500','Balconies and railings'),('31-000','Foundations')
on conflict (code) do nothing;

-- Project types with tools and default schedules (section 6.2)
insert into project_type (code, name, enabled_tools, default_schedule, default_cost_codes) values
 ('roof','Roof replacement','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,daily_logs,closeout}',
  '[{"name":"Pre-construction meeting","kind":"milestone"},{"name":"Mobilise and resident notices","days":7},{"name":"Tear-off and install","days":30,"payment":true},{"name":"Deck inspection","kind":"milestone","hold":true},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true},{"name":"Punch list","days":5}]',
  '{01-100,07-310,07-320,07-330,01-900}'),
 ('paint','Exterior paint','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Pre-construction meeting","kind":"milestone"},{"name":"Prep, wash and repairs","days":14},{"name":"Primer inspection","kind":"milestone","hold":true},{"name":"Finish coats","days":30,"payment":true},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true},{"name":"Punch list","days":5}]',
  '{01-100,09-900,01-900}'),
 ('asphalt','Asphalt and concrete','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Pre-construction meeting","kind":"milestone"},{"name":"Resident notices","days":3},{"name":"Mill","days":5},{"name":"Base course inspection","kind":"milestone","hold":true},{"name":"Pave","days":5,"payment":true},{"name":"Stripe","days":2},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true}]',
  '{01-100,32-120,03-300,32-170,01-900}'),
 ('pool','Pool repair or leak','{home,schedule,budget,bidding,contracts,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Diagnose","days":3},{"name":"Drain","days":2},{"name":"Repair","days":10,"payment":true},{"name":"Health inspection","kind":"milestone","hold":true},{"name":"Refill","days":3},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true}]',
  '{13-100,01-900}'),
 ('landscape','Landscape and irrigation','{home,schedule,budget,bidding,contracts,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Design","days":10},{"name":"Plant and material order","days":10},{"name":"Install","days":20,"payment":true},{"name":"Walkthrough","kind":"milestone","hold":true,"payment":true},{"name":"Establishment","days":30}]',
  '{32-900,32-800,01-900}'),
 ('fire_alarm','Fire alarm system','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,closeout,rfis}',
  '[{"name":"Design","days":15},{"name":"Permit","days":20},{"name":"Install","days":30,"payment":true},{"name":"Municipal inspection","kind":"milestone","hold":true},{"name":"Monitoring cut-over","kind":"milestone"},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true}]',
  '{28-300,01-900}'),
 ('structural','Balcony, siding or foundation','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,daily_logs,closeout,rfis}',
  '[{"name":"Engineering","days":20},{"name":"Permit","days":20},{"name":"Phased repair","days":60,"payment":true},{"name":"Phase inspection","kind":"milestone","hold":true},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true}]',
  '{05-500,07-400,31-000,01-900}'),
 ('hvac','HVAC replacements','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Pre-construction meeting","kind":"milestone"},{"name":"Equipment order","days":20},{"name":"Install","days":30,"payment":true},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true}]',
  '{23-000,01-900}'),
 ('interior','Interior and clubhouse design','{home,schedule,budget,bidding,contracts,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Concept","days":15},{"name":"Selections","days":15},{"name":"Procurement","days":30},{"name":"Install","days":20,"payment":true},{"name":"Punch list","days":5,"payment":true}]',
  '{12-000,09-900,01-900}'),
 ('amenity','Gates, mailboxes, dog parks and amenities','{home,schedule,budget,bidding,contracts,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Design","days":10},{"name":"Install","days":20,"payment":true},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true}]',
  '{32-300,02-200,01-900}'),
 ('insurance','Storm and insurance repair','{home,schedule,budget,bidding,contracts,change_orders,pay_requests,lien_releases,inspections,documents,photos,closeout}',
  '[{"name":"Loss documented","kind":"milestone"},{"name":"Adjuster visit","kind":"milestone"},{"name":"Scope and claim approval","days":20},{"name":"Repair","days":30,"payment":true},{"name":"Final inspection","kind":"milestone","hold":true,"payment":true},{"name":"Reimbursement received","kind":"milestone"}]',
  '{01-100,01-900}')
on conflict (code) do nothing;

-- Approval thresholds (section 6.1, confirmed by Joe 2026-11-16)
insert into approval_threshold (object_type, min_amount, max_amount, approver_chain) values
 ('pay_request',0,9999.99,'["capex_pm"]'),
 ('pay_request',10000,50000,'["capex_pm","coo"]'),
 ('pay_request',50000.01,null,'["capex_pm","coo","president"]'),
 ('change_order',0,9999.99,'["capex_pm"]'),
 ('change_order',10000,50000,'["capex_pm","coo"]'),
 ('change_order',50000.01,null,'["capex_pm","coo","president"]'),
 ('rfp',0,null,'["capex_pm","coo"]'),
 ('award',0,null,'["capex_pm","coo","president"]'),
 ('contract',0,null,'["capex_pm","coo","president"]'),
 ('override',0,null,'["president"]'),
 ('closeout',0,null,'["capex_pm","coo"]');

-- Named approvers for the chain roles (people, not roles)
insert into app_setting (key, value) values
 ('approver.coo',        '{"email":"joeg@gainesinvestmenttrust.com","name":"Joe Gerber"}'),
 ('approver.president',  '{"email":null,"name":"Jeff Gaines"}'),
 ('filing.autoFileConfidence', '0.9'),
 ('sharepoint.root',     '{"siteId":null,"driveId":null,"itemId":null,"path":"GIT Project Management Claude Platform"}')
on conflict (key) do nothing;

-- Naming patterns (section 6)
insert into naming_pattern (kind, pattern) values
 ('project_id','{PROP}-{YY}-{###}'),
 ('rfp_number','RFP-{PROP}-{###}'),
 ('contract_number','{ProjectID}-K{##}'),
 ('change_order_number','{ProjectID}-CO{##}'),
 ('pay_request_number','{ProjectID}-PR{##}'),
 ('project_folder','{State}/{PROP} - {PropertyName}/{Year}/{ProjectID} - {ProjectName}'),
 ('file_name','{ProjectID}_{DocType}_{Party}_{YYYY-MM-DD}_v{n}.{ext}')
on conflict (kind) do nothing;

-- Default payment gate checklist (section 6.3)
insert into checklist_template (kind, name, items) values
 ('payment_gate','Default progress payment gate','[
   {"key":"pm_verified","label":"Milestone or % complete verified by PM, with photos","required":true},
   {"key":"inspection_passed","label":"Required inspection passed","required":true,"applies_to":"hold_point"},
   {"key":"conditional_release","label":"Conditional progress release for this payment received and validated","required":true},
   {"key":"prior_unconditional","label":"Unconditional release for the previous payment received","required":true,"applies_to":"not_first"},
   {"key":"subtier_releases","label":"Sub-tier and supplier releases received","required":true,"applies_to":"has_subtier"},
   {"key":"coi_current","label":"COI, license and W-9 current","required":true},
   {"key":"no_hold","label":"No open safety or quality hold","required":true}
 ]'),
 ('payment_gate','Final payment additions','[
   {"key":"conditional_final","label":"Conditional final release received","required":true},
   {"key":"punch_complete","label":"Punch list complete","required":true},
   {"key":"final_inspection","label":"Final inspection passed","required":true},
   {"key":"warranty_docs","label":"Warranty documents received","required":true}
 ]');

-- Default trigger rules (build prompt section 11). Actions are interpreted by the worker.
insert into rule (name, event, conditions, actions) values
 ('Payment milestone reached','schedule.milestone_reached','{"var":"task.is_payment_milestone"}','[{"type":"request_pay_request"},{"type":"request_release","release":"conditional_progress"},{"type":"schedule_inspection"},{"type":"notify","to":"pm"}]'),
 ('Pay request missing gate items','pay_request.submitted','{"some":[{"var":"gate"},{"==":[{"var":"status"},"missing"]}]}','[{"type":"block"},{"type":"email_vendor","template":"gate_missing"}]'),
 ('Pay request ready','pay_request.submitted','{"none":[{"var":"gate"},{"==":[{"var":"status"},"missing"]}]}','[{"type":"route_approval"}]'),
 ('Payment recorded','payment.recorded','{}','[{"type":"request_release","release":"unconditional_progress"}]'),
 ('Unconditional release overdue','lien_release.overdue','{">=":[{"var":"days_since_payment"},10]}','[{"type":"remind_vendor","days":[10,15]},{"type":"escalate","to":["pm","contracts_admin"]},{"type":"block_next_payment"}]'),
 ('Hold point approaching','schedule.hold_point_due','{"<=":[{"var":"days_until"},7]}','[{"type":"create_inspection_task"},{"type":"outlook_invite","to":["inspector","vendor"]}]'),
 ('Inspection failed','inspection.failed','{}','[{"type":"create_punch_items"},{"type":"hold_tied_payments"},{"type":"notify","to":["vendor","pm"]}]'),
 ('Inspection passed','inspection.passed','{"var":"tied_to_payment"}','[{"type":"satisfy_gate","key":"inspection_passed"}]'),
 ('Task or milestone late','schedule.task_late','{">":[{"var":"slip_days"},0]}','[{"type":"flag","health":"at_risk"},{"type":"ask_reason","to":"owner"}]'),
 ('Project not updated','project.idle','{">":[{"var":"idle_days"},7]}','[{"type":"nudge","to":"pm"},{"type":"flag_exec"}]'),
 ('Budget forecast over','budget.forecast_changed','{">":[{"var":"overrun_pct"},5]}','[{"type":"flag"},{"type":"require_forecast_note"},{"type":"notify","to":"coo"}]'),
 ('Change order pending','change_order.pending','{">":[{"var":"business_days"},5]}','[{"type":"remind","to":"approver"},{"type":"escalate_after","business_days":10}]'),
 ('Approval waiting','approval.waiting','{">":[{"var":"business_days"},2]}','[{"type":"remind","to":"approver"},{"type":"digest"}]'),
 ('Bid deadline reminder','rfp.deadline_approaching','{"in":[{"var":"days_until"},[3,1]]}','[{"type":"remind_vendors","filter":"not_responded"}]'),
 ('Bid deadline passed','rfp.deadline_passed','{}','[{"type":"close_submissions"},{"type":"notify","to":"pm"},{"type":"start_gap_analysis"}]'),
 ('Vendor email received','email.received','{"var":"matched"}','[{"type":"file_attachments"},{"type":"extract"},{"type":"notify","to":"pm"}]'),
 ('COI or license expiring','compliance.expiring','{"in":[{"var":"days_until"},[30,15,0]]}','[{"type":"remind_vendor"},{"type":"block_at_zero"}]'),
 ('Contract executed','contract.executed','{}','[{"type":"create_commitment"},{"type":"create_sov"},{"type":"create_payment_milestones"},{"type":"create_inspections"},{"type":"create_closeout_checklist"},{"type":"file_pdf"}]'),
 ('Substantial completion','project.substantial_completion','{}','[{"type":"start_punch"},{"type":"request_release","release":"conditional_final"},{"type":"schedule_inspection","kind":"final"}]'),
 ('Warranty expiry','warranty.expiring','{"==":[{"var":"days_until"},60]}','[{"type":"schedule_warranty_walk"},{"type":"notify","to":"operations"}]'),
 ('Service contract renewal','contract.renewal_notice','{"in":[{"var":"days_until"},[60,30]]}','[{"type":"notify","to":"contract_owner"}]');

-- Regions (known markets; RVP assignment by admin)
insert into region (code, name) values ('TX','Texas'),('CA','California'),('NV','Nevada'),('OK','Oklahoma'),('AZ','Arizona')
on conflict (code) do nothing;
