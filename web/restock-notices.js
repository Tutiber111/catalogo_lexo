/* Account-scoped arrival summaries. Seen and completed are separate server-side states. */
(function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(v||0);
 let owner='',generation=0,cache=new Map(),dialog=null,entry=null,timer=null,sessionSeen=new Set(),stockSynced=new Set();
 const identity=()=>typeof state!=='undefined'&&state.user?.id&&['admin','salesman','customer'].includes(state.profile?.role)&&!state.isPasswordRecovery
   ?[state.user.id,state.profile.role,state.profile.salesman_code||'',state.profile.client_code||''].join(':'):'';
 const announce=()=>window.dispatchEvent(new Event('catalog:restocks-changed'));
 function reset(){generation++;cache.clear();sessionSeen.clear();stockSynced.clear();if(dialog){dialog.close();dialog.remove();dialog=null;}if(entry)entry.hidden=true;if(timer)clearInterval(timer);timer=null;}
 function ensureEntry(){
  if(entry)return;const anchor=document.querySelector('#openSalesDashboard');if(!anchor)return;
  entry=document.createElement('button');entry.type='button';entry.className='admin-entry-button';entry.hidden=true;entry.dataset.restockEntry='';entry.onclick=()=>open();anchor.after(entry);
 }
 function updateEntry(){ensureEntry();if(!entry)return;const data=cache.get('');entry.hidden=!identity()||!data?.available||!data.items?.length;entry.textContent=`Reposiciones${data?.items?.length?' · '+data.items.length:''}`;}
 async function load(code='',force=false){
  if(!identity())return {available:false,items:[]};
  if(cache.has(code)&&!force)return cache.get(code);
  const request=generation,account=owner;
  const pending={available:false,items:[],loading:true};cache.set(code,pending);
  try{
   const result=await CATALOG_SUPABASE.loadRestockInbox(code||null);
   if(generation!==request||owner!==account||identity()!==owner)return {available:false,items:[]};
   cache.set(code,result);updateEntry();announce();
   return result;
  }catch{if(generation===request&&owner===account){cache.set(code,{available:false,items:[],error:true});announce();}return {available:false,items:[],error:true};}
 }
 function productsHtml(items){return items.map(item=>`<li><b>${esc(item.sku)} · ${esc(item.name)}</b><span>${esc(item.clientName||'')}${item.purchases>=2?` · ${num(item.purchases)} compras · habitual: ${num(item.usualQty)} u.`:''}${item.missedQty>0?` · ${num(item.missedQty)} u. pedidas sin stock`:''}</span>${item.lastPurchase?`<small>Última compra: ${esc(item.lastPurchase.split('-').reverse().join('/'))}${item.frequency!==null&&item.frequency!==undefined?' · cada '+num(item.frequency)+' días':''}</small>`:''}</li>`).join('');}
 function markup(data,readonly=false){
  if(data?.loading)return '<p class="bi-empty">Cargando reposiciones…</p>';
  if(!data?.available)return '<p class="bi-empty">Las reposiciones estarán disponibles al activar la conexión de ingresos.</p>';
  if(!data.items.length)return '<p class="bi-empty">No tenés reposiciones pendientes.</p>';
  return data.items.map(batch=>`<article class="restock-batch"><header><div><h4>${esc(batch.title)}</h4><small>${esc(new Date(batch.receivedAt).toLocaleDateString('es-AR'))} · ${batch.products.length} oportunidades</small></div>${readonly?'':`<button type="button" data-restock-done="${esc(batch.id)}">Marcar gestionado</button>`}</header><ul>${productsHtml(batch.products)}</ul></article>`).join('');
 }
 async function done(id,button){
  const account=owner;button.disabled=true;
  try{await CATALOG_SUPABASE.acknowledgeRestock(id,true);if(owner!==account)return;for(const [code,data] of cache)if(data.available)cache.set(code,{...data,items:data.items.filter(b=>b.id!==id)});updateEntry();announce();if(dialog?.open)renderDialog();}
  catch{if(owner===account){button.disabled=false;const error=document.createElement('p');error.setAttribute('role','alert');error.textContent='No se pudo guardar. Intentá nuevamente.';button.after(error);}}
 }
 function bind(scope){scope.querySelectorAll('[data-restock-done]').forEach(button=>button.onclick=()=>done(button.dataset.restockDone,button));}
 function renderDialog(popup=false,items=null){
  if(!dialog){dialog=document.createElement('dialog');dialog.className='restock-dialog';dialog.setAttribute('aria-label','Reposiciones');document.body.append(dialog);}
  const data=cache.get('')||{loading:true};
  dialog.innerHTML=`<header><h2>${popup?'Volvieron productos que te interesan':'Reposiciones pendientes'}</h2><button type="button" data-restock-close aria-label="Cerrar reposiciones">×</button></header>${popup?'<p>Estos productos están disponibles nuevamente. Podés gestionar las oportunidades en tu lista de pendientes.</p>':''}<div>${markup(items?{available:true,items}:data)}</div>`;
  dialog.querySelector('[data-restock-close]').onclick=()=>dialog.close();bind(dialog);
 }
 async function open(){if(!identity())return;renderDialog();if(!dialog.open)dialog.showModal();await load();if(dialog?.open)renderDialog();}
 async function refresh(){
  const account=owner,data=await load('',true);if(owner!==account||!data.available)return;
  if(data.items.some(b=>!stockSynced.has(b.id))){data.items.forEach(b=>stockSynced.add(b.id));window.dispatchEvent(new Event('catalog:products-updated'));}
  if(dialog?.open){renderDialog();return;}
  const fresh=data.items.filter(b=>!b.seenAt&&!sessionSeen.has(b.id));
  if(!fresh.length||state.profile.role==='admin'||dialog?.open||document.querySelector('dialog[open]'))return;
  renderDialog(true,fresh);dialog.showModal();
  for(const b of fresh){sessionSeen.add(b.id);CATALOG_SUPABASE.acknowledgeRestock(b.id,false).then(()=>{if(owner===account){const current=cache.get('');if(current?.available)current.items=current.items.map(x=>x.id===b.id?{...x,seenAt:new Date().toISOString()}:x);}}).catch(()=>{});}
 }
 function sync(){const next=identity();if(next===owner)return;reset();owner=next;if(!next)return;ensureEntry();void refresh();timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);}
 function view(code='',readonly=false){const data=cache.get(code);if(!data)void load(code);return `<h3>Reposiciones pendientes</h3>${markup(data||{loading:true},readonly)}`;}
 window.RESTOCK_NOTICES={sync,open,view,bind,refresh};
 window.addEventListener('focus',()=>{if(owner&&document.visibilityState==='visible')void refresh();});
 document.addEventListener('close',()=>{if(owner)setTimeout(()=>void refresh(),0);},true);
 sync();
})();
