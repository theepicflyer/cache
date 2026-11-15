<script lang="ts">
	import { page } from '$app/state';
	import { loaded, query } from 'warren/web';
	import CategoryTile from '#lib/components/CategoryTile.svelte';
	import Chart from '#lib/components/Chart.svelte';
	import Empty from '#lib/components/Empty.svelte';
	import Habitat from '#lib/components/Habitat.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import Meter from '#lib/components/Meter.svelte';
	import Money from '#lib/components/Money.svelte';
	import { money, month } from '#lib/format.ts';
	import { settle } from '#lib/motion.svelte.ts';
	import type { Cell, Trends } from '#lib/types.ts';

	const trends = loaded<Trends>(() => `/api/trends${query({ months: page.url.searchParams.get('months'), end: page.url.searchParams.get('end') })}`);
	const a = $derived(trends.data);

	/** Months that count: finished, and with a budget or some spending. The server counts the same way. */
	const complete = $derived(a ? a.totals.filter((c) => !c.partial && (c.budget > 0 || c.spent !== 0)).length : 0);
	/** `Nov 26`, as the old charts labelled their x axis. */
	const label = (m: string) => `${month(m, 'abbr')} ${m.slice(2, 4)}`;
	const charts = $derived(
		a && {
			budget: { kind: 'budget' as const, labels: a.months.map(label), budget: a.totals.map((c) => c.budget), spent: a.totals.map((c) => c.spent), partial: a.totals.map((c) => c.partial) },
			inout: { kind: 'inout' as const, labels: a.months.map(label), income: a.flows.map((f) => f.income), out: a.flows.map((f) => f.out), partial: a.flows.map((f) => f.partial) },
			funds: { kind: 'funds' as const, labels: a.months.map(label), funds: a.funds.map((f) => ({ name: f.category.name, values: f.balances.map((b) => b.balance) })) }
		}
	);
	const cellTitle = (c: Cell) => `${month(c.month)}: ${money(c.spent)} of ${money(c.budget)}`;
	/** The budget as a share of the spend, for the tick on an over-budget meter. */
	const limit = (spent: number, budget: number) => (spent > 0 ? Math.round((budget / spent) * 100) : null);
	const spans = [6, 12, 24];

	// Other months: earlier or later slide in from their side; another span cross-fades.
	let heading = $state<HTMLElement>();
	let body = $state<HTMLElement>();
	let shown = '';
	$effect(() => {
		if (!a) return;
		const now = `${a.span} ${a.end}`;
		if (shown && now !== shown) {
			const [span, end] = shown.split(' ');
			settle([heading, body], Number(span) !== a.span ? 0 : a.end > end! ? 1 : -1);
		}
		shown = now;
	});
</script>

<svelte:head><title>Trends · Cache</title></svelte:head>

