import mongoose from "../db.server.js";

const { Schema } = mongoose;

// Shared options: expose `id` as a string virtual, drop `_id`/`__v` in JSON
// payloads. This keeps the API contract identical to the Prisma days where
// callers used the cuid string `id`.
function serializableModelOptions(extra = {}) {
  return {
    timestamps: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true, versionKey: false },
    ...extra,
  };
}

const editHistorySchema = new Schema(
  {
    shop: { type: String, required: true },
    resourceType: {
      type: String,
      enum: ["product", "collection"],
      default: "product",
    },
    productId: { type: String, required: true },
    productTitle: { type: String, required: true },
    oldTitle: { type: String, default: null },
    newTitle: { type: String, default: null },
    oldDescription: { type: String, default: null },
    newDescription: { type: String, default: null },
    editedAt: { type: Date, default: Date.now },
  },
  serializableModelOptions(),
);
editHistorySchema.index({ shop: 1, editedAt: -1 });
editHistorySchema.index({ shop: 1, resourceType: 1, editedAt: -1 });

const bulkJobSchema = new Schema(
  {
    shop: { type: String, required: true },
    resourceType: {
      type: String,
      enum: ["product", "collection"],
      default: "product",
    },
    fileName: { type: String, required: true },
    totalRows: { type: Number, required: true },
    successRows: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  serializableModelOptions(),
);
bulkJobSchema.index({ shop: 1, createdAt: -1 });
bulkJobSchema.index({ shop: 1, resourceType: 1, createdAt: -1 });

const bulkJobRowSchema = new Schema(
  {
    // jobId is the parent BulkJob's _id stringified — easier to query than a
    // ref/populate, and matches how routes serialize it for the client.
    jobId: { type: String, required: true, index: true },
    rowNumber: { type: Number, required: true },
    productUrl: { type: String, required: true },
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    productId: { type: String, default: null },
    productTitle: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "processing", "success", "failed", "skipped"],
      default: "pending",
    },
    errorMessage: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  serializableModelOptions(),
);
bulkJobRowSchema.index({ jobId: 1, rowNumber: 1 });

// Reuse compiled models across HMR cycles — re-compiling throws OverwriteModelError.
export const EditHistory =
  mongoose.models.EditHistory ?? mongoose.model("EditHistory", editHistorySchema);
export const BulkJob =
  mongoose.models.BulkJob ?? mongoose.model("BulkJob", bulkJobSchema);
export const BulkJobRow =
  mongoose.models.BulkJobRow ?? mongoose.model("BulkJobRow", bulkJobRowSchema);

// Helper used by every model fn that accepts an `id` string from the URL — if
// it's not a 24-char hex ObjectId, the query needs to short-circuit to "not
// found" instead of throwing a CastError.
export function isValidObjectId(id) {
  return mongoose.isValidObjectId(id);
}
