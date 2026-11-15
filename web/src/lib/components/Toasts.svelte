<script lang="ts">
	import { toasts } from '#lib/state.svelte.ts';

	/** Burrow toasts: a dark pill with a small animal, one at a time, above the bottom nav. */
	const toast = $derived(toasts.current);
</script>

<div class="toasts" aria-live="polite">
	{#if toast}
		{#key toast.id}
			<div class="bh-toast" role="status">
				<span class="bh-toast__bub"><img class="bh-mascot" src="/img/burrow/characters/{toast.who}-{toast.mood}.svg" width="36" height="36" alt="" /></span>
				<span class="bh-toast__text">{toast.message}</span>
				{#if toast.action}
					{@const action = toast.action}
					<button
						type="button"
						class="bh-btn bh-btn--ghost bh-btn--sm"
						onclick={() => {
							// read it before dismissing: `action` is derived from the toast, which dismiss clears
							const run = action.run;
							toasts.dismiss();
							run();
						}}>{action.label}</button
					>
				{/if}
			</div>
		{/key}
	{/if}
</div>
