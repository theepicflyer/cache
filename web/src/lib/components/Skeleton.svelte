<script lang="ts">
	/**
	 * Where a screen will be while its data is on its way: the header band (unless the screen draws its
	 * own) and a few cards, gently pulsing. Replaced by the screen itself, whose cards then rise in.
	 */
	let { habitat = true, cards = [220, 160, 260] }: { habitat?: boolean; cards?: number[] } = $props();
</script>

<div class="skeleton" role="status" aria-label="Loading">
	{#if habitat}<div class="skeleton__band wn-skeleton"></div>{/if}
	<div class="skeleton__cards">
		{#each cards as height, i (i)}<div class="skeleton__card wn-skeleton" style:height="{height}px" style:animation-delay="{i * 120}ms"></div>{/each}
	</div>
</div>
