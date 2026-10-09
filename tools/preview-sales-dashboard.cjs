// Creates a disposable local fixture using the production dashboard modules.
const fs = require('node:fs');
const index = fs.readFileSync('web/index.html', 'utf8');
const dialog = index.match(/<dialog id="salesDashboardDialog"[\s\S]*?<\/dialog>/)[0];
fs.writeFileSync('web/dashboard-verification.html', `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css?v=20261009-sales-analysis-r1"><title>Dashboard test — sample data</title><body><button id="openSalesDashboard">Mi gestión</button><button id="openAdminSalesDashboard">Panel de vendedores</button>${dialog}<p id="result"></p><script>
const admin=new URLSearchParams(location.search).has('admin');
const state={user:{id:'demo'},profile:{role:admin?'admin':'salesman',salesman_code:admin?null:'845'},cart:new Map(),catalog:{products:[{id:'bottle',sku:'A',name:'Botella',section:'Lexo'},{id:'cup',sku:'B',name:'Taza',section:'Lexo'},{id:'pan',sku:'C',name:'Sartén',section:'Magefesa'}]}};
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatMoney=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(value);
const clients=[{id:'a',clientCode:'001',name:'Bazar Central',locality:'Buenos Aires',salesmanCode:'845'},{id:'b',clientCode:'002',name:'Cocina & Hogar',locality:'Córdoba',salesmanCode:'845'},{id:'c',clientCode:'003',name:'Casa Norte',locality:'Rosario',salesmanCode:'900'}];
const order=(id,days,code,sku,qty,status='placed')=>({id,displayId:'#'+id,createdAt:new Date(Date.now()-days*86400000).toISOString(),status,totalValue:qty*100,customer:{clientCode:code,name:clients.find(c=>c.clientCode===code).name},items:[{productId:sku==='A'?'bottle':sku==='C'?'pan':'cup',sku,name:sku==='A'?'Botella':sku==='C'?'Sartén':'Taza',qty,lineTotal:qty*100}]});
const CATALOG_SUPABASE={loadDashboardSalesmen:async()=>[{code:'845',name:'Vendedor Uno'},{code:'900',name:'Vendedor Dos'}],loadDashboardClients:async code=>clients.filter(c=>c.salesmanCode===code),loadDashboardOrders:async()=>[order('1042',3,'001','A',2),order('1041',12,'001','C',5),order('1035',22,'001','B',3),order('1001',45,'002','A',4),order('1000',100,'002','B',3),order('1002',10,'002','B',9,'cancelled'),order('2000',2,'003','B',6)]};
const closeAccount=()=>{}; const closeCart=()=>{}; const closeCatalogMenu=()=>{};
const selectSalesClient=c=>{state.selectedSalesClient=c};const openCart=()=>{document.querySelector('#result').textContent='Cliente: '+state.selectedSalesClient.name}; const showToast=message=>{document.querySelector('#result').textContent=message};
const showCatalogDialog=d=>CATALOG_DIALOG.open(d); const closeCatalogDialog=d=>CATALOG_DIALOG.close(d); const isCatalogDialogOpen=d=>CATALOG_DIALOG.isOpen(d);
</script><script src="dialog-compat.js"></script><script src="sales-dashboard-model.js?v=20261009-sales-analysis-r1"></script><script src="sales-dashboard.js?v=20261009-sales-analysis-r1"></script></body></html>`);
console.log('Temporary preview: http://127.0.0.1:8080/dashboard-verification.html (synthetic data only)');
