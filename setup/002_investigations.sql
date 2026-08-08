-- The Unshaken Majority investigation publishing system
-- Run after setup/supabase.sql. This migration is idempotent.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.investigation_case_counters (
  case_year integer primary key check (case_year between 2020 and 9999),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.next_investigation_case_number(p_year integer default extract(year from now())::integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.investigation_case_counters(case_year, last_number)
  values (p_year, 1)
  on conflict (case_year) do update
    set last_number = public.investigation_case_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_number;

  return 'UM-' || p_year::text || '-' || lpad(v_number::text, 3, '0');
end;
$$;

revoke all on function public.next_investigation_case_number(integer) from public, anon, authenticated;
grant execute on function public.next_investigation_case_number(integer) to service_role;

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'editor' check (role in ('admin', 'editor', 'reviewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.investigations (
  id uuid primary key default gen_random_uuid(),
  site_key text not null default 'the-unshaken-majority',
  case_number text not null unique,
  slug text not null unique,
  title text not null,
  subtitle text,
  subject text,
  short_summary text,
  case_summary_html text,
  claim_html text,
  standard_html text,
  methodology_html text,
  bottom_line_html text,
  status text not null default 'Open Investigation' check (status in (
    'Open Investigation', 'Awaiting Response', 'Under Review', 'Preliminary Finding',
    'Final Finding', 'Inconclusive', 'Corrected', 'Withdrawn', 'Archived'
  )),
  finding_classification text check (finding_classification is null or finding_classification in (
    'Supported', 'Partially Supported', 'Unsupported', 'Misleading',
    'Inconsistent Enforcement', 'Insufficient Evidence', 'Inconclusive',
    'Corrected', 'Withdrawn', 'Custom'
  )),
  custom_finding_label text,
  finding_stage text check (finding_stage is null or finding_stage in ('Preliminary', 'Final')),
  evidence_type text,
  response_status text not null default 'Not Yet Contacted' check (response_status in (
    'Not Yet Contacted', 'Contacted', 'Awaiting Response', 'Response Received',
    'Declined to Respond', 'No Response Received', 'Response Published'
  )),
  category_id uuid references public.investigation_categories(id) on delete set null,
  workflow_status text not null default 'draft' check (workflow_status in (
    'draft', 'internal_review', 'approved', 'published', 'archived', 'withdrawn'
  )),
  public_visible boolean not null default false,
  public_status_visible boolean not null default true,
  date_opened date,
  published_at timestamptz,
  scheduled_publish_at timestamptz,
  withdrawn_at timestamptz,
  archived_at timestamptz,
  featured_evidence_id uuid,
  social_image_path text,
  seo_title text,
  seo_description text,
  assigned_editor_id uuid references public.admin_profiles(user_id) on delete set null,
  approving_editor_name text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_sections (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  section_key text not null,
  heading text,
  body_html text,
  sort_order integer not null default 0,
  public_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (investigation_id, section_key)
);

create table if not exists public.investigation_comparisons (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  comparison_group text,
  tested_item text not null,
  result text not null,
  tested_at timestamptz,
  evidence_label text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_assertions (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  assertion_type text not null check (assertion_type in ('supported', 'limitation')),
  statement text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_evidence (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  exhibit_label text not null,
  title text not null,
  description text,
  evidence_type text not null default 'Other' check (evidence_type in (
    'Screenshot', 'Screen Recording', 'Video', 'Audio', 'PDF', 'Document',
    'Webpage', 'Email', 'Public Statement', 'Data Table', 'Other'
  )),
  captured_at timestamptz,
  source_name text,
  source_url text,
  storage_path text,
  public_preview_path text,
  original_filename text,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  visibility text not null default 'Private' check (visibility in (
    'Public', 'Private', 'Internal Review Only', 'Withheld for Privacy',
    'Withheld for Legal or Safety Reasons'
  )),
  withheld_reason text,
  allow_download boolean not null default false,
  authenticity_note text,
  alt_text text,
  transcript text,
  featured boolean not null default false,
  placeholder boolean not null default false,
  upload_status text not null default 'ready' check (upload_status in ('pending', 'ready', 'failed')),
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.investigations
  drop constraint if exists investigations_featured_evidence_id_fkey;
alter table public.investigations
  add constraint investigations_featured_evidence_id_fkey
  foreign key (featured_evidence_id) references public.investigation_evidence(id) on delete set null;

create table if not exists public.investigation_sources (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  title text not null,
  publisher text,
  url text not null,
  publication_date date,
  accessed_date date,
  source_type text not null default 'Other' check (source_type in (
    'Primary Record', 'Official Policy', 'Webpage', 'News Report', 'Academic Research',
    'Public Statement', 'Court Record', 'Government Record', 'Data', 'Other'
  )),
  description text,
  archived_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_questions (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  question_type text not null check (question_type in ('right_of_response', 'remaining')),
  question text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_responses (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  contacted boolean not null default false,
  contacted_at timestamptz,
  contact_method text,
  response_deadline timestamptz,
  response_status text not null default 'Not Yet Contacted' check (response_status in (
    'Not Yet Contacted', 'Contacted', 'Awaiting Response', 'Response Received',
    'Declined to Respond', 'No Response Received', 'Response Published'
  )),
  response_received_at timestamptz,
  response_html text,
  response_document_url text,
  editorial_note_html text,
  public_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_findings (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  finding_type text not null check (finding_type in (
    'Supported', 'Partially Supported', 'Unsupported', 'Misleading',
    'Inconsistent Enforcement', 'Insufficient Evidence', 'Inconclusive',
    'Corrected', 'Withdrawn', 'Custom'
  )),
  custom_label text,
  headline text not null,
  explanation_html text not null,
  issued_at timestamptz,
  stage text not null check (stage in ('Preliminary', 'Final')),
  approving_editor_name text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_updates (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  update_type text not null check (update_type in (
    'Evidence Added', 'Company Response Added', 'Clarification', 'Correction',
    'Finding Updated', 'Status Updated', 'Source Added', 'Investigation Withdrawn', 'Other'
  )),
  description text not null,
  finding_changed boolean not null default false,
  previous_wording text,
  new_wording text,
  public_visible boolean not null default true,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.investigation_revisions (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  revision_number integer not null,
  snapshot jsonb not null,
  change_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (investigation_id, revision_number)
);

create table if not exists public.investigation_assignments (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  user_id uuid not null references public.admin_profiles(user_id) on delete cascade,
  assignment_role text not null default 'editor' check (assignment_role in ('editor', 'reviewer', 'approver')),
  created_at timestamptz not null default now(),
  unique (investigation_id, user_id, assignment_role)
);

create table if not exists public.investigation_tag_links (
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  tag_id uuid not null references public.investigation_tags(id) on delete cascade,
  primary key (investigation_id, tag_id)
);

create table if not exists public.investigation_audit_logs (
  id bigint generated always as identity primary key,
  investigation_id uuid references public.investigations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  investigation_id uuid not null references public.investigations(id) on delete cascade,
  case_number text not null,
  name text not null,
  email text not null,
  organization text,
  challenged_statement text not null,
  explanation text not null,
  source_url text,
  requested_correction text not null,
  permission_to_contact boolean not null default false,
  certification_acknowledged boolean not null default false,
  status text not null default 'received' check (status in ('received', 'reviewing', 'accepted', 'declined', 'closed')),
  internal_notes text,
  notification_status text not null default 'pending',
  notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.correction_attachments (
  id uuid primary key default gen_random_uuid(),
  correction_request_id uuid not null references public.correction_requests(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

alter table public.case_submissions
  add column if not exists related_case_number text;

create index if not exists investigations_public_idx on public.investigations (public_visible, workflow_status, published_at desc);
create index if not exists investigations_status_idx on public.investigations (status, finding_classification, updated_at desc);
create index if not exists investigations_subject_idx on public.investigations (subject);
create unique index if not exists investigation_current_finding_unique on public.investigation_findings (investigation_id) where is_current;
create unique index if not exists investigation_response_unique on public.investigation_responses (investigation_id);
create index if not exists investigation_comparisons_investigation_idx on public.investigation_comparisons (investigation_id, sort_order);
create index if not exists investigation_assertions_investigation_idx on public.investigation_assertions (investigation_id, assertion_type, sort_order);
create index if not exists investigation_evidence_investigation_idx on public.investigation_evidence (investigation_id, sort_order);
create index if not exists investigation_sources_investigation_idx on public.investigation_sources (investigation_id, sort_order);
create index if not exists investigation_questions_investigation_idx on public.investigation_questions (investigation_id, question_type, sort_order);
create index if not exists investigation_updates_investigation_idx on public.investigation_updates (investigation_id, occurred_at desc);
create index if not exists investigation_revisions_investigation_idx on public.investigation_revisions (investigation_id, revision_number desc);
create index if not exists correction_requests_investigation_idx on public.correction_requests (investigation_id, created_at desc);
create index if not exists audit_logs_investigation_idx on public.investigation_audit_logs (investigation_id, created_at desc);

-- Updated-at triggers.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'admin_profiles', 'investigation_categories', 'investigations', 'investigation_sections',
    'investigation_comparisons', 'investigation_assertions', 'investigation_evidence',
    'investigation_sources', 'investigation_questions', 'investigation_responses',
    'investigation_findings', 'correction_requests'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
  end loop;
end;
$$;

-- Deny browser clients direct table access. The Vercel API validates Supabase Auth
-- sessions and then uses the private service key for all investigation operations.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'admin_profiles', 'investigation_case_counters', 'investigation_categories', 'investigation_tags',
    'investigations', 'investigation_sections', 'investigation_comparisons', 'investigation_assertions',
    'investigation_evidence', 'investigation_sources', 'investigation_questions',
    'investigation_responses', 'investigation_findings', 'investigation_updates',
    'investigation_revisions', 'investigation_assignments', 'investigation_tag_links',
    'investigation_audit_logs', 'correction_requests', 'correction_attachments'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

grant usage, select on all sequences in schema public to service_role;

-- Private evidence bucket. Public exhibits are delivered through expiring signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'investigation-evidence',
  'investigation-evidence',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Corrections use a separate private prefix within the same bucket.

-- Seed the real category used by the first investigation.
insert into public.investigation_categories(name, slug, description)
values ('Consumer Personalization', 'consumer-personalization', 'Consumer-facing customization and personalization systems.')
on conflict (slug) do update set name = excluded.name, description = excluded.description;

-- Reserve UM-2026-001 and create the first investigation as an unpublished draft.
insert into public.investigation_case_counters(case_year, last_number)
values (2026, 1)
on conflict (case_year) do update set last_number = greatest(public.investigation_case_counters.last_number, 1);

with category as (
  select id from public.investigation_categories where slug = 'consumer-personalization'
), inserted as (
  insert into public.investigations (
    case_number, slug, title, subtitle, subject, short_summary, case_summary_html,
    claim_html, standard_html, methodology_html, status, finding_classification, finding_stage,
    evidence_type, response_status, category_id, workflow_status, public_visible,
    date_opened, seo_title, seo_description
  )
  select
    'UM-2026-001',
    'coca-cola-custom-can-filter',
    'Coca-Cola''s Custom Can Filter',
    'One Rule or Different Rules?',
    'The Coca-Cola Company / Coca-Cola Store personalization system',
    'Firsthand testing compared matching phrase structures while changing the racial or ethnic identifier in Coca-Cola''s online personalization filter.',
    '<p>The Unshaken Majority tested Coca-Cola''s online personalization filter using matching phrase structures while changing the racial or ethnic identifier. During the initial filter test, Black Pride, Latino Pride, and Asian Pride were allowed to proceed, while White Pride was rejected. The comparison was repeated using the word “Power.” Black Power, Latino Power, and Asian Power were allowed to proceed, while White Power was rejected.</p><p>This investigation is not an argument that Coca-Cola must print every phrase submitted by a customer. It examines whether comparable phrases are evaluated under one clear and consistently applied standard.</p>',
    '<p>Did Coca-Cola''s online personalization filter apply one clear and consistent standard to comparable phrases when only the racial or ethnic identifier was changed?</p>',
    '<p>If race-based “Power” slogans are considered inappropriate, then all race-based “Power” slogans should be prohibited under the same standard. If racial or ethnic “Pride” statements are permitted, comparable statements should be evaluated under the same clearly explained rule. The issue is not whether every phrase must be printed. The issue is whether one understandable standard is applied consistently to everyone.</p>',
    '<p>The testing was conducted firsthand through Coca-Cola''s online personalization system. Matching phrase structures were entered while changing the racial or ethnic identifier, and the initial automated screen result was documented through screen recordings and screenshots. The test concerns the initial filter response only; it does not establish whether a phrase would pass later human review, manufacturing, or shipment. Personalized products later appeared as out of stock, which limited immediate retesting.</p>',
    'Open Investigation',
    'Inconsistent Enforcement',
    'Preliminary',
    'Firsthand testing and screen recordings',
    'Not Yet Contacted',
    category.id,
    'draft',
    false,
    current_date,
    'Coca-Cola''s Custom Can Filter | UM-2026-001',
    'An unpublished preliminary investigation into Coca-Cola Store personalization filter results for comparable phrases.'
  from category
  on conflict (case_number) do update set
    slug = excluded.slug,
    title = excluded.title,
    subtitle = excluded.subtitle,
    subject = excluded.subject,
    short_summary = excluded.short_summary,
    case_summary_html = excluded.case_summary_html,
    claim_html = excluded.claim_html,
    standard_html = excluded.standard_html,
    methodology_html = excluded.methodology_html,
    status = excluded.status,
    finding_classification = excluded.finding_classification,
    finding_stage = excluded.finding_stage,
    evidence_type = excluded.evidence_type,
    response_status = excluded.response_status,
    category_id = excluded.category_id
  returning id
)
select id from inserted;

-- Structured comparison rows.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_comparisons(investigation_id, comparison_group, tested_item, result, evidence_label, sort_order)
select inv.id, v.comparison_group, v.tested_item, v.result, v.evidence_label, v.sort_order
from inv
cross join (values
  ('Pride comparison', 'Black Pride', 'Allowed to proceed', 'Exhibit A', 10),
  ('Pride comparison', 'Latino Pride', 'Allowed to proceed', 'Exhibit A', 20),
  ('Pride comparison', 'Asian Pride', 'Allowed to proceed', 'Exhibit A', 30),
  ('Pride comparison', 'White Pride', 'Rejected', 'Exhibit A', 40),
  ('Power comparison', 'Black Power', 'Allowed to proceed', 'Exhibit B', 50),
  ('Power comparison', 'Latino Power', 'Allowed to proceed', 'Exhibit B', 60),
  ('Power comparison', 'Asian Power', 'Allowed to proceed', 'Exhibit B', 70),
  ('Power comparison', 'White Power', 'Rejected', 'Exhibit B', 80),
  ('Additional comparison', 'I love Jesus', 'Rejected', 'Exhibit C', 90),
  ('Additional comparison', 'pedo', 'Allowed to proceed', 'Exhibit C', 100)
) as v(comparison_group, tested_item, result, evidence_label, sort_order)
where not exists (
  select 1 from public.investigation_comparisons c
  where c.investigation_id = inv.id and c.tested_item = v.tested_item
);

-- What the evidence currently supports.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_assertions(investigation_id, assertion_type, statement, sort_order)
select inv.id, 'supported', 'Firsthand testing documented different initial filter results for comparable phrases after the racial or ethnic identifier was changed.', 10
from inv
where not exists (
  select 1 from public.investigation_assertions a
  where a.investigation_id = inv.id and a.assertion_type = 'supported'
);

-- Required limitations.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_assertions(investigation_id, assertion_type, statement, sort_order)
select inv.id, 'limitation', v.statement, v.sort_order
from inv
cross join (values
  ('Passing the initial filter does not prove an order would pass final human review.', 10),
  ('The available evidence does not establish discriminatory intent.', 20),
  ('The available evidence does not establish whether an employee manually reviewed the entries.', 30),
  ('Results may change if Coca-Cola updates the system.', 40),
  ('Personalized products later appeared as out of stock, limiting immediate retesting.', 50)
) as v(statement, sort_order)
where not exists (
  select 1 from public.investigation_assertions a
  where a.investigation_id = inv.id and a.assertion_type = 'limitation' and a.statement = v.statement
);

-- Right-of-response questions.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_questions(investigation_id, question_type, question, sort_order)
select inv.id, 'right_of_response', v.question, v.sort_order
from inv
cross join (values
  ('Why was “White Pride” rejected while Black Pride, Latino Pride, and Asian Pride were allowed to proceed?', 10),
  ('Why were some race-based “Power” phrases allowed while “White Power” was rejected?', 20),
  ('Does the filter evaluate historical context or rely on a prohibited-term list?', 30),
  ('Why did “I love Jesus” fail the initial filter while “pedo” was allowed to proceed?', 40),
  ('Does every phrase receive separate human review after passing the initial filter?', 50),
  ('Will Coca-Cola publish clearer personalization standards?', 60)
) as v(question, sort_order)
where not exists (
  select 1 from public.investigation_questions q
  where q.investigation_id = inv.id and q.question_type = 'right_of_response' and q.question = v.question
);

-- Preliminary finding.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_findings(
  investigation_id, finding_type, headline, explanation_html, stage, is_current
)
select
  inv.id,
  'Inconsistent Enforcement',
  'Preliminary finding: inconsistent automated enforcement',
  '<p>Firsthand testing documented different initial filter results for comparable phrases after the racial or ethnic identifier was changed. The evidence supports a preliminary finding of inconsistent automated enforcement. The available evidence does not, by itself, establish intentional discrimination or prove that every phrase allowed through the initial filter would have passed final review, manufacturing, or shipment.</p>',
  'Preliminary',
  true
from inv
where not exists (
  select 1 from public.investigation_findings f where f.investigation_id = inv.id and f.is_current
);

-- Right-of-response record, intentionally not contacted.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_responses(investigation_id, contacted, response_status, public_visible)
select inv.id, false, 'Not Yet Contacted', true
from inv
where not exists (select 1 from public.investigation_responses r where r.investigation_id = inv.id);

-- Empty evidence exhibit slots. No media is invented or attached.
with inv as (select id from public.investigations where case_number = 'UM-2026-001')
insert into public.investigation_evidence(
  investigation_id, exhibit_label, title, description, evidence_type, visibility,
  allow_download, placeholder, upload_status, sort_order
)
select inv.id, v.exhibit_label, v.title, v.description, v.evidence_type, 'Private', false, true, 'ready', v.sort_order
from inv
cross join (values
  ('Exhibit A', 'Pride phrase testing', 'Administrator must upload the actual recording or screenshots.', 'Screen Recording', 10),
  ('Exhibit B', 'Power phrase testing', 'Administrator must upload the actual recording or screenshots.', 'Screen Recording', 20),
  ('Exhibit C', 'Additional wording testing', 'Administrator must upload the actual recording or screenshots.', 'Screen Recording', 30),
  ('Exhibit D', 'Personalized products shown as out of stock', 'Administrator must upload the actual screenshot or recording.', 'Screenshot', 40)
) as v(exhibit_label, title, description, evidence_type, sort_order)
where not exists (
  select 1 from public.investigation_evidence e
  where e.investigation_id = inv.id and e.exhibit_label = v.exhibit_label
);
