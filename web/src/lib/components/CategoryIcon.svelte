<script lang="ts">
	import { SPRITE } from '#lib/icons.ts';

	/** One icon from the category library. */
	let { name, size = 22 }: { name: string; size?: number } = $props();
</script>

<svg class="cat-icon" width={size} height={size} aria-hidden="true"><use href="{SPRITE}#i-{name}"></use></svg>
