begin;
alter table public.court_events add column if not exists calculated_date date;
alter table public.court_events add column if not exists calendar_version text;
alter table public.court_events add column if not exists confirmed_at timestamptz;
alter table public.court_events add column if not exists source_document text;
drop trigger if exists audit_court_events on public.court_events;
drop trigger if exists audit_court_events on public.court_events;
create trigger audit_court_events after insert or update or delete on public.court_events
for each row execute function public.log_change();
commit;
