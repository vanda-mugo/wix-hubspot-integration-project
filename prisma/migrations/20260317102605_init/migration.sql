-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('WIX_TO_HUBSPOT', 'HUBSPOT_TO_WIX', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "SyncSource" AS ENUM ('WIX', 'HUBSPOT');

-- CreateEnum
CREATE TYPE "ConflictStrategy" AS ENUM ('LAST_UPDATED_WINS', 'HUBSPOT_WINS', 'WIX_WINS');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "wixInstanceId" TEXT NOT NULL,
    "hubspotPortalId" TEXT,
    "hsAccessToken" TEXT,
    "hsRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "conflictStrategy" "ConflictStrategy" NOT NULL DEFAULT 'LAST_UPDATED_WINS',
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMapping" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "wixContactId" TEXT NOT NULL,
    "hubspotContactId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncSource" "SyncSource" NOT NULL,
    "syncCorrelationId" TEXT,

    CONSTRAINT "ContactMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldMapping" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "wixField" TEXT NOT NULL,
    "hubspotProperty" TEXT NOT NULL,
    "syncDirection" "SyncDirection" NOT NULL,
    "transform" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" "SyncSource" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "wixContactId" TEXT,
    "hubspotContactId" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Installation_wixInstanceId_key" ON "Installation"("wixInstanceId");

-- CreateIndex
CREATE INDEX "ContactMapping_wixContactId_idx" ON "ContactMapping"("wixContactId");

-- CreateIndex
CREATE INDEX "ContactMapping_hubspotContactId_idx" ON "ContactMapping"("hubspotContactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMapping_installationId_wixContactId_key" ON "ContactMapping"("installationId", "wixContactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMapping_installationId_hubspotContactId_key" ON "ContactMapping"("installationId", "hubspotContactId");

-- CreateIndex
CREATE INDEX "FieldMapping_installationId_idx" ON "FieldMapping"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldMapping_installationId_hubspotProperty_key" ON "FieldMapping"("installationId", "hubspotProperty");

-- CreateIndex
CREATE INDEX "SyncEvent_installationId_createdAt_idx" ON "SyncEvent"("installationId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncEvent_correlationId_idx" ON "SyncEvent"("correlationId");

-- CreateIndex
CREATE INDEX "SyncEvent_wixContactId_createdAt_idx" ON "SyncEvent"("wixContactId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncEvent_hubspotContactId_createdAt_idx" ON "SyncEvent"("hubspotContactId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessedEvent_processedAt_idx" ON "ProcessedEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_installationId_eventId_key" ON "ProcessedEvent"("installationId", "eventId");

-- AddForeignKey
ALTER TABLE "ContactMapping" ADD CONSTRAINT "ContactMapping_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldMapping" ADD CONSTRAINT "FieldMapping_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncEvent" ADD CONSTRAINT "SyncEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedEvent" ADD CONSTRAINT "ProcessedEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
