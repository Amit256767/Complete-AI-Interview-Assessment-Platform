import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  attemptFindMany: vi.fn(),
  attemptCount: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptCreate: vi.fn(),
  attemptUpdate: vi.fn(),
  attemptUpdateMany: vi.fn(),
  resumeFindMany: vi.fn(),
  resumeFindFirst: vi.fn(),
  resumeCreate: vi.fn(),
  responseUpsert: vi.fn(),
  dailyUsageUpsert: vi.fn(),
  dailyUsageUpdate: vi.fn(),
  dailyUsageUpdateMany: vi.fn(),
  geminiDailyQuotaUpsert: vi.fn(),
  geminiDailyQuotaUpdateMany: vi.fn(),
  geminiDailyQuotaFindUnique: vi.fn(),
  dailyUsageFindUnique: vi.fn(),
  geminiApiUsageCreate: vi.fn(),
  queryRaw: vi.fn(),
  generateQuestions: vi.fn(),
  evaluateInterviewAnswers: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    user = { findUnique: mocks.userFindUnique, create: mocks.userCreate };
    attempt = {
      findMany: mocks.attemptFindMany,
      count: mocks.attemptCount,
      findFirst: mocks.attemptFindFirst,
      create: mocks.attemptCreate,
      update: mocks.attemptUpdate,
      updateMany: mocks.attemptUpdateMany,
    };
    resume = {
      findMany: mocks.resumeFindMany,
      findFirst: mocks.resumeFindFirst,
      create: mocks.resumeCreate,
    };
    dailyUsage = { findUnique: mocks.dailyUsageFindUnique };
    geminiDailyQuota = { findUnique: mocks.geminiDailyQuotaFindUnique };
    question = { findMany: vi.fn() };
    $queryRaw = mocks.queryRaw;
    $transaction = (callback: (tx: unknown) => unknown) =>
      callback({
        response: { upsert: mocks.responseUpsert },
        attempt: { update: mocks.attemptUpdate, updateMany: mocks.attemptUpdateMany, create: mocks.attemptCreate, findFirst: mocks.attemptFindFirst },
        dailyUsage: { upsert: mocks.dailyUsageUpsert, update: mocks.dailyUsageUpdate, updateMany: mocks.dailyUsageUpdateMany, findUnique: mocks.dailyUsageFindUnique },
        geminiApiUsage: { create: mocks.geminiApiUsageCreate },
        geminiDailyQuota: { upsert: mocks.geminiDailyQuotaUpsert, updateMany: mocks.geminiDailyQuotaUpdateMany, findUnique: mocks.geminiDailyQuotaFindUnique },
      });
  },
}));

vi.mock('../src/ai.js', () => ({
  generateQuestions: mocks.generateQuestions,
  evaluateInterviewAnswers: mocks.evaluateInterviewAnswers,
}));

const secret = 'test-only-secret-that-is-long-enough-32';
let server: Server;
let baseUrl: string;
let app: any;
let utcDayStart: (date?: Date) => Date;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  process.env.GEMINI_DAILY_REQUEST_BUDGET = '15';
  process.env.FRONTEND_URL = 'https://hireprep-example.vercel.app, https://complete-ai-interview-assessment-pl.vercel.app/';
  process.env.CLIENT_URL = 'https://hireprep-example.netlify.app, https://secondary-client.example';
  ({ app, utcDayStart } = await import('../src/index.js'));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_DAILY_REQUEST_BUDGET = '15';
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.attemptFindMany.mockResolvedValue([]);
  mocks.attemptCount.mockResolvedValue(0);
  mocks.attemptFindFirst.mockResolvedValue(null);
  mocks.attemptCreate.mockResolvedValue({ id: 'attempt-new', status: 'GENERATING' });
  mocks.attemptUpdate.mockResolvedValue({ id: 'attempt-new' });
  mocks.attemptUpdateMany.mockResolvedValue({ count: 1 });
  mocks.dailyUsageUpsert.mockResolvedValue({ id: 'daily-usage-1' });
  mocks.dailyUsageUpdate.mockResolvedValue({ id: 'daily-usage-1' });
  mocks.dailyUsageUpdateMany.mockResolvedValue({ count: 1 });
  mocks.geminiDailyQuotaUpsert.mockResolvedValue({ id: 'gemini-daily-quota-1' });
  mocks.geminiDailyQuotaUpdateMany.mockResolvedValue({ count: 1 });
  mocks.geminiDailyQuotaFindUnique.mockResolvedValue({ requestCount: 4 });
  mocks.dailyUsageFindUnique.mockResolvedValue({ geminiRequestCount: 2, geminiInputTokens: 120, geminiOutputTokens: 80, geminiTotalTokens: 200 });
  mocks.geminiApiUsageCreate.mockResolvedValue({ id: 'gemini-usage-1' });
  mocks.resumeFindMany.mockResolvedValue([]);
  mocks.generateQuestions.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([{ attemptTable: 'Attempt', dailyUsageTable: 'DailyUsage', geminiUsageTable: 'GeminiApiUsage', quotaTable: 'GeminiDailyQuota' }]);
});

