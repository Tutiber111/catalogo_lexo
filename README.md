# catalogo_lexo

## Interactive Catalog Prototype

This is a static proof of concept for a public product catalog that uses the PDF pages as the visual layer and separate product data for cart behavior.

## Local Preview

Easiest option: double-click `START_PREVIEW.bat`.

You can also open this file directly in a browser:

```text
web/index.html
```

If you prefer the command line, run a small static server from the project root:

```powershell
node tools/static_server.js
```

Then open:

```text
http://localhost:8080
```

Admin section: open the catalog and use the small mark in the brand block, or go directly to `/#admin`.

Default admin password: `lexo2026`. Change it from the admin Settings panel before sharing the site.

The current admin is designed for the static prototype. Orders and adjustments are stored in the browser's local storage, with import/export buttons for moving that data between devices. To see every client order from different devices, a production version needs real server-side authentication and a shared orders database.

See `docs/order-database-model.md` for the proposed customer login and order database model.

## Supabase Setup

1. Open the Supabase SQL editor.
2. Run `supabase/schema.sql`.
3. Create your account from the catalog cart.
4. In Supabase SQL editor, promote your account:

```sql
update public.profiles set role = 'admin' where email = 'your-email@example.com';
```

After that, customer orders save to Supabase and the hidden admin popup can load all remote orders.

## Supabase Order Notifications

New Supabase orders can send an email notification through the `send-order-notifications` Edge Function.

Setup:

1. Run the latest `supabase/schema.sql` in the Supabase SQL editor. This adds the `order_notifications` queue.
2. Create or use a Resend account, then verify the sender domain/address you want to use.
3. Add these Supabase Edge Function secrets:

```powershell
supabase secrets set RESEND_API_KEY="re_..."
supabase secrets set ORDER_NOTIFICATION_TO="martin@lexo.com.ar"
supabase secrets set ORDER_NOTIFICATION_FROM="LEXO Pedidos <onboarding@resend.dev>"
supabase secrets set ORDER_NOTIFICATION_SITE_URL="https://your-catalog-url.netlify.app"
```

4. Deploy the function:

```powershell
supabase functions deploy send-order-notifications
```

When a signed-in customer saves an order, the app inserts a pending notification row and invokes the Edge Function. If the email send fails, the row remains in `order_notifications` with `status = 'failed'` and the error in `last_error`, so it can be inspected from Supabase.

The current temporary Resend setup uses `onboarding@resend.dev`, which only sends to the email address that owns the Resend account. To send from `ventas@lexo.com.ar` or notify multiple inboxes, verify `lexo.com.ar` in Resend and then update `ORDER_NOTIFICATION_FROM` / `ORDER_NOTIFICATION_TO`.

To retry failed notifications after fixing secrets or email settings:

```sql
update public.order_notifications
set status = 'pending', last_error = '', updated_at = now()
where status = 'failed';
```

## Regenerate Sample Data

The sample page images and `web/data/catalog.json` are generated from the PDF:

```powershell
python tools/build_catalog_sample.py
```

The current prototype uses selected pages from the full catalog to test page rendering, product extraction, clickable hotspots, search, and cart flow.

## Production Direction

For the real public version, the PDF remains the designed catalog layer, while product data should come from Excel, Google Sheets, Airtable, Supabase, or an admin dashboard. That lets prices and products update without redesigning the catalog pages every time.

## Netlify Deployment

This project is configured for Netlify with `netlify.toml`.

- Publish directory: `web`
- Build command: none

Recommended workflow:

1. Push this project to a GitHub repository.
2. In Netlify, choose **Add new site** -> **Import an existing project**.
3. Connect the repository.
4. Confirm the publish directory is `web`.
5. Deploy.

After that, every pushed update can trigger a new deploy automatically.
