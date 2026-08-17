export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function buildQueryString(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `?${query}` : "";
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = init.body === undefined
    ? { ...init.headers }
    : { "Content-Type": "application/json", ...init.headers };

  const response = await fetch(url, {
    cache: method === "GET" ? "no-store" : undefined,
    headers,
    ...init,
  });

  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiErrorFromResponse(response: Response) {
  const body = await response.json().catch(() => undefined) as
    | { error?: string; message?: string }
    | undefined;
  return new ApiError(
    response.status,
    body?.error ?? "request_failed",
    body?.message ?? `API request failed: ${response.status}`,
  );
}
