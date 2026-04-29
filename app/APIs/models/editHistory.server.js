import prisma from "../db.server.js";

export function recordEdit({
  shop,
  resourceType = "product",
  productId,
  productTitle,
  oldTitle,
  newTitle,
  oldDescription,
  newDescription,
}) {
  return prisma.editHistory.create({
    data: {
      shop,
      resourceType,
      productId,
      productTitle,
      oldTitle: oldTitle || null,
      newTitle: newTitle || null,
      oldDescription: oldDescription || null,
      newDescription: newDescription || null,
    },
  });
}

export function listRecentEditsForShop({ shop, resourceType, limit }) {
  return prisma.editHistory.findMany({
    where: {
      shop,
      ...(resourceType ? { resourceType } : {}),
    },
    orderBy: { editedAt: "desc" },
    take: limit,
  });
}
