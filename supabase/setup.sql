-- VoKalia, premier schéma. Exécuter une fois dans le projet de développement.
begin;

create schema vokalia_private;
revoke all on schema vokalia_private from public, anon, authenticated;
grant usage on schema vokalia_private to authenticated;

create table public.vk_profiles (
  id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 48),
  created_at timestamptz not null default now()
);

create table public.vk_servers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.vk_profiles(id),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 240),
  visibility text not null check (visibility in ('public', 'private')),
  tags text[] not null default '{}' check (cardinality(tags) <= 6 and array_position(tags, null) is null and char_length(array_to_string(tags, ',')) <= 240),
  banner_path text unique,
  created_at timestamptz not null default now()
);
create index vk_servers_owner_idx on public.vk_servers(owner_id);
create index vk_servers_directory_idx on public.vk_servers(created_at desc) where visibility = 'public';

create table public.vk_members (
  server_id uuid not null references public.vk_servers(id) on delete cascade,
  user_id uuid not null references public.vk_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index vk_members_user_idx on public.vk_members(user_id, server_id);

create table public.vk_categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.vk_servers(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 50),
  position integer not null default 0 check (position >= 0),
  unique (server_id, id)
);
create index vk_categories_order_idx on public.vk_categories(server_id, position, id);

create table public.vk_channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.vk_servers(id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 50),
  kind text not null check (kind in ('text', 'voice')),
  tags text[] not null default '{}' check (cardinality(tags) <= 6 and array_position(tags, null) is null and char_length(array_to_string(tags, ',')) <= 240),
  position integer not null default 0 check (position >= 0),
  foreign key (server_id, category_id) references public.vk_categories(server_id, id) on delete cascade
);
create index vk_channels_category_idx on public.vk_channels(server_id, category_id, position, id);

create table public.vk_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.vk_channels(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.vk_profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 2000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default now()
);
create index vk_messages_history_idx on public.vk_messages(channel_id, created_at desc, id desc);
create index vk_messages_author_idx on public.vk_messages(author_id);

create table public.vk_threads (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references public.vk_profiles(id) on delete cascade,
  member_b uuid not null references public.vk_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (member_a < member_b),
  unique (member_a, member_b)
);
create index vk_threads_member_b_idx on public.vk_threads(member_b);

create table public.vk_direct_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.vk_threads(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.vk_profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 2000 and body ~ '[^[:space:]]'),
  created_at timestamptz not null default now()
);
create index vk_dm_history_idx on public.vk_direct_messages(thread_id, created_at desc, id desc);
create index vk_dm_author_idx on public.vk_direct_messages(author_id);

create table vokalia_private.invites (
  code_hash bytea primary key,
  server_id uuid not null references public.vk_servers(id) on delete cascade,
  expires_at timestamptz not null,
  uses_remaining integer not null check (uses_remaining between 0 and 10)
);
create index vk_invites_server_idx on vokalia_private.invites(server_id);

create table vokalia_private.connections (
  user_id uuid not null references public.vk_profiles(id) on delete cascade,
  connection_id uuid not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, connection_id)
);

-- These helpers read the authenticated identity from Supabase, never from user input.
create function vokalia_private.confirmed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  ) and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true';
$$;

create function vokalia_private.require_profile() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if not vokalia_private.confirmed()
     or not exists (select 1 from public.vk_profiles where id = actor) then
    raise exception 'Un profil avec une adresse confirmée est requis.' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create function vokalia_private.is_member(p_server uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select vokalia_private.confirmed()) and exists (
    select 1 from public.vk_members m
    where m.server_id = p_server and m.user_id = (select auth.uid())
  );
$$;

create function vokalia_private.can_manage(p_server uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select vokalia_private.confirmed()) and exists (
    select 1 from public.vk_members m where m.server_id = p_server
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'moderator')
  );
$$;

create function vokalia_private.can_read_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select vokalia_private.confirmed()) and (
    p_user = (select auth.uid())
    or exists (select 1 from public.vk_members a join public.vk_members b using (server_id)
      where a.user_id = (select auth.uid()) and b.user_id = p_user)
    or exists (select 1 from public.vk_threads t
      where t.member_a = least(p_user, (select auth.uid())) and t.member_b = greatest(p_user, (select auth.uid())))
  );
$$;

create function vokalia_private.can_read_text(p_channel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vk_channels c
    where c.id = p_channel and c.kind = 'text' and vokalia_private.is_member(c.server_id));
$$;

create function vokalia_private.in_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select vokalia_private.confirmed()) and exists (select 1 from public.vk_threads t
    where t.id = p_thread and (select auth.uid()) in (t.member_a, t.member_b));
