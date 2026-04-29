-- Floom Cloud initial Supabase schema.
-- This migration translates the audited SQLite schema into Postgres with
-- Supabase Auth identity, Vault-backed secret references, pgvector embeddings,
-- pg_cron availability, and tenant isolation enforced by RLS.

create schema if not exists extensions;
create schema if not exists pgsodium;
create schema if not exists vault;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pgsodium with schema pgsodium;
create extension if not exists supabase_vault with schema vault;

create type public.workspace_role as enum ('admin', 'editor', 'viewer');
create type public.agent_token_scope as enum ('read', 'read-write', 'publish-only');
create type public.app_status as enum ('active', 'disabled', 'deleted');
create type public.app_type as enum ('docker', 'proxied', 'e2b');
create type public.app_visibility as enum ('private', 'link', 'public', 'public_live');
create type public.publish_status as enum ('draft', 'pending_review', 'published', 'rejected');
create type public.secret_policy as enum ('user_vault', 'creator_override');
create type public.connection_owner_kind as enum ('device', 'user');
create type public.connection_status as enum ('pending', 'active', 'revoked', 'expired');
create type public.invite_state as enum ('pending_email', 'pending_accept', 'accepted', 'revoked', 'declined');
create type public.workspace_invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.trigger_type as enum ('schedule', 'webhook');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.run_status as enum ('pending', 'running', 'success', 'failed', 'cancelled');
create type public.stripe_account_type as enum ('express', 'standard');

create table public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan text not null default 'free',
  vault_key_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  email extensions.citext,
  name text,
  auth_provider text not null default 'supabase',
  auth_subject text,
  image text,
  is_admin boolean not null default false,
  deleted_at timestamptz,
  delete_at timestamptz,
  composio_user_id text,
  created_at timestamptz not null default now(),
  unique (auth_provider, auth_subject)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.workspace_role not null default 'admin',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.user_active_workspace (
  user_id uuid primary key references public.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index idx_workspaces_slug on public.workspaces(slug);
create index idx_users_workspace on public.users(workspace_id);
create index idx_users_email on public.users(email);
create index idx_users_pending_delete on public.users(delete_at) where deleted_at is not null;
create index idx_workspace_members_user on public.workspace_members(user_id, workspace_id);

create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

create or replace function public.current_auth_email()
returns text
language sql
stable
security definer
set search_path = auth, public
as $$
  select email::text from auth.users where id = auth.uid();
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.workspace_role_for(target_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_role_for(target_workspace_id) = 'admin', false)
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin);
$$;

create or replace function public.can_write_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_role_for(target_workspace_id) in ('admin', 'editor'), false)
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin);
$$;

create or replace function public.active_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select uwa.workspace_id
      from public.user_active_workspace uwa
      join public.workspace_members wm
        on wm.workspace_id = uwa.workspace_id
       and wm.user_id = uwa.user_id
      where uwa.user_id = auth.uid()
      limit 1
    ),
    (
      select wm.workspace_id
      from public.workspace_members wm
      where wm.user_id = auth.uid()
      order by wm.joined_at asc
      limit 1
    )
  );
$$;

