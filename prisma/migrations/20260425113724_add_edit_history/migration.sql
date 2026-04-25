-- CreateTable
CREATE TABLE "EditHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "oldTitle" TEXT,
    "newTitle" TEXT,
    "oldDescription" TEXT,
    "newDescription" TEXT,
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EditHistory_shop_editedAt_idx" ON "EditHistory"("shop", "editedAt");