$$;

create function vokalia_private.own_banner_path(p_path text) returns boolean
language sql stable set search_path = '' as $$
  select (select vokalia_private.confirmed())
    and split_part(p_path, '/', 1) = (select auth.uid())::text
    and p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$';
$$;

create function vokalia_private.can_read_banner(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select vokalia_private.confirmed()) and (
    vokalia_private.own_banner_path(p_path) or exists (
      select 1 from public.vk_servers s where s.banner_path = p_path
        and (s.visibility = 'public' or vokalia_private.is_member(s.id))
    )
  );
$$;

create function vokalia_private.can_discard_banner(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select vokalia_private.own_banner_path(p_path)
    and not exists (select 1 from public.vk_servers where banner_path = p_path);
$$;

create function vokalia_private.create_server(p_name text, p_description text, p_visibility text, p_tags text[], p_banner text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := vokalia_private.require_profile();
  new_server uuid;
  new_category uuid;
begin
  if p_banner is not null and (
    not vokalia_private.own_banner_path(p_banner)
    or not exists (select 1 from storage.objects where bucket_id = 'vokalia-banners' and name = p_banner)
  ) then
    raise exception 'Bannière inaccessible.' using errcode = '42501';
  end if;
  insert into public.vk_servers(owner_id, name, description, visibility, tags, banner_path)
    values (actor, btrim(p_name), coalesce(btrim(p_description), ''), p_visibility, coalesce(p_tags, '{}'), p_banner)
    returning id into new_server;
  insert into public.vk_members(server_id, user_id, role) values (new_server, actor, 'owner');
  insert into public.vk_categories(server_id, name) values (new_server, 'Général') returning id into new_category;
  insert into public.vk_channels(server_id, category_id, name, kind, position) values
    (new_server, new_category, 'Discussion', 'text', 0), (new_server, new_category, 'Le café', 'voice', 1);
  return new_server;
end;
$$;

create function vokalia_private.join_server(p_server uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := vokalia_private.require_profile();
begin
  if not exists (select 1 from public.vk_servers where id = p_server and visibility = 'public') then
    raise exception 'Ce serveur nécessite une invitation.' using errcode = '42501';
  end if;
  insert into public.vk_members(server_id, user_id) values (p_server, actor) on conflict do nothing;
  return p_server;
end;
$$;

create function vokalia_private.make_invite(p_server uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare code uuid := gen_random_uuid();
begin
  if not vokalia_private.can_manage(p_server) then
    raise exception 'Tu ne peux pas inviter de membres ici.' using errcode = '42501';
  end if;
  insert into vokalia_private.invites(code_hash, server_id, expires_at, uses_remaining)
    values (sha256(convert_to(code::text, 'UTF8')), p_server, now() + interval '7 days', 10);
  return code;
end;
$$;

create function vokalia_private.accept_invite(p_code uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := vokalia_private.require_profile();
  invite vokalia_private.invites%rowtype;
begin
  select * into invite from vokalia_private.invites
    where code_hash = sha256(convert_to(p_code::text, 'UTF8')) and expires_at > now() for update;
  if not found then raise exception 'Invitation invalide ou expirée.' using errcode = '22023'; end if;
  if vokalia_private.is_member(invite.server_id) then return invite.server_id; end if;
  if invite.uses_remaining = 0 then raise exception 'Invitation épuisée.' using errcode = '22023'; end if;
  insert into public.vk_members(server_id, user_id) values (invite.server_id, actor) on conflict do nothing;
  if found then
    update vokalia_private.invites set uses_remaining = uses_remaining - 1 where code_hash = invite.code_hash;
  end if;
  return invite.server_id;
end;
$$;

create function vokalia_private.open_thread(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := vokalia_private.require_profile();
  first_user uuid := least(actor, p_user);
  second_user uuid := greatest(actor, p_user);
  thread uuid;
begin
  if p_user is null or p_user = actor then raise exception 'Choisis un autre membre.' using errcode = '22023'; end if;
  select id into thread from public.vk_threads where member_a = first_user and member_b = second_user;
  if found then return thread; end if;
  if not exists (select 1 from public.vk_members a join public.vk_members b using (server_id)
    where a.user_id = actor and b.user_id = p_user) then
    raise exception 'Vous devez partager un serveur pour ouvrir une conversation.' using errcode = '42501';
  end if;
  insert into public.vk_threads(member_a, member_b) values (first_user, second_user) on conflict do nothing;
  select id into thread from public.vk_threads where member_a = first_user and member_b = second_user;
  return thread;
end;
$$;

create function vokalia_private.touch_connection(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := vokalia_private.require_profile();
begin
  insert into vokalia_private.connections(user_id, connection_id) values (actor, p_connection)
    on conflict (user_id, connection_id) do update set seen_at = now();
  delete from vokalia_private.connections where user_id = actor and seen_at < now() - interval '1 hour';
end;
$$;

create function vokalia_private.end_connection(p_connection uuid) returns void
language sql security definer set search_path = '' as $$
  delete from vokalia_private.connections
    where user_id = (select auth.uid()) and connection_id = p_connection;
$$;

create function vokalia_private.online_members(p_server uuid) returns table(user_id uuid, display_name text, role text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.display_name, m.role from public.vk_members m
    join public.vk_profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null
    where m.server_id = p_server and (select vokalia_private.is_member(p_server))
      and exists (select 1 from vokalia_private.connections c
        where c.user_id = m.user_id and c.seen_at > now() - interval '65 seconds')
    order by p.display_name, m.user_id;
$$;

create function vokalia_private.find_servers(p_search text) returns setof public.vk_servers
language sql stable security definer set search_path = '' as $$
  select s.* from public.vk_servers s
    where s.visibility = 'public' and (select vokalia_private.confirmed())
      and (strpos(lower(s.name || ' ' || s.description || ' ' || array_to_string(s.tags, ' ')), lower(btrim(left(coalesce(p_search, ''), 80)))) > 0
        or exists (select 1 from public.vk_channels c where c.server_id = s.id
          and strpos(lower(array_to_string(c.tags, ' ')), lower(btrim(left(coalesce(p_search, ''), 80)))) > 0))
    order by s.created_at desc limit 50;
$$;

-- Public RPCs are invoker wrappers. The checked, privileged helpers stay private.
create function public.vk_create_server(p_name text, p_description text, p_visibility text, p_tags text[], p_banner text)
returns uuid language sql set search_path = '' as $$ select vokalia_private.create_server(p_name, p_description, p_visibility, p_tags, p_banner); $$;
create function public.vk_join_server(p_server uuid) returns uuid language sql set search_path = '' as $$ select vokalia_private.join_server(p_server); $$;
create function public.vk_make_invite(p_server uuid) returns uuid language sql set search_path = '' as $$ select vokalia_private.make_invite(p_server); $$;
create function public.vk_accept_invite(p_code uuid) returns uuid language sql set search_path = '' as $$ select vokalia_private.accept_invite(p_code); $$;
create function public.vk_open_thread(p_user uuid) returns uuid language sql set search_path = '' as $$ select vokalia_private.open_thread(p_user); $$;
create function public.vk_touch_connection(p_connection uuid) returns void language sql set search_path = '' as $$ select vokalia_private.touch_connection(p_connection); $$;
create function public.vk_end_connection(p_connection uuid) returns void language sql set search_path = '' as $$ select vokalia_private.end_connection(p_connection); $$;
create function public.vk_online_members(p_server uuid) returns table(user_id uuid, display_name text, role text) language sql stable set search_path = '' as $$ select * from vokalia_private.online_members(p_server); $$;
create function public.vk_find_servers(p_search text) returns setof public.vk_servers language sql stable set search_path = '' as $$ select * from vokalia_private.find_servers(p_search); $$;

create function public.vk_save_profile(p_name text) returns public.vk_profiles
language sql set search_path = '' as $$
  insert into public.vk_profiles(display_name) values (btrim(p_name))
    on conflict (id) do update set display_name = excluded.display_name returning *;
$$;

create function public.vk_voice_room(p_channel uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'server_id', c.server_id, 'name', c.name)
  from public.vk_channels c where c.id = p_channel and c.kind = 'voice';
$$;

revoke execute on all functions in schema vokalia_private from public, anon, authenticated;
grant execute on function vokalia_private.confirmed(), vokalia_private.is_member(uuid), vokalia_private.can_manage(uuid),
  vokalia_private.can_read_profile(uuid), vokalia_private.can_read_text(uuid), vokalia_private.in_thread(uuid),
  vokalia_private.own_banner_path(text), vokalia_private.can_read_banner(text), vokalia_private.can_discard_banner(text),
  vokalia_private.create_server(text, text, text, text[], text), vokalia_private.join_server(uuid),
  vokalia_private.make_invite(uuid), vokalia_private.accept_invite(uuid), vokalia_private.open_thread(uuid),
  vokalia_private.touch_connection(uuid), vokalia_private.end_connection(uuid), vokalia_private.online_members(uuid),
  vokalia_private.find_servers(text) to authenticated;

do $$
declare routine text;
begin
  foreach routine in array array['vk_create_server(text,text,text,text[],text)', 'vk_join_server(uuid)',
    'vk_make_invite(uuid)', 'vk_accept_invite(uuid)', 'vk_open_thread(uuid)', 'vk_touch_connection(uuid)',
    'vk_end_connection(uuid)', 'vk_online_members(uuid)', 'vk_find_servers(text)', 'vk_save_profile(text)', 'vk_voice_room(uuid)'] loop
    execute 'revoke all on function public.' || routine || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || routine || ' to authenticated';
  end loop;
end;
$$;

alter table public.vk_profiles enable row level security;
alter table public.vk_servers enable row level security;
alter table public.vk_members enable row level security;
alter table public.vk_categories enable row level security;
alter table public.vk_channels enable row level security;
alter table public.vk_messages enable row level security;
alter table public.vk_threads enable row level security;
alter table public.vk_direct_messages enable row level security;
alter table vokalia_private.invites enable row level security;
alter table vokalia_private.connections enable row level security;

revoke all on public.vk_profiles, public.vk_servers, public.vk_members, public.vk_categories,
  public.vk_channels, public.vk_messages, public.vk_threads, public.vk_direct_messages from public, anon, authenticated;
grant select on public.vk_profiles, public.vk_servers, public.vk_members, public.vk_categories,
  public.vk_channels, public.vk_messages, public.vk_threads, public.vk_direct_messages to authenticated;
grant insert(display_name), update(display_name) on public.vk_profiles to authenticated;
grant insert(server_id, name, position) on public.vk_categories to authenticated;
grant insert(server_id, category_id, name, kind, tags, position) on public.vk_channels to authenticated;
grant insert(channel_id, body) on public.vk_messages to authenticated;
grant insert(thread_id, body) on public.vk_direct_messages to authenticated;

create policy vk_read_profiles on public.vk_profiles for select to authenticated using (vokalia_private.can_read_profile(id));
create policy vk_create_profile on public.vk_profiles for insert to authenticated
  with check (id = (select auth.uid()) and (select vokalia_private.confirmed()));
create policy vk_update_profile on public.vk_profiles for update to authenticated
  using (id = (select auth.uid()) and (select vokalia_private.confirmed()))
  with check (id = (select auth.uid()) and (select vokalia_private.confirmed()));
create policy vk_read_servers on public.vk_servers for select to authenticated
  using ((select vokalia_private.confirmed()) and (visibility = 'public' or vokalia_private.is_member(id)));
create policy vk_read_members on public.vk_members for select to authenticated using (vokalia_private.is_member(server_id));
create policy vk_read_categories on public.vk_categories for select to authenticated using (vokalia_private.is_member(server_id));
create policy vk_add_categories on public.vk_categories for insert to authenticated with check (vokalia_private.can_manage(server_id));
create policy vk_read_channels on public.vk_channels for select to authenticated using (vokalia_private.is_member(server_id));
create policy vk_add_channels on public.vk_channels for insert to authenticated with check (vokalia_private.can_manage(server_id));
create policy vk_read_messages on public.vk_messages for select to authenticated using (vokalia_private.can_read_text(channel_id));
create policy vk_send_messages on public.vk_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and vokalia_private.can_read_text(channel_id));
create policy vk_read_threads on public.vk_threads for select to authenticated
  using ((select vokalia_private.confirmed()) and (select auth.uid()) in (member_a, member_b));
create policy vk_read_dm on public.vk_direct_messages for select to authenticated using (vokalia_private.in_thread(thread_id));
create policy vk_send_dm on public.vk_direct_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and vokalia_private.in_thread(thread_id));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('vokalia-banners', 'vokalia-banners', false, 2097152, array['image/webp', 'image/jpeg', 'image/png']);
create policy vk_upload_banner on storage.objects for insert to authenticated
  with check (bucket_id = 'vokalia-banners' and vokalia_private.own_banner_path(name));
create policy vk_download_banner on storage.objects for select to authenticated
  using (bucket_id = 'vokalia-banners' and vokalia_private.can_read_banner(name));
create policy vk_discard_banner on storage.objects for delete to authenticated
  using (bucket_id = 'vokalia-banners' and vokalia_private.can_discard_banner(name));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vk_messages') then
      alter publication supabase_realtime add table public.vk_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vk_direct_messages') then
      alter publication supabase_realtime add table public.vk_direct_messages;
    end if;
  end if;
end;
$$;

commit;
