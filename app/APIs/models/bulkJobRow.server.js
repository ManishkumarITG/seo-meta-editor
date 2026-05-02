import { BulkJobRow, isValidObjectId } from "./schemas.server.js";

const LEAN = { virtuals: true };

function shape(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id ?? doc.id),
    jobId: doc.jobId,
    rowNumber: doc.rowNumber,
    productUrl: doc.productUrl,
    metaTitle: doc.metaTitle,
    metaDescription: doc.metaDescription,
    productId: doc.productId ?? null,
    productTitle: doc.productTitle ?? null,
    status: doc.status,
    errorMessage: doc.errorMessage ?? null,
    processedAt: doc.processedAt ?? null,
  };
}

function shapeMany(docs) {
  return docs.map(shape);
}

export async function findPendingRowsForJob(jobId) {
  const docs = await BulkJobRow.find({ jobId, status: "pending" })
    .sort({ rowNumber: 1 })
    .lean(LEAN);
  return shapeMany(docs);
}

export async function markRowProcessing(rowId) {
  if (!isValidObjectId(rowId)) return null;
  const doc = await BulkJobRow.findByIdAndUpdate(
    rowId,
    { $set: { status: "processing" } },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function markRowSuccess(rowId, { productId, productTitle }) {
  if (!isValidObjectId(rowId)) return null;
  const doc = await BulkJobRow.findByIdAndUpdate(
    rowId,
    {
      $set: {
        status: "success",
        productId,
        productTitle,
        errorMessage: null,
        processedAt: new Date(),
      },
    },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function markRowFailed(
  rowId,
  { errorMessage, productId, productTitle } = {},
) {
  if (!isValidObjectId(rowId)) return null;
  const set = {
    status: "failed",
    errorMessage: errorMessage ?? null,
    processedAt: new Date(),
  };
  if (productId !== undefined) set.productId = productId;
  if (productTitle !== undefined) set.productTitle = productTitle;
  const doc = await BulkJobRow.findByIdAndUpdate(
    rowId,
    { $set: set },
    { new: true, lean: true },
  );
  return shape(doc);
}

export async function failOpenRowsForJob(jobId, errorMessage) {
  const result = await BulkJobRow.updateMany(
    { jobId, status: { $in: ["pending", "processing"] } },
    {
      $set: {
        status: "failed",
        errorMessage,
        processedAt: new Date(),
      },
    },
  );
  return { count: result.modifiedCount };
}

export async function findRowsForJob(jobId) {
  const docs = await BulkJobRow.find({ jobId })
    .sort({ rowNumber: 1 })
    .lean(LEAN);
  return shapeMany(docs);
}

export async function findFailedRowsForJob(jobId) {
  const docs = await BulkJobRow.find({ jobId, status: "failed" })
    .sort({ rowNumber: 1 })
    .lean(LEAN);
  return shapeMany(docs);
}

// Diff query for the polling endpoint — returns rows whose processedAt is
// after the cutoff OR are currently in flight.
export async function findRowsChangedSince(jobId, sinceDate) {
  const docs = await BulkJobRow.find({
    jobId,
    $or: [
      { processedAt: { $gt: sinceDate } },
      { status: "processing" },
    ],
  })
    .sort({ rowNumber: 1 })
    .lean(LEAN);
  return shapeMany(docs);
}

// Aggregation equivalent of Prisma's groupBy. Reshape to the same envelope
// the status route already consumes ({ status, _count: { _all } }) so the
// route doesn't need to change.
export async function groupRowsByStatusForJob(jobId) {
  const groups = await BulkJobRow.aggregate([
    { $match: { jobId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return groups.map((g) => ({ status: g._id, _count: { _all: g.count } }));
}

export async function findLastProcessedAtForJob(jobId) {
  const doc = await BulkJobRow.findOne({
    jobId,
    processedAt: { $ne: null },
  })
    .sort({ processedAt: -1 })
    .select({ processedAt: 1 })
    .lean(LEAN);
  return doc ? { processedAt: doc.processedAt } : null;
}

// Lightweight preview for the dashboard recent-jobs panel.
export async function previewFailedRowsForJob(jobId, limit) {
  const docs = await BulkJobRow.find({ jobId, status: "failed" })
    .sort({ rowNumber: 1 })
    .limit(limit)
    .select({
      _id: 1,
      rowNumber: 1,
      productUrl: 1,
      productTitle: 1,
      errorMessage: 1,
    })
    .lean(LEAN);
  return docs.map((d) => ({
    id: String(d._id),
    rowNumber: d.rowNumber,
    productUrl: d.productUrl,
    productTitle: d.productTitle ?? null,
    errorMessage: d.errorMessage ?? null,
  }));
}
