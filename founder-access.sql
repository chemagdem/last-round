-- Run once in Supabase SQL Editor after the existing account.sql setup.
-- Re-running is safe. Entitlement is based on the verified Auth identity,
-- never on a writable profile flag, client email, or localStorage value.
begin;

create or replace function public.has_founder_skin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = 'josemgarciademarina@hotmail.com'
      and email_confirmed_at is not null
  );
$$;
revoke all on function public.has_founder_skin() from public, anon;
grant execute on function public.has_founder_skin() to authenticated;

alter table public.player_profiles drop constraint if exists "player_profiles_equippedSkin_check";
alter table public.player_profiles add constraint "player_profiles_equippedSkin_check"
  check ("equippedSkin" in ('gold', 'carbon', 'crimson', 'founder'));

create or replace function public.enforce_founder_skin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new."equippedSkin" = 'founder' and not exists (
    select 1 from auth.users
    where id = new.user_id
      and lower(email) = 'josemgarciademarina@hotmail.com'
      and email_confirmed_at is not null
  ) then
    raise exception 'Founder skin is reserved for its verified owner.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_founder_skin() from public, anon, authenticated;
drop trigger if exists enforce_founder_skin on public.player_profiles;
create trigger enforce_founder_skin before insert or update on public.player_profiles
for each row execute function public.enforce_founder_skin();
commit;
