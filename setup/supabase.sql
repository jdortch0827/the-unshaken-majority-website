-- The Unshaken Majority secure website forms
-- Run this entire file once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.case_submissions (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  status text not null default 'awaiting_uploads'
    check (status in ('awaiting_uploads', 'received', 'reviewing', 'closed', 'failed')),
  name_or_alias text,
  email text,
  title text not null,
  organization text,
  observed_date date,
  summary text not null,
  comparison text not null,
  source_links text,
  permission_to_contact boolean not null default false,
  consent_acknowledged boolean not null default false,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  notification_status text not null default 'pending',
  notification_error text,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.case_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.case_submissions(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  status text not null default 'received'
    check (status in ('received', 'reviewing', 'responded', 'closed')),
  name text not null,
  email text not null,
  category text not null,
  subject text not null,
  message text not null,
  consent_acknowledged boolean not null default false,
  notification_status text not null default 'pending',
  notification_error text,
  created_at timestamptz not null default now()
);

create index if not exists case_submissions_created_at_idx
  on public.case_submissions (created_at desc);
create index if not exists case_submissions_status_idx
  on public.case_submissions (status, created_at desc);
create index if not exists case_attachments_submission_id_idx
  on public.case_attachments (submission_id);
create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

alter table public.case_submissions enable row level security;
alter table public.case_attachments enable row level security;
alter table public.contact_messages enable row level security;

-- Website visitors never receive database table permissions. The Vercel
-- server functions use the private server key and are the only writers.
revoke all on table public.case_submissions from anon, authenticated;
revoke all on table public.case_attachments from anon, authenticated;
revoke all on table public.contact_messages from anon, authenticated;
grant all on table public.case_submissions to service_role;
grant all on table public.case_attachments to service_role;
grant all on table public.contact_messages to service_role;

-- Private evidence bucket: five files are allowed by the website, each up to 10 MB.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'case-evidence',
  'case-evidence',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
