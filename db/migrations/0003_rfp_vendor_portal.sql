-- Sprint 3: RFPs, vendor portal links, outbound mail log, approval routing helpers.

-- Portal links: only a SHA-256 hash of the token is stored; links expire.
alter table invitation add column if not exists magic_link_expires_at timestamptz;
alter table invitation add column if not exists contact_id uuid references vendor_contact(id);
alter table invitation add column if not exists last_viewed_at timestamptz;
create unique index if not exists invitation_magic_link_hash_uq on invitation (magic_link_hash) where magic_link_hash is not null;

-- RFP extras
alter table rfp add column if not exists title text;
alter table rfp add column if not exists cover_note text;
alter table rfp add column if not exists docx_document_id uuid references document(id);

-- Approvals: who asked, and the object's display summary at the time (for the inbox)
alter table approval add column if not exists requested_by uuid references app_user(id);
alter table approval add column if not exists summary text;
alter table approval add column if not exists amount numeric(14,2);
alter table approval add column if not exists project_id uuid references project(id);
create index if not exists approval_object_idx on approval (object_type, object_id, step);

-- Mail sent from or for the platform (dev outbox and production send log both land here)
alter table email_message alter column graph_message_id drop not null;
alter table email_message add column if not exists body_html text;
alter table email_message add column if not exists status text not null default 'sent';
alter table email_message add column if not exists sent_by uuid references app_user(id);

-- Default bid form lines per project type (admin-editable starting point for every RFP)
alter table project_type add column if not exists default_bid_lines jsonb not null default '[]';
update project_type set default_bid_lines = '[
  {"line_no":"1","description":"Mobilisation, permits and resident notices","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"2","description":"Tear-off and replacement roofing system","unit":"SQ","kind":"base"},
  {"line_no":"3","description":"Roof deck replacement (unit price)","unit":"SF","kind":"unit_price"},
  {"line_no":"4","description":"Gutters and downspouts","unit":"LF","kind":"base"},
  {"line_no":"5","description":"Clean-up and haul-off","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"A1","description":"Alternate: upgraded shingle warranty","unit":"LS","quantity":1,"kind":"alternate"}]' where code = 'roof';
update project_type set default_bid_lines = '[
  {"line_no":"1","description":"Mobilisation, permits and resident notices","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"2","description":"Pressure wash and surface prep","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"3","description":"Wood and stucco repairs (unit price)","unit":"SF","kind":"unit_price"},
  {"line_no":"4","description":"Prime and two finish coats, all buildings","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"5","description":"Railings, doors and trim","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"A1","description":"Alternate: elastomeric coating on stucco","unit":"LS","quantity":1,"kind":"alternate"}]' where code = 'paint';
update project_type set default_bid_lines = '[
  {"line_no":"1","description":"Mobilisation and traffic control","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"2","description":"Mill and overlay","unit":"SY","kind":"base"},
  {"line_no":"3","description":"Crack seal","unit":"LF","kind":"base"},
  {"line_no":"4","description":"Concrete remove and replace","unit":"SF","kind":"base"},
  {"line_no":"5","description":"Striping and stall numbering","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"6","description":"Sub-base repair (unit price)","unit":"SF","kind":"unit_price"},
  {"line_no":"A1","description":"Alternate: seal coat remaining areas","unit":"SY","kind":"alternate"}]' where code = 'asphalt';
update project_type set default_bid_lines = '[
  {"line_no":"1","description":"Mobilisation and permits","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"2","description":"Scope of work as described","unit":"LS","quantity":1,"kind":"base"},
  {"line_no":"3","description":"Clean-up and haul-off","unit":"LS","quantity":1,"kind":"base"}]'
  where default_bid_lines = '[]'::jsonb;

-- Starter insurance requirements (admin-editable; section 8.1 step 5)
insert into app_setting (key, value) values
 ('rfp.defaultRequirements', '{
   "gl_each_occurrence": 1000000, "gl_aggregate": 2000000, "auto": 1000000, "umbrella": 2000000,
   "workers_comp": "Statutory", "additional_insured": "Gaines Investment Trust and the property owner entity",
   "retainage_pct": 10, "payment_terms": "Net 30 after approval",
   "lien_releases": "State statutory conditional and unconditional releases with every pay request",
   "contract": "GIT standard construction agreement", "prevailing_wage": false
 }')
on conflict (key) do nothing;

-- President approvals go to Jeff Gaines by email; they wait (never fall to another executive) until his account exists.
update app_setting set value = '{"email":"jeffg@gainesinvestmenttrust.com","name":"Jeff Gaines"}' where key = 'approver.president';

-- A step can wait for a named approver who has no account yet (assigned automatically when they are added).
alter table approval alter column approver_user_id drop not null;