create or replace function public.has_active_workspace_access(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select target_workspace_id = public.active_workspace_id()
     and public.is_workspace_member(target_workspace_id);
$$;

create table public.apps (
  id text primary key,
  slug text not null unique,
  name text not null,
  description text not null,
  manifest jsonb not null,
  status public.app_status not null default 'active',
  docker_image text,
  code_path text not null default '',
  category text,
  author uuid references public.users(id) on delete set null,
  icon text,
  app_type public.app_type not null default 'docker',
  base_url text,
  auth_type text,
  openapi_spec_url text,
  openapi_spec_cached text,
  auth_config jsonb,
  visibility public.app_visibility not null default 'private',
  link_share_token text,
  link_share_requires_auth boolean not null default false,
  review_submitted_at timestamptz,
  review_decided_at timestamptz,
  review_decided_by uuid references public.users(id) on delete set null,
  review_comment text,
  forked_from_app_id text references public.apps(id) on delete set null,
  claimed_at timestamptz,
  is_async boolean not null default false,
  webhook_url text,
  timeout_ms bigint,
  retries bigint not null default 0,
  max_run_retention_days bigint,
  run_rate_limit_per_hour bigint,
  async_mode text,
  featured boolean not null default false,
  avg_run_ms bigint,
  publish_status public.publish_status not null default 'pending_review',
  thumbnail_url text,
  stars bigint not null default 0,
  hero boolean not null default false,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_keys jsonb,
  public_catalog_live boolean generated always as (
    status = 'active'
    and visibility in ('public', 'public_live')
    and publish_status = 'published'
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_invites (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_id text not null references public.apps(id) on delete cascade,
  invited_user_id uuid references public.users(id) on delete set null,
  invited_email extensions.citext,
  state public.invite_state not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by_user_id uuid not null references public.users(id) on delete cascade
);

create table public.audit_log (
  id text primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_token_id text,
  actor_ip text,
  action text not null,
  target_type text,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.app_visibility_audit (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_id text not null references public.apps(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_user_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.runs (
  id text primary key,
  app_id text not null references public.apps(id) on delete cascade,
  thread_id text,
  action text not null,
  inputs jsonb,
  outputs jsonb,
  logs text not null default '',
  status public.run_status not null default 'pending',
  error text,
  error_type text,
  duration_ms bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  upstream_status bigint,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  device_id text,
  is_public boolean not null default false
);

create table public.jobs (
  id text primary key,
  slug text not null,
  app_id text not null references public.apps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  status public.job_status not null default 'queued',
  input_json jsonb,
  output_json jsonb,
  error_json jsonb,
  run_id text references public.runs(id) on delete set null,
  webhook_url text,
  timeout_ms bigint not null default 1800000,
  max_retries bigint not null default 0,
  attempts bigint not null default 0,
  per_call_vault_secret_ids uuid[],
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.builds (
  build_id text primary key,
  app_slug text,
  github_url text not null,
  repo_owner text not null,
  repo_name text not null,
  branch text not null,
  manifest_path text,
  manifest_options jsonb,
  requested_name text,
  requested_slug text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'detecting',
  error text,
  docker_image text,
  commit_sha text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.secrets (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  app_id text references public.apps(id) on delete cascade,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.run_threads (
  id text primary key,
  title text,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.run_turns (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id text not null references public.run_threads(id) on delete cascade,
  turn_index bigint not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.embeddings (
  app_id text primary key references public.apps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  text text not null,
  vector extensions.vector(1536) not null,
  updated_at timestamptz not null default now()
);

create table public.app_memory (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_slug text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, app_slug, user_id, key)
);

create table public.user_secrets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  key text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, key)
);

create table public.workspace_secrets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table public.workspace_secret_backfill_conflicts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  user_ids_json jsonb not null,
  detected_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  profile_json jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.workspace_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  profile_json jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.agent_tokens (
  id text primary key,
  prefix text not null,
  hash text not null unique,
  label text not null,
  scope public.agent_token_scope not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  rate_limit_per_minute bigint not null default 60
);

create table public.connections (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_kind public.connection_owner_kind not null,
  owner_id text not null,
  provider text not null,
  composio_connection_id text not null,
  composio_account_id text not null,
  status public.connection_status not null,
  metadata_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_kind, owner_id, provider)
);

create table public.stripe_accounts (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_account_id text not null unique,
  account_type public.stripe_account_type not null default 'express',
  country text,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.stripe_webhook_events (
  id text primary key,
  event_id text not null unique,
  event_type text not null,
  livemode boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table public.workspace_invites (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role public.workspace_role not null default 'editor',
  invited_by_user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  status public.workspace_invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

create table public.app_reviews (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  app_slug text not null,
  user_id uuid not null references public.users(id) on delete cascade,
  rating bigint not null check (rating between 1 and 5),
  title text,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, app_slug, user_id)
);

create table public.app_installs (
  id text primary key,
  app_id text not null references public.apps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  installed_at timestamptz not null default now(),
  unique (app_id, workspace_id, user_id)
);

create table public.feedback (
  id text primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  device_id text,
  email extensions.citext,
  url text,
  text text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table public.waitlist_signups (
  id text primary key,
  email extensions.citext not null,
  email_normalized text generated always as (lower(email::text)) stored,
  source text,
  user_agent text,
  ip_hash text,
  deploy_repo_url text,
  deploy_intent text,
  created_at timestamptz not null default now()
);

create table public.app_secret_policies (
  app_id text not null references public.apps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  policy public.secret_policy not null default 'user_vault',
  updated_at timestamptz not null default now(),
  primary key (app_id, key)
);

create table public.app_creator_secrets (
  app_id text not null references public.apps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_id, key)
);

create table public.triggers (
  id text primary key,
  app_id text not null references public.apps(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action text not null,
  inputs jsonb not null default '{}',
  trigger_type public.trigger_type not null,
  cron_expression text,
  tz text,
  webhook_secret_vault_secret_id uuid,
  webhook_url_path text,
  next_run_at bigint,
  last_fired_at bigint,
  enabled boolean not null default true,
  retry_policy jsonb,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table public.trigger_webhook_deliveries (
  trigger_id text not null references public.triggers(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id text not null,
  received_at bigint not null,
  primary key (trigger_id, request_id)
);

create table public.run_deletion_audit (
  id text primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  action text not null,
  run_id text,
  app_id text,
  deleted_count bigint not null,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create table public.job_trigger_context (
  job_id text primary key references public.jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trigger_id text not null references public.triggers(id) on delete cascade,
  trigger_type public.trigger_type not null,
  created_at timestamptz not null default now()
);

create index idx_apps_slug on public.apps(slug);
create index idx_apps_category on public.apps(category);
create index idx_apps_forked_from on public.apps(forked_from_app_id);
create index idx_apps_featured_avg on public.apps(featured, avg_run_ms);
create index idx_apps_publish_status on public.apps(publish_status);
create index idx_apps_visibility on public.apps(visibility);
create index idx_apps_workspace on public.apps(workspace_id);
create index idx_apps_public_catalog_live on public.apps(public_catalog_live) where public_catalog_live;
create index idx_app_invites_app_user on public.app_invites(app_id, invited_user_id);
create index idx_app_invites_email on public.app_invites(invited_email);
create index idx_audit_log_actor_user on public.audit_log(actor_user_id);
create index idx_audit_log_workspace_created on public.audit_log(workspace_id, created_at desc);
create index idx_audit_log_target on public.audit_log(target_type, target_id);
create index idx_audit_log_action on public.audit_log(action);
create index idx_audit_log_created_desc on public.audit_log(created_at desc);
create index idx_app_visibility_audit_app_created on public.app_visibility_audit(app_id, created_at desc);
create index idx_runs_thread on public.runs(thread_id);
create index idx_runs_app on public.runs(app_id);
create index idx_runs_workspace_user on public.runs(workspace_id, user_id);
create index idx_runs_device on public.runs(device_id) where device_id is not null;
create index idx_runs_app_finished on public.runs(app_id, finished_at);
create index idx_jobs_slug_status on public.jobs(slug, status);
create index idx_jobs_created_at on public.jobs(created_at);
create index idx_jobs_status on public.jobs(status);
create index idx_jobs_workspace_status on public.jobs(workspace_id, status);
create index idx_builds_status on public.builds(status);
create index idx_builds_app_slug on public.builds(app_slug);
create index idx_builds_repo_branch on public.builds(repo_owner, repo_name, branch, completed_at);
create unique index idx_secrets_unique on public.secrets(workspace_id, name, coalesce(app_id, '__global__'));
create index idx_run_turns_thread on public.run_turns(thread_id, turn_index);
create index idx_embeddings_vector on public.embeddings using ivfflat (vector extensions.vector_cosine_ops) with (lists = 100);
create index idx_app_memory_device on public.app_memory(device_id) where device_id is not null;
create index idx_app_memory_user on public.app_memory(workspace_id, user_id);
create index idx_agent_tokens_user_revoked on public.agent_tokens(user_id, revoked_at);
create index idx_connections_owner on public.connections(workspace_id, owner_kind, owner_id);
create index idx_connections_provider on public.connections(workspace_id, provider);
create index idx_connections_composio on public.connections(composio_connection_id);
create index idx_stripe_accounts_workspace on public.stripe_accounts(workspace_id);
create index idx_stripe_accounts_user on public.stripe_accounts(workspace_id, user_id);
create index idx_stripe_webhook_events_type on public.stripe_webhook_events(event_type);
create index idx_invites_workspace on public.workspace_invites(workspace_id);
create index idx_invites_email on public.workspace_invites(email);
create index idx_invites_token on public.workspace_invites(token);
create index idx_app_reviews_slug on public.app_reviews(app_slug);
create index idx_app_reviews_user on public.app_reviews(user_id);
create index idx_app_installs_workspace on public.app_installs(workspace_id, user_id, installed_at desc);
create index idx_app_installs_app on public.app_installs(app_id);
create index idx_feedback_created on public.feedback(created_at);
create unique index idx_waitlist_email_lower on public.waitlist_signups(email_normalized);
create index idx_waitlist_created on public.waitlist_signups(created_at);
create index idx_app_secret_policies_app on public.app_secret_policies(app_id);
create index idx_app_creator_secrets_app on public.app_creator_secrets(app_id);
create index idx_app_creator_secrets_workspace on public.app_creator_secrets(workspace_id);
create index idx_triggers_schedule on public.triggers(trigger_type, enabled, next_run_at);
create unique index idx_triggers_webhook_path on public.triggers(webhook_url_path) where webhook_url_path is not null;
create index idx_triggers_app on public.triggers(app_id);
create index idx_triggers_user on public.triggers(user_id);
create index idx_trigger_deliveries_received on public.trigger_webhook_deliveries(received_at);
create index idx_run_deletion_audit_actor on public.run_deletion_audit(actor_user_id, created_at);
create index idx_run_deletion_audit_workspace on public.run_deletion_audit(workspace_id, created_at);

create materialized view public.app_run_stats as
select
  a.id as app_id,
  a.workspace_id,
  count(r.id) filter (where r.finished_at >= now() - interval '7 days')::bigint as runs_7d,
  avg(r.duration_ms) filter (where r.status = 'success')::bigint as avg_success_duration_ms,
  max(r.finished_at) as last_finished_at
from public.apps a
left join public.runs r on r.app_id = a.id
group by a.id, a.workspace_id;

create unique index idx_app_run_stats_app on public.app_run_stats(app_id);
create index idx_app_run_stats_workspace on public.app_run_stats(workspace_id);

create view public.public_run_outputs as
select
  r.id,
  r.app_id,
  r.action,
  r.outputs,
  r.status,
  r.error_type,
  r.duration_ms,
  r.started_at,
  r.finished_at
from public.runs r
where r.is_public = true;

create or replace function public.claim_next_job(target_workspace_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.jobs;
begin
  if not public.is_service_role() then
    raise exception 'service_role_required';
  end if;

  update public.jobs
     set status = 'running',
         started_at = coalesce(started_at, now()),
         attempts = attempts + 1
   where id = (
     select id
     from public.jobs
     where workspace_id = target_workspace_id
       and status = 'queued'
     order by created_at asc
     for update skip locked
     limit 1
   )
   returning * into claimed;

  return claimed;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.users enable row level security;
alter table public.workspace_members enable row level security;
alter table public.user_active_workspace enable row level security;
alter table public.apps enable row level security;
alter table public.app_invites enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_visibility_audit enable row level security;
alter table public.runs enable row level security;
alter table public.jobs enable row level security;
alter table public.builds enable row level security;
alter table public.secrets enable row level security;
alter table public.run_threads enable row level security;
alter table public.run_turns enable row level security;
alter table public.embeddings enable row level security;
alter table public.app_memory enable row level security;
alter table public.user_secrets enable row level security;
alter table public.workspace_secrets enable row level security;
alter table public.workspace_secret_backfill_conflicts enable row level security;
alter table public.user_profiles enable row level security;
alter table public.workspace_profiles enable row level security;
alter table public.agent_tokens enable row level security;
alter table public.connections enable row level security;
alter table public.stripe_accounts enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.app_reviews enable row level security;
alter table public.app_installs enable row level security;
alter table public.feedback enable row level security;
alter table public.waitlist_signups enable row level security;
alter table public.app_secret_policies enable row level security;
alter table public.app_creator_secrets enable row level security;
alter table public.triggers enable row level security;
alter table public.trigger_webhook_deliveries enable row level security;
alter table public.run_deletion_audit enable row level security;
alter table public.job_trigger_context enable row level security;

create policy workspaces_read_member on public.workspaces
  for select using (public.is_service_role() or public.is_workspace_member(id));
create policy workspaces_insert_service on public.workspaces
  for insert with check (public.is_service_role());
create policy workspaces_update_admin on public.workspaces
  for update using (public.is_service_role() or public.is_workspace_admin(id))
  with check (public.is_service_role() or public.is_workspace_admin(id));
create policy workspaces_delete_service on public.workspaces
  for delete using (public.is_service_role());

create policy users_read_self_or_workspace_admin on public.users
  for select using (
    public.is_service_role()
    or id = auth.uid()
    or (workspace_id is not null and public.is_workspace_admin(workspace_id))
  );
create policy users_insert_self on public.users
  for insert with check (public.is_service_role() or id = auth.uid());
create policy users_update_self on public.users
  for update using (public.is_service_role() or id = auth.uid())
  with check (public.is_service_role() or id = auth.uid());
create policy users_delete_service on public.users
  for delete using (public.is_service_role());

create policy workspace_members_read_member on public.workspace_members
  for select using (
    public.is_service_role()
    or user_id = auth.uid()
    or public.is_workspace_member(workspace_id)
  );
create policy workspace_members_insert_admin on public.workspace_members
  for insert with check (public.is_service_role() or public.is_workspace_admin(workspace_id));
create policy workspace_members_update_admin on public.workspace_members
  for update using (public.is_service_role() or public.is_workspace_admin(workspace_id))
  with check (public.is_service_role() or public.is_workspace_admin(workspace_id));
create policy workspace_members_delete_admin on public.workspace_members
  for delete using (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy user_active_workspace_self on public.user_active_workspace
  for all using (public.is_service_role() or user_id = auth.uid())
  with check (
    public.is_service_role()
    or (user_id = auth.uid() and public.is_workspace_member(workspace_id))
  );

create policy apps_read_public_or_active_workspace on public.apps
  for select using (
    public.is_service_role()
    or public_catalog_live
    or public.has_active_workspace_access(workspace_id)
  );
create policy apps_insert_workspace_writer on public.apps
  for insert with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and public.can_write_workspace(workspace_id))
  );
create policy apps_update_workspace_writer on public.apps
  for update using (public.is_service_role() or public.can_write_workspace(workspace_id))
  with check (public.is_service_role() or public.can_write_workspace(workspace_id));
create policy apps_delete_workspace_admin on public.apps
  for delete using (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy tenant_active_select_app_invites on public.app_invites
  for select using (
    public.is_service_role()
    or public.has_active_workspace_access(workspace_id)
    or invited_user_id = auth.uid()
    or invited_email::text = public.current_auth_email()
  );
create policy tenant_admin_write_app_invites on public.app_invites
  for all using (public.is_service_role() or public.is_workspace_admin(workspace_id))
  with check (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy audit_read_admin on public.audit_log
  for select using (public.is_service_role() or (workspace_id is not null and public.is_workspace_admin(workspace_id)));
create policy audit_insert_service on public.audit_log
  for insert with check (public.is_service_role());

create policy app_visibility_audit_read_admin on public.app_visibility_audit
  for select using (public.is_service_role() or public.is_workspace_admin(workspace_id));
create policy app_visibility_audit_insert_service on public.app_visibility_audit
  for insert with check (public.is_service_role());

create policy runs_read_owner_or_workspace_admin on public.runs
  for select using (
    public.is_service_role()
    or (
      public.has_active_workspace_access(workspace_id)
      and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
    )
  );
create policy runs_insert_owner on public.runs
  for insert with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );
create policy runs_update_owner_or_service on public.runs
  for update using (
    public.is_service_role()
    or (
      public.has_active_workspace_access(workspace_id)
      and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
    )
  )
  with check (
    public.is_service_role()
    or (
      public.has_active_workspace_access(workspace_id)
      and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
    )
  );
create policy runs_delete_admin on public.runs
  for delete using (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy jobs_read_workspace on public.jobs
  for select using (public.is_service_role() or public.has_active_workspace_access(workspace_id));
create policy jobs_insert_owner_or_service on public.jobs
  for insert with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );
create policy jobs_update_service on public.jobs
  for update using (public.is_service_role()) with check (public.is_service_role());
create policy jobs_delete_service on public.jobs
  for delete using (public.is_service_role());

create policy builds_read_workspace on public.builds
  for select using (public.is_service_role() or public.has_active_workspace_access(workspace_id));
create policy builds_insert_owner on public.builds
  for insert with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );
create policy builds_update_service on public.builds
  for update using (public.is_service_role()) with check (public.is_service_role());
create policy builds_delete_admin on public.builds
  for delete using (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy secrets_read_writer_metadata on public.secrets
  for select using (public.is_service_role() or public.can_write_workspace(workspace_id));
create policy secrets_write_writer_metadata on public.secrets
  for all using (public.is_service_role() or public.can_write_workspace(workspace_id))
  with check (public.is_service_role() or public.can_write_workspace(workspace_id));

create policy run_threads_read_owner on public.run_threads
  for select using (
    public.is_service_role()
    or (
      public.has_active_workspace_access(workspace_id)
      and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
    )
  );
create policy run_threads_write_owner on public.run_threads
  for all using (
    public.is_service_role()
    or (
      public.has_active_workspace_access(workspace_id)
      and (user_id = auth.uid() or public.is_workspace_admin(workspace_id))
    )
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and (user_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  );

create policy run_turns_read_parent on public.run_turns
  for select using (
    public.is_service_role()
    or exists (
      select 1
      from public.run_threads rt
      where rt.id = run_turns.thread_id
        and rt.workspace_id = run_turns.workspace_id
        and public.has_active_workspace_access(rt.workspace_id)
        and (rt.user_id = auth.uid() or public.is_workspace_admin(rt.workspace_id))
    )
  );
create policy run_turns_write_parent on public.run_turns
  for all using (public.is_service_role())
  with check (
    public.is_service_role()
    or exists (
      select 1
      from public.run_threads rt
      where rt.id = run_turns.thread_id
        and rt.workspace_id = run_turns.workspace_id
        and rt.workspace_id = public.active_workspace_id()
        and rt.user_id = auth.uid()
    )
  );

create policy embeddings_read_public_or_workspace on public.embeddings
  for select using (
    public.is_service_role()
    or public.has_active_workspace_access(workspace_id)
    or exists (select 1 from public.apps a where a.id = embeddings.app_id and a.public_catalog_live)
  );
create policy embeddings_write_service on public.embeddings
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy app_memory_owner on public.app_memory
  for all using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and user_id = auth.uid())
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );

create policy user_secrets_owner_metadata on public.user_secrets
  for all using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and user_id = auth.uid())
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );

create policy workspace_secrets_writer_metadata on public.workspace_secrets
  for all using (public.is_service_role() or public.can_write_workspace(workspace_id))
  with check (public.is_service_role() or public.can_write_workspace(workspace_id));

create policy workspace_secret_conflicts_admin on public.workspace_secret_backfill_conflicts
  for all using (public.is_service_role() or public.is_workspace_admin(workspace_id))
  with check (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy user_profiles_owner on public.user_profiles
  for all using (public.is_service_role() or user_id = auth.uid())
  with check (public.is_service_role() or user_id = auth.uid());

create policy workspace_profiles_member_read on public.workspace_profiles
  for select using (public.is_service_role() or public.has_active_workspace_access(workspace_id));
create policy workspace_profiles_writer_write on public.workspace_profiles
  for all using (public.is_service_role() or public.can_write_workspace(workspace_id))
  with check (public.is_service_role() or public.can_write_workspace(workspace_id));

create policy agent_tokens_read_admin on public.agent_tokens
  for select using (public.is_service_role() or public.is_workspace_admin(workspace_id));
create policy agent_tokens_write_admin on public.agent_tokens
  for all using (public.is_service_role() or public.is_workspace_admin(workspace_id))
  with check (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy connections_owner_read on public.connections
  for select using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and owner_kind = 'user' and owner_id = auth.uid()::text)
  );
create policy connections_owner_write on public.connections
  for all using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and owner_kind = 'user' and owner_id = auth.uid()::text)
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and owner_kind = 'user' and owner_id = auth.uid()::text)
  );

create policy stripe_accounts_owner_read on public.stripe_accounts
  for select using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and (user_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  );
create policy stripe_accounts_service_write on public.stripe_accounts
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy stripe_webhook_events_service on public.stripe_webhook_events
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy workspace_invites_admin_read on public.workspace_invites
  for select using (
    public.is_service_role()
    or public.is_workspace_admin(workspace_id)
    or email::text = public.current_auth_email()
  );
create policy workspace_invites_admin_write on public.workspace_invites
  for all using (public.is_service_role() or public.is_workspace_admin(workspace_id))
  with check (public.is_service_role() or public.is_workspace_admin(workspace_id));

create policy app_reviews_read_public_or_workspace on public.app_reviews
  for select using (
    public.is_service_role()
    or public.has_active_workspace_access(workspace_id)
    or exists (select 1 from public.apps a where a.slug = app_reviews.app_slug and a.public_catalog_live)
  );
create policy app_reviews_owner_write on public.app_reviews
  for all using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and user_id = auth.uid())
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );

create policy app_installs_owner_read on public.app_installs
  for select using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and (user_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  );
create policy app_installs_owner_write on public.app_installs
  for all using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and user_id = auth.uid())
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and user_id = auth.uid())
  );

create policy feedback_insert_any on public.feedback
  for insert with check (true);
create policy feedback_read_admin on public.feedback
  for select using (public.is_service_role() or (workspace_id is not null and public.is_workspace_admin(workspace_id)));

create policy waitlist_insert_any on public.waitlist_signups
  for insert with check (true);
create policy waitlist_read_admin on public.waitlist_signups
  for select using (public.is_service_role() or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

create policy app_secret_policies_read_writer on public.app_secret_policies
  for select using (public.is_service_role() or public.can_write_workspace(workspace_id));
create policy app_secret_policies_write_writer on public.app_secret_policies
  for all using (public.is_service_role() or public.can_write_workspace(workspace_id))
  with check (public.is_service_role() or public.can_write_workspace(workspace_id));

create policy app_creator_secrets_writer_metadata on public.app_creator_secrets
  for all using (public.is_service_role() or public.can_write_workspace(workspace_id))
  with check (public.is_service_role() or public.can_write_workspace(workspace_id));

create policy triggers_owner_read on public.triggers
  for select using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and (user_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  );
create policy triggers_owner_write on public.triggers
  for all using (
    public.is_service_role()
    or (public.has_active_workspace_access(workspace_id) and (user_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  )
  with check (
    public.is_service_role()
    or (workspace_id = public.active_workspace_id() and (user_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  );

create policy trigger_deliveries_service on public.trigger_webhook_deliveries
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy run_deletion_audit_read_admin on public.run_deletion_audit
  for select using (public.is_service_role() or (workspace_id is not null and public.is_workspace_admin(workspace_id)));
create policy run_deletion_audit_insert_service on public.run_deletion_audit
  for insert with check (public.is_service_role());

create policy job_trigger_context_service on public.job_trigger_context
  for all using (public.is_service_role()) with check (public.is_service_role());

grant usage on schema public to anon, authenticated, service_role;
grant select on public.public_run_outputs to anon, authenticated, service_role;
grant select on public.app_run_stats to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant insert on public.feedback, public.waitlist_signups to anon;
grant select on public.apps, public.app_reviews, public.embeddings, public.public_run_outputs to anon;
grant execute on function public.claim_next_job(uuid) to service_role;
grant execute on function public.active_workspace_id() to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_active_workspace_access(uuid) to authenticated, service_role;
grant execute on function public.can_write_workspace(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_admin(uuid) to authenticated, service_role;
