import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn(),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(config: { model: string }) {
      mocks.getGenerativeModel(config);
      return { generateContent: (prompt: string) => mocks.generateContent(config.model, prompt) };
    }
  },
}));

import { generateQuestions } from '../src/ai.js';

const validQuestions = [{
  prompt: 'How do you isolate a production incident?',
  type: 'SCENARIO',
  options: ['A', 'B', 'C', 'D'],
  answerIndex: 0,
  explanation: 'Start by checking the impact and scope.',
}];

const success = () => ({ response: { text: () => JSON.stringify(validQuestions) } });
const input = { role: 'Backend Engineer', category: 'Systems', difficulty: 'INTERMEDIATE', count: 1 };

describe('Gemini transient failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test-only-api-key');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    vi.stubEnv('GEMINI_FALLBACK_MODEL', 'gemini-3.7-flash');
    vi.stubEnv('GEMINI_RETRY_ATTEMPTS', '2');
    vi.stubEnv('GEMINI_RETRY_BASE_DELAY_MS', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('retries a transient 503 and succeeds on the primary model', async () => {
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
      .mockResolvedValueOnce(success());

    await expect(generateQuestions(input)).resolves.toEqual(validQuestions);
    expect(mocks.generateContent.mock.calls.map(([model]) => model)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.8-flash',
    ]);
  });

  it('uses the configured fallback only after primary retries fail', async () => {
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
      .mockResolvedValueOnce(success());

    await expect(generateQuestions(input)).resolves.toEqual(validQuestions);
    expect(mocks.generateContent.mock.calls.map(([model]) => model)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
    ]);
  });

  it('returns a service-unavailable error after all attempts are exhausted', async () => {
    vi.stubEnv('GEMINI_FALLBACK_MODEL', '');
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('temporary outage'), { status: 503 }));

    await expect(generateQuestions(input)).rejects.toMatchObject({
      message: 'AI_PROVIDER_UNAVAILABLE',
      status: 503,
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404])('does not retry or fallback for non-retryable HTTP %i errors', async status => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('provider request rejected'), { status }));

    await expect(generateQuestions(input)).rejects.toMatchObject({
      message: 'AI_PROVIDER_UNAVAILABLE',
      status: 503,
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.generateContent.mock.calls[0][0]).toBe('gemini-3.8-flash');
  });
});
