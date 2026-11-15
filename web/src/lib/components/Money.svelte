<script lang="ts">
	import { money } from '#lib/format.ts';
	import { Count } from 'warren/web';

	/**
	 * A headline amount (whole cents) that counts up as it appears and from one value to the next when
	 * it changes, shown as `money()` shows it. On a screen gone back to it shows its value at once.
	 */
	let { value }: { value: number } = $props();
</script>

<Count {value} format={money} />
