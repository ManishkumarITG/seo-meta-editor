import {
  failOpenJob,
  findOpenJobsForShopOlderThan,
} from "../models/bulkJob.server.js";
import {
  failOpenRowsForJob,
  findLastProcessedAtForJob,
} from "../models/bulkJobRow.server.js";

// A job that's been "processing" with no row updates for this long is
// considered abandoned (e.g. the dev server restarted, the prod pod recycled).
// We can't recover the in-flight work, but we can stop the progress UI from
// hanging on it forever.
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
// Don't clobber freshly-created jobs that genuinely haven't started yet.
const MIN_AGE_BEFORE_RECOVERY_MS = 60 * 1000; // 1 minute

export async function recoverStaleJobsForShop(shop, { resourceType } = {}) {
  const now = Date.now();
  const stalenessCutoff = new Date(now - STALE_THRESHOLD_MS);
  const minAgeCutoff = new Date(now - MIN_AGE_BEFORE_RECOVERY_MS);

  const candidates = await findOpenJobsForShopOlderThan({
    shop,
    resourceType,
    olderThan: minAgeCutoff,
  });

  if (candidates.length === 0) return { recovered: 0 };

  let recovered = 0;
  for (const job of candidates) {
    const lastRow = await findLastProcessedAtForJob(job.id);
    const lastActivity = lastRow?.processedAt ?? job.createdAt;
    if (lastActivity > stalenessCutoff) continue;

    const claimed = await failOpenJob(job.id);
    if (!claimed) continue;

    await failOpenRowsForJob(
      job.id,
      "Job appears to have stalled (server restart or worker crash). Re-upload the failed rows to retry.",
    );
    recovered += 1;
  }

  return { recovered };
}
