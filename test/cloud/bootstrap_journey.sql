-- Fresh signup journey proof for Cloud Phase 1 bootstrap + RLS.
\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(ok boolean, label text)
returns text
language plpgsql
as $$
begin
  if not ok then
    raise exception 'fail - %', label;
  end if;
  return 'ok - ' || label;
end;
$$;

delete from public.user_active_workspace where user_id in (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
delete from public.workspace_members where user_id in (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
delete from public.workspaces where created_by_user_id in (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
delete from public.users where id in (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
delete from auth.users where id in (
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    '33333333-3333-3333-3333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'journey-alice@example.com',
    '',
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'journey-bob@example.com',
    '',
    now(),
    now(),
    now(),
    '{}'::jsonb,
    '{}'::jsonb
  );

select pg_temp.assert_true((select count(*) from public.users where id = '33333333-3333-3333-3333-333333333333') = 1, 'bootstrap_created_public_user');
select pg_temp.assert_true((select count(*) from public.workspaces where created_by_user_id = '33333333-3333-3333-3333-333333333333') = 1, 'bootstrap_created_workspace');
select pg_temp.assert_true((select count(*) from public.workspace_members where user_id = '33333333-3333-3333-3333-333333333333' and role = 'admin') = 1, 'bootstrap_created_admin_membership');
select pg_temp.assert_true((select count(*) from public.user_active_workspace where user_id = '33333333-3333-3333-3333-333333333333') = 1, 'bootstrap_created_active_workspace');

set local role authenticated;
set local "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
set local "request.jwt.claim.role" = 'authenticated';

insert into public.apps (id, workspace_id, slug, name, created_by_user_id)
values (
  'journey_bob_app',
  public.active_workspace_id(),
  'journey-bob-app',
  'Journey Bob App',
  '44444444-4444-4444-4444-444444444444'
);

insert into public.jobs (id, slug, app_id, workspace_id, user_id, action)
values (
  'journey_bob_job',
  'journey-bob-app',
  'journey_bob_app',
  public.active_workspace_id(),
  '44444444-4444-4444-4444-444444444444',
  'echo'
);

insert into public.runs (id, app_id, action, inputs, outputs, status, workspace_id, user_id)
values (
  'journey_bob_run',
  'journey_bob_app',
  'echo',
  '{"owner":"bob"}',
  '{"ok":true}',
  'success',
  public.active_workspace_id(),
  '44444444-4444-4444-4444-444444444444'
);

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
set local "request.jwt.claim.role" = 'authenticated';

select pg_temp.assert_true(public.active_workspace_id() is not null, 'authenticated_signup_has_active_workspace');

insert into public.apps (id, workspace_id, slug, name, created_by_user_id)
values (
  'journey_alice_app',
  public.active_workspace_id(),
  'journey-alice-app',
  'Journey Alice App',
  '33333333-3333-3333-3333-333333333333'
);

select pg_temp.assert_true((select count(*) from public.apps where id = 'journey_alice_app') = 1, 'authenticated_user_inserted_app');
select pg_temp.assert_true((select count(*) from public.apps) = 1, 'authenticated_user_selects_only_own_workspace_apps');
select pg_temp.assert_true(not exists (select 1 from public.apps where id = 'journey_bob_app'), 'authenticated_user_cannot_see_other_workspace_app');

insert into public.jobs (id, slug, app_id, workspace_id, user_id, action)
values (
  'journey_alice_job',
  'journey-alice-app',
  'journey_alice_app',
  public.active_workspace_id(),
  '33333333-3333-3333-3333-333333333333',
  'echo'
);

insert into public.runs (id, app_id, action, inputs, outputs, status, workspace_id, user_id)
values (
  'journey_alice_run',
  'journey_alice_app',
  'echo',
  '{"owner":"alice"}',
  '{"ok":true}',
  'success',
  public.active_workspace_id(),
  '33333333-3333-3333-3333-333333333333'
);

select pg_temp.assert_true((select count(*) from public.jobs where id = 'journey_alice_job') = 1, 'authenticated_user_inserted_owned_job');
select pg_temp.assert_true((select count(*) from public.runs where id = 'journey_alice_run') = 1, 'authenticated_user_inserted_run_for_owned_job');
select pg_temp.assert_true(not exists (select 1 from public.jobs where id = 'journey_bob_job'), 'authenticated_user_cannot_see_other_workspace_job');
select pg_temp.assert_true(not exists (select 1 from public.runs where id = 'journey_bob_run'), 'authenticated_user_cannot_see_other_workspace_run');

reset role;

rollback;
