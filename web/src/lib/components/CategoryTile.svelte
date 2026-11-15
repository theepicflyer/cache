<script lang="ts">
	import type { Category } from '#lib/types.ts';
	import { Trace } from 'warren/burrow';
	import CategoryIcon from './CategoryIcon.svelte';

	/** The square tile for a category: its icon, else Kacang's acorn for a fund, else its first letter. */
	let { category, class: klass = '' }: { category: Pick<Category, 'name' | 'kind' | 'display_icon'>; class?: string } = $props();
	const kind = $derived(category.kind === 'fund' ? 'tile--fund' : category.kind === 'income' ? 'tile--in' : '');
</script>

<span class="tile {kind} {klass}" aria-hidden={category.display_icon || category.kind === 'fund' ? undefined : 'true'}>
	{#if category.display_icon}
		<CategoryIcon name={category.display_icon} />
	{:else if category.kind === 'fund'}
		<Trace name="acorn" size={26} />
	{:else}
		{(category.name.slice(0, 1) || '?').toUpperCase()}
	{/if}
</span>
