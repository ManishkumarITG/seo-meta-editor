import { authenticate } from "../APIs/shopify.server.js";
import { findJobWithFailedRowsForShop } from "../APIs/models/bulkJob.server.js";

// Excel/Sheets treat cells starting with these characters as formulas, which
// is a CSV-injection vector when a merchant downloads and opens the report.
// Prefix the cell with a single quote so the value is rendered as text.
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function neutralizeFormula(str) {
  if (str.length === 0) return str;
  if (FORMULA_PREFIXES.includes(str[0])) {
    return `'${str}`;
  }
  return str;
}

function csvEscape(value) {
  if (value == null) return "";
  const str = neutralizeFormula(String(value));
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;

  const job = await findJobWithFailedRowsForShop({
    jobId,
    shop: session.shop,
  });

  if (!job) {
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
