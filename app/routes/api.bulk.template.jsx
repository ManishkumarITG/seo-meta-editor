import * as XLSX from "xlsx";
import { authenticate } from "../APIs/shopify.server.js";
import {
  getResourceAdapter,
  normalizeResourceType,
} from "../APIs/services/resourceAdapter.server.js";

const SAMPLE_ROWS_BY_TYPE = {
  product: [
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
  ],
  collection: [
    [
      "https://your-store.myshopify.com/collections/summer-sale",
      "Summer Sale — Up to 50% Off",
      "Shop our summer sale for unbeatable deals on top brands.",
    ],
    [
      "1234567890",
      "Loaded by numeric collection ID",
      "Use this format if you copy IDs out of the admin URL.",
    ],
    [
      "gid://shopify/Collection/9876543210",
      "Loaded by GID",
      "Both ID forms are accepted.",
    ],
  ],
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const resourceType = normalizeResourceType(url.searchParams.get("type"));
  const adapter = getResourceAdapter(resourceType);

  const sheet = XLSX.utils.aoa_to_sheet([
    [adapter.primaryUrlColumnHeader, "meta_title", "meta_description"],
    ...SAMPLE_ROWS_BY_TYPE[resourceType],
  ]);
  sheet["!cols"] = [{ wch: 60 }, { wch: 40 }, { wch: 60 }];

  // Force the URL column to text so Excel doesn't auto-convert long numeric
  // IDs to scientific notation when merchants paste their own data in.
  for (let r = 1; r <= 3; r += 1) {
    const ref = XLSX.utils.encode_cell({ r, c: 0 });
    if (sheet[ref]) {
      sheet[ref].t = "s";
      sheet[ref].z = "@";
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, `Bulk SEO ${adapter.label}s`);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bulk-seo-${adapter.label}-template.xlsx"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
};
