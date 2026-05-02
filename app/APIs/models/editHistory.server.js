import { EditHistory } from "./schemas.server.js";

const LEAN = { virtuals: true };

function shape(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id ?? doc.id),
    shop: doc.shop,
    resourceType: doc.resourceType,
    productId: doc.productId,
    productTitle: doc.productTitle,
    oldTitle: doc.oldTitle ?? null,
    newTitle: doc.newTitle ?? null,
    oldDescription: doc.oldDescription ?? null,
    newDescription: doc.newDescription ?? null,
    editedAt: doc.editedAt,
  };
}

export async function recordEdit({
  shop,
  resourceType = "product",
  productId,
  productTitle,
  oldTitle,
  newTitle,
  oldDescription,
  newDescription,
}) {
  const doc = await EditHistory.create({
    shop,
    resourceType,
    productId,
    productTitle,
    oldTitle: oldTitle || null,
    newTitle: newTitle || null,
    oldDescription: oldDescription || null,
    newDescription: newDescription || null,
  });
  return shape(doc.toObject({ virtuals: true }));
}

export async function listRecentEditsForShop({ shop, resourceType, limit }) {
  const docs = await EditHistory.find({
    shop,
    ...(resourceType ? { resourceType } : {}),
  })
    .sort({ editedAt: -1 })
    .limit(limit)
    .lean(LEAN);
  return docs.map(shape);
}
