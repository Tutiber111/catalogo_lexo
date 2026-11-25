-- Keep the historical exclusion from Diana's portfolio while honoring an
-- explicit assignment to a different salesperson in the client directory.
create or replace function public.sales_dashboard_assignment(client_code text, salesman_code text)
returns text language sql immutable set search_path = '' as $$
 select case
   when trim(client_code) = '81032' and coalesce(trim(salesman_code), '') in ('', '810') then 'unassigned'
   when trim(client_code) = '80605' and coalesce(trim(salesman_code), '') = '' then '805'
   when coalesce(trim(salesman_code), '') in ('', '90', '900') then '900'
   else trim(salesman_code)
 end;
$$;
