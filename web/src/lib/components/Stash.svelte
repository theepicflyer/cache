<script lang="ts">
	import type { Snippet } from 'svelte';
	import { stashArt } from 'warren/burrow';

	/**
	 * Burrow Stash: a sinking fund as Kacang's buried acorn store, with 0 to 15 acorns. The children
	 * are Tags (such as the monthly top-up) under the value.
	 */
	let { name, value, target = '', acorns = 0, class: klass = '', children }: { name: string; value: string; target?: string; acorns?: number; class?: string; children?: Snippet } = $props();
</script>

<div class="bh-stash {klass}">
	<div class="bh-stash__art">{@html stashArt(acorns)}</div>
	<div class="bh-stash__label">
		<span class="bh-stash__name">{name}</span>
		<span class="bh-stash__value">{value}</span>
		{#if target}<span class="bh-stash__target">{target}</span>{/if}
		{#if children}<span class="bh-stash__tags">{@render children()}</span>{/if}
	</div>
</div>
