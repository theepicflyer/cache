<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { loaded, query } from 'warren/web';
	import CategoryTile from '#lib/components/CategoryTile.svelte';
	import Empty from '#lib/components/Empty.svelte';
	import { Habitat } from 'warren/burrow';
	import Icon from '#lib/components/Icon.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import Meter from '#lib/components/Meter.svelte';
	import Money from '#lib/components/Money.svelte';
	import Stash from '#lib/components/Stash.svelte';
	import TransactionRow from '#lib/components/TransactionRow.svelte';
	import Wreath from '#lib/components/Wreath.svelte';
	import { day, money, month, plural, signedMoney } from '#lib/format.ts';
	import { settle } from '#lib/motion.svelte.ts';
	import { entry } from '#lib/state.svelte.ts';
	import type { BudgetLine, Home } from '#lib/types.ts';
	import { onMount } from 'svelte';

	const home = loaded<Home>(() => `/api/home${query({ month: page.url.searchParams.get('month') })}`);
	const data = $derived(home.data);
	const status = $derived(data?.status);

	// /?add=1 opens the add flow (the PWA shortcut).
	onMount(() => {
		if (page.url.searchParams.get('add')) {
			entry.add();
			replaceState('/', {});
		}
	});

	// Another month: the header's text and the cards slide in from the side it came from.
	let heading = $state<HTMLElement>();
	let body = $state<HTMLElement>();
	let shownMonth = '';
	$effect(() => {
		const m = data?.month;
		if (!m) return;
		if (shownMonth && m !== shownMonth) settle([heading, body], m > shownMonth ? 1 : -1);
		shownMonth = m;
	});

	const spentText = (b: BudgetLine) => `${b.spent < 0 ? `${money(-b.spent)} back` : money(b.spent)} / ${money(b.budget)}`;
	/** The budget as a share of what was spent, for the tick on an over-budget meter. */
</script>

<svelte:head><title>{data ? month(data.month) : 'Home'} · Cache</title></svelte:head>

