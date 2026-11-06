const PRODUCTION_API_URL = 'https://complete-ai-interview-assessment-platform.onrender.com/api';

function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export const API_BASE_URL = normalizeApiBase(
  import.meta.env.PROD
    ? PRODUCTION_API_URL
    : import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
);

export function apiUrl(path: string): string {
  const route = path.replace(/^\/+/, '').replace(/^api(?:\/|$)/, '');
  return `${API_BASE_URL}/${route}`;
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
  idempotencyKey: string;
  role: string;
  category: string;
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  count: 8;
  durationMinutes: number;
  resumeId?: string;
}, token = ''): Promise<T> {
  return requestApi<T>('/assessments/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
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
