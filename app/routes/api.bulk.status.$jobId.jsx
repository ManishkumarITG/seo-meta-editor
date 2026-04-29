import { json } from "@remix-run/node";
import { authenticate } from "../APIs/shopify.server.js";
import { findJobMetaForShop } from "../APIs/models/bulkJob.server.js";
import {
  findRowsChangedSince,
  findRowsForJob,
  groupRowsByStatusForJob,
} from "../APIs/models/bulkJobRow.server.js";

const NO_STORE = { "Cache-Control": "no-store" };

function serializeRow(r) {
  return {
    id: r.id,
    rowNumber: r.rowNumber,
    productUrl: r.productUrl,
    metaTitle: r.metaTitle,
    metaDescription: r.metaDescription,
    productId: r.productId,
    productTitle: r.productTitle,
    status: r.status,
    errorMessage: r.errorMessage,
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
  };
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;

  // Cheap shop-ownership check before fetching all rows.
  const meta = await findJobMetaForShop({ jobId, shop: session.shop });

  if (!meta) {
    return json(
      { error: "Job not found." },
      { status: 404, headers: NO_STORE },
    );
  }

  // ?since=<iso> diff mode — only return rows that have moved into
  // processing/success/failed since the given timestamp. The progress UI
  // merges these into its existing row list, cutting payload from O(rows)
  // to O(rows-changed-since-last-poll).
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  let sinceDate = null;
  if (since) {
    const parsed = new Date(since);
    if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
  }
  const rows = sinceDate
    ? await findRowsChangedSince(jobId, sinceDate)
    : await findRowsForJob(jobId);

  // Counters always come from the full table so the UI summary stays
  // accurate even when the row list is a diff.
  const groups = await groupRowsByStatusForJob(jobId);
  const counters = { processed: 0, processing: 0, pending: 0 };
  for (const g of groups) {
    if (g.status === "success" || g.status === "failed") {
      counters.processed += g._count._all;
    } else if (g.status === "processing") {
      counters.processing += g._count._all;
    } else {
      counters.pending += g._count._all;
    }
  }

  return json(
    {
      job: {
        id: meta.id,
        shop: meta.shop,
        fileName: meta.fileName,
        totalRows: meta.totalRows,
        successRows: meta.successRows,
        failedRows: meta.failedRows,
        status: meta.status,
        createdAt: meta.createdAt.toISOString(),
        completedAt: meta.completedAt
          ? meta.completedAt.toISOString()
          : null,
        counters,
      },
      rows: rows.map(serializeRow),
      // Echoed back so the client can pass it as ?since on the next poll.
      // We use server time, not max(processedAt), so we never miss rows
      // whose processedAt is older than the most-recent update.
      serverTime: new Date().toISOString(),
      diff: Boolean(sinceDate),
    },
    { headers: NO_STORE },
  );
};
