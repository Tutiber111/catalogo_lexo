const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('../tmp/sales-dashboard/runtime/node_modules/@electric-sql/pglite');
async function main(){
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 grant usage on schema public,auth to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,salesman_code text);
 create table sales_clients(id uuid primary key,client_code text unique,name text,salesman_code text);
 create table orders(id uuid primary key,created_at timestamptz,status text,sales_client_id uuid,sales_client_code text,customer_client_code text);
 create table order_items(id uuid primary key,order_id uuid,sku text,quantity int,line_total numeric);
 create table sales_history_batches(id text primary key,from_date date,to_date date,warehouse_from_date date);
 create table sales_history_lines(line_key text primary key,client_code text,ordered_net numeric);
 insert into profiles values
 ('00000000-0000-4000-8000-000000000001','admin',null),
 ('00000000-0000-4000-8000-000000000002','salesman','810'),
 ('00000000-0000-4000-8000-000000000003','salesman','900'),
 ('00000000-0000-4000-8000-000000000004','customer','810'),
 ('00000000-0000-4000-8000-000000000005','salesman',''),
 ('00000000-0000-4000-8000-000000000006','salesman','90');
 insert into sales_clients values
 ('10000000-0000-4000-8000-000000000001','81001','Diana customer','810'),
 ('10000000-0000-4000-8000-000000000002','81032','Alejandro','810'),
 ('10000000-0000-4000-8000-000000000003','90001','Adrian customer','90'),
 ('10000000-0000-4000-8000-000000000004','80001','Other customer','800');
 insert into orders values
 ('20000000-0000-4000-8000-000000000001','2026-10-20','placed','10000000-0000-4000-8000-000000000001',null,null),
 ('20000000-0000-4000-8000-000000000002','2026-10-20','placed','10000000-0000-4000-8000-000000000002',null,null),
 ('20000000-0000-4000-8000-000000000003','2026-10-20','placed','10000000-0000-4000-8000-000000000004','81001',null),
 ('20000000-0000-4000-8000-000000000004','2026-10-20','cancelled','10000000-0000-4000-8000-000000000001',null,null),
 ('20000000-0000-4000-8000-000000000005','2026-10-20','placed',null,'missing',null);
 insert into order_items values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','A',5,500);
 insert into sales_history_lines values ('d','81001',100),('a','81032',200),('other','80001',300),('orphan','missing',400);
 insert into sales_history_batches values ('batch','2024-09-02','2026-10-15','2026-10-16');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261028141217_salesman_dashboard_scope.sql','utf8'));
 const identity=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-4000-8000-'+String(n).padStart(12,'0')]);await db.exec('set role authenticated');};
 const scope=async(code=null,history=true)=>(await db.query('select public.sales_dashboard_scope($1,$2) as data',[code,history])).rows[0].data;
 await identity(2);const diana=await scope();
 assert.deepEqual(diana.clients.map(c=>c.client_code),['81001']);
 assert.deepEqual(diana.lines.map(l=>l.line_key),['d']);
 assert.equal(diana.orders.length,1,'other-client explicit ID wins over stale matching code; cancelled orders excluded');
 assert.equal(diana.orders[0].order_items[0].sku,'A');
 for(const code of ['900','800','*','unassigned',"810' OR true --"])await assert.rejects(()=>scope(code));
 assert.equal((await scope('810',false)).lines.length,0);
 await assert.rejects(()=>db.query('select * from public.sales_history_lines'),'salespeople cannot read all history directly');
 await identity(1);assert.deepEqual(await scope('810'),diana,'admin preview and real salesperson receive identical data');
 await assert.rejects(()=>scope());
 await identity(3);const adrian=await scope();assert.deepEqual(adrian.clients.map(c=>c.client_code),['90001']);assert.deepEqual(adrian.lines.map(l=>l.line_key),['orphan']);assert.equal(adrian.orders.length,1);
 await identity(6);assert.deepEqual(await scope(),adrian,'90 and 900 use the same Adrian group');
 for(const id of [4,5]){await identity(id);await assert.rejects(()=>scope());}
 await db.exec('reset role;set role anon');await assert.rejects(()=>scope('810'));
 await identity(1);await db.exec('reset role');await db.query('update profiles set role=null where id=$1',['00000000-0000-4000-8000-000000000004']);await identity(4);await assert.rejects(()=>scope('810'));
 await db.exec("reset role;update sales_clients set salesman_code='800' where client_code='81001'");
 await identity(2);const moved=await scope();assert.equal(moved.clients.length,0);assert.equal(moved.orders.length,0);assert.equal(moved.lines.length,0,'current reassignment immediately removes access');
 console.log('Dashboard SQL scope: portfolio isolation, matching admin preview, role denial, input tampering, current assignments, Adrian grouping and Alejandro exclusion passed.');
 }finally{await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
