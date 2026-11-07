function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('VITE_API_URL must be set to the backend API URL.');
  return `${trimmed.replace(/(?:\/api)+$/i, '')}/api`;
}

const configuredApiUrl = import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://complete-ai-interview-assessment-platform.onrender.com/api' : 'http://localhost:4000/api');
export const API_BASE_URL = normalizeApiBase(configuredApiUrl);

export function apiUrl(path: string): string {
  const route = path.replace(/^\/+/, '').replace(/^(?:api\/?)+/i, '');
  return `${API_BASE_URL}/${route}`;
}

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export async function requestApi<T>(path: string, options: RequestInit = {}, token = ''): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    response = await fetch(apiUrl(path), {
      ...options,
      headers,
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE_URL}. Check the backend service and network connection.`);
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  if (!response.ok) {
    throw new Error(data?.error || `API request failed (${response.status}).`);
  }
  if (data === null) throw new Error('The API returned an invalid response.');
  return data as T;
}

export function generateMockInterview<T>(input: {
  idempotencyKey?: string;
  role: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  count: 8;
  durationMinutes: number;
  resumeId?: string;
}, token = ''): Promise<T> {
  const suppliedKey = input.idempotencyKey?.trim();
  const idempotencyKey = suppliedKey && suppliedKey.length >= 8 && suppliedKey.length <= 128
    ? suppliedKey
    : createIdempotencyKey();
  return requestApi<T>('/assessments/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      role: input.role,
      category: input.category,
      difficulty: input.difficulty,
      count: input.count,
      durationMinutes: input.durationMinutes,
      resumeId: input.resumeId,
    }),
  }, token);
}
