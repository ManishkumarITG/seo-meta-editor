import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;

  const job = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    include: {
      rows: { orderBy: { rowNumber: "asc" } },
    },
  });

  if (!job || job.shop !== session.shop) {
    return json(
      { error: "Job not found." },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const processed = job.rows.filter(
    (r) => r.status === "success" || r.status === "failed",
  ).length;
  const processing = job.rows.filter((r) => r.status === "processing").length;
  const pending = job.rows.filter((r) => r.status === "pending").length;

  return json(
    {
      job: {
        id: job.id,
        shop: job.shop,
        fileName: job.fileName,
        totalRows: job.totalRows,
        successRows: job.successRows,
        failedRows: job.failedRows,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt
          ? job.completedAt.toISOString()
          : null,
        counters: { processed, processing, pending },
      },
      rows: job.rows.map((r) => ({
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
      })),
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
};
