# Product buyers and shared dashboard period

Tested locally and approved for publication November 3, 2026.

- Initial/reset dates are the first day of this month through today in Buenos
  Aires. `Este mes`, previous complete month, last 30 days, trailing 12 calendar
  months and all-history presets remain available.
- Headlines, order/delivery ratio, ticket, sales chart, source sales cards,
  product/client/vendor sales and export use the selected dates. Headline
  comparisons shift that range one calendar month and one year, clamping shorter
  months. YTD and 12-month reference figures and client frequency/status use the
  selected closing date. Their labels distinguish reference windows from sales
  in the selected period. Existing opportunity and pending restock definitions
  are preserved.
- The chart retains measure/dimension controls and defaults to delivered sales;
  its separate date override is removed. Changing the main measure updates the
  chart measure. Invoice-only admin analysis uses delivered for that chart.
- Products show units, net amount and buyer counts. Selecting a name or `Ver
  clientes` applies the exact brand/SKU key across the dashboard and opens the
  buyer table, with units, value, distinct purchase occasions and last purchase.
  Product name/SKU search remains available. Lists above 100 products have page
  controls; the selected product's buyer list is complete.
- Historical invoiced quantities are delivered quantities; unknown warehouse
  deliveries remain unknown and do not create buyers. Original prices, manual
  exclusions, grouped clients, the anchored two-day rule and existing server
  portfolio scoping remain in force. The feature fetches no additional data.
- Assets/cache prepared with version `20261103-product-buyers-r20`.

Validated with `test-sales-product-buyers.cjs`,
`test-sales-product-buyers-browser.cjs`, existing reporting and full historical
workbook reconciliation, client grouping and opportunities, plus dashboard
startup and salesperson/admin-preview browser tests. Screenshots of synthetic
desktop/mobile fixtures are in `tmp/sales-dashboard/product-buyers-*.png`.
