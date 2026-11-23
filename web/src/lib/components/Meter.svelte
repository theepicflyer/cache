<script lang="ts">
	import { Trace, type TraceName } from 'warren/burrow';

	/**
	 * Burrow Meter. Every meter shares one scale, 0 to 125% of its target, with the target as a tick at 80%; past it
	 * the fill carries on in the same colour, striped, so a category over budget looks like the others (over is
	 * information, not failure). The flag ("over", "over 3×") follows the label; `valueText` keeps its own column on
	 * the right. A target of 0 with something spent fills to the end.
	 */
	let {
		label = '',
		valueText = '',
		value = 0,
		max = 0,
		cap = 'acorn',
		tag = '',
		tagClass = 'bh-tag--over',
		class: klass = ''
	}: { label?: string; valueText?: string; value?: number; max?: number; cap?: TraceName | ''; tag?: string; tagClass?: string; class?: string } = $props();

	const HEADROOM = 1.25;
	const v = $derived(Math.max(0, value));
	// value as a share of the scale's end (125% of the target)
	const share = (x: number) => (max > 0 ? Math.min(x, max * HEADROOM) / (max * HEADROOM) : x > 0 ? 1 : 0);
	const base = $derived(max > 0 ? share(Math.min(v, max)) : 0);
	const extra = $derived(max > 0 ? share(v) - base : share(v));
	const over = $derived(v > max);
	const at = 1 / HEADROOM;
	const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
</script>

<div class="bh-meter {klass}" class:is-over={over} style="--meter: var(--accent); --meter-soft: var(--accent-soft)">
	{#if label || valueText}
		<div class="bh-meter__top">
			<span class="bh-meter__label">{label}{#if tag}<span class="bh-tag {tagClass}">{tag}</span>{/if}</span>
			<span class="bh-meter__value">{valueText}</span>
		</div>
	{/if}
	<div class="bh-meter__rail">
		<div class="bh-meter__track" role="meter" aria-valuemin="0" aria-valuemax={max} aria-valuenow={v} aria-label={label}>
			<div class="bh-meter__fill" style="--w: {pct(base)}"></div>
			{#if extra > 0}<div class="bh-meter__extra" style="left: {pct(max > 0 ? at : 0)}; --w: {pct(extra)}"></div>{/if}
		</div>
		<span class="bh-meter__tick" style="left: {pct(at)}" aria-hidden="true"></span>
		{#if cap}<Trace name={cap} size={24} class="bh-meter__cap" style="--w: {pct(base + extra)}" />{/if}
	</div>
</div>
