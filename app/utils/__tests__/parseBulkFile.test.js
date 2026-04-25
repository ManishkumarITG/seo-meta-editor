import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  BulkFileError,
  parseBulkBuffer,
} from "../parseBulkFile.server.js";

function makeWorkbookBuffer(rows, { headers } = {}) {
  const sheet = XLSX.utils.aoa_to_sheet([
    headers ?? ["product_url", "meta_title", "meta_description"],
    ...rows,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function makeCsvBuffer(rows, { headers } = {}) {
  const lines = [
    (headers ?? ["product_url", "meta_title", "meta_description"]).join(","),
    ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")),
  ];
  return Buffer.from(lines.join("\n"), "utf8");
}

describe("parseBulkBuffer (xlsx)", () => {
  it("parses a valid 3-row workbook", () => {
    const buf = makeWorkbookBuffer([
      ["https://shop.myshopify.com/products/cool-shirt", "Cool Shirt SEO", "A cool shirt"],
      ["1234567890", "By ID", "Loaded by id"],
      ["gid://shopify/Product/9876543210", "GID Title", "GID desc"],
    ]);
    const { rows, summary } = parseBulkBuffer(buf, { fileName: "test.xlsx" });
    assert.equal(rows.length, 3);
    assert.equal(summary.total, 3);
    assert.equal(summary.valid, 3);
    assert.equal(summary.error, 0);
    assert.equal(rows[0].productUrl, "https://shop.myshopify.com/products/cool-shirt");
    assert.equal(rows[0].rowNumber, 2);
  });

  it("accepts variant column header casing", () => {
    const buf = makeWorkbookBuffer(
      [["https://shop.myshopify.com/products/x", "T", "D"]],
      { headers: ["Product URL", "SEO Title", "SEO Description"] },
    );
    const { rows } = parseBulkBuffer(buf);
    assert.equal(rows[0].productUrl, "https://shop.myshopify.com/products/x");
    assert.equal(rows[0].metaTitle, "T");
    assert.equal(rows[0].metaDescription, "D");
  });

  it("flags missing URL as error", () => {
    const buf = makeWorkbookBuffer([["", "Title", "Desc"]]);
    const { rows, summary } = parseBulkBuffer(buf);
    assert.equal(rows[0].validation.level, "error");
    assert.equal(summary.error, 1);
  });

  it("flags missing both title and description as error", () => {
    const buf = makeWorkbookBuffer([["1234567890", "", ""]]);
    const { rows } = parseBulkBuffer(buf);
    assert.equal(rows[0].validation.level, "error");
    assert.match(
      rows[0].validation.messages.join(" "),
      /at least one of meta_title or meta_description/i,
    );
  });

  it("flags over-length title/description as warning", () => {
    const longTitle = "x".repeat(80);
    const longDesc = "y".repeat(200);
    const buf = makeWorkbookBuffer([["1234567890", longTitle, longDesc]]);
    const { rows, summary } = parseBulkBuffer(buf);
    assert.equal(rows[0].validation.level, "warning");
    assert.equal(summary.warning, 1);
    assert.equal(summary.error, 0);
  });

  it("flags duplicate product URLs with a warning", () => {
    const buf = makeWorkbookBuffer([
      ["1234567890", "First", ""],
      ["1234567890", "Second", ""],
    ]);
    const { rows } = parseBulkBuffer(buf);
    assert.ok(
      rows.every((r) =>
        r.validation.messages.some((m) => /Duplicate/i.test(m)),
      ),
    );
  });

  it("rejects empty workbook", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["product_url", "meta_title", "meta_description"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    assert.throws(() => parseBulkBuffer(buf), BulkFileError);
  });

  it("rejects file with wrong columns", () => {
    const buf = makeWorkbookBuffer(
      [["a", "b", "c"]],
      { headers: ["foo", "bar", "baz"] },
    );
    assert.throws(() => parseBulkBuffer(buf), BulkFileError);
  });

  it("rejects file over 1000 rows", () => {
    const rows = Array.from({ length: 1001 }, (_, i) => [
      `${1000000 + i}`,
      `T${i}`,
      `D${i}`,
    ]);
    const buf = makeWorkbookBuffer(rows);
    assert.throws(() => parseBulkBuffer(buf), /Maximum is 1000/);
  });
});

describe("parseBulkBuffer (csv)", () => {
  it("parses a CSV with the same shape", () => {
    const buf = makeCsvBuffer([
      ["https://shop.myshopify.com/products/abc", "Title A", "Desc A"],
      ["https://shop.myshopify.com/products/def", "Title B", "Desc B"],
    ]);
    const { rows, summary } = parseBulkBuffer(buf, { fileName: "test.csv" });
    assert.equal(rows.length, 2);
    assert.equal(summary.valid, 2);
  });
});
