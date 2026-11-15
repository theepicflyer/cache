import { goto } from '$app/navigation';

/** A failed request. `errors` holds per-field messages when the server refused a form. */
export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public errors: Record<string, string> = {}
	) {
		super(message);
	}
}

async function failure(res: Response): Promise<ApiError> {
	try {
		const body = await res.json();
		if (body.errors && typeof body.errors === 'object') {
			return new ApiError(res.status, Object.values(body.errors as Record<string, string>).join(' '), body.errors);
		}
		if (typeof body.detail === 'string') return new ApiError(res.status, body.detail);
	} catch {
		/* not JSON */
	}
	return new ApiError(res.status, `${res.status} ${res.statusText}`);
}

/** Fetch against the Cache API. Every call carries X-Warren, which the server requires on writes. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set('X-Warren', '1');
	const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
	if (res.status === 401 && !location.pathname.startsWith('/login')) {
		await goto('/login');
		throw new ApiError(401, 'Not signed in');
	}
	if (!res.ok) throw await failure(res);
	return (await res.json()) as T;
}

function withBody(method: string, body: unknown): RequestInit {
	return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) };
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, withBody('POST', body));
export const put = <T>(path: string, body: unknown) => api<T>(path, withBody('PUT', body));
export const patch = <T>(path: string, body: unknown) => api<T>(path, withBody('PATCH', body));
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/** A query string from the values that are set. */
export function query(params: Record<string, string | number | null | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
	}
	const text = search.toString();
	return text ? `?${text}` : '';
}
