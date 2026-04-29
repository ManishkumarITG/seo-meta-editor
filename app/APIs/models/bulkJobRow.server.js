import prisma from "../db.server.js";

export function findPendingRowsForJob(jobId) {
  return prisma.bulkJobRow.findMany({
    where: { jobId, status: "pending" },
    orderBy: { rowNumber: "asc" },
  });
}

export function markRowProcessing(rowId) {
  return prisma.bulkJobRow.update({
    where: { id: rowId },
    data: { status: "processing" },
  });
}

export function markRowSuccess(rowId, { productId, productTitle }) {
  return prisma.bulkJobRow.update({
    where: { id: rowId },
    data: {
      status: "success",
      productId,
      productTitle,
      errorMessage: null,
      processedAt: new Date(),
    },
  });
}

export function markRowFailed(
  rowId,
  { errorMessage, productId, productTitle } = {},
) {
  return prisma.bulkJobRow.update({
    where: { id: rowId },
    data: {
      status: "failed",
      errorMessage,
      ...(productId !== undefined ? { productId } : {}),
      ...(productTitle !== undefined ? { productTitle } : {}),
      processedAt: new Date(),
    },
  });
}

export function failOpenRowsForJob(jobId, errorMessage) {
  return prisma.bulkJobRow.updateMany({
    where: { jobId, status: { in: ["pending", "processing"] } },
    data: {
      status: "failed",
      errorMessage,
      processedAt: new Date(),
    },
  });
}

export function findRowsForJob(jobId) {
  return prisma.bulkJobRow.findMany({
    where: { jobId },
    orderBy: { rowNumber: "asc" },
  });
}

export function findFailedRowsForJob(jobId) {
  return prisma.bulkJobRow.findMany({
    where: { jobId, status: "failed" },
    orderBy: { rowNumber: "asc" },
  });
}

// Lightweight preview for the dashboard — only the columns the recent-jobs
// panel renders, capped at `limit` rows per job so listing recent jobs is
// O(jobs × limit) instead of O(jobs × failedRows).
export function previewFailedRowsForJob(jobId, limit) {
  return prisma.bulkJobRow.findMany({
    where: { jobId, status: "failed" },
    orderBy: { rowNumber: "asc" },
    take: limit,
    select: {
      id: true,
      rowNumber: true,
      productUrl: true,
      productTitle: true,
      errorMessage: true,
    },
  });
}

// Diff query for the polling endpoint — returns rows whose processedAt is
// after the cutoff OR are currently in flight.
export function findRowsChangedSince(jobId, sinceDate) {
  return prisma.bulkJobRow.findMany({
    where: {
      jobId,
      OR: [
        { processedAt: { gt: sinceDate } },
        { status: "processing" },
      ],
    },
    orderBy: { rowNumber: "asc" },
  });
}

export function groupRowsByStatusForJob(jobId) {
  return prisma.bulkJobRow.groupBy({
    by: ["status"],
    where: { jobId },
    _count: { _all: true },
  });
}

export function findLastProcessedAtForJob(jobId) {
  return prisma.bulkJobRow.findFirst({
    where: { jobId, processedAt: { not: null } },
    orderBy: { processedAt: "desc" },
    select: { processedAt: true },
  });
}
