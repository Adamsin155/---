-- One-time fill of the existing clients (docs/ops.md, section 153; run after
-- 20261225100000_autofill_client.sql, only after the owner saw the list): what the characterization
-- form and the contracts uploaded by hand already hold goes into the card where it is EMPTY, exactly
-- as the new triggers do for new ones. The characterization call's date: when the form was saved.
-- Nothing is overwritten, dropped or deleted.
update public.clients c
   set phone = case when coalesce(btrim(c.phone), '') = '' then coalesce(private.clean_phone(x.fields ->> 'phone'), c.phone) else c.phone end,
       address = case when coalesce(btrim(c.address), '') = '' then coalesce(private.clean_address(x.fields ->> 'address'), c.address) else c.address end,
       char_at = coalesce(c.char_at, case when exists (select 1 from jsonb_each_text(coalesce(x.fields, '{}'::jsonb)) f where btrim(f.value) <> '') then coalesce(x.completed_at, x.at) end)
  from public.characterizations x
 where x.client_id = c.id and c.status in ('active', 'ending')
   and ((coalesce(btrim(c.phone), '') = '' and private.clean_phone(x.fields ->> 'phone') is not null)
     or (coalesce(btrim(c.address), '') = '' and private.clean_address(x.fields ->> 'address') is not null)
     or (c.char_at is null and exists (select 1 from jsonb_each_text(coalesce(x.fields, '{}'::jsonb)) f where btrim(f.value) <> '')));

update public.clients c
   set company_id = m.cid
  from (select client_id, max(private.clean_company_id(company_id)) cid from public.manual_contracts group by client_id) m
 where m.client_id = c.id and c.status in ('active', 'ending') and coalesce(btrim(c.company_id), '') = '' and m.cid is not null;
