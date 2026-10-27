/* Display gate only; database and delivery API enforce the admin role. */
(function(){
  const ownerId='094aa67d-7768-4277-85c9-1d1b1831e7fe';
  const policy={ownerId,canAccess:(user,profile)=>Boolean(user?.id&&profile?.role==='admin'&&(!profile.id||profile.id===user.id))};
  if(typeof module!=='undefined'&&module.exports)module.exports=policy;
  else window.SALES_DASHBOARD_ACCESS=policy;
})();
