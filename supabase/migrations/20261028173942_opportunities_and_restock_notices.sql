-- Depends on the sales history and salesperson-scope migrations. No customer mail is sent.
create schema if not exists private;
create table if not exists private.picking_stock_link(id integer primary key check(id=1),secret text not null);
create table public.sales_catalog_products(
 product_id text primary key,sku text not null,brand text not null,name text not null,
 active boolean not null default true,base_out_of_stock boolean not null default false,
 is_new boolean not null default false
);
alter table public.sales_catalog_products enable row level security;
revoke all on public.sales_catalog_products from anon,authenticated;
grant all on public.sales_catalog_products to service_role;
create table public.sales_order_fulfillment(
 item_id uuid primary key references public.order_items(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 delivered_qty numeric not null check(delivered_qty>=0),nostock_qty numeric not null check(nostock_qty>=0),
 observed_at timestamptz not null default now()
);
alter table public.sales_order_fulfillment enable row level security;
revoke all on public.sales_order_fulfillment from anon,authenticated;
grant all on public.sales_order_fulfillment to service_role;
create function public.replace_sales_delivery_snapshot(p_order_ids uuid[],p_lines jsonb,p_observed_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_lines)<>'array' then raise exception 'Invalid snapshot'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x left join public.order_items i on i.id=(x->>'itemId')::uuid
   where i.id is null or i.order_id<>(x->>'orderId')::uuid or not(i.order_id=any(p_order_ids))
   or (x->>'deliveredQty')::numeric<0 or (x->>'deliveredQty')::numeric>i.quantity
   or (x->>'outOfStockQty')::numeric<0 or (x->>'outOfStockQty')::numeric>i.quantity) then raise exception 'Invalid fulfillment line'; end if;
 insert into public.sales_order_fulfillment(item_id,order_id,delivered_qty,nostock_qty,observed_at)
 select (x->>'itemId')::uuid,(x->>'orderId')::uuid,(x->>'deliveredQty')::numeric,coalesce((x->>'outOfStockQty')::numeric,0),p_observed_at from jsonb_array_elements(p_lines) x
 on conflict(item_id) do update set delivered_qty=excluded.delivered_qty,nostock_qty=excluded.nostock_qty,observed_at=excluded.observed_at
 where sales_order_fulfillment.observed_at<=excluded.observed_at;
 delete from public.sales_order_fulfillment f where f.order_id=any(p_order_ids) and f.observed_at<=p_observed_at
 and not exists(select 1 from jsonb_array_elements(p_lines) x where (x->>'itemId')::uuid=f.item_id);
end;$$;
revoke all on function public.replace_sales_delivery_snapshot(uuid[],jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.replace_sales_delivery_snapshot(uuid[],jsonb,timestamptz) to service_role;

create view private.sales_product_facts as
with cutoff as(select coalesce(min(warehouse_from_date),max(to_date)+1) as day from public.sales_history_batches)
select 'erp:'||h.order_key as order_id,h.order_date as day,h.client_code,upper(trim(h.sku)) as sku,
 h.ordered_qty as ordered_qty,h.invoiced_qty as delivered_qty,0::numeric as nostock_qty
from public.sales_history_lines h cross join cutoff c where h.order_date<c.day
and upper(trim(h.sku))<>all(array['1631','1740/33','1741/33','1741/33/C','1761/33','1762/33','1763/33','350','709','719','790'])
union all
select 'web:'||o.id::text,(o.created_at at time zone 'America/Argentina/Buenos_Aires')::date,
 case when o.sales_client_id is not null then c.client_code else coalesce(c.client_code,nullif(trim(o.sales_client_code),''),nullif(trim(o.customer_client_code),'')) end,
 upper(trim(i.sku)),i.quantity,f.delivered_qty,coalesce(f.nostock_qty,0)
from public.orders o join public.order_items i on i.order_id=o.id left join public.sales_order_fulfillment f on f.item_id=i.id
left join public.sales_clients c on case when o.sales_client_id is not null then c.id=o.sales_client_id else c.client_code=coalesce(nullif(trim(o.sales_client_code),''),nullif(trim(o.customer_client_code),'')) end
cross join cutoff ct where o.status::text not in ('draft','cancelled') and (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date>=ct.day
and upper(trim(i.sku))<>all(array['1631','1740/33','1741/33','1741/33/C','1761/33','1762/33','1763/33','350','709','719','790']);
revoke all on private.sales_product_facts from public,anon,authenticated;

create function public.sales_company_bestsellers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_ text; result_ jsonb; today_ date=(now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
 select role::text into role_ from public.profiles where id=auth.uid();
 if coalesce(role_,'') not in ('admin','salesman') then raise exception 'Access denied' using errcode='42501'; end if;
 with products as(select upper(trim(sku)) as sku,min(brand) as brand from public.sales_catalog_products where active group by upper(trim(sku)) having count(distinct brand)=1),
 ranked as(select p.brand||':'||f.sku as key,sum(f.delivered_qty) as qty from private.sales_product_facts f join products p on p.sku=f.sku
 where f.day>=today_-interval '12 months' and f.day<=today_ and f.delivered_qty>0 group by p.brand,f.sku)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by qty desc,key) from ranked r),'[]'::jsonb),
 'partial',exists(select 1 from private.sales_product_facts where day>=today_-interval '12 months' and day<=today_ and ordered_qty>0 and delivered_qty is null)) into result_;
 return result_;
