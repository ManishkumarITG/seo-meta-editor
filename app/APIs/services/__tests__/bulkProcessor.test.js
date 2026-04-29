import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { processBulkJob } from "../bulkProcessor.server.js";

const prisma = new PrismaClient();

const SHOP = "test-bulk-processor.myshopify.com";

function mockAdmin({ failingHandle = null, userErrorHandle = null } = {}) {
  const responses = [];
  const admin = {
    graphql: async (query, opts) => {
      responses.push({ query, opts });
      const variables = opts?.variables ?? {};

      // Lookup by handle
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

      // Lookup by ID
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

      // Update mutation
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
  return {
    json: async () => payload,
  };
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
  const job = await prisma.bulkJob.create({
    data: {
      shop: SHOP,
      fileName: "test.xlsx",
      totalRows: rows.length,
      status: "pending",
      rows: {
        create: rows.map((r, i) => ({
          rowNumber: i + 2,
          productUrl: r.productUrl,
          metaTitle: r.metaTitle,
          metaDescription: r.metaDescription,
        })),
      },
    },
    include: { rows: true },
  });
  return job;
}

async function cleanup() {
  await prisma.bulkJob.deleteMany({ where: { shop: SHOP } });
}

describe("processBulkJob (3-row scenarios)", () => {
  before(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("processes 3 valid rows successfully", async () => {
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

    const finalJob = await prisma.bulkJob.findUnique({
      where: { id: job.id },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });

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

    const finalJob = await prisma.bulkJob.findUnique({
      where: { id: job.id },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });

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

    const finalJob = await prisma.bulkJob.findUnique({
      where: { id: job.id },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });

    // Either the job completes with mixed statuses, or it falls into the
    // crash branch — both leave it in a terminal state with no rows still
    // pending/processing.
    assert.ok(["completed", "failed"].includes(finalJob.status));
    for (const r of finalJob.rows) {
      assert.ok(["success", "failed"].includes(r.status));
    }
  });
});
