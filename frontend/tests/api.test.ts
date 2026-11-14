import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, apiUrl, checkApiHealth, generateMockInterview, requestApi, resolveApiBaseUrl } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

describe('frontend API request headers', () => {
  it('normalizes API paths so the /api prefix appears only once', () => {
    expect(apiUrl('/api/auth/login')).toBe(`${API_BASE_URL}/auth/login`);
    expect(apiUrl('/auth/login')).toBe(`${API_BASE_URL}/auth/login`);
  });

  it('checks the Render API health endpoint using the normalized production base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', database: 'connected', ai: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkApiHealth()).resolves.toEqual({ status: 'ok', database: 'connected', ai: true });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/health`);
    expect(resolveApiBaseUrl(undefined, true)).toBe('https://complete-ai-interview-assessment-platform.onrender.com/api');
    expect(resolveApiBaseUrl('https://example.onrender.com', true)).toBe('https://example.onrender.com/api');
  });

  it('keeps an HTTP 503 health response distinguishable from a network or CORS failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'unavailable', database: 'unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(checkApiHealth()).rejects.toMatchObject({ status: 503, message: 'The interview service is temporarily unavailable. Please try again shortly.' });
  });

  it('describes browser access failures as possible CORS failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(checkApiHealth()).rejects.toThrow(/Vercel site's exact origin is allowed by the backend CORS settings/);
  });

  it('sends Idempotency-Key on POST /assessments/generate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'attempt-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateMockInterview({
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      role: 'Full-stack developer',
      category: 'React',
      difficulty: 'INTERMEDIATE',
      count: 8,
      durationMinutes: 15,
    }, 'candidate-token');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe(`${API_BASE_URL}/assessments/generate`);
    expect(init.method).toBe('POST');
    expect(headers.get('Idempotency-Key')).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(headers.get('Authorization')).toBe('Bearer candidate-token');
  });

  it('preserves HTTP status on API failures so the caller can distinguish them from transport failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'AI service is temporarily unavailable. Please try again shortly.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })));
    await expect(requestApi('/assessments/generate', { method: 'POST' }))
      .rejects.toMatchObject({ status: 503, message: 'The interview service is temporarily unavailable. Please try again shortly.' });
  });

  it('gives actionable guidance for auth failures while preserving provider quota messages', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Today’s AI request limit has been reached. Please try again after the quota resets.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })));

    await expect(requestApi('/assessments/generate')).rejects.toMatchObject({ status: 401, message: 'Please sign in again to start this interview.' });
    await expect(requestApi('/assessments/generate')).rejects.toMatchObject({ status: 429, message: 'Today’s AI request limit has been reached. Please try again after the quota resets.' });
  });

  it.each([undefined, 'short', 'x'.repeat(129)])('replaces a missing or invalid start key (%s) before fetch', async (key) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'attempt-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await generateMockInterview({
      idempotencyKey: key,
      role: 'Full-stack developer',
      category: 'React',
      difficulty: 'INTERMEDIATE',
      count: 8,
      durationMinutes: 15,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const outgoingKey = new Headers(init.headers).get('Idempotency-Key');
    expect(outgoingKey).toBeTruthy();
    expect(outgoingKey!.length).toBeGreaterThanOrEqual(8);
    expect(outgoingKey!.length).toBeLessThanOrEqual(128);
  });

  it.each([
    ['Headers object', new Headers([['Idempotency-Key', 'headers-instance-key']])],
    ['tuple array', [['Idempotency-Key', 'tuple-array-key']] as [string, string][]],
  ])('preserves custom headers supplied as a %s', async (_kind, customHeaders) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await requestApi('/assessments/generate', { method: 'POST', headers: customHeaders });

    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('Idempotency-Key')).toBe(customHeaders instanceof Headers
      ? 'headers-instance-key'
      : 'tuple-array-key');
  });
});
