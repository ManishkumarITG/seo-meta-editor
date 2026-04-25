import * as XLSX from "xlsx";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const sheet = XLSX.utils.aoa_to_sheet([
    ["product_url", "meta_title", "meta_description"],
    [
      "https://your-store.myshopify.com/products/cool-shirt",
      "Cool Shirt — Premium Cotton Tee",
      "Soft cotton tee in five colors. Free shipping over $50.",
    ],
    [
      "1234567890",
      "Loaded by numeric product ID",
      "Use this format if you copy IDs out of the admin URL.",
    ],
    [
      "gid://shopify/Product/9876543210",
      "Loaded by GID",
      "Both ID forms are accepted.",
    ],
  ]);
  sheet["!cols"] = [{ wch: 60 }, { wch: 40 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Bulk SEO");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="bulk-seo-template.xlsx"',
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
};
