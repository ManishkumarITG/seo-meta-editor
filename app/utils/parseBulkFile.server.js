import * as XLSX from "xlsx";
import {
  ProductInputError,
  parseProductInput,
} from "./parseProductUrl.js";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "./seoValidation.js";

export const MAX_BULK_ROWS = 1000;
export const MAX_BULK_FILE_BYTES = 5 * 1024 * 1024;

const URL_KEYS = ["product_url", "product url", "url", "producturl"];
const TITLE_KEYS = [
  "meta_title",
  "meta title",
  "metatitle",
  "title",
  "seo_title",
  "seo title",
  "seotitle",
];
const DESCRIPTION_KEYS = [
  "meta_description",
  "meta description",
  "metadescription",
  "description",
  "seo_description",
  "seo description",
  "seodescription",
];

export class BulkFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "BulkFileError";
  }
}

function normalizeKey(key) {
  return String(key ?? "").trim().toLowerCase();
}

function pickField(row, candidates) {
  for (const key of Object.keys(row)) {
    if (candidates.includes(normalizeKey(key))) {
      const value = row[key];
      if (value === undefined || value === null) return "";
      return String(value).trim();
    }
  }
  return "";
}

function validateRow({ rowNumber, productUrl, metaTitle, metaDescription }) {
  const messages = [];
  let level = "valid";

  if (!productUrl) {
    messages.push("Missing product URL.");
    level = "error";
  } else {
    try {
      parseProductInput(productUrl);
    } catch (err) {
      messages.push(
        err instanceof ProductInputError
          ? err.message
          : "Could not parse product URL.",
      );
      level = "error";
    }
  }

  if (!metaTitle && !metaDescription) {
    messages.push(
      "Provide at least one of meta_title or meta_description.",
    );
    level = "error";
  }

  if (metaTitle.length > SEO_TITLE_MAX) {
    messages.push(
      `Title is ${metaTitle.length} chars (recommended ≤ ${SEO_TITLE_MAX}).`,
    );
    if (level !== "error") level = "warning";
  }
  if (metaDescription.length > SEO_DESCRIPTION_MAX) {
    messages.push(
      `Description is ${metaDescription.length} chars (recommended ≤ ${SEO_DESCRIPTION_MAX}).`,
    );
    if (level !== "error") level = "warning";
  }

  return { rowNumber, productUrl, metaTitle, metaDescription, validation: { level, messages } };
}

export function parseBulkBuffer(buffer, { fileName } = {}) {
  if (buffer.byteLength > MAX_BULK_FILE_BYTES) {
    throw new BulkFileError(
      `File is too large (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB). Maximum allowed is 5 MB.`,
    );
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    throw new BulkFileError(
      `Could not read file${fileName ? ` "${fileName}"` : ""}: ${err.message}`,
    );
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new BulkFileError("Workbook has no sheets.");
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (rawRows.length === 0) {
    throw new BulkFileError(
      "File is empty. Add rows under the header columns and re-upload.",
    );
  }

  const sample = rawRows[0];
  const sampleKeys = Object.keys(sample).map(normalizeKey);
  const hasUrl = sampleKeys.some((k) => URL_KEYS.includes(k));
  const hasTitle = sampleKeys.some((k) => TITLE_KEYS.includes(k));
  const hasDescription = sampleKeys.some((k) => DESCRIPTION_KEYS.includes(k));

  if (!hasUrl || (!hasTitle && !hasDescription)) {
    throw new BulkFileError(
      "Required columns not found. Expected at least product_url and one of meta_title / meta_description (case-insensitive).",
    );
  }

  if (rawRows.length > MAX_BULK_ROWS) {
    throw new BulkFileError(
      `File has ${rawRows.length} rows. Maximum is ${MAX_BULK_ROWS} — split the file and try again.`,
    );
  }

  const rows = rawRows.map((row, idx) =>
    validateRow({
      rowNumber: idx + 2, // +1 for 1-based, +1 for header row
      productUrl: pickField(row, URL_KEYS),
      metaTitle: pickField(row, TITLE_KEYS),
      metaDescription: pickField(row, DESCRIPTION_KEYS),
    }),
  );

  const duplicates = findDuplicateUrls(rows);
  if (duplicates.size > 0) {
    for (const row of rows) {
      if (duplicates.has(row.productUrl) && row.validation.level === "valid") {
        row.validation.level = "warning";
        row.validation.messages.push(
          "Duplicate product URL — last occurrence wins.",
        );
      } else if (
        duplicates.has(row.productUrl) &&
        !row.validation.messages.some((m) => m.startsWith("Duplicate"))
      ) {
        row.validation.messages.push(
          "Duplicate product URL — last occurrence wins.",
        );
      }
    }
  }

  const summary = summarize(rows);

  return { rows, summary };
}

function findDuplicateUrls(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (!row.productUrl) continue;
    seen.set(row.productUrl, (seen.get(row.productUrl) ?? 0) + 1);
  }
  const dupes = new Set();
  for (const [url, count] of seen) {
    if (count > 1) dupes.add(url);
  }
  return dupes;
}

function summarize(rows) {
  let valid = 0;
  let warning = 0;
  let error = 0;
  for (const row of rows) {
    if (row.validation.level === "valid") valid += 1;
    else if (row.validation.level === "warning") warning += 1;
    else error += 1;
  }
  return { total: rows.length, valid, warning, error };
}
