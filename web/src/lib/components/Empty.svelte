<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Mood, Who } from '#lib/state.svelte.ts';
	import Mascot from './Mascot.svelte';

	/** Burrow EmptyState for inside a card. A small animal, so it can share a screen with the Habitat; `who={null}` for none. */
	let { who = 'gali', mood = 'sleepy', title, size = 56, children }: { who?: Who | null; mood?: Mood; title: string; size?: number; children?: Snippet } = $props();
</script>

<div class="bh-empty" style="padding:var(--space-4) var(--space-2)">
	{#if who}<Mascot {who} {mood} {size} />{/if}
	<h3 class="bh-empty__title">{title}</h3>
	<div class="bh-empty__body">{@render children?.()}</div>
</div>