{#if !data || !status}
	<Skeleton />
{:else}
	<Habitat class="bh-habitat--page" bounce kind="oak" mood={status.over ? 'worried' : status.budgets.length && !status.total_spent ? 'sleepy' : 'happy'}>
		<span class="bh-habitat__eyebrow">
			<span class="month-nav"><a href="/?month={data.prev_month}" aria-label="Previous month"><Icon name="chevron-left" size={16} /></a></span>
			{month(data.month)}
			<span class="month-nav">
				{#if data.is_current}
					<span aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
				{:else}
					<a href="/?month={data.next_month}" aria-label="Next month"><Icon name="chevron-right" size={16} /></a>
				{/if}
			</span>
		</span>
		<div bind:this={heading}>
			{#if !status.budgets.length}
				<h1 class="page-title">Set up budgets</h1>
			{:else if status.over}
				<h1 class="page-title"><Money value={-status.left} /> over</h1>
			{:else}
				<h1 class="page-title"><Money value={status.left} /> left</h1>
			{/if}
			{#if status.days_left !== null}
				<p class="bh-habitat__sub">{status.days_left === 0 ? 'Last day of the month' : `${plural(status.days_left, 'day')} to go`}</p>
			{:else if !data.is_current}
				<p class="bh-habitat__sub"><a href="/">Back to this month</a></p>
			{/if}
		</div>
	</Habitat>

	{#if !status.budgets.length && !status.funds.length}
		<div class="bh-card">
			<Empty who="kayu" mood="sleepy" title="No categories yet">
				Add the categories you spend in, each with a monthly budget, and any sinking funds.
				<div class="actions" style="justify-content:center;margin-top:12px">
					<a class="bh-btn bh-btn--primary wn-press" href="/categories/new"><Icon name="plus" size={20} /> Add a category</a>
				</div>
			</Empty>
		</div>
	{:else}
		<div class="cols" bind:this={body}>
			<div class="stack">
				{#if status.budgets.length}
					<div class="bh-card">
						<div class="center">
							<Wreath leaves={status.leaves}>
								<span class="ring-big"><Money value={status.total_spent} /></span>
								<span class="ring-small">spent of {money(status.total_budget)}</span>
							</Wreath>
						</div>
						{#if status.elapsed !== null}
							<p class="pace">
								{#if status.over}
									<span class="bh-tag bh-tag--lg bh-tag--over"><Icon name="arrow-up" size={16} /> Over budget this month</span>
								{:else if status.ahead_of_pace}
									<span class="bh-tag bh-tag--note bh-tag--lg"><Icon name="arrow-up" size={16} /> Ahead of the month so far</span>
								{:else}
									<span class="bh-tag bh-tag--lg bh-tag--in"><Icon name="check" size={16} /> On pace for the month</span>
								{/if}
							</p>
						{/if}
					</div>

					<section class="bh-card" aria-labelledby="budgets-title">
						<div class="bh-card__head">
							<h2 class="bh-card__title section-title" id="budgets-title">Budgets</h2>
							<a class="card-link" href="/trends">Trends</a>
						</div>
						<div class="meters">
							{#each status.budgets as b (b.category.id)}
								<a class="meter-link wn-press" href="/history{query({ category: b.category.id, month: data.month })}">
									<Meter label={b.category.name} value={b.spent} max={b.budget} valueText={spentText(b)} tag={b.over ? 'over' : ''} />
								</a>
							{/each}
						</div>
					</section>
				{/if}
			</div>

			<div class="stack">
				{#if status.incomes.length || status.income}
					<section class="bh-card" aria-labelledby="flow-title">
						<div class="bh-card__head">
							<h2 class="bh-card__title section-title" id="flow-title">In and out</h2>
							<a class="card-link" href="/history{query({ type: 'income', month: data.month })}">Income</a>
						</div>
						<div class="kpis">
							<div class="kpi"><span class="kpi__label">Income</span><span class="kpi__value in-text"><Money value={status.income} /></span></div>
							<div class="kpi"><span class="kpi__label">Spent</span><span class="kpi__value"><Money value={status.out} /></span><span class="kpi__sub">budgets and funds</span></div>
							<div class="kpi">
								<span class="kpi__label">{status.net < 0 ? 'Short' : 'Left over'}</span><span class="kpi__value" class:over-text={status.net < 0}><Money value={status.net} /></span>
							</div>
						</div>
						{#if status.incomes.length > 1}
							<div class="list list--flat" style="margin-top:8px">
								{#each status.incomes as i (i.category.id)}
									<a class="setting wn-press" href="/categories/{i.category.id}">
										<CategoryTile category={i.category} /><span class="grow setting__title">{i.category.name}</span><span class="setting__value in-text">{money(i.received)}</span>
									</a>
								{/each}
							</div>
						{/if}
					</section>
				{/if}

				{#if status.funds.length}
					<section class="bh-card" aria-labelledby="funds-title">
						<div class="bh-card__head">
							<h2 class="bh-card__title section-title" id="funds-title">Funds</h2>
						</div>
						<div class="stashes">
							{#each status.funds as f (f.category.id)}
								<a class="stash-link wn-press" href="/categories/{f.category.id}">
									<Stash name={f.category.name} value={money(f.balance)} acorns={f.acorns} class={f.balance < 0 ? 'is-negative' : ''}>
										{#if f.topup}<span class="bh-tag bh-tag--in">+{money(f.topup)} a month</span>{/if}
										{#if f.category.target}<span class="bh-tag">Target {money(f.category.target)}</span>{/if}
									</Stash>
								</a>
							{/each}
						</div>
						{#if status.fund_spent}
							<div class="bh-card__foot"><span>Spent from funds in {month(data.month, 'name')}</span><span class="bh-card__total">{money(status.fund_spent)}</span></div>
						{/if}
					</section>
				{/if}

				{#if data.upcoming.length}
					<section class="bh-card" aria-labelledby="upcoming-title">
						<div class="bh-card__head">
							<h2 class="bh-card__title section-title" id="upcoming-title">Coming up</h2>
							<a class="card-link" href="/recurring">Recurring</a>
						</div>
						<div class="list list--flat">
							{#each data.upcoming as { date, rule } (rule.id + date)}
								<a class="spend wn-press" href="/recurring/{rule.id}">
									<CategoryTile category={rule.category} />
									<span class="spend__text">
										<span class="spend__title">{rule.title}</span>
										<span class="spend__sub"><span>{rule.category.name}</span><span class="spend__freq"><Icon name="repeat" size={14} />{rule.frequency}</span></span>
									</span>
									<span class="bh-row__end">
										<span class="spend__amount" class:is-in={rule.type === 'income'}>{signedMoney(rule.amount, rule.type)}</span>
										<span class="bh-when"><Icon name="calendar" size={14} />{day(date)}</span>
									</span>
								</a>
							{/each}
						</div>
					</section>
				{/if}

				<section class="bh-card" aria-labelledby="recent-title">
					<div class="bh-card__head">
						<h2 class="bh-card__title section-title" id="recent-title">Latest in {month(data.month, 'name')}</h2>
						<a class="card-link" href="/history{query({ month: data.month })}">See all</a>
					</div>
					{#if data.recent.length}
						<div class="list list--flat">
							{#each data.recent as txn (txn.id)}<TransactionRow {txn} showDate />{/each}
						</div>
					{:else}
						<Empty who="kacang" mood="sleepy" title="Nothing spent yet">What you add for {month(data.month, 'name')} shows up here.</Empty>
					{/if}
				</section>
			</div>
		</div>
	{/if}
{/if}
