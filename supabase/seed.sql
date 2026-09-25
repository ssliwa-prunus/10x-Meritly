-- LOCAL DEVELOPMENT / CI ONLY. Never run this against the hosted Supabase project.
--
-- Creates one ready-to-use account per access role. Recreated on every `npx supabase db reset`.
--
--   admin@meritly.local       role: admin
--   supervisor@meritly.local  role: supervisor
--   employee@meritly.local    role: employee
--
-- Shared local password for all three: Meritly-Local-Passw0rd!
--
-- Fixed UUIDs use the seed range 00000000-0000-4000-8000-0000000000xx. The pgTAP suite
-- (supabase/tests) uses the disjoint range 00000000-0000-4000-8000-0000000001xx.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('Meritly-Local-Passw0rd!', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'admin@meritly.local', 'Local Admin'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'supervisor@meritly.local', 'Local Supervisor'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'employee@meritly.local', 'Local Employee')
) as u (id, email, display_name);

-- Password sign-in requires a matching email identity per user.
-- auth.identities.email is a generated column, so it is not inserted.
insert into auth.identities (
  id,
  user_id,
  provider_id,
  provider,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
);

-- The signup trigger created every profile as 'employee'; promote admin and supervisor.
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set role = 'supervisor' where id = '00000000-0000-4000-8000-000000000002';
