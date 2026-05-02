# SEO Meta Editor — Shopify App

An embedded Shopify admin app that lets a merchant paste any product URL (storefront or admin), edit the SEO title and description, and save the changes back to Shopify via the GraphQL Admin API.

Built on the official `@shopify/shopify-app-template-remix` template.

## Features

### Single product editor
- Paste any of the following and load the product:
  - `https://{shop}.myshopify.com/products/{handle}` (storefront)
  - `https://{shop}.myshopify.com/admin/products/{numeric_id}` (admin)
  - A custom-domain product URL (`/products/{handle}`)
  - A bare handle, numeric product ID, or `gid://shopify/Product/...` GID
- Read current `seo.title` / `seo.description` and edit them inline
- Live character counters with caution tone past 60 / 160 chars
- Confirms before saving when both fields are emptied
- Recent edits panel — last 10 saves, click to reload
- Toast on success, banner on errors, retry on network failures

### Bulk SEO update (`/app/bulk`)
- Upload an `.xlsx` or `.csv` with three columns — `product_url`, `meta_title`, `meta_description` — and update many products in one go
- Header names are case- and variant-insensitive (`Product URL`, `SEO Title`, `Meta Description`, `url`, etc.)
- Preview every row before starting: per-row validation (✅ valid / ⚠️ warning / ❌ error), length badges, and a summary count
- Errors block the run; warnings prompt a "continue anyway" confirm
- Downloadable starter template at `/api/bulk/template`
- Live progress page that polls every 1.5 s, with success / failed / pending counters and a per-row status table
- On completion, download a CSV of failed rows (filterable for re-upload) at `/api/bulk/{jobId}/errors.csv`
- Limits: 1000 rows, 5 MB per file
- Jobs are persisted in `BulkJob` / `BulkJobRow` tables; the merchant can close the browser and return to a running job from "Recent bulk jobs"
- Server-side throttling: when Shopify reports `cost.throttleStatus.currentlyAvailable < 200`, the processor sleeps to let the bucket refill before the next call

## Tech Stack

- Remix (`@remix-run/*` v2) + Vite
- TypeScript (strict)
- Polaris 12 + App Bridge React 4
- Shopify Admin GraphQL API `2025-01`
- MongoDB via Mongoose ODM (sessions, edit history, bulk job state)

## Requirements

