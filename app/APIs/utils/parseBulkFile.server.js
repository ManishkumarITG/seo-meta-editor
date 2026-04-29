import * as XLSX from "xlsx";
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from "../../utils/seoValidation.js";
import { getResourceAdapter } from "../services/resourceAdapter.server.js";

export const MAX_BULK_ROWS = 1000;
export const MAX_BULK_FILE_BYTES = 5 * 1024 * 1024;
// Hard ceiling on cell count to defuse zip-bomb / shared-string DoS attempts.
// 1000 rows × 30 columns is well above any legitimate input.
const MAX_CELLS = 30_000;
// Strings that look like Excel scientific-notation truncation of a numeric ID.
// Excel auto-converts numbers > 15 digits, silently corrupting Shopify product IDs.
const SCIENTIFIC_NOTATION = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

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

function validateRow(
  { rowNumber, productUrl, metaTitle, metaDescription },
  adapter,
) {
  const messages = [];
  let level = "valid";

  if (!productUrl) {
    messages.push(`Missing ${adapter.label} URL.`);
    level = "error";
  } else if (SCIENTIFIC_NOTATION.test(productUrl)) {
    messages.push(
      `Excel converted this ${adapter.label} ID to scientific notation. Format the ${adapter.primaryUrlColumnHeader} column as Text in your spreadsheet and re-export.`,
    );
    level = "error";
  } else {
    try {
      adapter.parseInput(productUrl);
    } catch (err) {
      messages.push(
        err instanceof adapter.InputError
          ? err.message
          : `Could not parse ${adapter.label} URL.`,
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

export function parseBulkBuffer(
  buffer,
  { fileName, resourceType = "product" } = {},
) {
  const adapter = getResourceAdapter(resourceType);
  const URL_KEYS = adapter.urlColumnKeys;

  if (buffer.byteLength > MAX_BULK_FILE_BYTES) {
    throw new BulkFileError(
      `File is too large (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB). Maximum allowed is 5 MB.`,
    );
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      // Skip work we don't need — saves CPU/memory and shrinks the DoS surface.
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellNF: false,
      cellDates: false,
      bookFiles: false,
      bookProps: false,
      bookSheets: false,
      bookVBA: false,
    });
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

  // Reject sheets whose declared range is absurdly large before we materialize
  // the cells — protects against crafted xlsx files with sparse but huge !ref.
  const ref = sheet["!ref"];
  if (ref) {
    try {
      const range = XLSX.utils.decode_range(ref);
      const cols = range.e.c - range.s.c + 1;
      const rows = range.e.r - range.s.r + 1;
      if (cols * rows > MAX_CELLS) {
        throw new BulkFileError(
          `Sheet has ${rows.toLocaleString()} rows × ${cols} columns — too large to process. Trim the sheet to its data range and re-upload.`,
        );
      }
    } catch (err) {
      if (err instanceof BulkFileError) throw err;
      // decode_range failure: fall through and let sheet_to_json error normally.
    }
  }

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
      `Required columns not found. Expected at least ${adapter.primaryUrlColumnHeader} and one of meta_title / meta_description (case-insensitive).`,
    );
  }

  if (rawRows.length > MAX_BULK_ROWS) {
    throw new BulkFileError(
      `File has ${rawRows.length} rows. Maximum is ${MAX_BULK_ROWS} — split the file and try again.`,
    );
  }

  const rows = rawRows.map((row, idx) =>
    validateRow(
      {
        rowNumber: idx + 2, // +1 for 1-based, +1 for header row
        productUrl: pickField(row, URL_KEYS),
        metaTitle: pickField(row, TITLE_KEYS),
        metaDescription: pickField(row, DESCRIPTION_KEYS),
      },
      adapter,
    ),
  );

  const duplicates = findDuplicateUrls(rows);
  if (duplicates.size > 0) {
    for (const row of rows) {
      if (duplicates.has(row.productUrl) && row.validation.level === "valid") {
        row.validation.level = "warning";
        row.validation.messages.push(
          `Duplicate ${adapter.label} URL — last occurrence wins.`,
        );
      } else if (
        duplicates.has(row.productUrl) &&
        !row.validation.messages.some((m) => m.startsWith("Duplicate"))
      ) {
        row.validation.messages.push(
          `Duplicate ${adapter.label} URL — last occurrence wins.`,
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
