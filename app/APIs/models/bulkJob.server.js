import {
  BulkJob,
  BulkJobRow,
  isValidObjectId,
} from "./schemas.server.js";

// Mongoose returns full hydrated docs by default. The route layer expects
// plain objects with an `id` string (not an `_id` ObjectId) — `.lean({
// virtuals: true })` gives us that without paying the hydration cost.
const LEAN = { virtuals: true };

function shape(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id ?? doc.id),
    shop: doc.shop,
    resourceType: doc.resourceType,
    fileName: doc.fileName,
    totalRows: doc.totalRows,
    successRows: doc.successRows,
    failedRows: doc.failedRows,
    status: doc.status,
    createdAt: doc.createdAt,
    completedAt: doc.completedAt,
  };
}

function shapeWithRows(doc) {
  if (!doc) return doc;
  return { ...shape(doc), rows: doc.rows ?? [] };
}

async function rowsForJob(jobId, where = {}) {
  // Mongoose 9's `.lean({ virtuals: true })` does NOT materialize the default
  // `id` virtual — only schema-declared virtuals are honored. So we shape each
  // row explicitly with `id: String(_id)` here. The progress page uses these
  // ids as React keys + IndexTable.Row ids; if they're undefined the table
  // breaks on first client-side render.
  const docs = await BulkJobRow.find({ jobId, ...where })
    .sort({ rowNumber: 1 })
    .lean();
  return docs.map((d) => ({
    id: String(d._id),
    jobId: d.jobId,
    rowNumber: d.rowNumber,
    productUrl: d.productUrl,
    metaTitle: d.metaTitle,
    metaDescription: d.metaDescription,
    productId: d.productId ?? null,
    productTitle: d.productTitle ?? null,
    status: d.status,
    errorMessage: d.errorMessage ?? null,
    processedAt: d.processedAt ?? null,
  }));
}

export async function createJobWithRows({
  shop,
  resourceType = "product",
  fileName,
  rows,
}) {
  // Single-node MongoDB doesn't support multi-doc transactions, so we
  // create the parent first then bulk-insert the rows. If the row insert
  // fails, the parent stays in `pending` and the recovery sweep will mark
  // it failed within ~5 minutes. See plan + CLAUDE.md.
  const job = await BulkJob.create({
    shop,
    resourceType,
    fileName,
    totalRows: rows.length,
    status: "pending",
  });

  if (rows.length > 0) {
    const jobId = String(job._id);
    await BulkJobRow.insertMany(
      rows.map((r) => ({
        jobId,
        rowNumber: r.rowNumber,
        productUrl: r.productUrl,
        metaTitle: r.metaTitle,
        metaDescription: r.metaDescription,
      })),
    );
  }

  return shape(job.toObject({ virtuals: true }));
}

export async function findJobMetaForShop({ jobId, shop, resourceType }) {
  if (!isValidObjectId(jobId)) return null;
  const doc = await BulkJob.findOne({
    _id: jobId,
    shop,
    ...(resourceType ? { resourceType } : {}),
  }).lean(LEAN);
  return shape(doc);
}

export async function findJobWithRowsForShop({ jobId, shop, resourceType }) {
  if (!isValidObjectId(jobId)) return null;
  const job = await BulkJob.findOne({
    _id: jobId,
    shop,
    ...(resourceType ? { resourceType } : {}),
  }).lean(LEAN);
  if (!job) return null;
  const rows = await rowsForJob(String(job._id));
  return shapeWithRows({ ...job, rows });
}

export async function findJobWithFailedRowsForShop({
  jobId,
  shop,
  resourceType,
}) {
  if (!isValidObjectId(jobId)) return null;
  const job = await BulkJob.findOne({
    _id: jobId,
    shop,
    ...(resourceType ? { resourceType } : {}),
  }).lean(LEAN);
  if (!job) return null;
  const rows = await rowsForJob(String(job._id), { status: "failed" });
  return shapeWithRows({ ...job, rows });
}

export async function listRecentJobsForShop({ shop, resourceType, limit }) {
  const docs = await BulkJob.find({
    shop,
    ...(resourceType ? { resourceType } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean(LEAN);
  return docs.map(shape);
}

// Atomic claim — single update flips pending → processing. Returns the doc
// if we won the race, null otherwise. `findOneAndUpdate` is the Mongo-native
// equivalent of Prisma's conditional `updateMany` we used to use here.
export async function claimJobForProcessing(jobId) {
  if (!isValidObjectId(jobId)) return null;
  const doc = await BulkJob.findOneAndUpdate(
    { _id: jobId, status: "pending" },
    { $set: { status: "processing" } },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function findJobById(jobId) {
  if (!isValidObjectId(jobId)) return null;
  const doc = await BulkJob.findById(jobId).lean(LEAN);
  return shape(doc);
}

export async function markJobCompleted(jobId) {
  if (!isValidObjectId(jobId)) return null;
  const doc = await BulkJob.findByIdAndUpdate(
    jobId,
    { $set: { status: "completed", completedAt: new Date() } },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function markJobFailed(jobId) {
  if (!isValidObjectId(jobId)) return null;
  const doc = await BulkJob.findByIdAndUpdate(
    jobId,
    { $set: { status: "failed", completedAt: new Date() } },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function updateJobCounters(jobId, { successRows, failedRows }) {
  if (!isValidObjectId(jobId)) return null;
  const doc = await BulkJob.findByIdAndUpdate(
    jobId,
    { $set: { successRows, failedRows } },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function findOpenJobsForShopOlderThan({
  shop,
  resourceType,
  olderThan,
}) {
  const docs = await BulkJob.find({
    shop,
    ...(resourceType ? { resourceType } : {}),
    status: { $in: ["pending", "processing"] },
    createdAt: { $lt: olderThan },
  })
    .select({ _id: 1, createdAt: 1 })
    .lean(LEAN);
  return docs.map((d) => ({ id: String(d._id), createdAt: d.createdAt }));
}

export async function failOpenJob(jobId) {
  if (!isValidObjectId(jobId)) return false;
  const result = await BulkJob.updateOne(
    { _id: jobId, status: { $in: ["pending", "processing"] } },
    { $set: { status: "failed", completedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}
