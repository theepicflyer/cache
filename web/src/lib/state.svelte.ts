/**
 * What the whole app shares: who is signed in, toasts and the add/edit flow. The session and toasts
 * are warren/web's; after a write, call `changes.changed()` (from warren/web) so loaded screens refresh.
 */
import { Session, Toasts } from 'warren/web';
import type { Mood } from 'warren/burrow';
import type { Me, Txn } from './types.ts';

export const session = new Session<Me>();

export type Who = 'kacang' | 'gali' | 'kayu' | 'bao';
export type { Mood } from 'warren/burrow';

/** Burrow toasts: a small animal and a message, one at a time, above the bottom nav. Errors are Kayu, worried. */
export const toasts = new Toasts<{ who: Who; mood: Mood }>({
	defaults: { who: 'kacang', mood: 'joy' },
	onError: { who: 'kayu', mood: 'worried' },
	max: 1
});

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
