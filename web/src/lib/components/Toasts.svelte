<script lang="ts">
	import { toasts } from '#lib/state.svelte.ts';
	import { fly } from 'warren/web';
	import { Mascot } from 'warren/burrow';
	import { backOut, cubicIn } from 'svelte/easing';

	/** Burrow toasts: a dark pill with a small animal, one at a time, above the bottom nav. Each flies up in and drops away. */
</script>

<div class="toasts" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div class="bh-toast" role="status" in:fly={{ y: 24, duration: 380, easing: backOut, opacity: 0 }} out:fly={{ y: 16, duration: 180, easing: cubicIn }}>
			<span class="bh-toast__bub"><Mascot character={toast.who} mood={toast.mood} size={36} /></span>
			<span class="bh-toast__text">{toast.message}</span>
			{#if toast.action}
				{@const action = toast.action}
				<button
					type="button"
					class="bh-btn bh-btn--ghost bh-btn--sm wn-press"
					onclick={() => {
						toasts.dismiss(toast.id);
						action.run();
					}}>{action.label}</button
				>
			{/if}
		</div>
	{/each}
</div>
