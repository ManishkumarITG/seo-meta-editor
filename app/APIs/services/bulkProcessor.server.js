import {
  claimJobForProcessing,
  markJobCompleted,
  markJobFailed,
  updateJobCounters,
} from "../models/bulkJob.server.js";
import {
  failOpenRowsForJob,
  findPendingRowsForJob,
  markRowFailed,
  markRowProcessing,
  markRowSuccess,
} from "../models/bulkJobRow.server.js";
import { getResourceAdapter } from "./resourceAdapter.server.js";

const MIN_AVAILABLE_COST = 200;
const MAX_THROTTLE_WAIT_MS = 30_000;
const FATAL_AUTH_CODES = new Set([
  "ACCESS_DENIED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "SHOP_INACTIVE",
]);
const FATAL_AUTH_PATTERN =
  /\b(unauthori[sz]ed|access\s*denied|forbidden|invalid\s*api\s*key|shop\s*is\s*inactive|401|403)\b/i;

// Thrown when the job can no longer make progress (e.g. token revoked).
// Caught by processBulkJob's outer try/catch, which marks the whole job failed.
export class BulkJobFatalError extends Error {
  constructor(message) {
    super(message);
    this.name = "BulkJobFatalError";
  }
}

function isFatalGraphqlError(graphqlErrors) {
  if (!Array.isArray(graphqlErrors) || graphqlErrors.length === 0) return false;
  return graphqlErrors.some((e) => {
    const code = e?.extensions?.code;
    if (typeof code === "string" && FATAL_AUTH_CODES.has(code.toUpperCase())) {
      return true;
    }
    return typeof e?.message === "string" && FATAL_AUTH_PATTERN.test(e.message);
  });
}

function summarizeGraphqlErrors(graphqlErrors) {
  if (!Array.isArray(graphqlErrors) || graphqlErrors.length === 0) {
    return "Shopify returned an error.";
  }
  return graphqlErrors
    .map((e) => e?.message ?? "unknown error")
    .slice(0, 3)
    .join("; ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspectGraphqlResponse(json) {
  const errors = json?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    if (isFatalGraphqlError(errors)) {
      throw new BulkJobFatalError(
        `Shopify rejected the request: ${summarizeGraphqlErrors(errors)}. Job aborted — the access token may have been revoked or scopes changed.`,
      );
    }
    throw new Error(summarizeGraphqlErrors(errors));
  }
}

async function lookupResource(adapter, admin, resourceUrl) {
  const parsed = adapter.parseInput(resourceUrl);
  if (parsed.type === "handle") {
    const response = await admin.graphql(adapter.getByHandleQuery, {
      variables: { handle: parsed.value },
    });
    const json = await response.json();
    inspectGraphqlResponse(json);
    return { resource: json.data?.[adapter.byHandleDataKey] ?? null, json };
  }
  const response = await admin.graphql(adapter.getByIdQuery, {
    variables: { id: adapter.gidFromId(parsed.value) },
  });
  const json = await response.json();
  inspectGraphqlResponse(json);
  return { resource: json.data?.[adapter.byIdDataKey] ?? null, json };
}

async function updateSeo(
  adapter,
  admin,
  { resourceId, metaTitle, metaDescription },
) {
  const response = await admin.graphql(adapter.updateMutation, {
    variables: {
      input: {
        id: resourceId,
        seo: { title: metaTitle, description: metaDescription },
      },
    },
  });
  const json = await response.json();
  inspectGraphqlResponse(json);
  return {
    userErrors: json.data?.[adapter.mutationDataKey]?.userErrors ?? [],
    json,
  };
}

async function throttleIfNeeded(json) {
  const status = json?.extensions?.cost?.throttleStatus;
  if (!status) return;
  const { currentlyAvailable, restoreRate } = status;
  if (
    typeof currentlyAvailable === "number" &&
    typeof restoreRate === "number" &&
    restoreRate > 0 &&
    currentlyAvailable < MIN_AVAILABLE_COST
  ) {
    const computed = Math.ceil(
      ((MIN_AVAILABLE_COST - currentlyAvailable) / restoreRate) * 1000,
    );
    const waitMs = Math.max(0, Math.min(computed, MAX_THROTTLE_WAIT_MS));
    await sleep(waitMs);
  }
}

async function processRow(adapter, admin, row) {
  await markRowProcessing(row.id);

  try {
    const { resource, json: lookupJson } = await lookupResource(
      adapter,
      admin,
      row.productUrl,
    );
    await throttleIfNeeded(lookupJson);

    if (!resource) {
      await markRowFailed(row.id, {
        errorMessage: `${capitalize(adapter.label)} not found in this store.`,
      });
      return { ok: false };
    }

    const { userErrors, json: updateJson } = await updateSeo(adapter, admin, {
      resourceId: resource.id,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
    });
    await throttleIfNeeded(updateJson);

    if (userErrors.length > 0) {
      await markRowFailed(row.id, {
        productId: resource.id,
        productTitle: resource.title,
        errorMessage: userErrors.map((e) => e.message).join("; "),
      });
      return { ok: false };
    }

    await markRowSuccess(row.id, {
      productId: resource.id,
      productTitle: resource.title,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof BulkJobFatalError) {
      await markRowFailed(row.id, { errorMessage: err.message });
      throw err;
    }
    if (err instanceof adapter.InputError) {
      await markRowFailed(row.id, { errorMessage: err.message });
      return { ok: false };
    }
    const message =
      err instanceof Error ? err.message : "Unknown error.";
    await markRowFailed(row.id, { errorMessage: message });
    return { ok: false };
  }
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export async function processBulkJob(jobId, admin) {
  try {
    const job = await claimJobForProcessing(jobId);
    if (!job) {
      console.warn(`[bulkProcessor] job ${jobId} not claimable`);
      return;
    }

    const adapter = getResourceAdapter(job.resourceType);
    const rows = await findPendingRowsForJob(jobId);

    let success = 0;
    let failed = 0;

    for (const row of rows) {
      const result = await processRow(adapter, admin, row);
      if (result.ok) success += 1;
      else failed += 1;

      await updateJobCounters(jobId, {
        successRows: success,
        failedRows: failed,
      });
    }

    await markJobCompleted(jobId);
  } catch (err) {
    const isFatal = err instanceof BulkJobFatalError;
    if (isFatal) {
      console.warn(`[bulkProcessor] job ${jobId} aborted: ${err.message}`);
    } else {
      console.error(`[bulkProcessor] job ${jobId} crashed:`, err);
    }
    try {
      await markJobFailed(jobId);
      await failOpenRowsForJob(
        jobId,
        isFatal
          ? `Job aborted: ${err.message}`
          : "Connection lost during processing.",
      );
    } catch (cleanupErr) {
      console.error(
        `[bulkProcessor] cleanup failed for job ${jobId}:`,
        cleanupErr,
      );
    }
  }
}
