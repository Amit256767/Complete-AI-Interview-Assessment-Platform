ALTER TABLE "Attempt"
  ADD COLUMN "evaluation" JSONB,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "dailyUsageId" TEXT;

CREATE UNIQUE INDEX "Attempt_userId_idempotencyKey_key"
  ON "Attempt"("userId", "idempotencyKey");
CREATE INDEX "Attempt_dailyUsageId_idx" ON "Attempt"("dailyUsageId");

CREATE TABLE "DailyUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dayStart" DATE NOT NULL,
  "mockInterviewCount" INTEGER NOT NULL DEFAULT 0,
  "geminiRequestCount" INTEGER NOT NULL DEFAULT 0,
  "geminiInputTokens" INTEGER NOT NULL DEFAULT 0,
  "geminiOutputTokens" INTEGER NOT NULL DEFAULT 0,
  "geminiTotalTokens" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DailyUsage_userId_dayStart_key" ON "DailyUsage"("userId", "dayStart");
CREATE INDEX "DailyUsage_userId_dayStart_idx" ON "DailyUsage"("userId", "dayStart");

CREATE TABLE "GeminiApiUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "dailyUsageId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "statusCode" INTEGER,
  "succeeded" BOOLEAN NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeminiApiUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeminiApiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeminiApiUsage_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GeminiApiUsage_dailyUsageId_fkey" FOREIGN KEY ("dailyUsageId") REFERENCES "DailyUsage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GeminiApiUsage_userId_createdAt_idx" ON "GeminiApiUsage"("userId", "createdAt");
CREATE INDEX "GeminiApiUsage_attemptId_operation_idx" ON "GeminiApiUsage"("attemptId", "operation");
CREATE INDEX "GeminiApiUsage_dailyUsageId_createdAt_idx" ON "GeminiApiUsage"("dailyUsageId", "createdAt");

ALTER TABLE "Attempt"
  ADD CONSTRAINT "Attempt_dailyUsageId_fkey" FOREIGN KEY ("dailyUsageId") REFERENCES "DailyUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
