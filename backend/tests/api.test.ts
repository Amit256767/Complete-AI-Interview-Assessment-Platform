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
  resumeFindMany: vi.fn(),
  resumeFindFirst: vi.fn(),
  resumeCreate: vi.fn(),
  responseUpsert: vi.fn(),
  generateQuestions: vi.fn(),
  evaluateAnswer: vi.fn(),
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
    };
    resume = {
      findMany: mocks.resumeFindMany,
      findFirst: mocks.resumeFindFirst,
      create: mocks.resumeCreate,
    };
    question = { findMany: vi.fn() };
    $transaction = (callback: (tx: unknown) => unknown) =>
      callback({
        response: { upsert: mocks.responseUpsert },
        attempt: { update: mocks.attemptUpdate },
      });
  },
}));

vi.mock('../src/ai.js', () => ({
  generateQuestions: mocks.generateQuestions,
  evaluateAnswer: mocks.evaluateAnswer,
}));

const secret = 'test-only-secret-that-is-long-enough-32';
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = secret;
  const { app } = await import('../src/index.js');
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
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.attemptFindMany.mockResolvedValue([]);
  mocks.attemptCount.mockResolvedValue(0);
  mocks.attemptFindFirst.mockResolvedValue(null);
  mocks.resumeFindMany.mockResolvedValue([]);
  mocks.generateQuestions.mockResolvedValue([]);
});

const bearer = (userId: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: userId }, secret)}` });

describe('authentication and candidate API routes', () => {
  it('allows the production frontend origin and CORS preflight requests', async () => {
    const response = await fetch(`${baseUrl}/api/dashboard`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://regal-dusk-361215.netlify.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://regal-dusk-361215.netlify.app');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
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
  });

  it('keeps generated MCQ answer keys out of the candidate response', async () => {
    mocks.generateQuestions.mockResolvedValue([{
      prompt: 'Which React hook stores local component state?',
      type: 'CONCEPTUAL',
      options: ['useState', 'useEffect', 'useMemo', 'useRef'],
      answerIndex: 0,
      explanation: 'useState stores local state.',
    }]);
    mocks.attemptCreate.mockResolvedValue({
      id: 'attempt-2',
      deadline: new Date(Date.now() + 600_000),
      questions: [{ id: 'question-2', prompt: 'Which React hook stores local component state?', type: 'CONCEPTUAL', options: ['useState', 'useEffect', 'useMemo', 'useRef'] }],
    });
    const response = await fetch(`${baseUrl}/api/assessments/generate`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'Frontend developer', category: 'React', difficulty: 'BEGINNER', count: 1, durationMinutes: 10 }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.questions[0].id).toBe('question-2');
    expect(body.questions[0]).not.toHaveProperty('answerIndex');
    expect(mocks.attemptCreate.mock.calls[0][0].data.questions.create[0].answerIndex).toBe(0);
  });

  it('scores submitted answers against stored keys and persists the result', async () => {
    mocks.attemptFindFirst.mockResolvedValue({
      id: 'attempt-3', status: 'IN_PROGRESS', deadline: new Date(Date.now() + 60_000),
      questions: [{ id: 'question-3', answerIndex: 2 }],
    });
    const response = await fetch(`${baseUrl}/api/assessments/attempt-3/submit`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: 'question-3', selectedIndex: 2 }] }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.score).toBe(100);
    expect(mocks.responseUpsert).toHaveBeenCalled();
    expect(mocks.attemptUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED', score: 100 }) }));
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
      questions: [{ id: 'question-expired', answerIndex: 1 }],
    });
    const response = await fetch(`${baseUrl}/api/assessments/attempt-expired/submit`, {
      method: 'POST',
      headers: { ...bearer('candidate-7'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: 'question-expired', selectedIndex: 1 }] }),
    });
    expect(response.status).toBe(410);
    expect(mocks.responseUpsert).not.toHaveBeenCalled();
    expect(mocks.attemptUpdate).not.toHaveBeenCalled();
  });
});
