create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 24 and display_name !~ '[[:cntrl:]]'),
  avatar_seed integer not null check (avatar_seed between 0 and 2147483647),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), is_blocked boolean not null default false
);
create table public.placement_zones (
  id text primary key, label text not null, min_x double precision not null, max_x double precision not null, min_z double precision not null, max_z double precision not null,
  ground_y double precision not null, max_occupants smallint not null check(max_occupants between 1 and 4), allowed_types text[] not null,
  check(min_x<max_x and min_z<max_z)
);
create table public.trap_catalog (
  type text primary key, display_name text not null, category text not null check(category in('sweeper','prop','movement')), placement_radius double precision not null check(placement_radius>0), risk_weight double precision not null check(risk_weight>0), enabled boolean not null default true, sort_order smallint not null unique
);
create table public.chains (
  id uuid primary key default gen_random_uuid(), public_slug text unique not null check(public_slug ~ '^[a-z0-9-]{10,24}$'), owner_id uuid not null references public.profiles(user_id), base_seed integer not null,
  status public.challenge_status not null default 'active', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.challenges (
  id uuid primary key default gen_random_uuid(), chain_id uuid not null references public.chains(id) on delete cascade, parent_id uuid references public.challenges(id), public_slug text unique not null check(public_slug ~ '^[a-z0-9-]{10,24}$'),
  depth smallint not null check(depth between 0 and 20), created_by uuid not null references public.profiles(user_id), created_by_name text not null, created_by_avatar_seed integer not null, base_seed integer not null, level_version smallint not null default 1 check(level_version=1),
  traps jsonb not null default '[]'::jsonb check(jsonb_typeof(traps)='array' and jsonb_array_length(traps)<=20), added_trap jsonb, ghost_trace jsonb, parent_completion_attempt_id uuid, is_published boolean not null default true,
  status public.challenge_status not null default 'active', attempts_count integer not null default 0 check(attempts_count>=0), completions_count integer not null default 0 check(completions_count>=0), best_time_ms integer check(best_time_ms between 0 and 90000), share_count integer not null default 0 check(share_count>=0), last_played_at timestamptz,
  public_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check(jsonb_array_length(traps)=depth), check((depth=0 and parent_id is null and added_trap is null) or (depth>0 and parent_id is not null and added_trap is not null))
);
create table public.attempts (
  id uuid primary key default gen_random_uuid(), challenge_id uuid not null references public.challenges(id) on delete cascade, user_id uuid not null references public.profiles(user_id) on delete cascade,
  client_session_id uuid not null, idempotency_key uuid not null, finish_idempotency_key uuid, share_token text, device_class text not null check(device_class in('desktop','tablet','mobile','unknown')), build_version text not null,
  outcome public.attempt_outcome not null default 'started', started_at timestamptz not null default now(), finished_at timestamptz, duration_ms integer check(duration_ms between 0 and 90000), max_progress double precision not null default 0 check(max_progress between 0 and 1.1),
  death_trap_instance_id text, ghost_trace jsonb, offered_traps text[], published_child_id uuid references public.challenges(id), created_at timestamptz not null default now(),
  unique(user_id,idempotency_key), unique(published_child_id), check(offered_traps is null or cardinality(offered_traps)=3), check((outcome='completed' and ghost_trace is not null) or outcome<>'completed' or finished_at is null)
);
alter table public.challenges add constraint challenges_parent_attempt_fk foreign key(parent_completion_attempt_id) references public.attempts(id);
create unique index challenges_one_child_per_attempt on public.challenges(parent_completion_attempt_id) where parent_completion_attempt_id is not null;
create table public.shares (
  id uuid primary key default gen_random_uuid(), share_token text unique not null, challenge_id uuid not null references public.challenges(id) on delete cascade, user_id uuid not null references public.profiles(user_id), channel public.share_channel not null, idempotency_key uuid not null, created_at timestamptz not null default now(), unique(user_id,idempotency_key)
);
create table public.share_visits (
  share_id uuid not null references public.shares(id) on delete cascade, viewer_id uuid not null references public.profiles(user_id) on delete cascade, challenge_id uuid not null references public.challenges(id) on delete cascade,
  opened_at timestamptz not null default now(), completed_attempt_id uuid references public.attempts(id), primary key(share_id,viewer_id)
);
create table public.mutation_idempotency (
  user_id uuid not null references public.profiles(user_id) on delete cascade, operation text not null, idempotency_key uuid not null, resource_id uuid, response_json jsonb, created_at timestamptz not null default now(), primary key(user_id,operation,idempotency_key)
);
