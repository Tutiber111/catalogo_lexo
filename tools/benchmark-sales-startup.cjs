// Uses private local fixtures; prints timings and aggregate checks only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{execFileSync}=require('node:child_process');
const current=require('../web/sales-bi-model.js');
const previous={exports:{}};
const baseline=process.env.SALES_BENCHMARK_BASE||'3fa7e063f38c4e55db8c2f5c19381d3a2b95a25c';
new Function('require','module','exports',execFileSync('git',['show',baseline+':web/sales-bi-model.js'],{encoding:'utf8'}))(require('node:module').createRequire(path.resolve('web/sales-bi-model.js')),previous,previous.exports);
const raw=JSON.parse(fs.readFileSync('tmp/sales-dashboard/prepared.json','utf8'));
const input={...raw,clients:raw.clients.map(c=>({id:c.client_code,clientCode:c.client_code,name:c.name,legalName:c.legal_name,salesmanCode:c.salesman_code,locality:c.locality})),batches:raw.batches||[raw.batch],catalog:JSON.parse(fs.readFileSync('web/data/catalog.json','utf8')).products,orders:[],includeUnassigned:true,analysisSalesmanCode:'*'};
const f={source:'history-warehouse',metric:'ordered',from:'2024-09-02',to:'2026-10-30',compare:'year',client:'',brand:'',category:'',province:'',product:''};
function run(model){let start=performance.now();const data=model.prepare(input);const prepareMs=performance.now()-start;start=performance.now();const report=model.reporting(data,f,'2026-10-30');return {report,prepareMs,reportMs:performance.now()-start};}
const before=run(previous.exports),after=run(current);assert.deepEqual(after.report,before.report,'optimized report must preserve all metrics and customer/vendor details');
console.log(JSON.stringify({lines:raw.lines.length,legacyHistoryLineRequests:Math.ceil(raw.lines.length/2000)*4,newSnapshotRequests:1,before:{prepareMs:Math.round(before.prepareMs),reportMs:Math.round(before.reportMs)},after:{prepareMs:Math.round(after.prepareMs),reportMs:Math.round(after.reportMs)},reportSpeedup:Math.round(before.reportMs/after.reportMs*10)/10,identicalReports:true},null,2));
