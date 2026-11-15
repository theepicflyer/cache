<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, put, query } from '#lib/api.ts';
	import CategoryTile from '#lib/components/CategoryTile.svelte';
	import Habitat from '#lib/components/Habitat.svelte';
	import Loading from '#lib/components/Loading.svelte';
	import { month } from '#lib/format.ts';
	import { loaded } from '#lib/load.svelte.ts';
	import { ledger, toasts } from '#lib/state.svelte.ts';
	import type { Budgets, Saved } from '#lib/types.ts';

	const budgets = loaded<Budgets>(() => `/api/budgets${query({ from_month: page.url.searchParams.get('from_month') })}`);
	const data = $derived(budgets.data);

	let amounts = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);

	// Fill the inputs with the amounts in force for the chosen month whenever they (re)load.
	$effect(() => {
		if (!data) return;
		amounts = Object.fromEntries(data.rows.map((r) => [String(r.category.id), (r.amount / 100).toFixed(2)]));
		errors = {};
	});

	function pickMonth(value: string) {
		goto(`/settings/budgets${query({ from_month: value })}`, { replace: true });
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!data) return;
		saving = true;
		try {
			const res = await put<Saved>('/api/budgets', { from_month: data.from_month, amounts });
			toasts.show(res.toast);
			ledger.changed();
			await goto('/settings');
		} catch (err) {
			if (err instanceof ApiError && Object.keys(err.errors).length) errors = err.errors;
			else toasts.error(err);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Edit amounts · Cache</title></svelte:head>

<Habitat kind="river" mood="busy">
	<span class="bh-habitat__eyebrow"><a href="/settings" style="color:inherit">Settings</a></span>
	<h1 class="page-title">Monthly amounts</h1>
	<p class="bh-habitat__sub">Budgets and fund top-ups</p>
</Habitat>

{#if !data}
	<Loading />
{:else}
	<form class="bh-card form-grid" onsubmit={save} novalidate>
		<div class="field">
			<label for="from_month">Apply from</label>
			<select class="select" id="from_month" name="from_month" value={data.from_month} onchange={(e) => pickMonth(e.currentTarget.value)}>
				{#each data.month_choices as m (m)}<option value={m}>{month(m)}</option>{/each}
			</select>
			<span class="field__hint">Changes apply from this month on. Earlier months keep the amounts they had, so past trends don't move.</span>
		</div>
		<div class="amount-rows">
			{#each data.rows as r (r.category.id)}
				{@const key = String(r.category.id)}
				<label class="amount-row" class:has-error={errors[key]}>
					<span class="row">
						<CategoryTile category={r.category} />
						<span class="setting__text">
							<span class="setting__title">{r.category.name}</span>
							<span class="setting__sub">{r.category.kind === 'fund' ? 'Fund top-up' : 'Budget'}</span>
							{#if errors[key]}<span class="field__error">{errors[key]}</span>{/if}
						</span>
					</span>
					<span class="input input--affix">$<input name="amount_{key}" inputmode="decimal" bind:value={amounts[key]} /></span>
				</label>
			{/each}
		</div>
		<div class="actions actions--end">
			<a class="bh-btn bh-btn--ghost" href="/settings">Cancel</a>
			<button class="bh-btn bh-btn--primary" type="submit" disabled={saving}>Save amounts</button>
		</div>
	</form>
{/if}
