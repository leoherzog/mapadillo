/**
 * Generic fetch wrapper for JSON API calls.
 *
 * Behavior:
 * - Throws {@link ApiError} for any non-2xx/204 response, preserving status +
 *   server-provided message when possible.
 * - Retries a single time on 429 Too Many Requests, honoring the `Retry-After`
 *   header (seconds) with a conservative upper bound so a hostile server can't
 *   wedge the UI.
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

/** Hard upper bound on 429 Retry-After delay we'll honor (ms). */
const MAX_RETRY_DELAY_MS = 5_000;
/** Default back-off when the server doesn't send a Retry-After header. */
const DEFAULT_RETRY_DELAY_MS = 500;

/** Parse the Retry-After header (seconds or HTTP-date) into milliseconds. */
function parseRetryAfter(header: string | null): number {
  if (!header) return DEFAULT_RETRY_DELAY_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  const whenMs = Date.parse(header);
  if (Number.isFinite(whenMs)) {
    const delta = whenMs - Date.now();
    return Math.max(0, Math.min(delta, MAX_RETRY_DELAY_MS));
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readErrorBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => null);
  if (!text) return text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed.message !== undefined ? parsed.message : parsed;
  } catch {
    return text;
  }
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const doFetch = () => fetch(path, { credentials: 'same-origin', ...init, ...(signal ? { signal } : {}) });

  let res = await doFetch();

  // Transparent single retry on 429 so callers don't have to implement it.
  if (res.status === 429) {
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    await delay(retryAfter, signal);
    res = await doFetch();
  }

  if (!res.ok) {
    throw new ApiError(res.status, await readErrorBody(res));
  }

  // 204 No Content — nothing to parse.
  // Safe: all 204 callers use Promise<void>.
  if (res.status === 204) return undefined as unknown as T;

  return (await res.json()) as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, undefined, signal);
}

function jsonRequest<T>(method: string, path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  }, signal);
}

export function apiPost<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  return jsonRequest<T>('POST', path, data, signal);
}

export function apiPut<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  return jsonRequest<T>('PUT', path, data, signal);
}

export function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'DELETE' }, signal);
}

export function apiPostForm<T>(path: string, formData: FormData, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: formData,
  }, signal);
}
