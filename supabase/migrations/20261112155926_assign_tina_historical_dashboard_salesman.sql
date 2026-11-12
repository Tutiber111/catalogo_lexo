-- Keep historical code 80605 in the same dashboard portfolio as code 84008.
create or replace function public.sales_dashboard_assignment(client_code text, salesman_code text)
returns text language sql immutable set search_path = '' as $$
 select case
   when trim(client_code) = '81032' then 'unassigned'
   when trim(client_code) = '80605' and coalesce(trim(salesman_code), '') = '' then '805'
   when coalesce(trim(salesman_code), '') in ('', '90', '900') then '900'
   else trim(salesman_code)
 end;
$$;
