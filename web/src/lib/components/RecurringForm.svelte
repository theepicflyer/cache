<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError, del, get, patch, post, query } from '#lib/api.ts';
	import { month, plural } from '#lib/format.ts';
	import { ledger, toasts } from '#lib/state.svelte.ts';
	import type { Category, EntryData, Rule, Saved, TxnType, Unit } from '#lib/types.ts';
	import { onMount } from 'svelte';
	import Habitat from './Habitat.svelte';
	import Icon from './Icon.svelte';

	/** Add a recurring rule, or edit `rule`. */
	let { rule = null }: { rule?: Rule | null } = $props();

	const UNITS: Unit[] = ['week', 'month', 'year'];

	// The form starts from the rule once; later reloads of the rule must not overwrite what is being typed.
	const start = (() => rule)();
	let type = $state<TxnType>(start?.type ?? 'expense');
	let title = $state(start?.title ?? '');
	let amount = $state(start ? (start.amount / 100).toFixed(2) : '');
	let category = $state(start ? String(start.category_id) : '');
	let every = $state(start?.every ?? 1);
	let unit = $state<Unit>(start?.unit ?? 'month');
	let monthOffset = $state(String(start?.month_offset ?? 0));
	let startDate = $state(start?.start_date ?? '');
	let endDate = $state(start?.end_date ?? '');
	let note = $state(start?.note ?? '');

	let cats = $state<Category[]>([]);
	let errors = $state<Record<string, string>>({});
	let formError = $state('');
	let busy = $state(false);

	onMount(async () => {
		try {
			const entry = await get<EntryData>('/api/entry');
			const list = entry.cats;
			// An archived category is not offered for new rules, but a rule already in one keeps it.
			if (start && !list.some((c) => c.id === start.category_id)) list.push(start.category);
			cats = list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
			if (!startDate) startDate = entry.today;
		} catch (err) {
			toasts.error(err);
		}
	});

	/** "Next on 25 November". */
	const nextText = (d: string) => `Next on ${Number(d.slice(8, 10))} ${month(d, 'name')}`;

	async function done(res: Saved) {
		toasts.show(res.created ? `${res.toast}. ${plural(res.created, 'entry', 'entries')} added.` : res.toast);
		// Leave first: announcing the change while this page is up reloads a rule that may be deleted.
		await goto('/recurring');
		ledger.changed();
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		errors = {};
		formError = '';
		const payload = {
			type,
			title,
			amount,
			category: category ? Number(category) : null,
			note,
			every: Number(every) || 1,
			unit,
			start_date: startDate,
			end_date: endDate || null,
			month_offset: Number(monthOffset)
		};
		try {
			await done(rule ? await patch(`/api/recurring/${rule.id}`, payload) : await post('/api/recurring', payload));
		} catch (err) {
			if (err instanceof ApiError && Object.keys(err.errors).length) errors = err.errors;
			else if (err instanceof ApiError && err.status === 400) formError = err.message;
			else toasts.error(err);
		} finally {
			busy = false;
		}
	}

	async function act(run: () => Promise<Saved>) {
		busy = true;
		try {
			await done(await run());
		} catch (err) {
			toasts.error(err);
		} finally {
			busy = false;
		}
	}
</script>

