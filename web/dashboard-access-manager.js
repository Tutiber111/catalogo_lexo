/* Only real admins may grant a dashboard capability. Roles stay unchanged. */
(function(){
 const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let dialog=null,epoch=0;
 const admin=()=>typeof state!=='undefined'&&state.user?.id&&state.profile?.role==='admin';
 function close(){epoch++;if(dialog){const node=dialog;dialog=null;node.close();node.remove();}}
 async function open(){
  if(!admin())return;close();const account=state.user.id,request=epoch;
  dialog=document.createElement('dialog');dialog.className='bi-client-groups-dialog';
  dialog.innerHTML='<header><h2>Accesos al dashboard</h2><button type="button" data-access-close aria-label="Cerrar">×</button></header><p>Permite ver todas las ventas y vendedores. La cuenta conserva su rol de vendedor.</p><div data-access-body><p role="status">Cargando cuentas…</p></div>';
  document.body.append(dialog);dialog.querySelector('[data-access-close]').onclick=close;dialog.addEventListener('close',()=>{if(dialog&&!dialog.open)close();});dialog.showModal();
  const body=dialog.querySelector('[data-access-body]');
  const valid=()=>epoch===request&&admin()&&state.user.id===account;
  try{
   const accounts=await CATALOG_SUPABASE.loadDashboardAccessAccounts();if(!valid())return;
   body.innerHTML=accounts.map(p=>`<article class="bi-access-account"><div><b>${safe(p.name||p.email)}</b><small>${safe(p.email)} · Vendedor ${safe(p.salesman_code||'sin código')}</small></div><label><input type="checkbox" data-access-id="${safe(p.id)}" ${p.dashboard_full_access?'checked':''}> Dashboard completo</label><span data-access-status role="status"></span></article>`).join('')||'<p>No hay cuentas de vendedores.</p>';
   body.addEventListener('change',async e=>{
    const field=e.target.closest('[data-access-id]');if(!field||!valid())return;
    const enabled=field.checked,status=field.closest('article').querySelector('[data-access-status]');field.disabled=true;status.textContent='Guardando…';
    try{await CATALOG_SUPABASE.setDashboardFullAccess(field.dataset.accessId,enabled);if(valid())status.textContent=enabled?'Acceso habilitado':'Acceso retirado';}
    catch{if(valid()){field.checked=!enabled;status.textContent='No se pudo guardar. Intentá nuevamente.';}}
    finally{if(valid())field.disabled=false;}
   });
  }catch{if(valid())body.innerHTML='<p role="alert">No se pudieron cargar los permisos. Revisá que la actualización esté activada.</p>';}
 }
 window.DASHBOARD_ACCESS_MANAGER={open,close};
})();
