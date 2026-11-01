-- Выполнить вручную в SQL Editor перед публикацией интерфейса.
begin;
create or replace function public.import_bank_receipt(p_source jsonb,p_client_id uuid,p_matter_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 canonical jsonb; operation_id uuid; previous financial_operations; receipt_id uuid;
 amount_value numeric; date_value date; target text;
begin
 perform require_finance_user();
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
 return jsonb_build_object('id',receipt_id,'existing',false,'table',target);
end $$;
revoke all on function public.import_bank_receipt(jsonb,uuid,uuid) from public,anon;
grant execute on function public.import_bank_receipt(jsonb,uuid,uuid) to authenticated,service_role;
commit;
