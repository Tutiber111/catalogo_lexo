const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('../tmp/sales-dashboard/runtime/node_modules/@electric-sql/pglite');
async function main(){const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,salesman_code text,client_code text);
 create function public.is_admin() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
 create table sales_clients(id uuid primary key,client_code text unique,name text,salesman_code text);
 create table orders(id uuid primary key,created_at timestamptz,status text,sales_client_id uuid,sales_client_code text,customer_client_code text);
 create table order_items(id uuid primary key,order_id uuid,sku text,quantity int,line_total numeric);
 create table product_overrides(product_id text primary key,sku text,hidden boolean default false,out_of_stock boolean default false,updated_at timestamptz);
 insert into profiles values
 ('00000000-0000-4000-8000-000000000001','admin',null,null),
 ('00000000-0000-4000-8000-000000000002','salesman','810',null),
 ('00000000-0000-4000-8000-000000000003','customer',null,'1'),
 ('00000000-0000-4000-8000-000000000004','customer',null,'2');
 insert into sales_clients values ('10000000-0000-4000-8000-000000000001','1','Own customer','810'),('10000000-0000-4000-8000-000000000002','2','Other private customer','800');
 insert into orders values ('20000000-0000-4000-8000-000000000001','2026-10-20','placed','10000000-0000-4000-8000-000000000001',null,null);
 insert into order_items values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','BAR',5,500);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261016161306_sales_history_analytics.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261028141217_salesman_dashboard_scope.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261028173942_opportunities_and_restock_notices.sql','utf8'));
 await db.exec(`insert into sales_history_batches(id,source_name,from_date,to_date,warehouse_from_date) values(repeat('a',64),'fixture','2024-09-01','2026-10-15','2026-10-16');
 insert into private.picking_stock_link values(1,'fixture-secret');
 insert into sales_catalog_products(product_id,sku,brand,name,is_new) values('p1','FOO','OXO','Product',false),('p2','BAR','OXO','Shortage product',false),('p3','ZERO','OXO','Zero available',false),('p4','NEW','OXO','New arrival',true),('p5','HIDDEN','OXO','Retired',false);
 insert into sales_catalog_products(product_id,sku,brand,name,active) values('p6','INACTIVE','OXO','Inactive product',false);
 insert into product_overrides(product_id,sku,hidden,out_of_stock) values('p1','FOO',false,true),('p2','BAR',false,true),('p3','ZERO',false,true),('p4','NEW',false,true),('p5','HIDDEN',true,true);
 `);
 const history=[];
 for(const code of ['1','2'])for(const [index,day] of ['2026-06-01','2026-07-01'].entries())for(const sku of ['FOO','NEW'])history.push({line_key:code+index+sku,order_key:code+index,order_date:day,client_code:code,client_name:code,sku,product_name:sku,ordered_qty:10,invoiced_qty:10,delivered_qty:10,returned_qty:0,cancelled_qty:0,pending_qty:0,ordered_net:100,invoiced_net:100,batch_id:'a'.repeat(64),source_row:4});
 for(const row of history){const keys=Object.keys(row);await db.query(`insert into sales_history_lines(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));}
 const payload={secret:'fixture-secret',company:'lexo',batch_id:'arrival-1',title:'Container one',received_at:new Date().toISOString(),observed_at:new Date().toISOString(),products:['FOO','BAR','ZERO','NEW','HIDDEN'].map((sku,i)=>({product_id:'p'+(i+1),sku,received_qty:50,available_qty:sku==='ZERO'?0:40,was_out:true}))};
 payload.fulfillment_orders=['20000000-0000-4000-8000-000000000001'];
 payload.products.push({product_id:'p6',sku:'INACTIVE',received_qty:10,available_qty:10,was_out:true});
 payload.fulfillment=[{order_id:payload.fulfillment_orders[0],sku:'BAR',ordered_qty:5,picked_qty:2,confirmed:true,nostock_qty:3}];
 const receive=async p=>(await db.query('select picking_receive_arrival($1::jsonb) data',[JSON.stringify(p)])).rows[0].data;
 await assert.rejects(()=>receive({...payload,secret:'bad'}));await assert.rejects(()=>receive({...payload,company:'bm'}));
 assert.equal((await receive(payload)).changed,3);
 assert.equal((await db.query("select count(*)::int n from product_overrides where product_id='p6'")).rows[0].n,0,'known inactive products are skipped without blocking valid restocks');
 assert.equal((await db.query('select delivered_qty from sales_order_fulfillment')).rows[0].delivered_qty,'2','arrival carries confirmed fulfillment into the cache');
 assert.equal((await db.query("select out_of_stock from product_overrides where product_id='p1'")).rows[0].out_of_stock,false);
 assert.equal((await db.query("select out_of_stock from product_overrides where product_id='p3'")).rows[0].out_of_stock,true,'unavailable stock remains unavailable');
 assert.equal((await db.query("select hidden from product_overrides where product_id='p5'")).rows[0].hidden,true,'arrivals never unhide products');
 assert.equal((await receive(payload)).duplicate,true);
 await db.exec("insert into sales_catalog_products(product_id,sku,brand,name) values('p1dup','FOO','OXO','Repeated catalog page');insert into sales_restock_products select batch_id,'p1dup',received_qty,available_qty,was_out,is_new from sales_restock_products where product_id='p1';");
 const identity=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-4000-8000-'+String(n).padStart(12,'0')]);await db.exec('set role authenticated');};
 const inbox=async(code=null)=>(await db.query('select sales_restock_inbox($1,false) data',[code])).rows[0].data;
 await identity(2);const seller=await inbox();assert.equal(seller.length,1);assert.equal(seller[0].products.length,2);assert.ok(seller[0].products.every(p=>p.clientCode==='1'));
 assert.equal(seller[0].products.find(p=>p.sku==='FOO').purchases,2);assert.equal(seller[0].products.find(p=>p.sku==='FOO').usualQty,10);
 assert.equal(seller[0].products.find(p=>p.sku==='BAR').missedQty,3,'explicit stock loss is relevant without repeat purchases');
 assert.ok(!seller[0].products.some(p=>p.sku==='NEW'));
 await assert.rejects(()=>inbox('800'));await assert.rejects(()=>db.query('select * from sales_restock_products'));
 await db.query('select sales_restock_ack($1,false)',['arrival-1']);assert.ok((await inbox())[0].seenAt);assert.equal((await inbox()).length,1,'seen remains pending');
 await identity(3);const customer=await inbox();assert.ok(customer[0].products.every(p=>p.clientCode==='1'));assert.equal(customer[0].seenAt,null,'salesperson seen status does not affect client');
 await assert.rejects(()=>inbox('800'));await db.query('select sales_restock_ack($1,true)',['arrival-1']);assert.equal((await inbox()).length,0);
 await identity(2);assert.equal((await inbox()).length,1,'client completing a notice does not complete salesperson task');
 await identity(4);assert.ok((await inbox())[0].products.every(p=>p.clientCode==='2'));assert.equal((await inbox())[0].products.length,1);
 await assert.rejects(()=>db.query('select sales_restock_ack($1,true)',['not-owned']));
 await db.exec('reset role');const later=new Date(Date.now()+1000).toISOString();await receive({...payload,cancelled:true,observed_at:later,products:payload.products.map(p=>({...p,available_qty:0}))});
 await identity(2);assert.equal((await inbox()).length,0,'undo withdraws pending notices');
 await db.exec('reset role');assert.equal((await receive(payload)).duplicate,true,'stale arrival cannot re-enable an undone batch');
 await identity(2);const ranked=(await db.query('select sales_company_bestsellers() data')).rows[0].data;
 assert.equal(ranked.items.find(p=>p.key==='OXO:FOO').qty,40,'company-wide totals include both clients without exposing identities');assert.ok(ranked.items.every(p=>Object.keys(p).every(k=>['key','qty'].includes(k))));
 await identity(3);await assert.rejects(()=>db.query('select sales_company_bestsellers()'));
 await db.exec('reset role;grant update on profiles to authenticated');await identity(3);await assert.rejects(()=>db.query("update profiles set client_code='2' where id=auth.uid()"),'client cannot steal another account link');
 await db.exec('reset role;set role anon');await assert.rejects(()=>inbox());
 console.log('Restock SQL: exact products, stock transitions, new/hidden exclusions, repeat purchases and shortage relevance, recipient privacy, per-user pending states, retries/undo and company ranking passed.');
}finally{await db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1});
