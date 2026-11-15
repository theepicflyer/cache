<script lang="ts">
	import { month, signedMoney, day } from '#lib/format.ts';
	import { entry } from '#lib/state.svelte.ts';
	import type { Txn } from '#lib/types.ts';
	import CategoryTile from './CategoryTile.svelte';
	import Icon from './Icon.svelte';

	/** One transaction in a list. A tap opens it in the entry flow. */
	let { txn, showDate = false }: { txn: Txn; showDate?: boolean } = $props();
	const income = $derived(txn.type === 'income');
</script>

<button type="button" class="spend wn-press" onclick={() => entry.edit(txn)}>
	<CategoryTile category={txn.category} class={income && txn.category.kind !== 'income' ? 'tile--in' : ''} />
	<span class="spend__text">
		<span class="spend__title">{txn.title}</span>
		<span class="spend__sub">
			<span>{txn.category.name}</span>
			{#if txn.counts_elsewhere}<span class="bh-tag bh-tag--note">for {month(txn.month, 'short')}</span>{/if}
			{#if txn.recurring_id}<Icon name="repeat" size={14} label="Recurring" />{/if}
			{#if txn.note}<Icon name="note" size={14} label="Has a note" />{/if}
		</span>
	</span>
	<span class="bh-row__end">
		<span class="spend__amount" class:is-in={income}>{signedMoney(txn.amount, txn.type)}</span>
		{#if showDate}<span class="bh-when"><Icon name="calendar" size={14} />{day(txn.date)}</span>{/if}
	</span>
</button>