- Node `>=20.19 <22 || >=22.12`
- npm
- A [Shopify Partners](https://partners.shopify.com) account with a development store

## Environment Variables

These are normally written automatically by `shopify app dev` into `.env`. You shouldn't need to set them by hand for local development.

| Variable             | Required | Purpose                                                    |
| -------------------- | -------- | ---------------------------------------------------------- |
| `SHOPIFY_API_KEY`    | yes      | Client ID of the Partners app                              |
| `SHOPIFY_API_SECRET` | yes      | Client secret of the Partners app                          |
| `SHOPIFY_APP_URL`    | yes      | Public URL of the running app (Cloudflare tunnel in dev)   |
| `SCOPES`             | yes      | Set automatically from `shopify.app.toml` (`read_products,write_products`) |
| `SHOP_CUSTOM_DOMAIN` | no       | Set if your dev store uses a non-`myshopify.com` domain    |
| `MONGODB_URI`        | yes      | MongoDB connection string (default `mongodb://localhost:27017/`) |
| `MONGODB_DATABASE`   | yes      | MongoDB database name (default `seo_meta_editor`)          |

## Local Development

1. Install dependencies (already done if you scaffolded via `npm init @shopify/app`):
   ```bash
   npm install
   ```

2. Make sure MongoDB is running locally and reachable at the URI in `.env` (default `mongodb://localhost:27017/`). Mongoose creates the database + collections + indexes on first model use, so there's no separate migration step.

3. Start the dev server. The first run prompts you to log into Shopify Partners, pick (or create) an app, and select a development store:
   ```bash
   npm run dev
   ```

4. When the CLI prints the preview URL, open it. Shopify will install the app on your dev store. After install, the SEO Editor route is the home of the embedded admin app.

### Trying it out

1. In your dev store admin, copy a product URL (e.g. `https://your-store.myshopify.com/admin/products/1234567890`).
2. Open the SEO Editor app, paste the URL, click **Load product**.
3. Edit the SEO title / description. Click **Save changes**.
4. Open the same product in Shopify admin → scroll to the **Search engine listing** card. The new values are live.

## Useful Commands

| Command                    | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `npm run dev`              | `shopify app dev` — runs the embedded app locally           |
| `npm run build`            | Production Remix build                                      |
| `npm run lint`             | ESLint                                                      |
| `npm run deploy`           | `shopify app deploy` — deploys app config to Shopify        |
| `mongosh $MONGODB_URI/$MONGODB_DATABASE` | Inspect the local MongoDB database               |

## Deploy to Shopify Partners

The Shopify CLI manages app configuration and hosting integration. A typical deploy looks like:

1. Push app config (URLs, scopes, webhooks) from `shopify.app.toml`:
   ```bash
   npm run deploy
   ```
2. Host the app somewhere reachable (Vercel, Fly, Render, Cloudflare Workers, your own VPS). Point `SHOPIFY_APP_URL` at the public URL and update the `application_url` and `redirect_urls` in `shopify.app.toml` (or let `shopify app deploy` write them) before re-deploying.
3. Point `MONGODB_URI` at a managed MongoDB cluster (Atlas, etc.) and set `MONGODB_DATABASE` to your production database name. Mongoose creates indexes on first model use — no separate migration step.

See the official Shopify docs for hosting recipes:
- https://shopify.dev/docs/apps/deployment/web

## Project Structure

```
app/
  routes/
    app._index.jsx                    # main editor: loader + action + UI
    app.jsx                           # embedded app frame + nav
    app.bulk.jsx                      # bulk upload page (dropzone + preview + recent jobs)
    app.bulk.$jobId.jsx               # bulk job progress page (polls every 1.5s)
    api.bulk.upload.jsx               # POST: parse file, return preview OR create job
    api.bulk.status.$jobId.jsx        # GET: job status (no-store; polled by progress page)
    api.bulk.template.jsx             # GET: streams a sample .xlsx
    api.bulk.$jobId.errors[.csv].jsx  # GET: CSV of failed rows
    auth.$.jsx                        # OAuth callback (template)
    auth.login/                       # login route (template)
    webhooks.app.*                    # webhooks (template)
  graphql/
    getProduct.js                     # productByHandle / product GraphQL queries
    updateProductSeo.js               # productUpdate mutation
  components/
    SeoEditor.jsx                     # single-product editing form
    RecentEdits.jsx                   # last-10 edits panel
  services/
    bulkProcessor.server.js           # sequential row processor with cost-based throttling
  utils/
    parseProductUrl.js                # URL/handle/ID parsing (shared with bulk)
    parseBulkFile.server.js           # xlsx / csv → validated rows
    seoValidation.js                  # counter helpers
    timeAgo.js                        # relative time formatter
    __tests__/                        # node:test specs
  db.server.js                        # Mongoose connection singleton
  shopify.server.js                   # Shopify app config (with MongoDBSessionStorage)
  models/
    schemas.server.js                 # Mongoose schemas: BulkJob, BulkJobRow, EditHistory
shopify.app.toml                      # Shopify app config (scopes, webhooks, URLs)
```

## Tests

`node:test` specs ship with the repo:

| Suite | Run |
| --- | --- |
| URL parser | `node --test app/utils/__tests__/parseProductUrl.test.js` |
| Bulk file parser (xlsx + csv) | `node --test app/APIs/utils/__tests__/parseBulkFile.test.js` |
| Bulk processor (3-row scenarios, hits MongoDB) | `node --test app/APIs/services/__tests__/bulkProcessor.test.js` |

The processor test connects to MongoDB on `MONGODB_URI` (default `mongodb://localhost:27017/`) using the `MONGODB_DATABASE` value (default `seo_meta_editor_test` for the test) and tears down test rows under the shop name `test-bulk-processor.myshopify.com`. If MongoDB is unreachable the suite skips silently.

## Troubleshooting

- **"App name cannot contain Shopify"** when re-scaffolding — pick a different app name.
- **Scope changes don't take effect** — after editing `shopify.app.toml`, the dev session prompts to reauthorize. Accept it. In prod, push with `npm run deploy`.
- **MongoDB connection refused** — the dev server logs `[db.server] MongoDB connection failed` on startup if it can't reach `MONGODB_URI`. Start MongoDB locally (`brew services start mongodb-community`, `sudo systemctl start mongod`, etc.) and restart `npm run dev`.
- **"Could not load product" with a custom domain** — set the `SHOP_CUSTOM_DOMAIN` env var to that domain so embedded auth resolves.
