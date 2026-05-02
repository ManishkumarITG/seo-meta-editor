import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/";
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || "seo_meta_editor";

// HMR-safe singleton — without this, every dev-server reload would open a
// fresh connection and quickly exhaust the pool.
const cached = global.__mongoose ?? { conn: null, promise: null };
if (!global.__mongoose) global.__mongoose = cached;

export function connectToMongo() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DATABASE,
        serverSelectionTimeoutMS: 10_000,
      })
      .then((m) => {
        cached.conn = m;
        return m;
      })
      .catch((err) => {
        // Reset the cached promise so the next call retries instead of
        // returning a permanently rejected promise.
        cached.promise = null;
        throw err;
      });
  }
  return cached.promise;
}

// Mongoose buffers commands until the connection resolves, so eagerly kicking
// off the connection at module load means by the time a route's loader runs
// the connection is usually ready. Errors surface lazily on the first query.
connectToMongo().catch((err) => {
  console.error("[db.server] MongoDB connection failed:", err.message);
});

export default mongoose;
