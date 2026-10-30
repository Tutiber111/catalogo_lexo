const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('../tmp/sales-dashboard/runtime/node_modules/@electric-sql/pglite');
async function main(){const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text);
 alter table profiles enable row level security;create policy own_profile on profiles for select to authenticated using(id=auth.uid());grant select on profiles to authenticated;
 create function is_admin() returns bool language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
 insert into profiles values('00000000-0000-4000-8000-000000000001','admin'),('00000000-0000-4000-8000-000000000002','salesman'),('00000000-0000-4000-8000-000000000003','customer');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261016161306_sales_history_analytics.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261030140912_dashboard_history_snapshot.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261030144701_dashboard_history_json_response.sql','utf8'));
 await db.exec(`insert into sales_history_batches(id,source_name,from_date,to_date,warehouse_from_date) values(repeat('a',64),'fixture','2024-09-02','2026-10-15','2026-10-16');
 insert into sales_history_lines(line_key,order_key,order_date,client_code,sku,ordered_qty,invoiced_qty,delivered_qty,returned_qty,cancelled_qty,pending_qty,ordered_net,invoiced_net,batch_id,source_row)
 select lpad(n::text,6,'0'),n::text,'2026-10-01','1','A',2,1,1,0,0,1,123.45,61.725,repeat('a',64),n+4 from generate_series(1,1501) n;`);
 const identity=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-4000-8000-'+String(n).padStart(12,'0')]);await db.exec('set role authenticated');};
 const read=async()=>(await db.query('select sales_dashboard_history_json() data')).rows[0].data;
 await identity(1);const data=await read();assert.equal(data.available,true);assert.equal(data.lines.length,1501,'one snapshot returns more than a REST row page');assert.equal(data.batches.length,1);assert.equal(data.lines[0].line_key,'000001');assert.equal(data.lines[1500].line_key,'001501');assert.equal(data.lines[0].ordered_net,123.45);assert.equal(data.lines[0].invoiced_net,61.725);
 assert.ok(!('delivered_qty' in data.lines[0]),'snapshot uses the same fields as the previous authorized history projection');
 await identity(2);await assert.rejects(()=>read(),e=>e.code==='42501');await identity(3);await assert.rejects(()=>read(),e=>e.code==='42501');
 await db.exec('reset role;set role anon');await assert.rejects(()=>read(),e=>e.code==='42501');
 await db.exec('reset role');assert.equal((await db.query("select prosecdef from pg_proc where proname='sales_dashboard_history_json'")).rows[0].prosecdef,false,'snapshot retains caller RLS');
 assert.equal((await db.query("select prorettype::regtype::text as type from pg_proc where proname='sales_dashboard_history_json'")).rows[0].type,'json','response avoids expensive binary JSON repacking');
 assert.equal((await db.query('select count(*)::int n from sales_history_lines')).rows[0].n,1501);
 console.log('Single-request history SQL: all rows and exact prices, deterministic projection, caller RLS, admin-only reads, salesperson/customer/anonymous denial and no data changes passed.');
}finally{await db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
