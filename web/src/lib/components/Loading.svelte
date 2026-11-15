<script lang="ts">
	import { Trace } from 'warren/burrow';

	/** Burrow's Loader: footprints walking, while a page's data is on its way. */
	let { label = '' }: { label?: string } = $props();
</script>

<div class="center" style="padding:var(--space-8) 0">
	<div class="bh-loader" role="status" aria-label={label || 'Loading'}>
		<span class="bh-loader__trail">
			{#each [0, 1, 2, 3] as i (i)}
				<Trace name="footprint" size={20} class="bh-loader__print" style="animation-delay:{i * 0.35}s" />
			{/each}
		</span>
		{#if label}<span class="bh-loader__label">{label}</span>{/if}
	</div>
</div>
