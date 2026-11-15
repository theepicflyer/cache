<script lang="ts">
	import { ICONS, type IconName } from '#lib/icons.ts';

	/** One of Burrow's stroke icons. Decorative unless it has a `label`. */
	let { name, size = 24, label = '' }: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg
	class="bh-icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2.2"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}><path d={ICONS[name]} /></svg
>
