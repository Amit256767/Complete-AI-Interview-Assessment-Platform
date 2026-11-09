import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generateContent: vi.fn(), getGenerativeModel: vi.fn() }));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(config: { model: string }) {
      mocks.getGenerativeModel(config);
      return { generateContent: (prompt: string) => mocks.generateContent(config.model, prompt) };
    }
  },
}));

import { evaluateInterviewAnswers, generateQuestions } from '../src/ai.js';

const questions = Array.from({ length: 8 }, (_, index) => ({
  prompt: `How would you handle engineering scenario ${index + 1}?`,
  type: 'SCENARIO' as const,
  options: ['Choice A', 'Choice B', 'Choice C', 'Choice D'],
  answerIndex: 0,
  explanation: 'Explain the decision and the tradeoffs.',
}));
const evaluation = {
  overallScore: 80,
  feedback: 'Clear answers with room for more detail.',
  strengths: ['Good reasoning'],
  weaknesses: ['Explain tradeoffs'],
  questionScores: Array.from({ length: 8 }, (_, index) => ({
    position: index + 1,
    score: 80,
    feedback: `Feedback for question ${index + 1}.`,
    strengths: ['Relevant answer'],
    weaknesses: ['Add detail'],
  })),
};
const success = (value: unknown) => ({ response: { text: () => JSON.stringify(value), usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } } });
const generationInput = { role: 'Backend Engineer', category: 'Systems', difficulty: 'INTERMEDIATE' };
const answers = questions.map((question, index) => ({
  position: index + 1,
  prompt: question.prompt,
  selectedAnswer: question.options[0],
  correctAnswer: question.options[0],
  isCorrect: true,
  explanation: question.explanation,
}));

describe('combined mock interview Gemini calls', () => {
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

  it('uses exactly 2 primary Gemini calls for one completed 8-answer interview', async () => {
    mocks.generateContent.mockResolvedValueOnce(success(questions)).mockResolvedValueOnce(success(evaluation));
    const usageEvents: unknown[] = [];
    const onUsage = async (event: unknown) => { usageEvents.push(event); };

    const generated = await generateQuestions(generationInput, { operation: 'GENERATION', onUsage });
    expect(generated).toHaveLength(8);
    const result = await evaluateInterviewAnswers(answers, { operation: 'EVALUATION', onUsage });

    expect(result).toMatchObject({ overallScore: 80 });
    expect(result.questionScores).toHaveLength(8);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(mocks.generateContent.mock.calls.map(([model]) => model)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash']);
    expect(mocks.generateContent.mock.calls[1][1]).toContain('"position":8');
    expect(usageEvents).toHaveLength(2);
    expect(usageEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'GENERATION', succeeded: true, totalTokens: 150 }),
      expect.objectContaining({ operation: 'EVALUATION', succeeded: true, totalTokens: 150 }),
    ]));
  });

  it('treats a whitespace-only API key as missing configuration', async () => {
    vi.stubEnv('GEMINI_API_KEY', '   ');
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toMatchObject({ message: 'AI_NOT_CONFIGURED' });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('retries transient 503 responses with one API call per attempt', async () => {
    mocks.generateContent.mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 })).mockResolvedValueOnce(success(questions));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).resolves.toHaveLength(8);
    expect(mocks.generateContent.mock.calls.map(([model]) => model)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash']);
  });

  it('uses fallback only after primary retries fail', async () => {
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('temporary outage'), { status: 503 }))
      .mockResolvedValueOnce(success(questions));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).resolves.toHaveLength(8);
    expect(mocks.generateContent.mock.calls.map(([model]) => model)).toEqual([
      'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.7-flash',
    ]);
  });

  it('returns an unavailable response when retries and fallback are exhausted', async () => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('temporary outage'), { status: 503 }));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toMatchObject({ status: 503 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(4);
  });

  it.each([400, 401, 403, 404])('does not retry or fall back for non-retryable HTTP %i errors', async status => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('provider request rejected'), { status }));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toMatchObject({
      status: 503,
      providerStatus: status,
      diagnosis: status === 401 || status === 403 ? 'check_api_key_or_permissions'
        : status === 404 ? 'check_model_name_or_endpoint' : 'check_request_format_or_project_prerequisites',
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.generateContent.mock.calls[0][0]).toBe('gemini-3.8-flash');
  });

  it('logs safe diagnostics for provider errors without logging raw error details or secrets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const apiKey = 'super-secret-gemini-key';
    mocks.generateContent.mockRejectedValue(Object.assign(
      new Error(`API key ${apiKey} rejected: private provider response`),
      { status: 403, errorDetails: [{ reason: 'PERMISSION_DENIED', message: `key=${apiKey}` }] },
    ));

    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toMatchObject({ status: 503 });

    const log = warn.mock.calls.map(([message]) => String(message)).join('\n');
    expect(log).toContain('status=403');
    expect(log).toContain('diagnosis=check_api_key_or_permissions');
    expect(log).toContain('provider_reason=PERMISSION_DENIED');
    expect(log).not.toContain(apiKey);
    expect(log).not.toContain('private provider response');
  });

  it('classifies model, request, quota, and provider availability from HTTP status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [status, diagnosis] of [
      [400, 'check_request_format_or_project_prerequisites'],
      [404, 'check_model_name_or_endpoint'],
      [429, 'project_quota_exhausted'],
      [503, 'provider_unavailable'],
    ] as const) {
      vi.clearAllMocks();
      mocks.generateContent.mockRejectedValue(Object.assign(new Error('provider failure'), { status }));
      await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toBeDefined();
      expect(warn.mock.calls.map(([message]) => String(message)).join('\n')).toContain(`diagnosis=${diagnosis}`);
    }
  });

  it('retries a per-minute 429 but stops on a daily quota 429', async () => {
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error('rate_limit_exceeded: requests per minute'), { status: 429, errorDetails: { reason: 'rate_limit_exceeded' } }))
      .mockResolvedValueOnce(success(questions));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).resolves.toHaveLength(8);
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('quota_exceeded: daily quota'), { status: 429, errorDetails: { reason: 'quota_exceeded' } }));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toMatchObject({ message: 'AI_QUOTA_EXCEEDED', status: 429 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });

  it('retries a timed out generation and then uses the configured fallback model', async () => {
    vi.useFakeTimers();
    vi.stubEnv('GEMINI_RETRY_ATTEMPTS', '1');
    mocks.generateContent.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(success(questions));
    const result = generateQuestions(generationInput, { operation: 'GENERATION' });
    await vi.advanceTimersByTimeAsync(25_001);
    await expect(result).resolves.toHaveLength(8);
    expect(mocks.generateContent.mock.calls.map(([model]) => model)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash']);
    vi.useRealTimers();
  });

  it('rejects malformed Gemini output that is not exactly eight questions', async () => {
    mocks.generateContent.mockResolvedValue(success(questions.slice(0, 7)));
    await expect(generateQuestions(generationInput, { operation: 'GENERATION' })).rejects.toMatchObject({ message: 'AI_PROVIDER_UNAVAILABLE', status: 503 });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
});
