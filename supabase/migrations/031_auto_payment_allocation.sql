begin;
-- Внутренняя функция: только однозначное полное погашение остатков заданий.
create or replace function public.auto_allocate_receipt(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p payments; candidates jsonb; matches jsonb; selected_rows jsonb; parts jsonb; selected_expenses uuid[]; has_selected boolean;
begin
 perform require_finance_user();perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 select * into p from payments where id=p_id for update;
 if not found then raise exception 'Платёж не найден'; end if;
 if p.matter_id is not null or exists(select 1 from payment_allocations where payment_id=p.id) then return jsonb_build_object('allocated',false,'reason','manual'); end if;
 if exists(select 1 from payments x where x.client_id=p.client_id and x.id<>p.id and x.amount>coalesce((select sum(a.amount) from effective_payment_allocations a where a.payment_id=x.id),0)) then
  return jsonb_build_object('allocated',false,'reason','unallocated');
 end if;
 has_selected:=exists(select 1 from reimbursable_expenses where payment_id=p.id);
 with fee as (
  select m.id,coalesce((select sum(b.amount) from billing_events b where b.matter_id=m.id and b.event_date<=p.pay_date and b.source<>'payments' and b.kind<>'expense'),0)
   -coalesce((select sum(a.fee_amount) from effective_payment_allocations a where a.matter_id=m.id and a.payment_id<>p.id),0) amount
  from matters m where m.client_id=p.client_id
 ), expenses as (
  select e.matter_id,sum(e.amount) amount,jsonb_agg(e.id order by e.id) ids from reimbursable_expenses e
  join matters m on m.id=e.matter_id where m.client_id=p.client_id and e.expense_date<=p.pay_date
   and (e.payment_id=p.id or (not has_selected and e.payment_id is null and e.status='invoiced')) group by e.matter_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('matter_id',f.id,'fee_amount',f.amount,'expense_amount',coalesce(e.amount,0),'expenses',coalesce(e.ids,'[]'::jsonb)) order by f.id),'[]'::jsonb)
 into candidates from fee f left join expenses e on e.matter_id=f.id where f.amount>=0 and f.amount+coalesce(e.amount,0)>0 and f.amount+coalesce(e.amount,0)<=p.amount;
 if jsonb_array_length(candidates)>16 then return jsonb_build_object('allocated',false,'reason','many'); end if;
 with recursive c as (select ordinality::int n,value row,(value->>'fee_amount')::numeric+(value->>'expense_amount')::numeric amount from jsonb_array_elements(candidates) with ordinality),
 search(n,total,chosen) as (
  select 0,0::numeric,'[]'::jsonb
  union all
  select s.n+1,s.total+case when v.take then c.amount else 0 end,s.chosen||case when v.take then jsonb_build_array(c.row) else '[]'::jsonb end
  from search s join c on c.n=s.n+1 cross join (values(false),(true)) v(take)
  where s.total+case when v.take then c.amount else 0 end<=p.amount
 ) select jsonb_agg(chosen) into matches from (select chosen from search where n=jsonb_array_length(candidates) and total=p.amount limit 2) found;
 if coalesce(jsonb_array_length(matches),0)<>1 then return jsonb_build_object('allocated',false,'reason',case when jsonb_array_length(matches)>1 then 'ambiguous' else 'no_match' end); end if;
 selected_rows:=matches->0;
 select coalesce(array_agg(expid.id::uuid),'{}'::uuid[]) into selected_expenses from jsonb_array_elements(selected_rows) r cross join lateral jsonb_array_elements_text(r->'expenses') expid(id);
 if exists(select 1 from reimbursable_expenses where payment_id=p.id and not(id=any(selected_expenses))) then return jsonb_build_object('allocated',false,'reason','expenses'); end if;
 update reimbursable_expenses set payment_id=p.id,reimbursed_date=p.pay_date,status='reimbursed' where id=any(selected_expenses) and payment_id is null;
 select jsonb_agg(jsonb_build_object('matter_id',r->>'matter_id','act_id',null,'fee_amount',r->'fee_amount','expense_amount',r->'expense_amount')) into parts from jsonb_array_elements(selected_rows) r;
 perform save_payment_allocations(p.id,parts,p.revision,md5('auto-allocation:'||p.id::text)::uuid);
 return jsonb_build_object('allocated',true,'parts',jsonb_array_length(parts),'rows',parts);
end $$;
revoke all on function public.auto_allocate_receipt(uuid) from public,anon,authenticated;

