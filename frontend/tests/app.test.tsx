// @vitest-environment jsdom
import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

const questions = Array.from({ length: 8 }, (_, index) => ({
  id: `question-${index + 1}`,
  prompt: `Question ${index + 1}: explain this engineering decision.`,
  type: 'SCENARIO',
  options: ['Option A', 'Option B', 'Option C', 'Option D'],
}));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  localStorage.setItem('hp_token', 'candidate-token');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/health')) return json({ status: 'ok', database: 'connected', ai: true });
    if (url.endsWith('/dashboard')) return json({ completed: 0, average: null, best: null, attempts: [] });
    if (url.endsWith('/assessments/generate')) return json({ id: 'attempt-1', questions }, 201);
    throw new Error(`Unexpected API request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function mountApp() {
  await act(async () => root.render(<StrictMode><App /></StrictMode>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  if (!found) throw new Error(`Button not found: ${label}`);
  return found as HTMLButtonElement;
}

describe('AI request behavior in the application UI', () => {
  it('does not generate questions on Intro/overview or Dashboard initialization under StrictMode', async () => {
    await mountApp();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assessments/generate'))).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/dashboard'))).toBe(true);
  });

  it('does not generate questions while opening Practice or navigating between pages', async () => {
    await mountApp();
    await act(async () => button('Practice').click());
    expect(container.textContent).toContain('Choose a practice');
    await act(async () => button('Resume').click());
    await act(async () => button('History').click());
    await act(async () => button('Question Bank').click());
    await act(async () => button('Settings').click());
    await act(async () => button('Overview').click());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assessments/generate'))).toHaveLength(0);
  });

  it('sends one generation request after an explicit start despite repeated clicks', async () => {
    await mountApp();
    await act(async () => button('Practice').click());
    const category = button('React');
    await act(async () => {
      category.click();
      category.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assessments/generate'))).toHaveLength(1);
    const [url, request] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/assessments/generate'))!;
    expect(String(url)).toContain('/api/assessments/generate');
    expect(JSON.parse(String(request?.body))).toMatchObject({ category: 'React', role: 'Full-stack developer', count: 8, durationMinutes: 15 });
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer candidate-token');
    expect(new Headers(request?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(container.textContent).toContain('Practice session');
  });

  it('uses a new idempotency key when changing categories after an uncertain start', async () => {
    let starts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return json({ status: 'ok', database: 'connected', ai: true });
      if (url.endsWith('/dashboard')) return json({ completed: 0, average: null, best: null, attempts: [] });
      if (url.endsWith('/assessments/generate')) return ++starts === 1
        ? json({ error: 'This mock interview is already being generated. Please retry shortly.' }, 409)
        : json({ id: 'attempt-2', questions }, 201);
      throw new Error(`Unexpected API request: ${url}`);
    });
    await mountApp();
    await act(async () => button('Practice').click());
    await act(async () => button('React').click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => button('Python').click());
    const startsSent = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assessments/generate'));
    expect(startsSent).toHaveLength(2);
    const first = new Headers(startsSent[0][1]?.headers).get('Idempotency-Key');
    const second = new Headers(startsSent[1][1]?.headers).get('Idempotency-Key');
    expect(first).not.toBe(second);
    expect(JSON.parse(String(startsSent[1][1]?.body)).category).toBe('Python');
    expect(container.textContent).toContain('Practice session');
  });

  it('does not retry a failed start automatically', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return json({ status: 'ok', database: 'connected', ai: true });
      if (url.endsWith('/dashboard')) return json({ completed: 0, average: null, best: null, attempts: [] });
      if (url.endsWith('/assessments/generate')) return json({ error: 'AI service is temporarily unavailable.' }, 503);
      throw new Error(`Unexpected API request: ${url}`);
    });
    await mountApp();
    await act(async () => button('Practice').click());
    await act(async () => {
      button('React').click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assessments/generate'))).toHaveLength(1);
    expect(container.textContent).toContain('The interview service is temporarily unavailable. Please try again shortly.');
  });
});
