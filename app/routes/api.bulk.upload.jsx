import { authenticate } from "../shopify.server";
import prisma from "../db.server.js";
import {
  BulkFileError,
  parseBulkBuffer,
} from "../utils/parseBulkFile.server.js";
import { processBulkJob } from "../services/bulkProcessor.server.js";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

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

  const fileName = file.name || "upload";
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
    parsed = parseBulkBuffer(buffer, { fileName });
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

  const job = await prisma.$transaction(async (tx) => {
    return tx.bulkJob.create({
      data: {
        shop: session.shop,
        fileName,
        totalRows: parsed.rows.length,
        status: "pending",
        rows: {
          create: parsed.rows.map((r) => ({
            rowNumber: r.rowNumber,
            productUrl: r.productUrl,
            metaTitle: r.metaTitle,
            metaDescription: r.metaDescription,
          })),
        },
      },
    });
  });

  setImmediate(() => {
    processBulkJob(job.id, admin).catch((err) => {
      console.error(`[api.bulk.upload] processBulkJob ${job.id} threw:`, err);
    });
  });

  return { phase: "started", jobId: job.id };
};
