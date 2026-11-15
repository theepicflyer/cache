<script lang="ts" module>
	import type { Kind } from '#lib/types.ts';

	/** The category form as typed: amounts are text such as "250", months YYYY-MM. */
	export interface CategoryValues {
		name: string;
		kind: Kind;
		icon: string;
		amount: string;
		from_month: string;
		opening_balance: string;
		target: string;
		archived: boolean;
	}

	/** Fields the form shows its own message under; any other message goes above the form. */
	export const FIELDS = ['name', 'icon', 'amount', 'opening_balance', 'target'];
</script>

<script lang="ts">
	import IconPicker from './IconPicker.svelte';

	/**
	 * The fields shared by the new-category form and a category page's Edit card. Put it inside a
	 * `<form>`: the income kind hides the amount fields with a `form:has(...)` rule in layout.css.
	 * `errors` are the per-field messages of a refused save.
	 */
	let { values = $bindable(), errors = {}, editing = false }: { values: CategoryValues; errors?: Record<string, string>; editing?: boolean } = $props();
	const other = $derived(
		Object.entries(errors)
			.filter(([field]) => !FIELDS.includes(field))
			.map(([, message]) => message)
	);
</script>

{#if other.length}<p class="form-error">{other.join(' ')}</p>{/if}
<div class="field" class:has-error={errors.name}>
	<label for="id_name">Name</label>
	<input class="input" id="id_name" name="name" bind:value={values.name} maxlength="80" required />
	{#if errors.name}<span class="field__error">{errors.name}</span>{/if}
</div>
<div class="field">
	<span class="field__label">Kind</span>
	<div class="bh-seg" role="radiogroup">
		<label><input type="radio" name="kind" value="budget" bind:group={values.kind} /><span class="bh-seg__opt">Budget</span></label>
		<label><input type="radio" name="kind" value="fund" bind:group={values.kind} /><span class="bh-seg__opt">Sinking fund</span></label>
		<label><input type="radio" name="kind" value="income" bind:group={values.kind} /><span class="bh-seg__opt">Income</span></label>
	</div>
	<span class="field__hint"
		>A budget is what you plan to spend each month. A fund saves a set amount every month and you spend from what has built up. Income is money coming in, such as pay.</span
	>
</div>
<IconPicker bind:value={values.icon} name={values.name} kind={values.kind} error={errors.icon} />
<div class="form-grid form-grid--2 budget-only">
	<div class="field" class:has-error={errors.amount}>
		<label for="id_amount">Monthly budget or top-up</label>
		<span class="input input--affix">$<input id="id_amount" name="amount" inputmode="decimal" bind:value={values.amount} placeholder="0.00" /></span>
		{#if errors.amount}<span class="field__error">{errors.amount}</span>{/if}
	</div>
	<div class="field">
		<label for="id_from_month">Starting</label>
		<input class="input" type="month" id="id_from_month" name="from_month" bind:value={values.from_month} />
		<span class="field__hint">Earlier months keep their amount.</span>
	</div>
	<div class="field" class:has-error={errors.opening_balance}>
		<label for="id_opening_balance">Fund: opening balance</label>
		<span class="input input--affix">$<input id="id_opening_balance" name="opening_balance" inputmode="decimal" bind:value={values.opening_balance} /></span>
		<span class="field__hint">What the fund held before its first top-up.</span>
		{#if errors.opening_balance}<span class="field__error">{errors.opening_balance}</span>{/if}
	</div>
	<div class="field" class:has-error={errors.target}>
		<label for="id_target">Fund: target</label>
		<span class="input input--affix">$<input id="id_target" name="target" inputmode="decimal" bind:value={values.target} placeholder="Optional" /></span>
		{#if errors.target}<span class="field__error">{errors.target}</span>{/if}
	</div>
</div>
{#if editing}<label class="check"><input type="checkbox" name="archived" bind:checked={values.archived} /> Archived (hidden when adding)</label>{/if}