create or replace function public.save_payment_matched(p_payment jsonb,p_reimbursement_ids uuid[],p_expected_revision bigint,p_operation_id uuid,p_auto boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pid uuid; previous_operation boolean; result jsonb;
begin
 perform require_finance_user();perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 previous_operation:=exists(select 1 from financial_operations where id=p_operation_id);
 pid:=save_payment(p_payment,p_reimbursement_ids,p_expected_revision,p_operation_id);
 if p_auto and p_expected_revision is null and not previous_operation then result:=auto_allocate_receipt(pid);
 else result:=jsonb_build_object('allocated',false,'reason','manual'); end if;
 return result||jsonb_build_object('id',pid);
end $$;
revoke all on function public.save_payment_matched(jsonb,uuid[],bigint,uuid,boolean) from public,anon;
grant execute on function public.save_payment_matched(jsonb,uuid[],bigint,uuid,boolean) to authenticated,service_role;

-- Перегрузку старого импорта удаляем, иначе PostgREST не различит запросы.
drop function if exists public.import_bank_receipt(jsonb,uuid,uuid);
create or replace function public.import_bank_receipt(p_source jsonb,p_client_id uuid,p_matter_id uuid,p_auto boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 canonical jsonb; operation_id uuid; previous financial_operations; receipt_id uuid;
 amount_value numeric; date_value date; target text; allocation_result jsonb;
begin
 perform require_finance_user();perform pg_advisory_xact_lock(hashtext('timelog-finance'));
 if p_auto and p_client_id is not null then p_matter_id:=null; end if;
 amount_value:=(p_source->>'amount')::numeric;
 date_value:=(p_source->>'date')::date;
 if amount_value is null or amount_value::text in ('NaN','Infinity','-Infinity') or amount_value<=0 or amount_value<>round(amount_value,2) or amount_value>=10000000000 then
  raise exception 'Некорректная сумма поступления';
 end if;
 if date_value is null or coalesce(p_source->>'account','')='' then raise exception 'Не указан счёт или дата выписки'; end if;
 if p_client_id is not null and not exists(select 1 from clients where id=p_client_id) then raise exception 'Доверитель не найден'; end if;
 if p_matter_id is not null and not exists(select 1 from matters where id=p_matter_id and client_id=p_client_id) then raise exception 'Задание принадлежит другому доверителю'; end if;
 canonical:=jsonb_build_object('account',regexp_replace(p_source->>'account','\s','','g'),
  'date',date_value,'amount',amount_value::numeric(12,2),'doc',trim(coalesce(p_source->>'doc','')),
  'inn',trim(coalesce(p_source->>'inn','')),'name',lower(regexp_replace(trim(coalesce(p_source->>'name','')),'\s+',' ','g')),
  'purpose',lower(regexp_replace(trim(coalesce(p_source->>'purpose','')),'\s+',' ','g')));
 operation_id:=md5('bank-import-v1:'||canonical::text)::uuid;
 perform pg_advisory_xact_lock(hashtext('bank-import-v1'));
 select * into previous from financial_operations where id=operation_id;
 if found then
  if previous.kind<>'bank-import' or previous.payload<>canonical then raise exception 'Конфликт идентификатора операции'; end if;
  target:=case when exists(select 1 from payments where id=previous.result_id) then 'payments'
   when exists(select 1 from manual_income where id=previous.result_id) then 'manual_income' else null end;
  if target is null then raise exception 'Ранее импортированное поступление удалено. Проверьте историю перед ручным внесением'; end if;
  return jsonb_build_object('id',previous.result_id,'existing',true,'table',target);
 end if;
 receipt_id:=gen_random_uuid();
 if p_client_id is not null then
  target:='payments';
  insert into payments(id,client_id,matter_id,pay_date,amount,description,doc_no,created_by)
   values(receipt_id,p_client_id,p_matter_id,date_value,amount_value,coalesce(nullif(p_source->>'purpose',''),'Поступление по выписке'),nullif(p_source->>'doc',''),auth.uid());
 else
  target:='manual_income';
  insert into manual_income(id,client_id,matter_id,income_date,amount,description,doc_no,created_by)
   values(receipt_id,null,null,date_value,amount_value,coalesce(nullif(p_source->>'purpose',''),'Поступление по выписке'),nullif(p_source->>'doc',''),auth.uid());
 end if;
 insert into financial_operations(id,kind,payload,result_id,created_by)values(operation_id,'bank-import',canonical,receipt_id,auth.uid());
 if p_auto and target='payments' then allocation_result:=auto_allocate_receipt(receipt_id); end if;
 return jsonb_build_object('id',receipt_id,'existing',false,'table',target,'allocation',allocation_result);
end $$;
revoke all on function public.import_bank_receipt(jsonb,uuid,uuid,boolean) from public,anon;
grant execute on function public.import_bank_receipt(jsonb,uuid,uuid,boolean) to authenticated,service_role;

commit;
