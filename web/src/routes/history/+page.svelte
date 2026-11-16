<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { fade, flip, get, loaded, query, rise, row } from 'warren/web';
	import Empty from '#lib/components/Empty.svelte';
	import { Habitat } from 'warren/burrow';
	import Icon from '#lib/components/Icon.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import TransactionRow from '#lib/components/TransactionRow.svelte';
	import { day, money, month } from '#lib/format.ts';
	import { toasts } from '#lib/state.svelte.ts';
	import type { History } from '#lib/types.ts';
	import { untrack } from 'svelte';

	const params = $derived(page.url.searchParams);
	const filters = $derived({
		q: params.get('q') ?? '',
		type: params.get('type') ?? '',
		month: params.get('month') ?? '',
		category: params.get('category') ?? ''
	});

	const history = loaded<History>(() => `/api/history${query({ ...filters, page: params.get('page') })}`);
	const data = $derived(history.data);

	/** Older pages appended by "Load older transactions"; they belong to the first page they were loaded under. */
	let older = $state<History[]>([]);
	let loadingOlder = $state(false);
	$effect(() => {
		void history.data;
		older = [];
	});
	const last = $derived(older.at(-1) ?? data);

	/**
	 * The filters the list on screen was loaded with. Other filters cross-fade to a new list; the same
	 * filters loaded again (after an edit, say) keep the list, and its rows slide in and out.
	 */
	const shownFilters = $derived.by(() => {
		void history.data;
		return untrack(() => JSON.stringify(filters));
	});

	async function loadOlder() {
		if (!last || loadingOlder) return;
		loadingOlder = true;
		const base = data;
		try {
			const next = await get<History>(`/api/history${query({ ...filters, page: last.page + 1 })}`);
			// The filters or the ledger changed while this was on its way: the page it continues is gone.
			if (base === history.data) older = [...older, next];
		} catch (err) {
			toasts.error(err);
		} finally {
			loadingOlder = false;
		}
	}

	/** The filters live in the address. Typing replaces it, so one search is one step back, not one per letter. */
	function apply(change: Partial<typeof filters>, replace = false) {
		const next = { ...filters, ...change };
		goto(`/history${query(next)}`, { replace, reset: false });
	}

	let q = $state(page.url.searchParams.get('q') ?? '');
	let typing: ReturnType<typeof setTimeout> | undefined;
	// Follow the address (back, forward, a link) unless a search is still waiting to be applied.
	$effect(() => {
		const fromUrl = filters.q;
		if (!typing) q = fromUrl;
	});
	function onSearch() {
		clearTimeout(typing);
		typing = setTimeout(() => {
			typing = undefined;
			if (q !== filters.q) apply({ q }, true);
		}, 300);
	}
</script>

<svelte:head><title>History · Cache</title></svelte:head>

{#if !data}
	<Skeleton cards={[150, 300, 300]} />
{:else}
	<Habitat class="bh-habitat--page" bounce kind="burrow" mood={data.filtered && !data.count ? 'worried' : 'happy'}>
		<span class="bh-habitat__eyebrow">Transactions</span>
		<h1 class="page-title">History</h1>
		{#if data.filtered}
			<div class="bh-facts">
				<span class="bh-tag">{data.count} found</span>
				{#if data.spent}<span class="bh-tag">{money(data.spent)} out</span>{/if}
				{#if data.received}<span class="bh-tag bh-tag--in">{money(data.received)} in</span>{/if}
			</div>
		{:else}
			<p class="bh-habitat__sub">{data.count} in all</p>
		{/if}
	</Habitat>

	<form class="filters" role="search" onsubmit={(e) => e.preventDefault()}>
		<label class="input input--affix">
			<Icon name="search" size={20} />
			<span class="sr-only">Search</span>
			<input type="search" name="q" bind:value={q} oninput={onSearch} placeholder="Search titles and notes" enterkeyhint="search" />
		</label>
		<div class="bh-seg" role="radiogroup" aria-label="Type">
			{#each [['', 'All'], ['expense', 'Expenses'], ['income', 'Income']] as [value, label] (value)}
				<label
					><input type="radio" name="type" {value} checked={filters.type === value} onchange={() => apply({ type: value })} /><span class="bh-seg__opt">{label}</span></label
				>
			{/each}
		</div>
		<div class="filters__row">
			<label
				><span class="sr-only">Month</span>
				<select class="select" name="month" value={filters.month} onchange={(e) => apply({ month: e.currentTarget.value })}>
					<option value="">All months</option>
					{#each data.months as m (m)}<option value={m}>{month(m)}</option>{/each}
				</select>
			</label>
			<label
				><span class="sr-only">Category</span>
				<select class="select" name="category" value={filters.category} onchange={(e) => apply({ category: e.currentTarget.value })}>
					<option value="">All categories</option>
					{#each data.categories as c (c.id)}<option value={String(c.id)}>{c.name}{c.archived ? ' (archived)' : ''}</option>{/each}
				</select>
			</label>
		</div>
	</form>

	<div id="results">
		{#if data.days.length}
			{#key shownFilters}
				<div in:fade={{ duration: 220 }}>
					{#each [data, ...older] as chunk (chunk.page)}
						<!-- an older page rises in under the last -->
						<div class="chunk" in:rise>
							{#each chunk.days as d (d.date)}
								<section class="day-group" transition:row animate:flip>
									<h2 class="day"><Icon name="calendar" size={16} />{d.date === data.today ? 'Today' : day(d.date)}<span class="day__line" aria-hidden="true"></span></h2>
									<div class="list">
										{#each d.rows as txn (txn.id)}<div class="txn" transition:row animate:flip><TransactionRow {txn} /></div>{/each}
									</div>
								</section>
							{/each}
						</div>
					{/each}
				</div>
			{/key}
			{#if last && last.page < last.pages}
				<div class="more">
					<button type="button" class="bh-btn bh-btn--secondary bh-btn--sm wn-press" disabled={loadingOlder} onclick={loadOlder}>Load older transactions</button>
				</div>
			{/if}
		{:else if data.filtered}
			<div class="bh-card"><Empty who={null} title="No matches">Gali dug everywhere. Try a shorter word or another month.</Empty></div>
		{:else}
			<div class="bh-card"><Empty who={null} title="Nothing here yet">Tap the plus to add your first expense or income.</Empty></div>
		{/if}
	</div>
{/if}
