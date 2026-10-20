-- BMA Expenses Slack bot: reimbursement request state machine + audit trail.
create extension if not exists "pgcrypto";

create table if not exists public.reimbursements (
  id                   uuid primary key default gen_random_uuid(),
  slack_user_id        text        not null,
  requester_name       text        not null,
  payee_key            text        not null,
  payee_rho_name       text        not null,
  amount_cents         integer     not null check (amount_cents > 0),
  currency             text        not null default 'USD',
  memo                 text        not null default '',
  receipt_urls         text[]      not null default '{}',
  status               text        not null default 'pending'
                         check (status in ('pending','approved','rejected','paid')),
  approver_slack_id    text,
  reject_reason        text,
  approval_channel     text,
  approval_message_ts  text,
  sheet_row            integer,
  approved_at          timestamptz,
  paid_at              timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists reimbursements_status_idx on public.reimbursements (status);
create index if not exists reimbursements_created_idx on public.reimbursements (created_at desc);

-- The service-role key bypasses RLS, but enable it anyway so nothing else can read the
-- table by accident. The bot is the only writer/reader.
alter table public.reimbursements enable row level security;
