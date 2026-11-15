<script lang="ts" module>
	import library from '#lib/iconLibrary.json';

	const GENERIC = 'dots-three';
	const MATCH = library.match as Record<string, string>;
	const LABELS = new Map(library.groups.flatMap((g) => g.icons.map((i) => [i.n, i.l] as const)));

	/** The icon the server will pick from a name (guessIcon in server/src/ledger.ts); "" if none fits. */
	export function guessIcon(name: string): string {
		const found: string[] = [];
		for (const word of name.toLowerCase().match(/[a-z]+/g) ?? []) {
			const hit = MATCH[word] ?? (word.endsWith('s') ? MATCH[word.slice(0, -1)] : undefined);
			if (hit) found.push(hit);
		}
		// "Other income" should get the income icon, not the catch-all one.
		return found.find((i) => i !== GENERIC) ?? found[0] ?? '';
	}
</script>

<script lang="ts">
	import type { Kind } from '#lib/types.ts';
	import CategoryIcon from './CategoryIcon.svelte';
	import Icon from './Icon.svelte';

	/**
	 * The category icon picker: automatic (guessed from the name as it is typed), the first letter, or
	 * one of the library's icons. `value` is what the server stores: "", "letter" or an icon's name.
	 */
	let { value = $bindable(''), name, kind, error = '' }: { value?: string; name: string; kind: Kind; error?: string } = $props();

	// A refused icon opens the picker so the problem is next to the choices.
	let open = $state(false);
	let search = $state('');
	$effect(() => {
		if (error) open = true;
	});

	const trimmed = $derived(name.trim());
	const icon = $derived(value === 'letter' ? '' : value || guessIcon(trimmed));
	const label = $derived(value === 'letter' ? 'First letter' : (value && LABELS.get(value)) || 'Automatic');
	const hint = $derived(value ? '' : icon ? 'Picked from the name' : 'Nothing fits the name, so it shows the first letter');

	const words = $derived(search.toLowerCase().split(/\s+/).filter(Boolean));
	const groups = $derived(
		library.groups.map((g) => ({ label: g.label, icons: g.icons.filter((i) => words.every((w) => i.k.includes(w))) })).filter((g) => g.icons.length)
	);

	function pick() {
		open = false;
	}
</script>

<div class="field">
	<span class="field__label">Icon</span>
	<div class="icon-current">
		<span>
			<span class="tile" class:tile--fund={kind === 'fund'} class:tile--in={kind === 'income'}>
				{#if icon}
					<CategoryIcon name={icon} />
				{:else if kind === 'fund' && value !== 'letter'}
					<img class="bh-trace" src="/img/burrow/traces/acorn.svg" width="26" height="26" alt="" />
				{:else}
					{(trimmed[0] || '?').toUpperCase()}
				{/if}
			</span>
		</span>
		<span class="grow"><span class="setting__title">{label}</span><br /><span class="small muted">{hint}</span></span>
	</div>
	<details class="icon-picker" bind:open>
		<summary class="bh-btn bh-btn--secondary bh-btn--sm">Choose an icon</summary>
		<div class="icon-picker__body">
			<label class="input input--affix"
				><Icon name="search" size={20} /><span class="sr-only">Search icons</span><input
					type="search"
					bind:value={search}
					placeholder="Search, e.g. car or food"
					enterkeyhint="search"
					onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
				/></label
			>
			<div class="icon-grid icon-grid--wide">
				<label class="icon-opt icon-opt--wide"><input type="radio" name="icon" value="" bind:group={value} onchange={pick} /><span class="icon-opt__box">Automatic</span></label>
				<label class="icon-opt icon-opt--wide"><input type="radio" name="icon" value="letter" bind:group={value} onchange={pick} /><span class="icon-opt__box">First letter</span></label>
			</div>
			{#each groups as g (g.label)}
				<section class="icon-group">
					<p class="icon-group__title">{g.label}</p>
					<div class="icon-grid">
						{#each g.icons as i (i.n)}
							<label class="icon-opt" title={i.l}
								><input type="radio" name="icon" value={i.n} bind:group={value} onchange={pick} /><span class="icon-opt__box"><CategoryIcon name={i.n} size={24} /></span><span class="sr-only"
									>{i.l}</span
								></label
							>
						{/each}
					</div>
				</section>
			{/each}
			{#if !groups.length}<p class="small muted">No icons match. Try another word.</p>{/if}
			<p class="small muted">Icons by <a href="https://phosphoricons.com" rel="noopener">Phosphor</a>.</p>
		</div>
	</details>
	{#if error}<span class="field__error">{error}</span>{/if}
</div>
