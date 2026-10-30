# Dashboard client groups

Release approved October 29, 2026. Applies to Lexo only; no WarehousePick or Edge Function changes.

Admins open **Agrupar clientes** from the sales dashboard header, enter a display name, search and select at least two client codes, then save. Existing groups can be edited or ungrouped. Each code belongs to at most one group. Selection remains visible while searching other locations.

Historical-only follow-up (database applied; included in this frontend release): the admin candidate RPC unions catalog clients with exact codes from sales history and searches their historical name aliases. Code 80605 (Tina & Co) is supported even when absent from `sales_clients`. No catalog client is inserted and no salesperson is inferred from older files. Historical-only ownership follows the existing unassigned-to-Adrian analytical rule; current master assignments take precedence whenever present. Historical-only locations cannot be passed to checkout.

Groups are shared, persistent reporting configuration stored by authenticated admin-only RPCs. They never update `sales_clients`, source orders, invoices, WarehousePick, or salesperson assignments. Group reads return only membership codes currently assigned to the requesting salesperson; customers and anonymous users cannot read them. Admin preview applies grouping only after the selected portfolio is scoped.

Grouped analysis combines amounts, quantities, distinct clients, charts, customer frequency/cohorts and product opportunities. As confirmed by the user, purchases across grouped codes use the existing anchored two-day rule: days 1+3 form one occasion, day 5 starts another; use the first occasion date across month boundaries. Ungrouping restores separate source identities. Salesperson reports compute each portfolio separately, preserving original revenue ownership. A multi-salesperson group is labeled **Varios vendedores** in the company-wide client view.

Row exports retain original location codes/names alongside the grouped identity. Creating an order from a group opens a location selector and passes a real source client to the existing cart. Restock notices continue to address their original authorized client/location; this change does not broaden notification recipients or client sign-in access.

## Activation after approval

1. Apply `supabase/migrations/20261029154708_dashboard_client_groups.sql` to Lexo only. Depends on the existing salesperson assignment helper. Tables have RLS and no direct browser privileges; RPCs use explicit authenticated role checks and fixed search paths.
   For the historical-only fix, additionally apply `20261029190415_dashboard_group_historical_clients.sql`. It removes the catalog-master foreign key from reporting membership and validates exact codes against the catalog OR sales history inside the admin-only save RPC. It preserves existing groups and leaves source tables untouched. The new candidate RPC is admin-only; membership reads remain portfolio-scoped.
2. Publish the changed BI model/UI/CSS, Supabase client, dashboard loader, `dashboard-client-groups.js`, index, and service worker together. New grouping assets use `20261029-client-groups-r16`; unchanged assets retain existing versions. No Edge Function or WarehousePick changes are required.
   The historical-only follow-up uses `20261029-historical-groups-r17` for its changed assets and service worker cache.
3. Verify admin save/edit/delete, correct scoped membership for a salesperson and admin preview, original per-location checkout, and persistence after reload.

## Verification

Passed `test-dashboard-client-groups.cjs`, `test-dashboard-client-groups-db.cjs`, `test-dashboard-client-groups-browser.cjs`, and existing reporting/model/API/dashboard tests. Existing salesperson/admin-preview and restock browser regressions passed using a temporary local server. SQL tests run the actual migration in PGlite with scoped read/admin write/anonymous customer denial, duplicate membership, invalid code and rollback checks. Browser tests cover search, selection persistence, save, rename, undo, real checkout branch identity and mobile layout. No live clients were grouped for testing.
