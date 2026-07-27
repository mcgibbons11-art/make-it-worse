-- Public challenge DTOs need attribution names and avatar seeds, not stable
-- anonymous-auth UUIDs. Keep ownerUserId in the private canonical snapshot for
-- moderation/ownership, but replace it with null at the public trust boundary.

create or replace function public.challenge_dto(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'id', c.id,
  'slug', c.public_slug,
  'chainId', c.chain_id,
  'chainSlug', ch.public_slug,
  'parentSlug', p.public_slug,
  'depth', c.depth,
  'baseSeed', c.base_seed,
  'levelVersion', c.level_version,
  'createdByName', c.created_by_name,
  'createdByAvatarSeed', c.created_by_avatar_seed,
  'addedTrap', case
    when c.added_trap is null then null
    else jsonb_set(c.added_trap, '{ownerUserId}', 'null'::jsonb, true)
  end,
  'traps', coalesce((
    select jsonb_agg(jsonb_set(trap.value, '{ownerUserId}', 'null'::jsonb, true))
    from jsonb_array_elements(coalesce(c.traps, '[]'::jsonb)) trap(value)
  ), '[]'::jsonb),
  'ghostTrace', c.ghost_trace,
  'stats', jsonb_build_object(
    'attempts', c.attempts_count,
    'completions', c.completions_count,
    'survivalRate', case
      when c.attempts_count = 0 then null
      else c.completions_count::double precision / c.attempts_count
    end,
    'bestTimeMs', c.best_time_ms,
    'recentAttempts', c.attempts_count,
    'shareCount', c.share_count
  ),
  'createdAt', to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'isDemo', false
)
from public.challenges c
join public.chains ch on ch.id = c.chain_id
left join public.challenges p on p.id = c.parent_id
where c.id = p_id
$$;

update public.challenges
set public_payload = public.challenge_dto(id);

revoke all on function public.challenge_dto(uuid) from public, anon, authenticated;
