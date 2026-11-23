-- Let the store owner set staff roles from the Supabase dashboard again.
--
-- 20261122220000_commerce_reliability added protect_profiles_role(), which reverted
-- every role change not made with the service_role key. The dashboard's table editor
-- and SQL editor send no JWT, so auth.role() is empty there and the owner's own
-- changes were silently undone.
--
-- New rule: only requests that come through the public API as a customer or a visitor
-- (JWT role anon or authenticated) are locked. Those are the only callers who could try
-- to make themselves staff. The service_role key and direct database logins as the
-- project owner (postgres / supabase_admin, which is what the dashboard uses) may set
-- roles. Sign-up inserts (handle_new_user, run by the auth server) still get 'customer'.

begin;

create or replace function public.protect_profiles_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(auth.role(), '');
begin
  if v_jwt_role = 'service_role' then
    return new;
  end if;

  -- Dashboard / SQL editor: an owner login with no customer or visitor JWT.
  -- session_user is the login role and is not changed by security definer.
  if v_jwt_role not in ('anon', 'authenticated')
     and session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.role := 'customer';
  elsif old.role is distinct from new.role then
    new.role := old.role;
  end if;
  return new;
end;
$$;

insert into public.schema_migrations(version)
values ('20261122230000_staff_role_dashboard')
on conflict (version) do nothing;

commit;
