-- Document presentation only. Financial records and issued snapshots are unchanged.
begin;
alter table public.clients add column if not exists act_party_text text;
alter table public.clients add column if not exists act_requisites text;
alter table public.matters add column if not exists act_document_options jsonb;
do $$begin
 if not exists(select 1 from pg_constraint where conname='clients_act_text_limits') then
  alter table public.clients add constraint clients_act_text_limits check
   (coalesce(length(act_party_text),0)<=8000 and coalesce(length(act_requisites),0)<=8000);
 end if;
 if not exists(select 1 from pg_constraint where conname='matters_act_options_valid') then
  alter table public.matters add constraint matters_act_options_valid check
   (act_document_options is null or (jsonb_typeof(act_document_options)='object'
    and length(act_document_options::text)<=8000
    and (not(act_document_options?'style') or act_document_options->>'style' in ('auto','hourly','subscription','fixed'))
    and (not(act_document_options?'agreement_kind') or act_document_options->>'agreement_kind' in ('agreement','contract'))));
 end if;
end $$;
comment on column public.clients.act_party_text is 'Full plain-text description of the client in the act; no HTML';
comment on column public.clients.act_requisites is 'Plain-text client requisites in the signature block; no signature image';
comment on column public.matters.act_document_options is 'Presentation: style, agreement_kind, service_clause, fee_clause';
notify pgrst,'reload schema';
commit;
