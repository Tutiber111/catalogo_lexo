/* Admin-managed reporting groups. Checkout always selects a real source client. */
(function(){
 const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let dialog=null,epoch=0;
 const admin=()=>typeof state!=='undefined'&&state.user?.id&&state.profile?.role==='admin';
 function close(){epoch++;if(dialog){dialog.close();dialog.remove();dialog=null;}}
 function shell(title){close();dialog=document.createElement('dialog');dialog.className='bi-client-groups-dialog';dialog.innerHTML=`<header><h2>${safe(title)}</h2><button type="button" data-group-close aria-label="Cerrar">×</button></header><div data-group-body></div>`;document.body.append(dialog);dialog.querySelector('[data-group-close]').onclick=close;dialog.addEventListener('close',()=>{if(dialog&&!dialog.open)close();});dialog.showModal();return dialog.querySelector('[data-group-body]');}
 function errorText(e){return e?.code==='23505'?'Un código ya pertenece a otro grupo. Editá ese grupo o desagrupalo primero.':e?.code==='22023'?'Ingresá un nombre y al menos dos códigos válidos.':'No se pudo guardar el cambio. Intentá nuevamente.';}
 async function open({available,groups,onSaved}){
  if(!admin())return;const account=state.user.id,body=shell('Agrupar clientes'),request=epoch;
  if(!available){body.innerHTML='<p>Esta opción estará disponible al activar la actualización de grupos de clientes.</p>';return;}
  body.innerHTML='<p role="status">Cargando clientes…</p>';
  let clients;try{clients=await CATALOG_SUPABASE.loadDashboardGroupCandidates();}catch{if(epoch===request)body.innerHTML='<p role="alert">No se pudieron cargar los clientes del catálogo y del historial. Actualizá el panel e intentá nuevamente.</p>';return;}
  if(epoch!==request||!admin()||state.user.id!==account)return;
  let editing=null,selected=new Set(),search='';
  const groupFor=code=>groups.find(g=>g.clientCodes.includes(String(code)));
  function draw(){
   body.innerHTML=`<p class="bi-group-help">Un grupo reúne ventas, frecuencia y oportunidades. Los pedidos dentro de 2 días se combinan en una ocasión de compra.</p><div class="bi-group-existing"><button type="button" data-group-new>Nuevo grupo</button>${groups.map(g=>`<article><b>${safe(g.name)}</b><small>${safe(g.clientCodes.join(' + '))}</small><button type="button" data-group-edit="${safe(g.id)}">Editar</button><button type="button" data-group-delete="${safe(g.id)}">Desagrupar</button></article>`).join('')}</div><form data-group-form><label>Nombre del cliente agrupado<input name="groupName" maxlength="120" required value="${safe(editing?.name||'')}" placeholder="Ej. Cliente · todas las sucursales"></label><label>Buscar por código, nombre o localidad<input type="search" data-group-search value="${safe(search)}"></label><div class="bi-group-selected" data-group-selected></div><div class="bi-group-options" data-group-options></div><p data-group-error role="alert"></p><button type="submit">${editing?'Guardar grupo':'Crear grupo'}</button></form>`;
   body.querySelector('[data-group-new]').onclick=()=>{editing=null;selected.clear();search='';draw();};
   body.querySelectorAll('[data-group-edit]').forEach(b=>b.onclick=()=>{editing=groups.find(g=>g.id===b.dataset.groupEdit);selected=new Set(editing.clientCodes);search='';draw();});
   body.querySelectorAll('[data-group-delete]').forEach(b=>b.onclick=async()=>{const g=groups.find(g=>g.id===b.dataset.groupDelete);if(!confirm(`¿Desagrupar ${g.name}? Sus códigos volverán a analizarse por separado.`))return;b.disabled=true;try{await CATALOG_SUPABASE.deleteDashboardClientGroup(g.id);if(epoch!==request)return;await onSaved();close();}catch(e){if(epoch===request){b.disabled=false;body.querySelector('[data-group-error]').textContent=errorText(e);}}});
   body.querySelector('[data-group-search]').oninput=e=>{search=e.target.value;drawOptions();};
   body.querySelector('[data-group-form]').onsubmit=async e=>{e.preventDefault();const form=e.target,error=body.querySelector('[data-group-error]');if(selected.size<2){error.textContent='Seleccioná al menos dos códigos.';return;}const button=form.querySelector('[type=submit]');button.disabled=true;error.textContent='';try{await CATALOG_SUPABASE.saveDashboardClientGroup(editing?.id,form.elements.groupName.value,[...selected]);if(epoch!==request)return;await onSaved();close();}catch(e){if(epoch===request){button.disabled=false;error.textContent=errorText(e);}}};
   drawOptions();
  }
  function drawOptions(){
   const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const rows=clients.filter(c=>norm(`${c.clientCode} ${c.name} ${c.legalName} ${c.locality} ${c.searchAliases||''}`).includes(norm(search)));
   body.querySelector('[data-group-options]').innerHTML=rows.slice(0,100).map(c=>{const group=groupFor(c.clientCode),locked=group&&group.id!==editing?.id;return `<label><input type="checkbox" value="${safe(c.clientCode)}" ${selected.has(String(c.clientCode))?'checked':''} ${locked?'disabled':''}><span><b>${safe(c.clientCode)} · ${safe(c.legalName||c.name)}</b><small>${safe(c.locality||'')}${c.historicalOnly?' · Historial':''}${locked?' · Grupo: '+safe(group.name):''}</small></span></label>`;}).join('')+(rows.length>100?'<small>Mostrando 100 resultados. Usá la búsqueda para encontrar otros códigos.</small>':'');
   body.querySelectorAll('[data-group-options] input').forEach(input=>input.onchange=()=>{if(input.checked)selected.add(input.value);else selected.delete(input.value);drawSelected();});drawSelected();
  }
  function drawSelected(){body.querySelector('[data-group-selected]').innerHTML=`<b>${selected.size} códigos seleccionados</b>${[...selected].map(code=>`<button type="button" data-group-remove="${safe(code)}">${safe(code)} ×</button>`).join('')}`;body.querySelectorAll('[data-group-remove]').forEach(b=>b.onclick=()=>{selected.delete(b.dataset.groupRemove);drawOptions();});}
  draw();
 }
 function chooseClient(clients,onSelect){clients=clients.filter(c=>c.id);const body=shell('Elegir local para el pedido');if(!clients.length){body.innerHTML='<p>Este grupo contiene solo clientes históricos. Elegí un cliente registrado en el catálogo para crear un pedido.</p>';return;}body.innerHTML=clients.map((c,i)=>`<button type="button" data-group-branch="${i}"><b>${safe(c.clientCode)} · ${safe(c.legalName||c.name)}</b><small>${safe([c.address,c.locality].filter(Boolean).join(' · '))}</small></button>`).join('');body.querySelectorAll('[data-group-branch]').forEach(b=>b.onclick=()=>{const client=clients[Number(b.dataset.groupBranch)];close();onSelect(client);});}
 window.DASHBOARD_CLIENT_GROUPS={open,close,chooseClient};
})();
