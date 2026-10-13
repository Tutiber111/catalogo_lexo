# Order email recovery

Order 269 was saved on 2026-10-13 at 12:00:15 Buenos Aires time. The email
worker was killed with `CPUTime`, 2051 ms CPU, and HTTP 546
`WORKER_RESOURCE_LIMIT`. Its notification remained `processing` with one
attempt and no provider email ID.

The fix prepares invariant workbook changes at build time, edits cells by row,
and compresses only the changed worksheet. Other workbook entries retain their
compressed bytes, styles, formulas, and images. Excel formula caches are cleared
and recalculation on opening remains enabled.

Each notification has a durable `delivery_key` and `first_attempt_at`. A retry
reuses the provider idempotency key and deterministic workbook bytes. Active
workers cannot be reclaimed for five minutes; compare-and-set locking prevents
two requests from claiming the same attempt. Retries are limited to five attempts
within 23 hours, inside Resend's 24-hour deduplication window. Each scheduled
request processes one notification to give it its own Edge Function CPU budget.
Changed order details or recipient configuration can make Resend reject a retry
payload with the same key; review that failure rather than bypassing deduplication.

## Release sequence (requires explicit approval)

1. Apply only `20261013151633_recover_order_email_workers.sql`. Do not bulk-apply
   unrelated pending migrations from this checkout.
2. Deploy `send-order-notifications` with `index.ts`, `workbook-zip.ts`, and the
   regenerated `order-template-base64.ts`.
   Deploy `send-order-email-failure-alerts` with JWT gateway verification disabled
   (it authenticates the internal secret itself), then apply only
   `20261013153650_alert_failed_order_emails.sql` to enable its outbox and scheduler.
3. Confirm the internal secret matches the scheduler. The function prefers
   `ORDER_NOTIFICATION_INTERNAL_SECRET`, falling back to the existing
   `PRICE_ACCESS_INTERNAL_SECRET`; Vault prefers `order_notification_secret`,
   falling back to the existing `price_access_notification_secret`. Do not print
   secret values. Confirm scheduled requests authenticate successfully.
4. Publish the updated `web/supabase-client.js` after approval. It reports email
   success only when the worker confirms `sent`, including already-sent orders.
5. Order 269 has already been resent; do not resend it again during deployment.
   For a newly authorized verification order, confirm `sent` and a Resend email ID.
   Confirm mailbox delivery separately when provider read access is available.
6. Verify the minute scheduler and a controlled retry in production. Local tests
   do not establish the production CPU budget or delivery status.

Preexisting stuck sends have no safe provider key and are marked failed after
five minutes for admin review. Existing historical failed emails are not replayed.
Automatic retries require the keyed worker's recorded first attempt. Checkout
still saves an order if emailing fails, with a visible email warning.

## Failure alerts

Failure alerts go to `ventas@lexo.com.ar`, as explicitly requested. A database
trigger queues an alert when a send fails. A separate minute watchdog also catches
workers stuck in `processing` and emails left `pending` for more than five minutes.
One alert is queued per delivery key, including for grouped branch emails.
The alert includes the order number, detection time, failure reason, and a link to
the admin panel. It contains no Excel attachment and uses a separate Edge Function.
An alert records the failure even if a later retry recovers the order.

Alert attempts also use compare-and-set leases, a persisted payload, an idempotency
key, five attempts, and a 23-hour safe retry window. If the email provider is down,
the alert can only arrive after it recovers; an independent channel would be needed
to cover a provider-wide outage. The current Resend key permits sends but rejects
delivery-status queries. Accepted sends are not proof of delivery to an inbox;
automated bounce/delivery monitoring requires a webhook or provider read access.

Order 269 was manually resent through the existing authenticated admin session
on 2026-10-13 at 12:38:56 Buenos Aires time, before deploying these changes.
The database confirms `sent`, provider ID `01a135ea-b36d-7c7b-8129-39bf06392a04`,
and the four explicitly approved recipients: `ventas@lexo.com.ar`,
`martinbertisch@gmail.com`, `gabertisch@hotmail.com`, `yajid55@yahoo.com.ar`.

## Local validation

Both tools use Node 22.19+ and the same pinned `fflate@0.8.2` used by the worker.
Set `FFLATE_MODULE` to its resolved CommonJS module, or use the local QA copy at
`outputs/email-qa/package/lib/node.cjs`. No tests send emails.

Run `node tools/prepare-order-email-template.cjs` after editing the canonical
`supabase/functions/send-order-notifications/order-template.xlsx`.
Run `node tools/test-order-email-worker.cjs` to verify workbook integrity,
deterministic bytes, CPU usage, locking, and deduplication. If the original worker
snapshot exists at `outputs/email-qa/original.ts`, the test also compares every
uncompressed ZIP entry and reports before/after CPU timings.
Run `node tools/test-order-email-failure-alerts.cjs` to verify independent alert
delivery, retries, frozen payloads, deduplication, and authentication with mocked
HTTP requests.
