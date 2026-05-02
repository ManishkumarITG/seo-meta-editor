# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Task | Command |
| --- | --- |
| Run the embedded app locally (Shopify CLI tunnel + Remix) | `npm run dev` |
| Production build | `npm run build` |
| Lint | `npm run lint` |
| Push app config (scopes/URLs/webhooks) to Shopify | `npm run deploy` |
| Production server entrypoint | `npm run start` (expects `npm run build` first) |

Persistence is **MongoDB via Mongoose**. Connection settings come from `.env`:

```
MONGODB_URI="mongodb://localhost:27017/"
MONGODB_DATABASE="seo_meta_editor"
```

Mongoose creates indexes lazily on first model use — there is no migration step. Use `mongosh` (or Compass) for ad-hoc queries: `mongosh mongodb://localhost:27017/seo_meta_editor`.

No test runner is wired up. Three `node:test` suites ship in the repo — run any of them directly:
- `node --test app/utils/__tests__/parseProductUrl.test.js` — URL parser (shared util)
- `node --test app/APIs/utils/__tests__/parseBulkFile.test.js` — xlsx/csv parser
- `node --test app/APIs/services/__tests__/bulkProcessor.test.js` — bulk processor (writes to MongoDB under shop `test-bulk-processor.myshopify.com`, cleans up after itself; the suite tries to connect for 2 s and **skips silently** if MongoDB isn't reachable)

Note: when adding new test files, relative imports must include the `.js` extension (Node ESM does not auto-resolve extensions; Vite/Remix only auto-resolves at build time).

## Architecture

This started from the `@shopify/shopify-app-template-remix` template (originally TypeScript) and has been converted to plain JavaScript / JSX. Remix v2 + Vite, Polaris 12, App Bridge React 4, Mongoose ODM against a local MongoDB. No TypeScript anywhere — `.js` for server / utility / GraphQL files, `.jsx` for React components and Remix routes.

### Folder convention — backend lives in `app/APIs/`

```
app/
├── APIs/                          # all server-only code
│   ├── db.server.js               # Mongoose connection singleton (HMR-safe)
│   ├── shopify.server.js          # shopifyApp() config + exports
│   ├── graphql/                   # tagged template strings
│   ├── models/                    # Mongoose-backed data access (schemas + bulkJob, bulkJobRow, editHistory)
│   ├── services/                  # business logic (bulkProcessor, bulkRecovery)
│   └── utils/                     # server-only utils (parseBulkFile)
├── components/                    # React components (frontend)
├── utils/                         # SHARED utils — used by client AND server
│   ├── parseProductUrl.js         # URL/handle/ID parsing — pure, framework-agnostic
│   ├── seoValidation.js           # length helpers
│   └── timeAgo.js                 # relative time formatter
├── routes/                        # Remix flat-routes (loaders/actions delegate to APIs/)
├── entry.server.jsx
├── root.jsx
└── routes.js
```

**Rule**: anything that imports `mongoose`, `@shopify/shopify-app-remix`, or has `.server.js` in its name belongs under `app/APIs/`. Routes import from there; they shouldn't call `mongoose` / Mongoose models directly. Pure utility functions used by both client components AND server code stay in `app/utils/` — moving them to `APIs/` would force frontend imports to cross the boundary.

### Request flow

1. `app/APIs/shopify.server.js` configures `shopifyApp(...)` with `MongoDBSessionStorage` (from `@shopify/shopify-app-session-storage-mongodb`) and exports the singleton `authenticate`. Every admin-facing loader/action calls `authenticate.admin(request)` first; webhooks call `authenticate.webhook(request)`. The session storage adapter manages its own MongoDB connection separate from Mongoose — sessions live in the `shopify_sessions` collection.
2. `app/routes.js` simply re-exports `flatRoutes()` — file names in `app/routes/` map to URLs (`app._index.jsx` → `/app`, dotted segments are nesting).
3. `app/routes/app.jsx` is the embedded-app parent route: loads Polaris CSS, mounts `<AppProvider isEmbeddedApp>` with the `SHOPIFY_API_KEY`, renders the App Bridge `<NavMenu>`, and re-exports `boundary.error` / `boundary.headers` so Shopify's CSP and frame-ancestors headers reach the response. Every child route under `/app/*` therefore runs inside an authenticated, embedded App Bridge context.
4. `app/routes/app._index.jsx` is the entire feature: one Remix `loader` (fetches last 10 `EditHistory` rows via `listRecentEditsForShop` model) and one `action` that switches on `intent` (`"load"` or `"save"`). The UI uses **two `useFetcher`s** — one for load, one for save — so they don't interfere with each other's loading states or `data` shape.

### Product input → GraphQL dispatch

`app/utils/parseProductUrl.js` is the single source of truth for what users can paste (kept in shared `utils/` because both the editor route and the bulk parser import it). `parseProductInput` returns either `{ type: "handle", value }` or `{ type: "id", value }`, and the action dispatches accordingly:

- `type: "handle"` → `GET_PRODUCT_BY_HANDLE` (`productByHandle` query)
- `type: "id"` → `productGidFromId(value)` → `GET_PRODUCT_BY_ID` (`product(id:)` query)

Saves always go through `UPDATE_PRODUCT_SEO` (`productUpdate` with `{ input: { id, seo: { title, description } } }`). The action returns `userErrors` from Shopify untouched; `SeoEditor.fieldErrorsFromUserErrors` maps them onto the title/description fields by inspecting the `field` path array.

The `featuredImage*` form fields in the save action exist so the optimistic re-rendered product card keeps its thumbnail without an extra round-trip query — `productUpdate` only returns `seo`, not the full product, by design.

### Persistence

MongoDB (Mongoose ODM). Schemas live in [app/APIs/models/schemas.server.js](app/APIs/models/schemas.server.js):

- `EditHistory` — owned by this app. Written on every successful save by the single-product / single-collection action. Indexed on `(shop, editedAt)` and `(shop, resourceType, editedAt)` so the recent-edits loader can fetch the last 10 cheaply per resource type. Filtered by `resourceType` (`"product" | "collection"`) so the two single editors don't bleed into each other.
- `BulkJob` + `BulkJobRow` — bulk-update job state. `BulkJob.resourceType` discriminates products vs collections. `BulkJobRow.jobId` is the parent job's `_id` stringified (no Mongoose populate — string equality is cheaper).
- Session documents live in the `shopify_sessions` collection, owned by `@shopify/shopify-app-session-storage-mongodb`. Don't hand-edit; let the library write to it.

[app/APIs/db.server.js](app/APIs/db.server.js) caches the Mongoose connection on `globalThis.__mongoose` so HMR reloads share a single connection. The connect call fires at module load — Mongoose buffers queries until the connection resolves, so loaders see a "connection just works" experience.

**No transactions.** `createJobWithRows` does `BulkJob.create` → `BulkJobRow.insertMany` sequentially. Single-node MongoDB doesn't support multi-doc transactions; if the row insert fails, the parent stays in `pending` and the recovery sweep marks it failed within ~5 minutes. To get true atomicity you'd need a replica-set deployment + Mongoose sessions.

**ID handling.** Mongoose `_id` is an `ObjectId`. The model layer stringifies via virtuals so callers see a string `id` — this matches the contract from the Prisma days. Routes pass IDs through URLs as strings; the model layer's `isValidObjectId` guard short-circuits invalid IDs to `null` instead of throwing a `CastError`.

### Bulk SEO update subsystem

A second feature lives under `/app/bulk` and `/api/bulk/*`. It lets a merchant upload an `.xlsx` or `.csv` and update many products in one job. Key pieces:

- `app/APIs/utils/parseBulkFile.server.js` — `parseBulkBuffer(buffer)` reads the first sheet, normalizes column headers (case + variant tolerant), validates each row, and returns `{ rows, summary }`. Rejects oversize (>5 MB), too-many-rows (>1000), empty workbooks, and missing required columns. Server-only (`.server.js`) so `xlsx` doesn't get bundled to the client. Also detects Excel scientific-notation truncation of long numeric IDs.
- `app/APIs/services/bulkProcessor.server.js` — `processBulkJob(jobId, admin)` runs sequentially over `BulkJobRow` records via the model layer. Calls the same `productByHandle` / `product` / `productUpdate` GraphQL ops the single-product flow uses. Reads `extensions.cost.throttleStatus.currentlyAvailable` from each response and sleeps `(200 - currentlyAvailable) / restoreRate` seconds when below threshold (capped at 30 s). Distinguishes per-row failures (mark row `failed`, continue) from `BulkJobFatalError` (token revoked / scopes changed → abort whole job).
- `app/APIs/services/bulkRecovery.server.js` — `recoverStaleJobsForShop(shop)` runs opportunistically from the bulk page + progress page loaders. Flips jobs stuck in `processing` for >5 min with no row activity to `failed` so the UI doesn't hang forever after a server restart.
- `app/APIs/models/{bulkJob,bulkJobRow,editHistory}.server.js` — thin Mongoose wrappers. Routes and services should call these instead of touching `BulkJob.findOne(...)` etc. directly, so the data-access layer stays centralised.
- `app/routes/api.bulk.upload.jsx` — POST action. Pre-validates `Content-Length`. Without `confirm: true` it returns `{ phase: "preview", rows, summary }`. With `confirm: true` and zero error rows, it calls `createJobWithRows`, kicks off `setImmediate(() => processBulkJob(jobId, admin))` (intentionally **not** awaited — the HTTP response returns immediately), and returns `{ phase: "started", jobId }`.
- `app/routes/app.bulk.$jobId.jsx` — progress page polls `/api/bulk/status/:jobId?since=<iso>` every 1.5 s. Diff-mode polling: server returns only rows changed since `since`, client merges by id. Stops polling when `status` becomes `completed` / `failed`, and on 404 (job deleted).
- `app/routes/api.bulk.$jobId.errors[.csv].jsx` — bracket-escaped flat-routes filename so the URL `/api/bulk/:jobId/errors.csv` keeps the literal `.csv` segment. Cells are CSV-injection-neutralised (`=`/`+`/`-`/`@` prefixes are escaped with `'`).

Things to know if editing here:
- The processor receives the `admin` GraphQL client from `authenticate.admin(request)` in the upload action's request scope. The `setImmediate` continues running after the response returns, but only as long as the Node process stays alive — there is no job queue / worker. Restarting the dev server abandons running jobs; the recovery scan flips them to `failed` on the next page load so the UI doesn't hang. For production this would need a real queue.
- Bulk processing **does not** write to `EditHistory` — the recent-edits panel on the home page only reflects single-product saves. Don't add a bulk → EditHistory bridge unless asked.
- The status endpoint sets `Cache-Control: no-store`. Don't memoize / cache it; merchants will see stale progress.
- File limits live in `app/APIs/utils/parseBulkFile.server.js` (`MAX_BULK_ROWS`, `MAX_BULK_FILE_BYTES`) and are surfaced to the UI via the loader on `app.bulk.jsx` — change one, change both.
- Job state transitions go through the model layer's atomic `updateMany` guards (`claimJobForProcessing`, `failOpenJob`) so two processors can't race on the same rows.

### SEO validation is advisory

`utils/seoValidation.js` exposes `SEO_TITLE_MAX = 60` and `SEO_DESCRIPTION_MAX = 160`. These are only used to switch the counter tone to `caution` — saves are never blocked client-side based on length. Shopify itself enforces real limits and returns them as `userErrors`.

## Things to know before editing

- **Plain JS / JSX, no TypeScript.** Don't add `.ts` / `.tsx` files, type annotations, or `import type`. There is no `tsconfig.json`, no `typecheck` script, and no `typescript` dev dependency. If you find yourself wanting types, use a JSDoc `@type` comment.
- **API version is set in three places** and they currently disagree: `app/shopify.server.js` uses `ApiVersion.January25`, `.graphqlrc.js` uses `ApiVersion.July25` (codegen only, unused at runtime), and `shopify.app.toml` declares `api_version = "2026-07"` for webhooks. If you bump the Admin API version, update `shopify.server.js` (runtime) and `.graphqlrc.js` (codegen) together; the webhooks `api_version` is independent.
- **GraphQL queries are plain template strings** (`#graphql` tagged) under `app/graphql/`, not codegen-generated documents. The `@shopify/api-codegen-preset` is configured but not relied on.
- **Routing is file-system based via `flatRoutes()`**. Do not edit `app/routes.js` to add routes — add a file under `app/routes/`.
- **Future flag `v3_singleFetch: false`** in `vite.config.js` is intentional; the action returns plain objects (not `json()`) and the template hasn't been migrated to single-fetch.
- **Custom domains** require setting `SHOP_CUSTOM_DOMAIN`; `shopify.server.js` only adds `customShopDomains` when that env var is present.
- **MongoDB datasource** is read from `MONGODB_URI` + `MONGODB_DATABASE` env vars. For production, point them at a managed MongoDB (Atlas, etc.) — no schema migration is required, Mongoose creates indexes on first model use.
- **Workspaces include `extensions/*`** but the directory only has `.gitkeep`. If you scaffold a Shopify extension via `npm run generate`, it will land there as an npm workspace.
- **ESLint extends `@remix-run/eslint-config/jest-testing-library`** even though there is no Jest setup; this is leftover from the template and is harmless.
