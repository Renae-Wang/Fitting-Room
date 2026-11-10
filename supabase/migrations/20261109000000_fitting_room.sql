-- Fitting Room: one private record table, a private photo bucket and daily AI limits.
-- Every row and photo belongs to the signed-in user; nothing is readable by anyone else.

create table public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  store text not null check (store in ('items','refs','looks','settings')),
  id text not null check (length(id) between 1 and 200),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, id)
);
alter table public.records enable row level security;
create policy "Own records only" on public.records for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Usage counters are written only by the AI function (service role); no client access.
create table public.usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  route text not null,
  used integer not null default 0,
  primary key (user_id, day, route)
);
alter table public.usage enable row level security;

create function public.reserve_usage(p_user uuid, p_route text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  insert into public.usage (user_id, day, route, used)
  values (p_user, (now() at time zone 'utc')::date, p_route, 1)
  on conflict (user_id, day, route) do update set used = public.usage.used + 1
    where public.usage.used < p_limit
  returning used into v;
  return v is not null and v <= p_limit;
end $$;
revoke all on function public.reserve_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_usage(uuid, text, integer) to service_role;

-- Private photo bucket: files live at <user id>/<photo id>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif']);

create policy "Own photos: read" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Own photos: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Own photos: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
