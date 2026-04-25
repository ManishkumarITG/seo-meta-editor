import { authenticate } from "../shopify.server";
import prisma from "../db.server.js";

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;

  const job = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    include: {
      rows: {
        where: { status: "failed" },
        orderBy: { rowNumber: "asc" },
      },
    },
  });

  if (!job || job.shop !== session.shop) {
    return new Response("Not found", { status: 404 });
  }

  const header = [
    "row_number",
    "product_url",
    "meta_title",
    "meta_description",
    "error_message",
  ];

  const lines = [header.join(",")];
  for (const row of job.rows) {
    lines.push(
      [
        row.rowNumber,
        row.productUrl,
        row.metaTitle,
        row.metaDescription,
        row.errorMessage ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  const body = lines.join("\r\n");
  const filename = `bulk-errors-${job.id}.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
