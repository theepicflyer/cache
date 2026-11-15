<script lang="ts">
	import CategoryTile from '#lib/components/CategoryTile.svelte';
	import Empty from '#lib/components/Empty.svelte';
	import Habitat from '#lib/components/Habitat.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { day, money, signedMoney } from '#lib/format.ts';
	import { loaded } from 'warren/web';
	import type { RecurringList } from '#lib/types.ts';

	const list = loaded<RecurringList>(() => '/api/recurring');
	const data = $derived(list.data);
</script>

<svelte:head><title>Recurring · Cache</title></svelte:head>

{#if !data}
	<Skeleton cards={[60, 360]} />
{:else}
	<Habitat kind="river" mood="happy">
		<span class="bh-habitat__eyebrow"><a href="/settings" style="color:inherit">Settings</a></span>
		<h1 class="page-title">Recurring</h1>
		<div class="bh-facts">
			<span class="bh-tag">About {money(data.monthly_out)} a month out</span>
			{#if data.monthly_in}<span class="bh-tag bh-tag--in">{money(data.monthly_in)} a month in</span>{/if}
		</div>
	</Habitat>
	<div class="stack">
		<div class="note">Each one adds a transaction on its date. Edits change every entry still to come; entries already added stay as they are.</div>
		<section class="bh-card">
			{#each data.rules as r (r.id)}
				<a class="spend wn-press" href="/recurring/{r.id}">
					<CategoryTile category={r.category} class={r.paused || !r.next ? 'tile--off' : ''} />
					<span class="spend__text">
						<span class="spend__title">{r.title}</span>
						<span class="spend__sub">
							<span>{r.category.name}</span>
							<span class="spend__freq"><Icon name="repeat" size={14} />{r.frequency}</span>
							{#if r.month_offset}<span class="bh-tag bh-tag--note">for the month before</span>{/if}
						</span>
					</span>
					<span class="bh-row__end">
						<span class="spend__amount" class:is-in={r.type === 'income'}>{signedMoney(r.amount, r.type)}</span>
						{#if r.paused}<span class="bh-tag">Paused</span>{:else if r.next}<span class="bh-when"><Icon name="calendar" size={14} />{day(r.next)}</span>{:else}<span class="bh-tag">Ended</span>{/if}
					</span>
				</a>
			{:else}
				<Empty who={null} title="Nothing recurring yet">Add rent, bills, subscriptions or pay once and they appear on their own.</Empty>
			{/each}
			<div class="actions" style="margin-top:12px"><a class="bh-btn bh-btn--primary wn-press" href="/recurring/new"><Icon name="plus" size={20} /> Add recurring</a></div>
		</section>
	</div>
{/if}
