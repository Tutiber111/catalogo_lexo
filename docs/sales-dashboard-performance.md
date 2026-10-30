# Dashboard startup performance — prepared October 30, 2026

Release approved October 30, 2026. The historical grouping and history endpoint migrations are applied. Frontend publication completes this combined release.

## Changes

- Admin history uses one `sales_dashboard_history_json()` RPC returning the same projected line fields and batch metadata. This replaces 108 history-line page requests for the current 52,083 lines, plus the metadata request. The RPC uses **security invoker**, the existing table RLS/grants, an explicit DB-profile admin check and no anonymous execute privilege. Salespeople continue using the existing portfolio-scoped snapshot, not the company-wide history endpoint.
- History, catalog data, client grouping, prices, company ranking and warehouse delivery reads start concurrently. A scoped salesperson request does not delay the independent warehouse read. The main metrics still wait for confirmed warehouse data; this update does not substitute zero deliveries while a request is pending.
- Raw admin history is retained in memory for at most five minutes for the same user/role/view key. Live clients, orders and deliveries remain refreshed. Manual **Actualizar** bypasses the history cache. Reopening an already-rendered dashboard within 55 seconds reuses that exact screen without requests or calculations; between 55 seconds and five minutes it shows the timestamped prior data while updating in the background.
- Current-model date-range subsets are reused within a report, so customer/vendor calculations do not repeatedly scan the entire dataset for the same period.
- Prepared data and up to 30 calculated results are reused for the same snapshot and identical filters. Fresh data, ownership/view changes and sign-out invalidate them. No historical or customer data is written to localStorage, IndexedDB, the service worker, or a shared response cache by this change.
- The opportunities count is calculated in idle time after rendering the main dashboard. Its placeholder is an ellipsis, never a fabricated zero. Opening the actual opportunities panel calculates its complete results on demand. A stale callback cannot render into a different account or replaced dashboard.

## Local measurements and verification

`node tools/benchmark-sales-startup.cjs` compares the current model against commit `3fa7e063f38c4e55db8c2f5c19381d3a2b95a25c`, with an exact deep comparison of all report metrics and customer/vendor details over the private 52,083-line fixture. One run measured the report calculation at **1,102 ms before / 193 ms after (5.7x)**. Preparation was **731 / 701 ms**, so preparation itself is not claimed as a major improvement. Timings depend on hardware/JIT; no production end-to-end startup time is claimed before publication.

Passed: `test-sales-history-snapshot-db.cjs` (actual migration, 1,501 rows, exact values and deterministic projection, existing RLS and admin-only access), `test-sales-bi-api.cjs` (single RPC, no page reads, permission denial, malformed response rejection, compatibility fallback), `test-sales-startup-browser.cjs` (parallel reads, fresh reopen with zero requests/recalculations, cached tab changes, manual refresh invalidation, sign-out clearing), existing salesperson/admin-preview browser checks, reporting/model tests and full workbook reconciliation.

The API retains the old paged reader only for installations where the new RPC is absent (`PGRST202`/`42883`). A permission or malformed-response failure is never converted to a paged fallback. The normal local preview remains authenticated and uses its existing private history route.

## Release after approval

1. Apply `supabase/migrations/20261030140912_dashboard_history_snapshot.sql` to Lexo and verify an admin receives the unchanged history count/projection while salespeople/customers/anonymous callers are denied.
2. The working tree also contains the separately prepared Tina & Co historical grouping fix. A combined publication must apply its `20261029190415_dashboard_group_historical_clients.sql` first, because the changed grouping UI calls its new admin-only candidate RPC. Do not accidentally publish that UI without its migration.
3. Publish only the reviewed dashboard/history/grouping files, tests and documentation; preserve unrelated `web/app.js`, quick-order and other local work. Modified startup assets/cache use `20261030-dashboard-speed-r18`; the historical-group selector retains `20261029-historical-groups-r17`.
4. Verify the exact Netlify commit/assets, browser load, protected RPCs, scoped views and measured startup after publication. No WarehousePick or Edge Function changes are required for this performance update.

## Production database validation

The initial binary-JSON snapshot took 11,287 ms. EXPLAIN identified costly nested JSONB response construction. The additive `20261030144701_dashboard_history_json_response.sql` creates `sales_dashboard_history_json()` using native JSON response construction, preserving the existing endpoint and the same invoker/admin/RLS restrictions. It returned 52,083 lines in 1,920 ms under the authenticated role. The HTTP JSON object/field layout remains unchanged. This is database time, not a promise about total startup time on every connection.

The production verification script passed exact row/amount comparisons, Tina candidate lookup, mixed catalog/history grouping inside a rolled-back transaction, scoped membership, and salesperson/customer/anonymous denial. No test group remained. The two original attempts to replace the binary endpoint expired at the connector confirmation stage; the successful additive migration leaves it intact.
