-- Staff accounts: store staff sign in to the dashboard and Kintampo Manager with their own
-- account instead of the shared store password. A profile with role 'staff' can do the daily
-- work; 'admin' (and the store password) can also add and remove staff.
begin;

-- Allow the new role. The original check only allowed customer | admin; drop it by
-- whatever name it has, then add the wider one.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.profiles'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('customer', 'staff', 'admin'));

comment on table public.profiles is 'App user profile; role customer | staff | admin.';

insert into public.schema_migrations(version)
values ('20261123120000_staff_accounts')
on conflict (version) do nothing;

commit;
