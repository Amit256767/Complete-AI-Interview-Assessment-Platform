import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, generateMockInterview, requestApi } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

describe('frontend API request headers', () => {
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
