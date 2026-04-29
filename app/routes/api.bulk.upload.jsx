import { authenticate } from "../APIs/shopify.server.js";
import { createJobWithRows } from "../APIs/models/bulkJob.server.js";
import {
  BulkFileError,
  MAX_BULK_FILE_BYTES,
  parseBulkBuffer,
} from "../APIs/utils/parseBulkFile.server.js";
import { processBulkJob } from "../APIs/services/bulkProcessor.server.js";
import { normalizeResourceType } from "../APIs/services/resourceAdapter.server.js";

const MAX_FILENAME_LENGTH = 200;

function truncateFileName(name) {
  if (!name) return "upload";
  if (name.length <= MAX_FILENAME_LENGTH) return name;
  return `${name.slice(0, MAX_FILENAME_LENGTH - 1)}…`;
}

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Reject oversized bodies before buffering to memory.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 0 && contentLength > MAX_BULK_FILE_BYTES * 1.1) {
    // 10 % grace for multipart envelope overhead.
    return {
      phase: "error",
      message: `Upload too large (${(contentLength / 1024 / 1024).toFixed(2)} MB). Max ${(MAX_BULK_FILE_BYTES / 1024 / 1024).toFixed(0)} MB.`,
    };
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return {
      phase: "error",
      message: `Could not read upload: ${err.message}`,
    };
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { phase: "error", message: "No file received." };
  }

  const resourceType = normalizeResourceType(formData.get("resourceType"));
  const fileName = truncateFileName(file.name || "upload");
  let buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    return {
      phase: "error",
      message: `Could not read file bytes: ${err.message}`,
    };
  }

  let parsed;
  try {
    parsed = parseBulkBuffer(buffer, { fileName, resourceType });
  } catch (err) {
    if (err instanceof BulkFileError) {
      return { phase: "error", message: err.message };
    }
    return {
      phase: "error",
      message: `Unexpected error parsing file: ${err.message}`,
    };
  }

  const confirm = String(formData.get("confirm") ?? "") === "true";
  if (!confirm) {
    return {
      phase: "preview",
      fileName,
      rows: parsed.rows,
      summary: parsed.summary,
    };
  }

  if (parsed.summary.error > 0) {
    return {
      phase: "error",
      message: "Cannot start: file has errored rows. Fix and re-upload.",
    };
  }

  const job = await createJobWithRows({
    shop: session.shop,
    resourceType,
    fileName,
    rows: parsed.rows,
  });

  setImmediate(() => {
    processBulkJob(job.id, admin).catch((err) => {
      console.error(`[api.bulk.upload] processBulkJob ${job.id} threw:`, err);
    });
  });

  return { phase: "started", jobId: job.id };
};
