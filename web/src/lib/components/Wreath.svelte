<script lang="ts">
	import type { Snippet } from 'svelte';
	import { wreathArt } from '#lib/burrow/scenes/art.ts';

	/**
	 * Burrow Ring, wreath variant (Cache's month): 26 oak leaves turn green as the month's budget is
	 * spent. The children sit in the centre.
	 */
	let { leaves = 0, class: klass = '', children }: { leaves?: number; class?: string; children: Snippet } = $props();
</script>

<div class="bh-wreath-wrap {klass}">
	<div class="bh-ring bh-ring--wreath" style="width:196px;height:196px">
		{@html wreathArt(leaves)}
		<div class="bh-ring__center" style="width:196px;height:196px">{@render children()}</div>
	</div>
</div>
