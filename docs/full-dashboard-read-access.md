# Full dashboard access for selected salespeople

Release approved November 3, 2026. Database and delivery-function changes are
applied; website publication and the account grant follow the sequence below.

`profiles.dashboard_full_access` is a boolean, default false. Actual admins always
have full dashboard access. A salesperson with this flag may read both Ventas
and Vendedores across Lexo, filter any salesperson and preview their dashboard.
Their role remains `salesman`. Regular salespeople retain their own portfolio.
Customers cannot gain dashboard access through this flag.

Admins manage it through **Accesos al dashboard** in the dashboard header.
The list resolves sign-in emails through Auth, because profile email can be
missing. Only admin-checked RPCs can list accounts or change the flag. A separate
profile trigger also blocks self-grants through INSERT, UPDATE or upsert.

The full context RPC projects analytics clients/orders/lines, omitting phone,
notes and other order-management fields. It checks the DB profile on every
request. Historical data remains in the existing fast cache with the same exact
projection. Its reader stays security invoker; its SELECT policy also accepts
the dashboard capability. Existing operational order/client/item RLS, stock
policies, `is_admin()` and group write RPCs are unchanged. The full viewer UI
omits group/access management and report-to-checkout actions.

The delivery Edge Function reads the flag from the authenticated DB profile and
revalidates full reads through the reporting RPC; caller metadata/body cannot
grant it. A preview is scoped even when its caller has full access. Warehouse
reads remain Lexo-only. Restock lists can be read company-wide, while broad
automatic pop-ups are suppressed for managerial viewers; receipts still belong
to the signed-in user. No warehouse database changes are involved.

Caches distinguish full/portfolio/preview modes. Authorization failures clear
cached company data even on a background refresh. Server revocation applies to
the next protected request with the same JWT. Already rendered data in an open
browser cannot be remotely erased instantaneously; focus/periodic refresh or
the profile sync clears it on the next check.

## Account selection

Match the confirmed sign-in account through Auth and verify its existing
salesperson role/code before granting access. Do not create another account or
infer an identity from a name. Account-specific release details stay outside
the public repository.

## Approved release sequence

1. Apply `20261103154501_full_dashboard_read_access.sql` to Lexo only. No account
   is enabled by the schema migration.
2. Deploy `sales-dashboard-deliveries` with its `_shared` files, including the
   updated `sales-delivery-reader.mjs`. No keys are printed or moved client-side.
3. Publish the reviewed frontend once via Git, including the pending product
   buyers/shared-date feature. Dashboard assets/cache use
   `20261103-dashboard-access-r21`; its model retains the product feature's r20.
   Preserve unrelated `web/app.js`, vendor and other checkout work.
4. Enable the flag only for the confirmed Auth account after verifying its
   existing role is salesman and code is 805. This can also be done through the
   admin permission UI. Keep the role and portfolio code unchanged.
5. Set the verifier's `app.verify_dashboard_user` session setting to the
   confirmed profile UUID, run `tools/verify-full-dashboard-access.sql`, check production roles/assets
   and verify the exact published Git/Netlify commit. Report separately which
   backend, website and account permission changes actually completed.

Local checks cover actual migration execution; full/company and scoped reads;
unchanged role/stock/group restrictions; signup/update/metadata self-escalation;
revocation without a fresh JWT; the delivery bridge; full/normal/admin browser
views; permission management; and background revocation cache clearing. Existing
dashboard startup and product/date tests also pass.
