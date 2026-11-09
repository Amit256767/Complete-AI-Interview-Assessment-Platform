CREATE TABLE "GeminiDailyQuota" (
  "id" TEXT NOT NULL,
  "dayStart" DATE NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeminiDailyQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeminiDailyQuota_dayStart_key" ON "GeminiDailyQuota"("dayStart");
