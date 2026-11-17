-- DocuSign eSignature (build prompt 4.3)
alter table contract add column if not exists signature_sent_by uuid references app_user(id);
alter table contract add column if not exists signature_status text
  check (signature_status in ('sent','delivered','signed_by_vendor','completed','declined','voided'));
alter table contract add column if not exists signature_note text;
create unique index if not exists contract_envelope_uq on contract (docusign_envelope_id) where docusign_envelope_id is not null;

-- Every Connect message received, for audit and to ignore repeats (DocuSign retries).
create table if not exists docusign_event (
  id           uuid primary key default gen_random_uuid(),
  envelope_id  text not null,
  event        text not null,
  event_at     timestamptz,
  contract_id  uuid references contract(id),
  payload      jsonb not null,
  processed    boolean not null default false,
  error        text,
  received_at  timestamptz not null default now()
);
create index if not exists docusign_event_env on docusign_event (envelope_id, received_at);

-- Who countersigns for GIT. Defaults to the President; change in settings.
-- contract.signatory: signs for GIT in DocuSign after the vendor. contract.signatureCc: copied on every envelope.
insert into app_setting (key, value) values
  ('contract.signatory', '{"email":"jeffg@gainesinvestmenttrust.com","name":"Jeff Gaines"}'),
  ('contract.signatureCc', '[]')
on conflict (key) do nothing;