{#if !a}
	<Skeleton />
{:else}
	<Habitat kind="oak" mood={a.flagged.length ? 'worried' : 'happy'}>
		<span class="bh-habitat__eyebrow">
			<span class="month-nav"><a href="/trends{query({ months: a.span, end: a.prev_end })}" aria-label="Earlier"><Icon name="chevron-left" size={16} /></a></span>
			{month(a.months[0] ?? a.end, 'short')} to {month(a.end, 'short')}
			<span class="month-nav">
				{#if a.next_end}
					<a href="/trends{query({ months: a.span, end: a.next_end })}" aria-label="Later"><Icon name="chevron-right" size={16} /></a>
				{:else}
					<span aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
				{/if}
			</span>
		</span>
		<h1 class="page-title">Trends</h1>
		<p class="bh-habitat__sub" bind:this={heading}>{complete ? `Over budget in ${a.months_over} of ${complete} month${complete === 1 ? '' : 's'}` : 'No complete months yet'}</p>
	</Habitat>

	<nav class="bh-seg seg-bar" aria-label="Months shown">
		{#each spans as n (n)}
			<a class="bh-seg__opt wn-press" class:is-on={a.span === n} href="/trends{query({ months: n, end: a.end })}" aria-current={a.span === n ? 'page' : undefined}>{n} months</a>
		{/each}
	</nav>

	{#if !a.categories.length && !a.funds.length}
		<div class="bh-card"><Empty who={null} title="Nothing to compare yet">Trends appear once you have budgets and a month of transactions.</Empty></div>
	{:else if charts}
		<div class="cols" bind:this={body}>
			<section class="bh-card span-2" aria-labelledby="kpi-title">
				<h2 class="sr-only" id="kpi-title">Summary</h2>
				<div class="kpis">
					<div class="kpi">
						<span class="kpi__label">Months over budget</span>
						<span class="kpi__value" class:over-text={a.months_over}>{a.months_over} of {complete}</span>
						<span class="kpi__sub">complete months</span>
					</div>
					<div class="kpi">
						<span class="kpi__label">Average spent</span>
						<span class="kpi__value"><Money value={a.avg_spent} /></span>
						<span class="kpi__sub">a month, budgets only</span>
					</div>
					<div class="kpi">
						<span class="kpi__label">Average budget</span>
						<span class="kpi__value"><Money value={a.avg_budget} /></span>
						<span class="kpi__sub">
							{#if a.avg_spent > a.avg_budget}<span class="over-text">{money(a.avg_spent - a.avg_budget)} over</span> on average{:else}{money(a.avg_budget - a.avg_spent)} under on average{/if}
						</span>
					</div>
					<div class="kpi">
						<span class="kpi__label">Over most months</span>
						<span class="kpi__value" class:over-text={a.flagged.length}>{a.flagged.length}</span>
						<span class="kpi__sub">{a.flagged.length === 1 ? 'category' : 'categories'}</span>
					</div>
				</div>
			</section>

			<section class="bh-card span-2" aria-labelledby="trend-title">
				<div class="bh-card__head bh-card__head--wrap">
					<div class="bh-card__heading">
						<h2 class="bh-card__title section-title" id="trend-title">Spent against budget</h2>
						{#if a.current}<p class="bh-card__sub">{month(a.current, 'name')} is still running, so it's faded and left out of the counts.</p>{/if}
					</div>
					<span class="legend"><span class="l-spent">Spent</span><span class="l-spent-over">Spent, over</span><span class="l-budget">Budget</span>{#if a.current}<span class="l-running">Running</span>{/if}</span>
				</div>
				<Chart data={charts.budget} label="Monthly spending against the total budget" />
			</section>

			{#if a.flagged.length}
				<section class="bh-card" aria-labelledby="flag-title">
					<div class="bh-card__head">
						<div class="bh-card__heading">
							<h2 class="bh-card__title section-title" id="flag-title">Over most months</h2>
							<p class="bh-card__sub">Average spent a month against the budget.</p>
						</div>
					</div>
					<div class="list list--flat">
						{#each a.flagged as t (t.category.id)}
							<a class="spend wn-press" href="/categories/{t.category.id}">
								<CategoryTile category={t.category} />
								<span class="spend__text">
									<span class="spend__title">{t.category.name}</span>
									<span class="spend__sub"><span class="bh-tag bh-tag--over">Over in {t.months_over} of {t.months_counted} months</span></span>
								</span>
								<span class="bh-row__end">
									<span class="spend__amount">{money(t.avg_spent)}</span>
									<span class="bh-row__detail">of {money(t.avg_budget)}{t.avg_percent ? ` (${t.avg_percent}%)` : ''}</span>
								</span>
							</a>
						{/each}
					</div>
					<div class="bh-card__foot">
						<span>Spend less in these, or set each budget nearer its average so it reflects reality.</span>
						<a class="bh-btn bh-btn--secondary bh-btn--sm wn-press" href="/settings/budgets"><Icon name="pencil" size={18} /> Edit budgets</a>
					</div>
				</section>
			{/if}

			<section class="bh-card" class:span-2={!a.flagged.length} aria-labelledby="avg-title">
				<div class="bh-card__head"><h2 class="bh-card__title section-title" id="avg-title">Average month by category</h2></div>
				<div class="meters">
					{#each a.categories as t (t.category.id)}
						<a class="meter-link wn-press" href="/categories/{t.category.id}">
							<Meter
								label={t.category.name}
								percent={t.avg_percent ?? 0}
								over={t.avg_over}
								limit={limit(t.avg_spent, t.avg_budget)}
								value="{money(t.avg_spent)} / {money(t.avg_budget)}"
								tag={t.months_over ? `over ${t.months_over}×` : ''}
								tagClass={t.consistently_over ? 'bh-tag--over' : ''}
							/>
						</a>
					{/each}
				</div>
			</section>

			<section class="bh-card span-2" aria-labelledby="heat-title">
				<div class="bh-card__head bh-card__head--wrap">
					<div class="bh-card__heading">
						<h2 class="bh-card__title section-title" id="heat-title">Month by month</h2>
						<p class="bh-card__sub">Share of each month's budget spent. Tap a cell to see its spends.</p>
					</div>
					<span class="legend"><span class="l-under">Under</span><span class="l-near">Within 10%</span><span class="l-over">Over</span><span class="l-partial">Running</span></span>
				</div>
				<div class="heat-wrap">
					<table class="heat">
						<thead>
							<tr>
								<th class="heat__cat" scope="col">Category</th>
								{#each a.months as m, i (m)}<th scope="col">{month(m, 'abbr')}{#if m.endsWith('-01') || i === 0}<br />{m.slice(2, 4)}{/if}</th>{/each}
								<th scope="col">Over</th>
							</tr>
						</thead>
						<tbody>
							{#each a.categories as t (t.category.id)}
								<tr>
									<td class="heat__cat"><a href="/categories/{t.category.id}">{t.category.name}</a></td>
									{#each t.cells as c (c.month)}
										<td class="t-{c.tone}" class:is-partial={c.partial} title={cellTitle(c)}>
											<a href="/history{query({ category: t.category.id, month: c.month })}">{c.percent !== null ? `${c.percent}%` : c.spent ? money(c.spent) : '–'}</a>
										</td>
									{/each}
									<td class="heat__sum" class:over-text={t.consistently_over}>{t.months_over}/{t.months_counted}</td>
								</tr>
							{/each}
							<tr>
								<td class="heat__cat">All budgets</td>
								{#each a.totals as c (c.month)}
									<td class="t-{c.tone}" class:is-partial={c.partial} title={cellTitle(c)}>{c.percent !== null ? `${c.percent}%` : '–'}</td>
								{/each}
								<td class="heat__sum">{a.months_over}/{complete}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

			{#if a.flows_counted || a.avg_income}
				<section class="bh-card span-2" aria-labelledby="flow-title">
					<div class="bh-card__head">
						<h2 class="bh-card__title section-title" id="flow-title">In and out</h2>
						<span class="legend"><span class="l-spent">Income</span><span class="l-bark">Spent</span></span>
					</div>
					<div class="kpis" style="margin-bottom:12px">
						<div class="kpi"><span class="kpi__label">Average income</span><span class="kpi__value in-text"><Money value={a.avg_income} /></span><span class="kpi__sub">a month</span></div>
						<div class="kpi"><span class="kpi__label">Average spent</span><span class="kpi__value"><Money value={a.avg_out} /></span><span class="kpi__sub">budgets and funds</span></div>
						<div class="kpi">
							<span class="kpi__label">Average {a.avg_net < 0 ? 'short' : 'left over'}</span><span class="kpi__value" class:over-text={a.avg_net < 0}><Money value={a.avg_net} /></span><span class="kpi__sub">a month</span>
						</div>
					</div>
					<Chart data={charts.inout} label="Income and spending by month" small />
				</section>
			{/if}

			{#if a.funds.length}
				<section class="bh-card span-2" aria-labelledby="funds-title">
					<div class="bh-card__head"><h2 class="bh-card__title section-title" id="funds-title">Funds</h2></div>
					<Chart data={charts.funds} label="Fund balances by month" small />
					<div class="list list--flat" style="margin-top:12px">
						{#each a.funds as f (f.category.id)}
							<a class="setting wn-press" href="/categories/{f.category.id}">
								<CategoryTile category={f.category} />
								<span class="setting__text">
									<span class="setting__title">{f.category.name}</span>
									<span class="bh-tags">
										<span class="bh-tag bh-tag--in">+{money(f.topup_now)} a month</span>
										<span class="bh-tag">Spends {money(f.avg_spent)} a month</span>
										{#if f.draining}<span class="bh-tag bh-tag--note">More than goes in</span>{/if}
									</span>
								</span>
								<span class="bh-row__end"><span class="setting__value" class:over-text={f.balance_now < 0}>{money(f.balance_now)}</span><span class="bh-row__detail">saved</span></span>
							</a>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}
{/if}
