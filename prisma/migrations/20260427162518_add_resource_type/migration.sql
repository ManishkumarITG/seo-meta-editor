-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BulkJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'product',
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);
INSERT INTO "new_BulkJob" ("completedAt", "createdAt", "failedRows", "fileName", "id", "shop", "status", "successRows", "totalRows") SELECT "completedAt", "createdAt", "failedRows", "fileName", "id", "shop", "status", "successRows", "totalRows" FROM "BulkJob";
DROP TABLE "BulkJob";
ALTER TABLE "new_BulkJob" RENAME TO "BulkJob";
CREATE INDEX "BulkJob_shop_createdAt_idx" ON "BulkJob"("shop", "createdAt");
CREATE INDEX "BulkJob_shop_resourceType_createdAt_idx" ON "BulkJob"("shop", "resourceType", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
