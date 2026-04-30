-- Focused Phase 1 RLS proof. Run against the local Supabase Postgres after
-- applying apps/server/db/migrations/001_initial.sql.
\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(ok boolean, label text)
returns text
language plpgsql
as $$
begin
  if not ok then
    raise exception 'assertion failed: %', label;
  end if;
  return 'ok - ' || label;
end;
$$;

insert into auth.users (id, aud, role, email, confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice@example.com', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bob@example.com', now(), now(), now())
on conflict (id) do nothing;

insert into public.workspaces (id, slug, name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-ws', 'Alice Workspace'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob-ws', 'Bob Workspace')
on conflict (id) do nothing;

insert into public.users (id, workspace_id, email, name)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@example.com', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob@example.com', 'Bob')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'admin')
on conflict (workspace_id, user_id) do nothing;

insert into public.user_active_workspace (user_id, workspace_id)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
on conflict (user_id) do update set workspace_id = excluded.workspace_id;

insert into public.apps (id, slug, name, description, manifest, code_path, workspace_id, author, visibility, publish_status)
values
  ('app_alice_private', 'alice-private', 'Alice Private', 'private', '{"actions":{}}', '', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'private', 'published'),
  ('app_bob_private', 'bob-private', 'Bob Private', 'private', '{"actions":{}}', '', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'private', 'published')
on conflict (id) do nothing;

insert into public.runs (id, app_id, action, inputs, outputs, status, workspace_id, user_id)
values
  ('run_alice', 'app_alice_private', 'echo', '{"secret":"alice"}', '{"ok":true}', 'success', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('run_bob', 'app_bob_private', 'echo', '{"secret":"bob"}', '{"ok":true}', 'success', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.jobs (id, slug, app_id, workspace_id, user_id, action)
values
  ('job_alice', 'alice-private', 'app_alice_private', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'echo'),
  ('job_bob', 'bob-private', 'app_bob_private', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'echo')
on conflict (id) do nothing;

insert into public.app_memory (workspace_id, app_slug, user_id, key, value)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-private', '11111111-1111-1111-1111-111111111111', 'profile', '{"n":1}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob-private', '22222222-2222-2222-2222-222222222222', 'profile', '{"n":2}')
on conflict (workspace_id, app_slug, user_id, key) do nothing;

create temp table test_vault_secrets (
  label text primary key,
  id uuid not null
) on commit drop;

insert into test_vault_secrets (label, id)
values
  ('alice', vault.create_secret('alice-secret', 'alice API_KEY', '')),
  ('bob', vault.create_secret('bob-secret', 'bob API_KEY', ''));

insert into public.workspace_secrets (workspace_id, key, vault_secret_id)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'API_KEY', id
from test_vault_secrets
where label = 'alice'
union all
select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'API_KEY', id
from test_vault_secrets
where label = 'bob'
on conflict (workspace_id, key) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.assert_true(public.active_workspace_id() = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'alice_active_workspace');
select pg_temp.assert_true((select count(*) from public.apps) = 1, 'alice_only_reads_one_private_app');
select pg_temp.assert_true(not exists (select 1 from public.apps where id = 'app_bob_private'), 'alice_cannot_read_bob_app');
select pg_temp.assert_true((select count(*) from public.runs) = 1, 'alice_only_reads_one_run');
select pg_temp.assert_true(not exists (select 1 from public.runs where id = 'run_bob'), 'alice_cannot_read_bob_run');
select pg_temp.assert_true(not exists (select 1 from public.runs where id = 'run_bob'), 'alice_bootstrap_cannot_read_bob_run');
select pg_temp.assert_true((select count(*) from public.jobs) = 1, 'alice_only_reads_one_job');
select pg_temp.assert_true((select count(*) from public.app_memory) = 1, 'alice_only_reads_one_memory_row');
select pg_temp.assert_true((select count(*) from public.workspace_secrets) = 1, 'alice_only_reads_own_workspace_secret_metadata');

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.assert_true(public.active_workspace_id() = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'bob_active_workspace');
select pg_temp.assert_true((select count(*) from public.apps) = 1, 'bob_only_reads_one_private_app');
select pg_temp.assert_true(not exists (select 1 from public.apps where id = 'app_alice_private'), 'bob_cannot_read_alice_app');
select pg_temp.assert_true((select count(*) from public.runs) = 1, 'bob_only_reads_one_run');
select pg_temp.assert_true(not exists (select 1 from public.runs where id = 'run_alice'), 'bob_cannot_read_alice_run');
select pg_temp.assert_true((select count(*) from public.jobs) = 1, 'bob_only_reads_one_job');
select pg_temp.assert_true((select count(*) from public.app_memory) = 1, 'bob_only_reads_one_memory_row');
select pg_temp.assert_true((select count(*) from public.workspace_secrets) = 1, 'bob_only_reads_own_workspace_secret_metadata');

reset role;

select pg_temp.assert_true(not exists (
  select 1
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'agent_tokens', 'app_creator_secrets', 'app_installs', 'app_invites',
      'app_memory', 'app_reviews', 'apps', 'app_secret_policies',
      'app_visibility_audit', 'audit_log', 'builds', 'connections',
      'embeddings', 'feedback', 'jobs', 'run_deletion_audit', 'runs',
      'run_threads', 'run_turns', 'secrets', 'stripe_accounts',
      'stripe_webhook_events', 'triggers', 'trigger_webhook_deliveries',
      'user_active_workspace', 'user_profiles', 'users', 'user_secrets',
      'waitlist_signups', 'workspace_invites', 'workspace_members',
      'workspace_profiles', 'workspaces', 'workspace_secret_backfill_conflicts',
      'workspace_secrets'
    )
    and not c.relrowsecurity
), 'all_audited_tables_have_rls_enabled');

rollback;
