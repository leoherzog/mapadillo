/**
 * Generic fetch wrapper for JSON API calls.
 */

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, ...(signal ? { signal } : {}) });

  if (!res.ok) {
    const text = await res.text().catch(() => null);
    let body: unknown = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        body = parsed.message !== undefined ? parsed.message : parsed;
      } catch {
        // keep raw text as body
      }
    }
    throw new ApiError(res.status, body);
  }

  // 204 No Content — nothing to parse.
  // Safe: all 204 callers use Promise<void>.
  if (res.status === 204) return undefined as unknown as T;

  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  }, signal);
}

export function apiPut<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
