export type Row = Record<string, any>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Same-origin API client. Mutations carry the CSRF token and a fresh idempotency key. */
export async function request(path: string, method = 'GET', body?: unknown, csrf?: string) {
  const res = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(Array.isArray(data.message) ? data.message.join('، ') : data.message || 'تعذر إكمال الطلب', res.status);
  return data;
}
