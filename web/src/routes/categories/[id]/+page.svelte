<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, changes, del, loaded, patch } from 'warren/web';
	import type { ChartData } from '#lib/charts.ts';
	import CategoryForm, { type CategoryValues } from '#lib/components/CategoryForm.svelte';
	import CategoryTile from '#lib/components/CategoryTile.svelte';
	import Chart from '#lib/components/Chart.svelte';
	import Empty from '#lib/components/Empty.svelte';
	import { Habitat } from 'warren/burrow';
	import Icon from '#lib/components/Icon.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import TransactionRow from '#lib/components/TransactionRow.svelte';
	import { money, month } from '#lib/format.ts';
	import { smoothDetails } from '#lib/motion.svelte.ts';
	import { entry, toasts } from '#lib/state.svelte.ts';
	import type { CategoryDetail, Kind } from '#lib/types.ts';

	const detail = loaded<CategoryDetail>(() => `/api/categories/${page.params.id}`);
	const data = $derived(detail.data);
	const cat = $derived(data?.category);
	const trend = $derived(data?.history.kind === 'budget' ? data.history.trend : null);

	const KINDS: Record<Kind, string> = { budget: 'Budget', fund: 'Sinking fund', income: 'Income' };
	/** Decimal text as the old form showed it ("700.00"), so a saved amount reads the same. */
	const decimal = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
	/** "Nov 26", the chart's x axis. */
	const label = (m: string) => `${month(m, 'abbr')} ${m.slice(2, 4)}`;

	const chart = $derived.by((): ChartData | null => {
		const h = data?.history;
		if (!h) return null;
		const labels = h.months.map(label);
		if (h.kind === 'income') return { kind: 'income', labels, received: h.received };
		if (h.kind === 'fund') return { kind: 'fund', labels, balance: h.balances, spent: h.spent };
		return { kind: 'budget', labels, budget: h.trend.cells.map((c) => c.budget), spent: h.trend.cells.map((c) => c.spent) };
	});

	let values = $state<CategoryValues | null>(null);
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);

	// The form starts from what is saved each time the category loads, as the old page did after every save.
	$effect(() => {
		if (!data) return;
		const c = data.category;
		values = {
			name: c.name,
			kind: c.kind,
			icon: c.icon,
			amount: decimal(data.amount_now),
			from_month: data.this_month.slice(0, 7),
			opening_balance: decimal(c.opening_balance),
			target: decimal(c.target),
			archived: c.archived
		};
		errors = {};
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!values || !cat) return;
		saving = true;
		try {
			const res = await patch<{ toast: string }>(`/api/categories/${cat.id}`, values);
			toasts.show(res.toast);
			changes.changed();
		} catch (err) {
			if (err instanceof ApiError && Object.keys(err.errors).length) errors = err.errors;
			else toasts.error(err);
		} finally {
			saving = false;
		}
	}

	async function removeAmount(id: number) {
		try {
			const res = await del<{ toast: string }>(`/api/amounts/${id}`);
			toasts.show(res.toast);
			changes.changed();
		} catch (err) {
			toasts.error(err);
		}
	}

	async function remove() {
		if (!cat) return;
		try {
			const res = await del<{ toast: string; result: 'archived' | 'deleted' }>(`/api/categories/${cat.id}`);
			if (res.result === 'archived') {
				changes.changed();
				// Archiving instead of deleting is a heads-up, so it is Kayu's worried toast like the old error message.
				toasts.show(res.toast, { who: 'kayu', mood: 'worried' });
			} else {
				// Leave first: reloading this page now would ask for a category that no longer exists.
				await goto('/settings');
				changes.changed();
				toasts.show(res.toast);
			}
		} catch (err) {
			toasts.error(err);
		}
	}
</script>

<svelte:head><title>{cat?.name ?? 'Category'} · Cache</title></svelte:head>