const bearer = (userId: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: userId }, secret)}` });
const mockQuestions = Array.from({ length: 8 }, (_, index) => ({
  prompt: `Interview question ${index + 1}: explain a useful engineering decision.`,
  type: 'SCENARIO',
  options: ['Choice A', 'Choice B', 'Choice C', 'Choice D'],
  answerIndex: 0,
  explanation: 'A clear answer explains the tradeoffs.',
}));
const mockEvaluation = {
  overallScore: 82,
  feedback: 'Your answers were clear and technically sound.',
  strengths: ['Clear reasoning'],
  weaknesses: ['Add more tradeoff detail'],
  questionScores: Array.from({ length: 8 }, (_, index) => ({
    position: index + 1,
    score: 82,
    feedback: `Feedback for answer ${index + 1}.`,
    strengths: ['Good reasoning'],
    weaknesses: ['Explain tradeoffs'],
  })),
};

describe('authentication and candidate API routes', () => {
  it('returns database health from GET /api/health and leaves GET /api unregistered', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', database: 'connected', ai: false });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);

    const apiRoot = await fetch(`${baseUrl}/api`);
    expect(apiRoot.status).toBe(404);
  });

  it('reports the database as not ready when the quota migration has not been applied', async () => {
    process.env.DATABASE_URL = 'postgresql://test';
    mocks.queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([{ attemptTable: 'Attempt', dailyUsageTable: 'DailyUsage', geminiUsageTable: 'GeminiApiUsage', quotaTable: null }]);
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', database: 'schema_not_ready' });
  });

  it('exposes authenticated global and per-user Gemini request usage', async () => {
    process.env.GEMINI_DAILY_REQUEST_BUDGET = '12';
    const response = await fetch(`${baseUrl}/api/usage`, { headers: bearer('candidate-7') });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      global: { requests: 4, budget: 12, scope: 'all_users' },
      user: { requests: 2, inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    });
    expect(mocks.geminiDailyQuotaFindUnique).toHaveBeenCalledOnce();
    expect(mocks.dailyUsageFindUnique).toHaveBeenCalledOnce();
  });

  it('trusts exactly one Render proxy hop before rate limiting', async () => {
    expect(app.get('trust proxy')).toBe(1);

    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: {
        ...bearer('candidate-7'),
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ role: 'Frontend developer', category: 'React', difficulty: 'BEGINNER', count: 8, durationMinutes: 10 }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'A valid Idempotency-Key header is required to start a mock interview.' });
    expect(response.headers.get('ratelimit-limit')).toBe('100');
  });

  it.each([
    ['missing', undefined],
    ['too short', 'short'],
    ['too long', 'k'.repeat(129)],
  ])('rejects a %s idempotency key', async (_label, key) => {
    const headers: Record<string, string> = { ...bearer('candidate-7'), 'Content-Type': 'application/json' };
    if (key !== undefined) headers['Idempotency-Key'] = key;
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ role: 'Frontend developer', category: 'React', difficulty: 'BEGINNER', count: 8, durationMinutes: 10 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'A valid Idempotency-Key header is required to start a mock interview.' });
    expect(mocks.attemptFindFirst).not.toHaveBeenCalled();
    expect(mocks.dailyUsageUpsert).not.toHaveBeenCalled();
  });

  it('accepts a valid idempotency key and reserves one interview attempt', async () => {
    mocks.generateQuestions.mockResolvedValue(mockQuestions);
    mocks.attemptUpdate.mockResolvedValue({ id: 'attempt-new', deadline: new Date(Date.now() + 60_000), questions: mockQuestions.map((question, index) => ({ ...question, id: `question-${index + 1}` })) });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': '123e4567-e89b-42d3-a456-426614174000' },
      body: JSON.stringify({ role: 'Frontend developer', category: 'React', difficulty: 'BEGINNER', count: 8, durationMinutes: 10 }),
    });
    expect(response.status).toBe(201);
    expect(mocks.attemptCreate.mock.calls[0][0].data.idempotencyKey).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(mocks.generateQuestions).toHaveBeenCalledOnce();
  });

  it('allows the exact production frontend origin and assessment preflight headers', async () => {
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://complete-ai-interview-assessment-pl.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://complete-ai-interview-assessment-pl.vercel.app');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    const allowedHeaders = response.headers.get('access-control-allow-headers')?.toLowerCase() || '';
    expect(allowedHeaders).toContain('authorization');
    expect(allowedHeaders).toContain('content-type');
    expect(allowedHeaders).toContain('idempotency-key');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('allows origins from CLIENT_URL and localhost, while rejecting unknown origins', async () => {
    const frontendCsvEntry = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://hireprep-example.vercel.app' } });
    expect(frontendCsvEntry.headers.get('access-control-allow-origin')).toBe('https://hireprep-example.vercel.app');

    const netlify = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://hireprep-example.netlify.app' } });
    expect(netlify.headers.get('access-control-allow-origin')).toBe('https://hireprep-example.netlify.app');

    const clientCsvEntry = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://secondary-client.example' } });
    expect(clientCsvEntry.headers.get('access-control-allow-origin')).toBe('https://secondary-client.example');

    const localhost = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    expect(localhost.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const unknown = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://not-allowed.example' } });
    expect(unknown.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects unauthenticated access to the dashboard', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`);
    expect(response.status).toBe(401);
    expect(mocks.attemptFindMany).not.toHaveBeenCalled();
  });

  it('creates an account with a password hash and never returns it', async () => {
    mocks.userCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'candidate-1', name: data.name, email: data.email,
    }));
    const response = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Taylor Candidate', email: 'TAYLOR@example.com', password: 'a-long-test-password' }),
    });
    const body = await response.json();
    const saved = mocks.userCreate.mock.calls[0][0].data;
    expect(response.status).toBe(201);
    expect(saved.email).toBe('taylor@example.com');
    expect(saved.passwordHash).not.toBe('a-long-test-password');
    expect(saved).not.toHaveProperty('password');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.token).toBeTruthy();
  });

  it('authenticates a registered user without returning the password hash', async () => {
    const passwordHash = await bcrypt.hash('a-long-test-password', 4);
    mocks.userFindUnique.mockResolvedValue({ id: 'candidate-2', name: 'Taylor Candidate', email: 'taylor@example.com', passwordHash });
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'TAYLOR@example.com', password: 'a-long-test-password' }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(mocks.userFindUnique.mock.calls[0][0].where.email).toBe('taylor@example.com');
  });

  it('rejects an incorrect password without revealing account details', async () => {
    const passwordHash = await bcrypt.hash('a-different-password', 4);
    mocks.userFindUnique.mockResolvedValue({ id: 'candidate-2', name: 'Taylor Candidate', email: 'taylor@example.com', passwordHash });
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taylor@example.com', password: 'wrong-password' }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Email or password is incorrect.' });
  });

  it('returns a client error for invalid signup input', async () => {
    const response = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'T', email: 'not-an-email', password: 'short' }),
    });
    expect(response.status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('does not allow duplicate account registration', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 'existing-candidate' });
    const response = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Taylor Candidate', email: 'taylor@example.com', password: 'a-long-test-password' }),
    });
    expect(response.status).toBe(409);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('returns a safe error and logs database error metadata without sensitive values', async () => {
    const databaseError = Object.assign(new Error('connection failed for user@example.com with password=never-log-this'), { code: 'P1001' });
    mocks.userFindUnique.mockRejectedValue(databaseError);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Taylor Candidate', email: 'taylor@example.com', password: 'a-long-test-password' }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Something went wrong. Please try again.' });
      expect(log).toHaveBeenCalledWith('[api] route=/api/auth/signup error=Error code=P1001');
      expect(log.mock.calls.flat().join(' ')).not.toContain('never-log-this');
      expect(log.mock.calls.flat().join(' ')).not.toContain('taylor@example.com');
    } finally {
      log.mockRestore();
    }
  });

  it('returns an actionable message when signup reaches a missing database table', async () => {
    mocks.userFindUnique.mockRejectedValue(Object.assign(new Error('table details omitted'), { code: 'P2021' }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Taylor Candidate', email: 'taylor@example.com', password: 'a-long-test-password' }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Database schema is not initialized. Apply the pending Prisma migrations.' });
    } finally {
      log.mockRestore();
    }
  });

  it('returns a clear configuration error when practice generation has no AI key', async () => {
    mocks.generateQuestions.mockRejectedValue(new Error('AI_NOT_CONFIGURED'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await fetch(`${baseUrl}/api/assessments/generate`, {
        method: 'POST',
        headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-001' },
        body: JSON.stringify({ role: 'Frontend developer', category: 'React', difficulty: 'BEGINNER', count: 8, durationMinutes: 10 }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'AI practice generation is unavailable. Set GEMINI_API_KEY in the backend environment.' });
      expect(mocks.attemptCreate).toHaveBeenCalledOnce();
      expect(mocks.dailyUsageUpdate).toHaveBeenCalledWith(expect.objectContaining({data:{mockInterviewCount:{decrement:1}}}));
    } finally {
      log.mockRestore();
    }
  });

  it('returns a friendly response when Gemini remains unavailable', async () => {
    mocks.generateQuestions.mockRejectedValue(Object.assign(new Error('AI_PROVIDER_UNAVAILABLE'), {
      status: 503, providerStatus: 403, diagnosis: 'check_api_key_or_permissions', providerReason: 'PERMISSION_DENIED',
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await fetch(`${baseUrl}/api/assessments/generate`, {
        method: 'POST',
        headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-002' },
        body: JSON.stringify({ role: 'Frontend developer', category: 'React', difficulty: 'BEGINNER', count: 8, durationMinutes: 10 }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'AI service is temporarily unavailable. Please try again shortly.' });
      expect(mocks.attemptCreate).toHaveBeenCalledOnce();
      expect(log.mock.calls.map(([message]) => String(message)).join('\n')).toContain('provider_status=403 provider_diagnosis=check_api_key_or_permissions provider_reason=PERMISSION_DENIED');
    } finally {
      log.mockRestore();
    }
  });

  it('creates exactly 8 saved questions with one generation operation', async () => {
    const savedQuestions = mockQuestions.map((question, index) => ({ ...question, id: `question-${index + 1}` }));
    mocks.generateQuestions.mockImplementation(async (_input, options) => {
      await options.onUsage({ operation: 'GENERATION', model: 'gemini-3.8-flash', statusCode: 200, succeeded: true, inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      return mockQuestions;
    });
    mocks.attemptUpdate.mockResolvedValue({ id: 'attempt-new', deadline: new Date(Date.now() + 60_000), questions: savedQuestions });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-003' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.questions).toHaveLength(8);
    expect(body.questions[0]).not.toHaveProperty('answerIndex');
    expect(mocks.generateQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.attemptCreate.mock.calls[0][0].data.status).toBe('GENERATING');
    expect(mocks.dailyUsageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ mockInterviewCount: { lt: 10 } }) }));
    expect(mocks.geminiApiUsageCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ operation: 'GENERATION', model: 'gemini-3.8-flash', totalTokens: 150, succeeded: true }) });
    expect(mocks.dailyUsageUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ geminiRequestCount: { increment: 1 }, geminiTotalTokens: { increment: 150 } }) }));
  });

  it('reserves the shared Gemini daily budget before sending a provider request', async () => {
    mocks.generateQuestions.mockImplementation(async (_input, options) => {
      await options.beforeRequest();
      return mockQuestions;
    });
    mocks.geminiDailyQuotaUpdateMany.mockResolvedValueOnce({ count: 0 });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'quota-budget-key-1' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'This app’s shared Gemini request budget for today has been reached. It resets at midnight UTC; please try again tomorrow.' });
    expect(mocks.geminiDailyQuotaUpsert).toHaveBeenCalledOnce();
    expect(mocks.generateQuestions).toHaveBeenCalledOnce();
  });

  it('enforces the ten-interview daily cap before generating questions', async () => {
    mocks.dailyUsageUpdateMany.mockResolvedValue({ count: 0 });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-004' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'You have reached today’s limit of 10 mock interviews. Try again after midnight UTC.' });
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it('rejects generation requests that do not request exactly 8 questions', async () => {
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-006' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 7, durationMinutes: 15 }),
    });
    expect(response.status).toBe(400);
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
    expect(mocks.dailyUsageUpsert).not.toHaveBeenCalled();
  });

  it('returns a friendly 429 when the Gemini project quota is exhausted', async () => {
    mocks.generateQuestions.mockRejectedValue(Object.assign(new Error('AI_QUOTA_EXCEEDED'), { status: 429 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await fetch(`${baseUrl}/api/assessments/generate`, {
        method: 'POST',
        headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-007' },
        body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
      });
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: 'The Gemini API project has reached its current quota. Check the project’s active quota and retry after Google’s reset window.' });
    } finally {
      log.mockRestore();
    }
  });

  it('reuses an idempotent generation instead of calling Gemini again', async () => {
    mocks.attemptFindFirst.mockResolvedValue({ id: 'attempt-existing', status: 'IN_PROGRESS', deadline: new Date(Date.now() + 60_000), questions: mockQuestions.map((question, index) => ({ ...question, id: `saved-question-${index + 1}`, position: index })) });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-start-key-005' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).questions).toHaveLength(8);
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
    expect(mocks.geminiDailyQuotaUpsert).not.toHaveBeenCalled();
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it('prevents concurrent duplicate submissions from reaching Gemini twice', async () => {
    mocks.attemptFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'attempt-racing', status: 'GENERATING', questions: [] });
    mocks.attemptCreate.mockRejectedValueOnce(Object.assign(new Error('unique constraint'), { code: 'P2002' }));
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'racing-idempotency-key' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'This mock interview is already being generated. Please retry shortly.' });
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
  });

  it('keeps duplicate protection for an idempotency key whose generation already failed', async () => {
    mocks.attemptFindFirst.mockResolvedValue({ id: 'attempt-failed', status: 'GENERATION_FAILED', questions: [] });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json', 'Idempotency-Key': 'mock-failed-key-01' },
      body: JSON.stringify({ role: 'Backend engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 8, durationMinutes: 15 }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'This request was already used. Start a new mock interview.' });
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it('submits all 8 answers and grades them without another Gemini request', async () => {
    const questions = mockQuestions.map((question, index) => ({ ...question, id: `question-${index + 1}`, position: index }));
    const inProgress = { id: 'attempt-8', status: 'IN_PROGRESS', deadline: new Date(Date.now() + 60_000), dailyUsageId: 'daily-usage-1', questions, responses: [] };
    const responses = questions.map((question, index) => ({ questionId: question.id, correct: index < 6 }));
    const completed = { ...inProgress, status: 'SUBMITTED', score: 88, evaluation: { ...mockEvaluation, overallScore: 88 }, responses };
    mocks.attemptFindFirst.mockResolvedValueOnce(inProgress).mockResolvedValueOnce(completed);
    const response = await fetch(`${baseUrl}/api/assessments/attempt-8/submit`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: questions.map((question, index) => ({ questionId: question.id, selectedIndex: index === 0 ? 1 : 0 })) }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ overallScore: 88, score: 88, total: 8 });
    expect(body.questionScores).toHaveLength(8);
    expect(mocks.evaluateInterviewAnswers).not.toHaveBeenCalled();
    expect(mocks.responseUpsert).toHaveBeenCalledTimes(8);
  });

  it('returns saved evaluation on duplicate submission without a second Gemini call', async () => {
    const questions = mockQuestions.map((question, index) => ({ ...question, id: `question-${index + 1}` }));
    mocks.attemptFindFirst.mockResolvedValue({ id: 'attempt-complete', status: 'SUBMITTED', score: 82, evaluation: mockEvaluation, responses: questions.map((question, index) => ({ questionId: question.id, correct: index < 6 })), questions });
    const response = await fetch(`${baseUrl}/api/assessments/attempt-complete/submit`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).questionScores).toHaveLength(8);
    expect(mocks.evaluateInterviewAnswers).not.toHaveBeenCalled();
  });

  it('does not start another evaluation while the first request is in progress', async () => {
    mocks.attemptFindFirst.mockResolvedValue({ id: 'attempt-evaluating', status: 'EVALUATING', questions: mockQuestions });
    const response = await fetch(`${baseUrl}/api/assessments/attempt-evaluating/submit`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    });
    expect(response.status).toBe(409);
    expect(mocks.evaluateInterviewAnswers).not.toHaveBeenCalled();
  });

  it('treats a concurrent unique-email conflict as a duplicate signup', async () => {
    mocks.userCreate.mockRejectedValue(Object.assign(new Error('unique constraint'), { code: 'P2002' }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Taylor Candidate', email: 'taylor@example.com', password: 'a-long-test-password' }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Email is already registered.' });
    } finally {
      log.mockRestore();
    }
  });

  it('scopes dashboard history queries to the authenticated candidate', async () => {
    mocks.attemptFindMany.mockResolvedValue([{ id: 'attempt-1', score: 75, category: 'React' }]);
    mocks.attemptCount.mockResolvedValue(17);
    const response = await fetch(`${baseUrl}/api/dashboard`, { headers: bearer('candidate-7') });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.completed).toBe(17);
    expect(mocks.attemptFindMany.mock.calls[0][0].where.userId).toBe('candidate-7');
    expect(mocks.resumeFindMany.mock.calls[0][0].where.userId).toBe('candidate-7');
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
  });

  it('inspects global and user Gemini usage without invoking an AI provider', async () => {
    const response = await fetch(`${baseUrl}/api/usage`, { headers: bearer('candidate-7') });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.global).toEqual({ requests: 4, budget: 15, scope: 'all_users' });
    expect(body.user).toEqual({ requests: 2, inputTokens: 120, outputTokens: 80, totalTokens: 200 });
    expect(body.dayStart).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    expect(mocks.geminiDailyQuotaFindUnique).toHaveBeenCalledOnce();
    expect(mocks.dailyUsageFindUnique).toHaveBeenCalledOnce();
    expect(mocks.generateQuestions).not.toHaveBeenCalled();
  });

  it('uses a new UTC quota bucket immediately after midnight UTC', async () => {
    expect(utcDayStart(new Date('2026-11-13T23:59:59.000Z')).toISOString()).toBe('2026-11-13T00:00:00.000Z');
    expect(utcDayStart(new Date('2026-11-14T00:00:00.000Z')).toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });
  it('rejects a PDF upload whose content does not have a PDF signature', async () => {
    const form = new FormData();
    form.append('resume', new Blob(['not a PDF'], { type: 'application/pdf' }), 'resume.pdf');
    const response = await fetch(`${baseUrl}/api/resumes`, { method: 'POST', headers: bearer('candidate-7'), body: form });
    expect(response.status).toBe(400);
    expect(mocks.resumeCreate).not.toHaveBeenCalled();
  });

  it('refuses answer submission after the saved attempt deadline', async () => {
    mocks.attemptFindFirst.mockResolvedValue({
      id: 'attempt-expired', status: 'IN_PROGRESS', deadline: new Date(Date.now() - 1_000),
      dailyUsageId: 'daily-usage-1',
      questions: mockQuestions.map((question, index) => ({ ...question, id: `question-expired-${index + 1}` })),
    });
    const response = await fetch(`${baseUrl}/api/assessments/attempt-expired/submit`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: mockQuestions.map((_, index) => ({ questionId: `question-expired-${index + 1}`, selectedIndex: 1 })) }),
    });
    expect(response.status).toBe(410);
    expect(mocks.responseUpsert).not.toHaveBeenCalled();
    expect(mocks.attemptUpdate).not.toHaveBeenCalled();
  });
});
