/* Display gate only; the read-only scope API enforces role and portfolio access. */
(function(){
  const ownerId='094aa67d-7768-4277-85c9-1d1b1831e7fe';
  const policy={ownerId,canAccess:(user,profile)=>Boolean(user?.id&&(profile?.role==='admin'||profile?.role==='salesman'&&Boolean(String(profile.salesman_code||'').trim()))&&(!profile.id||profile.id===user.id))};
  if(typeof module!=='undefined'&&module.exports)module.exports=policy;
  else window.SALES_DASHBOARD_ACCESS=policy;
})();
