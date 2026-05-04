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
