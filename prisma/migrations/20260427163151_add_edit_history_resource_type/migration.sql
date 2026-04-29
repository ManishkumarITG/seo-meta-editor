-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EditHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'product',
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "oldTitle" TEXT,
    "newTitle" TEXT,
    "oldDescription" TEXT,
    "newDescription" TEXT,
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_EditHistory" ("editedAt", "id", "newDescription", "newTitle", "oldDescription", "oldTitle", "productId", "productTitle", "shop") SELECT "editedAt", "id", "newDescription", "newTitle", "oldDescription", "oldTitle", "productId", "productTitle", "shop" FROM "EditHistory";
DROP TABLE "EditHistory";
ALTER TABLE "new_EditHistory" RENAME TO "EditHistory";
CREATE INDEX "EditHistory_shop_editedAt_idx" ON "EditHistory"("shop", "editedAt");
CREATE INDEX "EditHistory_shop_resourceType_editedAt_idx" ON "EditHistory"("shop", "resourceType", "editedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