<Habitat kind="river" mood="busy">
	<span class="bh-habitat__eyebrow"><a href="/recurring" style="color:inherit">Recurring</a></span>
	<h1 class="page-title">{rule ? rule.title : 'New recurring'}</h1>
	{#if rule}<p class="bh-habitat__sub">{rule.paused ? 'Paused' : rule.next ? nextText(rule.next) : 'Ended'}</p>{/if}
</Habitat>

<form class="bh-card form-grid" onsubmit={save} novalidate>
	{#if formError}<p class="form-error">{formError}</p>{/if}
	<div class="form-grid form-grid--2">
		<div class="field span-2">
			<span class="field__label">Type</span>
			<div class="bh-seg" role="radiogroup" aria-label="Type">
				<label><input type="radio" name="type" value="expense" bind:group={type} /><span class="bh-seg__opt">Expense</span></label>
				<label><input type="radio" name="type" value="income" bind:group={type} /><span class="bh-seg__opt">Income</span></label>
			</div>
		</div>
		<div class="field span-2" class:has-error={errors.title}>
			<label for="id_title">Title</label>
			<input class="input" id="id_title" name="title" bind:value={title} maxlength="200" required placeholder="e.g. Rent" />
			{#if errors.title}<span class="field__error">{errors.title}</span>{/if}
		</div>
		<div class="field" class:has-error={errors.amount}>
			<label for="id_amount">Amount</label>
			<span class="input input--affix">$<input id="id_amount" name="amount" inputmode="decimal" bind:value={amount} required /></span>
			{#if errors.amount}<span class="field__error">{errors.amount}</span>{/if}
		</div>
		<div class="field" class:has-error={errors.category}>
			<label for="id_category">Category</label>
			<select class="select" id="id_category" name="category" bind:value={category} required>
				<option value="">Pick a category</option>
				{#each cats as c (c.id)}<option value={String(c.id)}>{c.name}</option>{/each}
			</select>
			{#if errors.category}<span class="field__error">{errors.category}</span>{/if}
		</div>
		<div class="field" class:has-error={errors.every}>
			<label for="id_every">Repeats every</label>
			<div class="row">
				<input class="input" style="width:80px" type="number" min="1" max="52" id="id_every" name="every" bind:value={every} />
				<select class="select grow" name="unit" aria-label="Unit" bind:value={unit}>
					{#each UNITS as u (u)}<option value={u}>{Number(every) === 1 ? u : `${u}s`}</option>{/each}
				</select>
			</div>
			{#if errors.every}<span class="field__error">{errors.every}</span>{/if}
		</div>
		<div class="field">
			<label for="id_month_offset">Counts toward</label>
			<select class="select" id="id_month_offset" name="month_offset" bind:value={monthOffset}>
				<option value="0">The month of its date</option>
				<option value="-1">The month before (a bill for last month)</option>
			</select>
		</div>
		<div class="field" class:has-error={errors.start_date}>
			<label for="id_start_date">First date</label>
			<input class="input" type="date" id="id_start_date" name="start_date" bind:value={startDate} required />
			{#if !rule}<span class="field__hint">A first date in the past adds the entries up to today.</span>{/if}
			{#if errors.start_date}<span class="field__error">{errors.start_date}</span>{/if}
		</div>
		<div class="field" class:has-error={errors.end_date}>
			<label for="id_end_date">Last date</label>
			<input class="input" type="date" id="id_end_date" name="end_date" bind:value={endDate} />
			<span class="field__hint">Optional.</span>
			{#if errors.end_date}<span class="field__error">{errors.end_date}</span>{/if}
		</div>
		<div class="field span-2">
			<label for="id_note">Note</label>
			<textarea class="textarea" id="id_note" name="note" rows="2" bind:value={note}></textarea>
		</div>
	</div>
	{#if rule}<p class="note">Saving changes every entry still to come. Entries already added stay as they are; edit those on the History page.</p>{/if}
	<div class="actions actions--end">
		<a class="bh-btn bh-btn--ghost" href="/recurring">Cancel</a>
		<button class="bh-btn bh-btn--primary" type="submit" disabled={busy}>{rule ? 'Save changes' : 'Add recurring'}</button>
	</div>
</form>

{#if rule}
	{@const id = rule.id}
	<div class="actions" style="margin-top:16px">
		<button class="bh-btn bh-btn--secondary bh-btn--sm" type="button" disabled={busy} onclick={() => act(() => post(`/api/recurring/${id}/toggle`))}>
			{#if rule.paused}<Icon name="play" size={18} /> Resume{:else}<Icon name="pause" size={18} /> Pause{/if}
		</button>
		<button class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--danger" type="button" disabled={busy} onclick={() => act(() => del(`/api/recurring/${id}`))}><Icon name="trash" size={18} /> Delete</button>
		<a class="bh-btn bh-btn--ghost bh-btn--sm" href="/history{query({ q: rule.title })}">Past entries</a>
	</div>
{/if}
