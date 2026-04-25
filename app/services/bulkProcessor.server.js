import prisma from "../db.server.js";
import {
  GET_PRODUCT_BY_HANDLE,
  GET_PRODUCT_BY_ID,
} from "../graphql/getProduct.js";
import { UPDATE_PRODUCT_SEO } from "../graphql/updateProductSeo.js";
import {
  ProductInputError,
  parseProductInput,
  productGidFromId,
} from "../utils/parseProductUrl.js";

const MIN_AVAILABLE_COST = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookupProduct(admin, productUrl) {
  const parsed = parseProductInput(productUrl);
  if (parsed.type === "handle") {
    const response = await admin.graphql(GET_PRODUCT_BY_HANDLE, {
      variables: { handle: parsed.value },
    });
    const json = await response.json();
    return { product: json.data?.productByHandle ?? null, json };
  }
  const response = await admin.graphql(GET_PRODUCT_BY_ID, {
    variables: { id: productGidFromId(parsed.value) },
  });
  const json = await response.json();
  return { product: json.data?.product ?? null, json };
}

async function updateSeo(admin, { productId, metaTitle, metaDescription }) {
  const response = await admin.graphql(UPDATE_PRODUCT_SEO, {
    variables: {
      input: {
        id: productId,
        seo: { title: metaTitle, description: metaDescription },
      },
    },
  });
  const json = await response.json();
  return {
    userErrors: json.data?.productUpdate?.userErrors ?? [],
    json,
  };
}

async function throttleIfNeeded(json) {
  const status = json?.extensions?.cost?.throttleStatus;
  if (!status) return;
  const { currentlyAvailable, restoreRate } = status;
  if (
    typeof currentlyAvailable === "number" &&
    typeof restoreRate === "number" &&
    restoreRate > 0 &&
    currentlyAvailable < MIN_AVAILABLE_COST
  ) {
    const waitMs = Math.ceil(
      ((MIN_AVAILABLE_COST - currentlyAvailable) / restoreRate) * 1000,
    );
    await sleep(waitMs);
  }
}

async function processRow(admin, row) {
  await prisma.bulkJobRow.update({
    where: { id: row.id },
    data: { status: "processing" },
  });

  try {
    const { product, json: lookupJson } = await lookupProduct(
      admin,
      row.productUrl,
    );
    await throttleIfNeeded(lookupJson);

    if (!product) {
      await prisma.bulkJobRow.update({
        where: { id: row.id },
        data: {
          status: "failed",
          errorMessage: "Product not found in this store.",
          processedAt: new Date(),
        },
      });
      return { ok: false };
    }

    const { userErrors, json: updateJson } = await updateSeo(admin, {
      productId: product.id,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
    });
    await throttleIfNeeded(updateJson);

    if (userErrors.length > 0) {
      await prisma.bulkJobRow.update({
        where: { id: row.id },
        data: {
          status: "failed",
          productId: product.id,
          productTitle: product.title,
          errorMessage: userErrors.map((e) => e.message).join("; "),
          processedAt: new Date(),
        },
      });
      return { ok: false };
    }

    await prisma.bulkJobRow.update({
      where: { id: row.id },
      data: {
        status: "success",
        productId: product.id,
        productTitle: product.title,
        errorMessage: null,
        processedAt: new Date(),
      },
    });
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof ProductInputError
        ? err.message
        : err instanceof Error
        ? err.message
        : "Unknown error.";
    await prisma.bulkJobRow.update({
      where: { id: row.id },
      data: {
        status: "failed",
        errorMessage: message,
        processedAt: new Date(),
      },
    });
    return { ok: false };
  }
}

export async function processBulkJob(jobId, admin) {
  let job;
  try {
    job = await prisma.bulkJob.findUnique({ where: { id: jobId } });
    if (!job) {
      console.warn(`[bulkProcessor] job ${jobId} not found`);
      return;
    }
    await prisma.bulkJob.update({
      where: { id: jobId },
      data: { status: "processing" },
    });

    const rows = await prisma.bulkJobRow.findMany({
      where: { jobId, status: "pending" },
      orderBy: { rowNumber: "asc" },
    });

    let success = 0;
    let failed = 0;

    for (const row of rows) {
      const result = await processRow(admin, row);
      if (result.ok) success += 1;
      else failed += 1;

      await prisma.bulkJob.update({
        where: { id: jobId },
        data: { successRows: success, failedRows: failed },
      });
    }

    await prisma.bulkJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[bulkProcessor] job ${jobId} crashed:`, err);
    try {
      await prisma.bulkJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          completedAt: new Date(),
        },
      });
      // Anything still in "processing" is now stuck — mark them failed.
      await prisma.bulkJobRow.updateMany({
        where: { jobId, status: { in: ["pending", "processing"] } },
        data: {
          status: "failed",
          errorMessage: "Connection lost during processing.",
          processedAt: new Date(),
        },
      });
    } catch (cleanupErr) {
      console.error(
        `[bulkProcessor] cleanup failed for job ${jobId}:`,
        cleanupErr,
      );
    }
  }
}
