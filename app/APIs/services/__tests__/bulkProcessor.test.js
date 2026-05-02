import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { processBulkJob } from "../bulkProcessor.server.js";
import {
  BulkJob,
  BulkJobRow,
} from "../../models/schemas.server.js";

const SHOP = "test-bulk-processor.myshopify.com";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const MONGODB_DATABASE =
  process.env.MONGODB_DATABASE || "seo_meta_editor_test";

let mongoReachable = false;
let skipReason = "";

function mockAdmin({ failingHandle = null, userErrorHandle = null } = {}) {
  const responses = [];
  const admin = {
    graphql: async (query, opts) => {
      responses.push({ query, opts });
      const variables = opts?.variables ?? {};

      if (query.includes("productByHandle")) {
        const handle = variables.handle;
        if (failingHandle && handle === failingHandle) {
          return jsonResponse({
            data: { productByHandle: null },
            extensions: makeExtensions(),
          });
        }
        return jsonResponse({
          data: {
            productByHandle: {
              id: `gid://shopify/Product/${handle.length}999`,
              title: `Title for ${handle}`,
              handle,
              featuredImage: null,
              seo: { title: null, description: null },
            },
          },
          extensions: makeExtensions(),
        });
      }

      if (query.includes("query GetProductById")) {
        const id = String(variables.id);
        return jsonResponse({
          data: {
            product: {
              id,
              title: `Title for ${id}`,
              handle: "by-id-handle",
              featuredImage: null,
              seo: { title: null, description: null },
            },
          },
          extensions: makeExtensions(),
        });
      }

      if (query.includes("productUpdate")) {
        const id = variables.input.id;
        if (userErrorHandle && id.includes(`${userErrorHandle.length}999`)) {
          return jsonResponse({
            data: {
              productUpdate: {
                product: null,
                userErrors: [
                  { field: ["input", "seo", "title"], message: "Bad title" },
                ],
              },
            },
            extensions: makeExtensions(),
          });
        }
        return jsonResponse({
          data: {
            productUpdate: {
              product: {
                id,
                seo: {
                  title: variables.input.seo.title,
                  description: variables.input.seo.description,
                },
              },
              userErrors: [],
            },
          },
          extensions: makeExtensions(),
        });
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    },
  };
  return { admin, responses };
}

function jsonResponse(payload) {
  return { json: async () => payload };
}

function makeExtensions() {
  return {
    cost: {
      throttleStatus: {
        currentlyAvailable: 1900,
        maximumAvailable: 2000,
        restoreRate: 100,
      },
    },
  };
}

async function seedJob(rows) {
  const job = await BulkJob.create({
    shop: SHOP,
    fileName: "test.xlsx",
    totalRows: rows.length,
    status: "pending",
  });
  const jobId = String(job._id);
  await BulkJobRow.insertMany(
    rows.map((r, i) => ({
      jobId,
      rowNumber: i + 2,
      productUrl: r.productUrl,
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
    })),
  );
  return { id: jobId };
}

async function fetchJobWithRows(jobId) {
  const job = await BulkJob.findById(jobId).lean();
  if (!job) return null;
  const rows = await BulkJobRow.find({ jobId })
    .sort({ rowNumber: 1 })
    .lean();
  return { ...job, rows };
}

async function cleanup() {
  const ids = (
    await BulkJob.find({ shop: SHOP }).select({ _id: 1 }).lean()
  ).map((j) => String(j._id));
  if (ids.length > 0) {
    await BulkJobRow.deleteMany({ jobId: { $in: ids } });
    await BulkJob.deleteMany({ shop: SHOP });
  }
}

describe("processBulkJob (3-row scenarios)", () => {
  before(async () => {
    try {
      await mongoose.connect(MONGODB_URI, {
        dbName: MONGODB_DATABASE,
        serverSelectionTimeoutMS: 2000,
      });
      mongoReachable = true;
      await cleanup();
    } catch (err) {
      mongoReachable = false;
      skipReason = `MongoDB unreachable at ${MONGODB_URI} (${err.message})`;
      console.warn(`[bulkProcessor.test] skipping suite — ${skipReason}`);
    }
  });

  after(async () => {
    if (mongoReachable) {
      await cleanup();
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it("processes 3 valid rows successfully", async () => {
    if (!mongoReachable) return; // suite-level skip when Mongo not running
    const job = await seedJob([
      {
        productUrl: "https://shop.myshopify.com/products/alpha",
        metaTitle: "Alpha",
        metaDescription: "First product",
      },
      {
        productUrl: "1234567890",
        metaTitle: "By Id",
        metaDescription: "Second product",
      },
      {
        productUrl: "https://shop.myshopify.com/products/gamma",
        metaTitle: "Gamma",
        metaDescription: "Third product",
      },
    ]);

    const { admin } = mockAdmin();
    await processBulkJob(job.id, admin);

    const finalJob = await fetchJobWithRows(job.id);
    assert.equal(finalJob.status, "completed");
    assert.equal(finalJob.successRows, 3);
    assert.equal(finalJob.failedRows, 0);
    assert.ok(finalJob.completedAt instanceof Date);
    for (const r of finalJob.rows) {
      assert.equal(r.status, "success");
      assert.ok(r.productId, "row should have productId set");
      assert.ok(r.productTitle, "row should have productTitle set");
      assert.equal(r.errorMessage, null);
    }
  });

  it("marks not-found and userError rows as failed, succeeds others", async () => {
    if (!mongoReachable) return;
    const job = await seedJob([
      {
        productUrl: "https://shop.myshopify.com/products/missing",
        metaTitle: "Missing",
        metaDescription: "404",
      },
      {
        productUrl: "https://shop.myshopify.com/products/userror",
        metaTitle: "x".repeat(500),
        metaDescription: "Triggers user error",
      },
      {
        productUrl: "https://shop.myshopify.com/products/ok",
        metaTitle: "OK",
        metaDescription: "Fine",
      },
    ]);

    const { admin } = mockAdmin({
      failingHandle: "missing",
      userErrorHandle: "userror",
    });
    await processBulkJob(job.id, admin);

    const finalJob = await fetchJobWithRows(job.id);
    assert.equal(finalJob.status, "completed");
    assert.equal(finalJob.successRows, 1);
    assert.equal(finalJob.failedRows, 2);

    const [r1, r2, r3] = finalJob.rows;
    assert.equal(r1.status, "failed");
    assert.match(r1.errorMessage, /not found/i);
    assert.equal(r2.status, "failed");
    assert.match(r2.errorMessage, /Bad title/);
    assert.equal(r3.status, "success");
  });

  it("recovers gracefully when admin throws mid-job", async () => {
    if (!mongoReachable) return;
    const job = await seedJob([
      {
        productUrl: "https://shop.myshopify.com/products/a",
        metaTitle: "A",
        metaDescription: "",
      },
      {
        productUrl: "https://shop.myshopify.com/products/b",
        metaTitle: "B",
        metaDescription: "",
      },
      {
        productUrl: "https://shop.myshopify.com/products/c",
        metaTitle: "C",
        metaDescription: "",
      },
    ]);

    let calls = 0;
    const admin = {
      graphql: async () => {
        calls += 1;
        if (calls > 2) throw new Error("network blip");
        return jsonResponse({
          data: {
            productByHandle: {
              id: "gid://shopify/Product/1",
              title: "T",
              handle: "h",
              featuredImage: null,
              seo: { title: null, description: null },
            },
          },
          extensions: makeExtensions(),
        });
      },
    };

    await processBulkJob(job.id, admin);

    const finalJob = await fetchJobWithRows(job.id);
    assert.ok(["completed", "failed"].includes(finalJob.status));
    for (const r of finalJob.rows) {
      assert.ok(["success", "failed"].includes(r.status));
    }
  });
});
