import prisma from "../db.server.js";

const JOB_FIELDS = {
  id: true,
  shop: true,
  resourceType: true,
  fileName: true,
  totalRows: true,
  successRows: true,
  failedRows: true,
  status: true,
  createdAt: true,
  completedAt: true,
};

export function createJobWithRows({
  shop,
  resourceType = "product",
  fileName,
  rows,
}) {
  return prisma.$transaction((tx) =>
    tx.bulkJob.create({
      data: {
        shop,
        resourceType,
        fileName,
        totalRows: rows.length,
        status: "pending",
        rows: {
          create: rows.map((r) => ({
            rowNumber: r.rowNumber,
            productUrl: r.productUrl,
            metaTitle: r.metaTitle,
            metaDescription: r.metaDescription,
          })),
        },
      },
    }),
  );
}

export function findJobMetaForShop({ jobId, shop, resourceType }) {
  return prisma.bulkJob.findFirst({
    where: {
      id: jobId,
      shop,
      ...(resourceType ? { resourceType } : {}),
    },
    select: JOB_FIELDS,
  });
}

export function findJobWithRowsForShop({ jobId, shop, resourceType }) {
  return prisma.bulkJob.findFirst({
    where: {
      id: jobId,
      shop,
      ...(resourceType ? { resourceType } : {}),
    },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
}

export function findJobWithFailedRowsForShop({ jobId, shop, resourceType }) {
  return prisma.bulkJob.findFirst({
    where: {
      id: jobId,
      shop,
      ...(resourceType ? { resourceType } : {}),
    },
    include: {
      rows: {
        where: { status: "failed" },
        orderBy: { rowNumber: "asc" },
      },
    },
  });
}

export function listRecentJobsForShop({ shop, resourceType, limit }) {
  return prisma.bulkJob.findMany({
    where: {
      shop,
      ...(resourceType ? { resourceType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// Atomic claim — returns the job if we won the race, null if another caller
// already moved it out of "pending".
export async function claimJobForProcessing(jobId) {
  const result = await prisma.bulkJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "processing" },
  });
  if (result.count === 0) return null;
  return prisma.bulkJob.findUnique({ where: { id: jobId } });
}

export function findJobById(jobId) {
  return prisma.bulkJob.findUnique({ where: { id: jobId } });
}

export function markJobCompleted(jobId) {
  return prisma.bulkJob.update({
    where: { id: jobId },
    data: { status: "completed", completedAt: new Date() },
  });
}

export function markJobFailed(jobId) {
  return prisma.bulkJob.update({
    where: { id: jobId },
    data: { status: "failed", completedAt: new Date() },
  });
}

export function updateJobCounters(jobId, { successRows, failedRows }) {
  return prisma.bulkJob.update({
    where: { id: jobId },
    data: { successRows, failedRows },
  });
}

export function findOpenJobsForShopOlderThan({ shop, resourceType, olderThan }) {
  return prisma.bulkJob.findMany({
    where: {
      shop,
      ...(resourceType ? { resourceType } : {}),
      status: { in: ["pending", "processing"] },
      createdAt: { lt: olderThan },
    },
    select: { id: true, createdAt: true },
  });
}

export async function failOpenJob(jobId) {
  const result = await prisma.bulkJob.updateMany({
    where: { id: jobId, status: { in: ["pending", "processing"] } },
    data: { status: "failed", completedAt: new Date() },
  });
  return result.count > 0;
}
