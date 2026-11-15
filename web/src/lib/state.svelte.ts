/** What the whole app shares: who is signed in, toasts, the add/edit flow, and "the ledger changed". */
import { ApiError, get } from './api.ts';
import type { Me, Txn } from './types.ts';

class Session {
	me = $state<Me | null>(null);
	#loading: Promise<Me | null> | null = null;

	load(force = false): Promise<Me | null> {
		if (force || !this.#loading) {
			this.#loading = get<Me>('/api/me')
				.then((me) => (this.me = me))
				.catch(() => (this.me = null));
		}
		return this.#loading;
	}
}
export const session = new Session();

export type Who = 'kacang' | 'gali' | 'kayu' | 'bao';
export type Mood = 'happy' | 'joy' | 'busy' | 'sleepy' | 'worried' | 'wow';
export interface Toast {
	id: number;
	message: string;
	who: Who;
	mood: Mood;
	action: { label: string; run: () => void } | null;
}

/** Burrow toasts: one at a time, above the bottom nav. */
class Toasts {
	current = $state<Toast | null>(null);
	#id = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	show(message: string, options: Partial<Pick<Toast, 'who' | 'mood' | 'action'>> = {}): void {
		const toast: Toast = { id: ++this.#id, message, who: options.who ?? 'kacang', mood: options.mood ?? 'joy', action: options.action ?? null };
		this.current = toast;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.dismiss(toast.id), toast.action ? 6000 : 4000);
	}
	/** Something went wrong: Kayu, worried. */
	error(err: unknown): void {
		const message = err instanceof ApiError || err instanceof Error ? err.message : String(err);
		this.show(message, { who: 'kayu', mood: 'worried' });
	}
	dismiss(id?: number): void {
		if (id === undefined || this.current?.id === id) this.current = null;
	}
}
export const toasts = new Toasts();

/**
 * The ledger's data changed (a transaction was added, a category saved...). Pages read `ledger.version`
 * inside the effect that loads them, so they load again.
 */
class Ledger {
	version = $state(0);
	changed(): void {
		this.version++;
	}
}
export const ledger = new Ledger();

/**
 * The add/edit flow, on every page. `add()` opens it empty (or with a category chosen, which skips
 * the category page), `edit(txn)` opens it on the review page.
 */
class EntryFlow {
	open = $state(false);
	editing = $state<Txn | null>(null);
	category = $state<number | null>(null);

	add(category: number | null = null): void {
		this.editing = null;
		this.category = category;
		this.open = true;
	}
	edit(txn: Txn): void {
		this.editing = txn;
		this.open = true;
	}
	close(): void {
		this.open = false;
	}
}
export const entry = new EntryFlow();
