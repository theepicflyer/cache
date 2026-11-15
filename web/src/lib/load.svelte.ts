import { get } from './api.ts';
import { ledger, toasts } from './state.svelte.ts';

/**
 * A page's data. `path` is read reactively, so the data loads again when the address it is built
 * from changes, and when the ledger changes (`ledger.changed()`). The last data stays on screen
 * while the next loads. Call it during component setup.
 *
 *   const home = loaded<Home>(() => `/api/home${query({ month })}`);
 *   {#if home.data} ... {/if}
 */
export function loaded<T>(path: () => string | null): { readonly data: T | null; readonly failed: boolean; reload(): void } {
	let data = $state<T | null>(null);
	let failed = $state(false);
	let again = $state(0);

	$effect(() => {
		const url = path();
		void ledger.version;
		void again;
		if (!url) return;
		let stale = false;
		get<T>(url)
			.then((result) => {
				if (stale) return;
				data = result;
				failed = false;
			})
			.catch((err) => {
				if (stale || err?.status === 401) return;
				failed = true;
				toasts.error(err);
			});
		return () => {
			stale = true;
		};
	});

	return {
		get data() {
			return data;
		},
		get failed() {
			return failed;
		},
		reload: () => void again++
	};
}