end;$$;
revoke all on function public.sales_company_bestsellers() from public,anon;
grant execute on function public.sales_company_bestsellers() to authenticated;

create table public.sales_restock_batches(id text primary key,title text not null,received_at timestamptz not null,active boolean not null default true,observed_at timestamptz not null default now());
create table public.sales_restock_products(
 batch_id text not null references public.sales_restock_batches(id),product_id text not null references public.sales_catalog_products(product_id),
 received_qty numeric not null,available_qty numeric not null,was_out boolean not null,is_new boolean not null default false,
 primary key(batch_id,product_id)
);
create table public.sales_restock_receipts(
 user_id uuid not null references public.profiles(id) on delete cascade,batch_id text not null references public.sales_restock_batches(id),
 seen_at timestamptz,done_at timestamptz,primary key(user_id,batch_id)
);
alter table public.sales_restock_batches enable row level security;
alter table public.sales_restock_products enable row level security;
alter table public.sales_restock_receipts enable row level security;
revoke all on public.sales_restock_batches,public.sales_restock_products,public.sales_restock_receipts from anon,authenticated;
grant all on public.sales_restock_batches,public.sales_restock_products,public.sales_restock_receipts to service_role;

-- Warehouse sends only completed incoming stock batches. Retry uses the same immutable batch ID.
create function public.picking_receive_arrival(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch_ text=trim(p->>'batch_id');line_ jsonb;product_ public.sales_catalog_products%rowtype;was_out_ boolean;count_ int=0;version_ timestamptz;fulfillment_ jsonb;order_ids_ uuid[];
begin
 if coalesce(p->>'secret','')='' or not exists(select 1 from private.picking_stock_link where id=1 and secret=p->>'secret') then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p->>'company'<>'lexo' or batch_ is null or length(batch_) not between 1 and 200 then raise exception 'Invalid arrival'; end if;
 version_=(p->>'observed_at')::timestamptz;
 if version_ is null or version_>now()+interval '5 minutes' then raise exception 'Invalid observation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('arrival:'||batch_));
 if exists(select 1 from public.sales_restock_batches where id=batch_ and observed_at>=version_) then return jsonb_build_object('ok',true,'duplicate',true); end if;
 insert into public.sales_restock_batches(id,title,received_at,active,observed_at) values(batch_,left(coalesce(p->>'title','Ingreso de mercadería'),200),(p->>'received_at')::timestamptz,not coalesce((p->>'cancelled')::boolean,false),version_)
 on conflict(id) do update set active=excluded.active,observed_at=excluded.observed_at;
 if jsonb_typeof(p->'fulfillment')='array' and jsonb_typeof(p->'fulfillment_orders')='array' then
   select array_agg(value::uuid) into order_ids_ from jsonb_array_elements_text(p->'fulfillment_orders');
   select coalesce(jsonb_agg(jsonb_build_object('itemId',i.id,'orderId',i.order_id,'deliveredQty',case when f.confirmed then f.picked_qty else 0 end,'outOfStockQty',f.nostock_qty)),'[]'::jsonb)
   into fulfillment_ from jsonb_to_recordset(p->'fulfillment') as f(order_id uuid,sku text,ordered_qty numeric,picked_qty numeric,confirmed boolean,nostock_qty numeric)
   join public.order_items i on i.order_id=f.order_id and upper(trim(i.sku))=upper(trim(f.sku))
   where i.quantity=f.ordered_qty and f.picked_qty between 0 and f.ordered_qty and f.nostock_qty between 0 and f.ordered_qty
   and (select count(*) from public.order_items ii where ii.order_id=i.order_id and upper(trim(ii.sku))=upper(trim(i.sku)))=1;
   perform public.replace_sales_delivery_snapshot(coalesce(order_ids_,'{}'::uuid[]),fulfillment_,version_);
 end if;
 if coalesce((p->>'cancelled')::boolean,false) then
   for line_ in select value from jsonb_array_elements(coalesce(p->'products','[]'::jsonb)) loop
     if (line_->>'available_qty')::numeric<=0 then
       update public.product_overrides po set out_of_stock=true,updated_at=now()
       where po.product_id=line_->>'product_id' and exists(select 1 from public.sales_catalog_products cp where cp.product_id=po.product_id and upper(trim(cp.sku))=upper(trim(line_->>'sku')));
     end if;
   end loop;
   return jsonb_build_object('ok',true,'cancelled',true);
 end if;
 if jsonb_typeof(p->'products')<>'array' then raise exception 'Invalid products'; end if;
 for line_ in select value from jsonb_array_elements(p->'products') loop
   select * into product_ from public.sales_catalog_products where product_id=line_->>'product_id' and upper(trim(sku))=upper(trim(line_->>'sku'));
   if not found then raise exception 'Unknown catalog product';end if;
   -- A known retired product must not block valid products in the same container.
   if not product_.active then continue;end if;
   if coalesce((line_->>'received_qty')::numeric,0)<=0 or coalesce((line_->>'available_qty')::numeric,0)<=0 then continue; end if;
   if exists(select 1 from public.product_overrides where product_id=product_.product_id and hidden) then continue; end if;
   select coalesce((select out_of_stock from public.product_overrides where product_id=product_.product_id),product_.base_out_of_stock) or coalesce((line_->>'was_out')::boolean,false) into was_out_;
   insert into public.sales_restock_products(batch_id,product_id,received_qty,available_qty,was_out,is_new)
   values(batch_,product_.product_id,(line_->>'received_qty')::numeric,(line_->>'available_qty')::numeric,was_out_,product_.is_new)
   on conflict(batch_id,product_id) do update set available_qty=excluded.available_qty,received_qty=excluded.received_qty;
   insert into public.product_overrides(product_id,sku,out_of_stock,updated_at) values(product_.product_id,product_.sku,false,now())
   on conflict(product_id) do update set out_of_stock=false,updated_at=excluded.updated_at;
   count_=count_+1;
 end loop;
 return jsonb_build_object('ok',true,'changed',count_);
end;$$;
revoke all on function public.picking_receive_arrival(jsonb) from public;
grant execute on function public.picking_receive_arrival(jsonb) to anon,authenticated;

-- Client codes are an account link, not a customer-editable notification filter.
create function public.protect_restock_client_code() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid()=new.id and not public.is_admin() and
   (case when tg_op='INSERT' then coalesce(new.client_code,'')<>'' else new.client_code is distinct from old.client_code end) then
   raise exception 'Only admins can assign client codes' using errcode='42501';
 end if;return new;
end;$$;
revoke all on function public.protect_restock_client_code() from public,anon,authenticated;
create trigger protect_restock_client_code before insert or update on public.profiles for each row execute function public.protect_restock_client_code();

create function public.sales_restock_inbox(p_salesman_code text default null,p_include_done boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller public.profiles%rowtype;target_ text;result_ jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman','customer') then raise exception 'Access denied' using errcode='42501'; end if;
 if caller.role::text='admin' then target_=nullif(trim(p_salesman_code),'');
 elsif caller.role::text='salesman' then
   if coalesce(trim(caller.salesman_code),'')='' then raise exception 'Salesperson code required' using errcode='42501'; end if;
   target_=case when caller.salesman_code='90' then '900' else caller.salesman_code end;
   if p_salesman_code is not null and p_salesman_code<>target_ then raise exception 'Portfolio denied' using errcode='42501'; end if;
 elsif p_salesman_code is not null then raise exception 'Portfolio denied' using errcode='42501'; end if;
 with recursive scoped_clients as materialized (
   select c.* from public.sales_clients c where
   case when caller.role::text='customer' then c.client_code=nullif(caller.client_code,'')
   else target_ is null or public.sales_dashboard_assignment(c.client_code,c.salesman_code)=target_ end
 ), facts as materialized (select f.* from private.sales_product_facts f join scoped_clients c on c.client_code=f.client_code), eligible as materialized (
   select distinct on (b.id,c.client_code,p.brand,upper(trim(p.sku))) b.*,r.seen_at,r.done_at,rp.product_id,rp.received_qty,rp.available_qty,p.sku,p.brand,p.name,c.client_code,c.name as client_name
   from public.sales_restock_batches b join public.sales_restock_products rp on rp.batch_id=b.id
   join public.sales_catalog_products p on p.product_id=rp.product_id
   cross join scoped_clients c left join public.sales_restock_receipts r on r.batch_id=b.id and r.user_id=caller.id
   left join public.product_overrides po on po.product_id=p.product_id
   where b.active and rp.was_out and not rp.is_new and p.active and not coalesce(po.hidden,false) and not coalesce(po.out_of_stock,p.base_out_of_stock)
   and (select count(distinct cp.brand) from public.sales_catalog_products cp where upper(trim(cp.sku))=upper(trim(p.sku)) and cp.active)=1
   and (p_include_done or r.done_at is null)
   order by b.id,c.client_code,p.brand,upper(trim(p.sku)),p.product_id
 ), days as (
   select distinct e.id,e.client_code,f.day from eligible e join facts f on f.client_code=e.client_code
   where f.day>=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date-interval '12 months' and f.day<=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date and f.delivered_qty>0
 ), numbered as(select *,row_number() over(partition by id,client_code order by day) as n from days),
 occasions as(
   select id,client_code,n,day,day as anchor from numbered where n=1
   union all
   select d.id,d.client_code,d.n,d.day,case when d.day-o.anchor<=2 then o.anchor else d.day end from occasions o join numbered d on d.id=o.id and d.client_code=o.client_code and d.n=o.n+1
 ), stats as(
   select e.id,e.client_code,e.product_id,count(distinct o.anchor) as purchases,min(o.anchor) as first_day,max(o.anchor) as last_day
   from eligible e join facts f on f.client_code=e.client_code and f.sku=upper(trim(e.sku)) and f.delivered_qty>0
   join occasions o on o.id=e.id and o.client_code=e.client_code and o.day=f.day group by e.id,e.client_code,e.product_id
 ), relevant as(
   select e.*,coalesce(s.purchases,0) as purchases,s.last_day,
   case when s.purchases>=2 then (s.last_day-s.first_day)::numeric/(s.purchases-1) end as frequency,
   (select sum(f.delivered_qty)/nullif(s.purchases,0) from facts f where f.client_code=e.client_code and f.sku=upper(trim(e.sku)) and f.day>=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date-interval '12 months' and f.day<=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date) as usual_qty,
   coalesce((select sum(f.nostock_qty) from facts f where f.client_code=e.client_code and f.sku=upper(trim(e.sku)) and f.day>=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date-interval '12 months' and f.day<=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date),0) as missed_qty
   from eligible e left join stats s on s.id=e.id and s.client_code=e.client_code and s.product_id=e.product_id
 ), groups as(
   select id,title,received_at,seen_at,done_at,jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku,'name',name,'brand',brand,'clientCode',client_code,'clientName',client_name,'purchases',purchases,'frequency',frequency,'usualQty',usual_qty,'lastPurchase',last_day,'missedQty',missed_qty) order by client_name,sku) as products
   from relevant where purchases>=2 or missed_qty>0 group by id,title,received_at,seen_at,done_at
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'receivedAt',received_at,'seenAt',seen_at,'doneAt',done_at,'products',products) order by received_at desc,id),'[]'::jsonb) into result_ from groups;
 return result_;
end;$$;
revoke all on function public.sales_restock_inbox(text,boolean) from public,anon;
grant execute on function public.sales_restock_inbox(text,boolean) to authenticated;
create function public.sales_restock_ack(p_batch_id text,p_done boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from jsonb_array_elements(public.sales_restock_inbox(null,true)) b where b->>'id'=p_batch_id) then raise exception 'Notice denied' using errcode='42501'; end if;
 insert into public.sales_restock_receipts(user_id,batch_id,seen_at,done_at) values(auth.uid(),p_batch_id,now(),case when p_done then now() end)
 on conflict(user_id,batch_id) do update set seen_at=coalesce(sales_restock_receipts.seen_at,excluded.seen_at),done_at=case when p_done then excluded.done_at else sales_restock_receipts.done_at end;
end;$$;
revoke all on function public.sales_restock_ack(text,boolean) from public,anon;
grant execute on function public.sales_restock_ack(text,boolean) to authenticated;
