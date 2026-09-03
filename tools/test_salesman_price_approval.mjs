import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../web/supabase-client.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260903184725_add_salesman_price_access_approval.sql", import.meta.url),
  "utf8",
);
const translatedErrorsMigration = fs.readFileSync(
  new URL("../supabase/migrations/20260903185621_translate_salesman_approval_errors.sql", import.meta.url),
  "utf8",
);

assert.match(html, /id="salesmanPriceApprovalsSection"[^>]*hidden/);
assert.match(app, /state\.profile\?\.role !== "salesman"/);
assert.match(app, /loadAssignedPendingPriceApprovals\(\)/);
assert.match(app, /approveAssignedPriceAccess\(profileId\)/);
assert.match(client, /client\.rpc\("list_pending_assigned_price_access_requests"\)/);
assert.match(client, /client\.rpc\("approve_assigned_price_access_request"/);

assert.match(migration, /security definer/gi);
assert.match(migration, /profile\.role::text = 'salesman'/);
assert.match(migration, /profile\.assigned_salesman_code = actor_salesman_code/g);
assert.match(migration, /profile\.price_access_approved = false/g);
assert.match(migration, /price_access_approved_by = auth\.uid\(\)/);
assert.match(migration, /revoke all on function public\.list_pending_assigned_price_access_requests\(\) from public, anon/);
assert.match(migration, /revoke all on function public\.approve_assigned_price_access_request\(uuid\) from public, anon/);
assert.match(translatedErrorsMigration, /Solo los vendedores con un código asignado pueden ver estas solicitudes\./);
assert.match(translatedErrorsMigration, /Solo los vendedores con un código asignado pueden aprobar solicitudes\./);
assert.match(translatedErrorsMigration, /Solicitud no encontrada o no asignada a este vendedor\./);
assert.doesNotMatch(translatedErrorsMigration, /Only salesmen|Request not found/);

console.log("Salesman price approval checks passed.");
