# Opportunities and restock notices — local release preparation

Prepared October 28, 2026. Nothing in this document is evidence of publication.

**Catalog release approved by Tuti on October 28:** both catalog migrations and the 893-product registry are applied; `sales-dashboard-deliveries` is ACTIVE at version 2 with JWT verification. The CLI deployment account returned 403, so the explicitly approved connected Supabase account performed deployment. Frontend publication is the final release step. WarehousePick activation belongs exclusively to the warehouse AI; this release does not apply its SQL or its already-matching SKU map.

## Behavior

- Opportunities use the company-wide top 20 products by delivered units over the trailing 12 months, then exclude products the selected client ordered during that period. Product/brand/category filters narrow the candidate list. Only currently available, visible products appear.
- Lapsed products were ordered in the preceding nine months and have no orders in the latest three months. Current customer assignments still control visibility.
- WarehousePick supplier invoices (`stock_apply_invoice` → `stock_batches`/`stock_moves`, kind `invoice`) create arrival events. Inventory counts and adjustments do not create alerts. This is the receiving workflow's confirmation point; no new confirmation screen is added.
- Exact catalog IDs and SKUs are mandatory. An arrival only restores availability when current WarehousePick `on_hand - reserved` is positive. Hidden products stay hidden; prices are untouched.
- One arrival summary is relevant to a client when the product has at least two delivered purchase occasions in the preceding 12 months, or recorded WarehousePick no-stock demand. Purchase occasions follow the anchored two-day rule. New products without that history do not generate repeat-purchase notices; products explicitly marked `sales_catalog_products.is_new` are excluded too.
- Salespeople get their current portfolio; signed-in customers get only their admin-assigned `profiles.client_code`. Customer account links are protected against self-reassignment. Company rankings expose product aggregates, not other clients' identities.
- Catalog pop-ups appear for unseen arrival batches; closing them leaves the items pending. The catalog's **Reposiciones** button and dashboard's **Reposiciones** tab open the pending list. **Marcar gestionado** completes it only for that account. Admin previews are read-only.
- Polling occurs at sign-in, on window focus, and every minute while visible. New summaries trigger the existing catalog refresh so stock buttons update. These are in-app notices, not email or push messages.
- Arrival retries are idempotent. Unmapped SKUs stay queued without blocking mapped products. Undoing an arrival withdraws its notices; known zero availability restores the out-of-stock flag. Previously sent or older event versions cannot re-enable an undone batch.

## Files and activation order

Release approval covers Lexo only. Lexo is `iexpvwmtxauvzkcncqoc`; WarehousePick is `wjokaaqfwjsvxcuhtbzm` and must be handled separately by its owner. Verify the current migration state before repeating any deployment step.

1. Apply pending Lexo `20261028141217_salesman_dashboard_scope.sql`, then `20261028173942_opportunities_and_restock_notices.sql`. The earlier history migration and imported historical data must already exist. Do not run the old master-data import.
2. Run `node tools/prepare-restock-catalog.cjs` against the release catalog. It prepares metadata for 893 exact product IDs under ignored `tmp/sales-dashboard/restock-release/`. Apply `catalog-products.sql` to Lexo and `warehouse-catalog-map.sql` to WarehousePick. The latter replaces only the Lexo SKU map, preserving other companies. Repeat this metadata step whenever products are added, removed, or renamed.
3. Verify the existing WarehousePick `private.catalog_links` Lexo target and credentials. Configure the matching secret in Lexo `private.picking_stock_link`, using the existing secure bridge configuration; never print, commit, or send secrets to the browser. The catalog RPC is `picking_receive_arrival`. Existing `picking_set_stock` support is a separate migration (`20261022120000_picking_stock_sync.sql`) and must be verified if ongoing warehouse stock-out synchronization is desired.
4. Apply `supabase/catalog_restock_events.sql` in WarehousePick (local copy prepared in the supplied project folder). It adds the outbox, supplier-movement trigger, retry dispatcher and minute cron job; existing receiving functions remain unchanged. It does not backfill old arrivals or notify old containers.
5. Deploy the updated Lexo `sales-dashboard-deliveries` Edge Function, including `_shared/sales-delivery-reader.mjs`, `_shared/dashboard-access.mjs`, and `_shared/sales-delivery-cache.mjs`. The service-role key remains server-side. The fulfillment cache is refreshed by validated delivery reads and arrival payloads, so repeat demand and no-stock demand can be evaluated without a prior dashboard visit.
6. Publish the frontend files together, including `restock-notices.js`, BI modules, Supabase client, index and service worker. Current asset/cache version is `20261028-restocks-r14`.
7. Verify live admin, salesperson, admin-preview and customer roles; reject other-portfolio requests. Confirm the queue's response and one controlled receipt end-to-end before considering activation complete. No real receipt or notification was generated during local tests.

Known inactive products are skipped by the catalog receiver without blocking valid products in the same batch. Unknown IDs or mismatched SKUs remain errors. The warehouse AI owns its reviewed bounded retry/version implementation and activation. Do not deploy the older warehouse output copy from this catalog project. Existing receiving UI and stock calculations remain unchanged.

## Local verification

Passed: `test-sales-opportunities.cjs`, `test-restock-db.cjs`, `test-warehouse-restock-events.cjs`, `test-restock-browser.cjs`, `test-sales-reporting.cjs`, `test-sales-bi-model.cjs`, `test-sales-bi-api.cjs`, `test-sales-deliveries.mjs`, `test-salesman-scope-db.cjs`, `test-sales-standard-preview.cjs`, `test-salesman-dashboard-browser.cjs`, and `test-sales-preview-data.cjs`.

The database tests execute the actual migrations and WarehousePick hook in local PostgreSQL fixtures. Browser tests use synthetic authenticated accounts and intercepted data, including mobile layout and account switching. They do not establish live production delivery or migration state.

`tools/verify-restock-release.sql` additionally passed against the production catalog database after deployment. Its read-only checks use actual admin, salesperson and linked-customer profiles, compare admin preview with salesperson scope, reject other portfolios/customer dashboard access/anonymous access, and catch the expected 42501 for an invalid arrival secret. Session claims are rolled back and no business rows are written. Live arrival delivery remains a separate coordinated warehouse check.
