/**
 * Generic fetch wrapper for JSON API calls.
 *
 * Throws {@link ApiError} for any non-2xx response, preserving the status and
 * the server-provided message when possible.
 */

/** The worker's non-empty `{ error }` text, if the body carries one. */
function serverError(body: unknown): string | undefined {
  const detail = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof detail === 'string' && detail ? detail : undefined;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(serverError(body) ?? `API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * User-facing text for a failed call: the server's `{ error }` text, a non-API
 * Error's message, or `fallback`.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return serverError(err.body) ?? fallback;
  return err instanceof Error ? err.message : fallback;
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => null);
  if (!text) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, ...(signal ? { signal } : {}) });

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorBody(res));
  }

  // 204 No Content — nothing to parse.
  // Safe: all 204 callers use Promise<void>.
  if (res.status === 204) return undefined as unknown as T;

  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

function jsonRequest<T>(method: string, path: string, data?: unknown, signal?: AbortSignal, keepalive?: boolean): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
    ...(keepalive ? { keepalive } : {}),
  }, signal);
}

export function apiPost<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  return jsonRequest<T>('POST', path, data, signal);
}

/**
 * @param keepalive - lets the request finish after the page unloads; the browser rejects it
 *   once in-flight keepalive bodies pass 64 KiB, so use it only for small payloads
 */
export function apiPut<T>(path: string, data?: unknown, keepalive?: boolean): Promise<T> {
  return jsonRequest<T>('PUT', path, data, undefined, keepalive);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

/** POST a Blob as the raw request body, typed by the blob's MIME type. */
export function apiPostBlob<T>(path: string, blob: Blob): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
}
