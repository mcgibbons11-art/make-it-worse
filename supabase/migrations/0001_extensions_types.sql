create extension if not exists pgcrypto;

create type public.challenge_status as enum ('active','archived','blocked');
create type public.attempt_outcome as enum ('started','completed','fell','timeout','reset','quit');
create type public.share_channel as enum ('web_share','copy_link','share_image','share_clip','unknown');
