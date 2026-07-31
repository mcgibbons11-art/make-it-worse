-- Authored rooms are free-build data, not 20-round social challenges. Keep the
-- optional standalone community backend aligned with the v5 copy/paste codec:
-- bytes are bounded at the trust boundary, but asset counts are not design
-- limits.

alter table public.custom_map_versions
  drop constraint if exists custom_map_versions_payload_code_check,
  drop constraint if exists custom_map_versions_piece_count_check,
  drop constraint if exists custom_map_versions_trap_count_check;

alter table public.custom_map_versions
  alter column piece_count type integer,
  alter column trap_count type integer;

alter table public.custom_map_versions
  add constraint custom_map_versions_payload_code_check
    check (char_length(payload_code) between 1 and 1000000 and payload_code ~ '^[A-Za-z0-9_-]+$'),
  add constraint custom_map_versions_piece_count_check check (piece_count >= 1),
  add constraint custom_map_versions_trap_count_check check (trap_count >= 0);

create or replace function public.custom_map_code_payload(p_code text)
returns jsonb language plpgsql immutable security definer set search_path=public,pg_temp as $$
declare v_base64 text;v_payload jsonb;
begin
  if p_code is null or char_length(p_code) not between 1 and 1000000 or p_code !~ '^[A-Za-z0-9_-]+$' then return null;end if;
  v_base64:=translate(p_code,'-_','+/');
  v_base64:=v_base64||repeat('=',(4-char_length(v_base64)%4)%4);
  v_payload:=convert_from(decode(v_base64,'base64'),'UTF8')::jsonb;
  if jsonb_typeof(v_payload)<>'array' or jsonb_array_length(v_payload)<>10 or v_payload->>0<>'5' then return null;end if;
  if jsonb_typeof(v_payload->6)<>'array' then return null;end if;
  if jsonb_typeof(v_payload->7)<>'array' or jsonb_array_length(v_payload->7)<>5 or jsonb_typeof(v_payload->7->0)<>'array' or jsonb_array_length(v_payload->7->0)<1 then return null;end if;
  return v_payload;
exception when others then return null;
end$$;