{#if !data || !cat || !chart}
	<Skeleton />
{:else}
	<Habitat class="bh-habitat--page" bounce kind="oak" mood={cat.kind === 'fund' ? ((data.balance ?? 0) < 0 ? 'worried' : 'happy') : trend?.consistently_over ? 'worried' : 'happy'}>
		<span class="bh-habitat__eyebrow"><a href="/settings" style="color:inherit">Settings</a> · {KINDS[cat.kind]}{cat.archived ? ' · archived' : ''}</span>
		<h1 class="page-title page-title--icon"><CategoryTile category={cat} />{cat.name}</h1>
		<div class="bh-facts">
			{#if cat.kind === 'income'}
				<span class="bh-tag bh-tag--in">{money(data.received_now)} this month</span>
			{:else if cat.kind === 'fund'}
				<span class="bh-tag" class:bh-tag--over={(data.balance ?? 0) < 0}>{money(data.balance)} saved</span>
				<span class="bh-tag bh-tag--in">+{money(data.amount_now)} a month</span>
			{:else}
				<span class="bh-tag">{money(data.amount_now)} a month</span>
				{#if trend?.months_counted}<span class="bh-tag" class:bh-tag--over={trend.consistently_over}>Over in {trend.months_over} of {trend.months_counted} months</span>{/if}
			{/if}
		</div>
	</Habitat>

	<div class="cols">
		<section class="bh-card span-2" aria-labelledby="hist-title">
			<div class="bh-card__head">
				<h2 class="bh-card__title section-title" id="hist-title">
					{cat.kind === 'income' ? 'Received' : cat.kind === 'fund' ? 'Balance' : 'Spent against budget'}, last 12 months
				</h2>
				<button type="button" class="bh-btn bh-btn--secondary bh-btn--sm wn-press" onclick={() => entry.add(cat.id)}><Icon name="plus" size={18} /> Add</button>
			</div>
			{#if cat.kind === 'budget'}<div class="legend" style="margin-bottom:8px"><span class="l-spent">Spent</span><span class="l-spent-over">Spent, over</span><span class="l-budget">Budget</span></div>{/if}
			<Chart data={chart} label="History" small />
			{#if trend?.months_counted}
				<div class="kpis" style="margin-top:16px">
					<div class="kpi"><span class="kpi__label">Average spent</span><span class="kpi__value">{money(trend.avg_spent)}</span><span class="kpi__sub">a month</span></div>
					<div class="kpi"><span class="kpi__label">Average budget</span><span class="kpi__value">{money(trend.avg_budget)}</span><span class="kpi__sub">a month</span></div>
					<div class="kpi">
						<span class="kpi__label">Months over</span><span class="kpi__value" class:over-text={trend.consistently_over}>{trend.months_over} of {trend.months_counted}</span><span class="kpi__sub"
							>{trend.total_over ? `${money(trend.total_over)} over in all` : 'never over'}</span
						>
					</div>
				</div>
			{/if}
		</section>

		<section class="bh-card" aria-labelledby="edit-title">
			<div class="bh-card__head"><h2 class="bh-card__title section-title" id="edit-title">Edit</h2></div>
			{#if values}
				<form class="form-grid" onsubmit={save}>
					<CategoryForm bind:values {errors} editing />
					<div class="actions actions--end"><button class="bh-btn bh-btn--primary wn-press" type="submit" disabled={saving}>Save {cat.kind === 'fund' ? 'fund' : 'category'}</button></div>
				</form>
			{/if}
			{#if cat.kind !== 'income'}
				<details class="disclosure disclosure--ruled" {@attach smoothDetails}>
					<summary>Amount history <Icon name="chevron-down" size={20} /></summary>
					<div class="list list--flat">
						{#each data.amounts as row (row.id)}
							<div class="setting">
								<span class="grow"><span class="bh-when"><Icon name="calendar" size={14} />From {month(row.start_month, 'short')}</span></span>
								<span class="bh-row__end"><span class="setting__value">{money(row.amount)}</span><span class="bh-row__detail">a month</span></span>
								{#if data.amounts.length > 1}
									<button type="button" class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--icon wn-press" aria-label="Remove this change" onclick={() => removeAmount(row.id)}><Icon name="x" size={16} /></button>
								{/if}
							</div>
						{/each}
					</div>
				</details>
			{/if}
			<!-- the card's action, in the tray along its bottom -->
			<div class="bh-card__tray">
				<button class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--danger wn-press" type="button" onclick={remove}><Icon name="trash" size={18} /> {data.recent.length ? 'Archive' : 'Delete'} {cat.name}</button>
			</div>
		</section>

		<section class="bh-card" aria-labelledby="spends-title">
			<div class="bh-card__head">
				<h2 class="bh-card__title section-title" id="spends-title">Latest</h2>
				<a class="card-link" href="/history?category={cat.id}">See all</a>
			</div>
			{#if data.recent.length}
				<div class="list list--flat">
					{#each data.recent as txn (txn.id)}<TransactionRow {txn} showDate />{/each}
				</div>
			{:else}
				<Empty who={null} title="Nothing yet">Transactions in {cat.name} show up here.</Empty>
			{/if}
		</section>
	</div>
{/if}
