<script lang="ts">
	import { Trace, type TraceName } from 'warren/burrow';

	/**
	 * Burrow Meter: a sticker track that fills to `percent` and ends in a trace. Going over is
	 * information, not failure: with `over` and `limit` (the budget as a % of what was spent) the track
	 * rescales to the spend, with a tick at the budget and the overspend past it in tomato.
	 */
	let {
		label = '',
		value = '',
		percent = 0,
		over = false,
		limit = null,
		cap = 'acorn',
		tag = '',
		tagClass = '',
		class: klass = ''
	}: { label?: string; value?: string; percent?: number; over?: boolean; limit?: number | null; cap?: TraceName | ''; tag?: string; tagClass?: string; class?: string } = $props();

	const style = $derived(`--pct: ${percent}%;${over && limit ? ` --limit: ${limit}%;` : ''}`);
</script>

<div class="bh-meter {klass}" class:is-over={over} {style}>
	{#if label || value}
		<div class="bh-meter__top">
			<span class="bh-meter__label">{label}</span>
			<span class="bh-meter__value">{value}{#if tag}<span class="bh-tag {tagClass}">{tag}</span>{/if}</span>
		</div>
	{/if}
	<div class="bh-meter__rail">
		<div class="bh-meter__track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent} aria-label={label}>
			<div class="bh-meter__fill"></div>
		</div>
		{#if over && limit}<span class="bh-meter__limit" aria-hidden="true"></span>{/if}
		{#if cap}<Trace name={cap} size={24} class="bh-meter__cap" />{/if}
	</div>
</div>
