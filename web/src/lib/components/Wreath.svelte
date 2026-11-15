<script lang="ts">
	import type { Snippet } from 'svelte';
	import { wreathArt } from 'warren/burrow';

	/**
	 * Burrow Ring, wreath variant (Cache's month): 26 oak leaves turn green as the month's budget is
	 * spent. The children sit in the centre.
	 */
	let { leaves = 0, class: klass = '', children }: { leaves?: number; class?: string; children: Snippet } = $props();

	/** Each leaf numbered (`--i`), so they can light up one after another as the wreath appears. */
	const art = $derived.by(() => {
		let i = 0;
		return wreathArt(leaves).replace(/class="bh-wleaf/g, () => `style="--i:${i++}" class="bh-wleaf`);
	});
</script>

<div class="bh-wreath-wrap {klass}">
	<div class="bh-ring bh-ring--wreath" style="width:196px;height:196px">
		{@html art}
		<div class="bh-ring__center" style="width:196px;height:196px">{@render children()}</div>
	</div>
</div>
