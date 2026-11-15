<script lang="ts">
	import { NAV, activeNav } from '#lib/nav.ts';
	import { page } from '$app/state';
	import { entry, session } from '#lib/state.svelte.ts';
	import Icon from './Icon.svelte';

	/** The side rail, from 1024px. */
	const active = $derived(activeNav(page.url.pathname));
</script>

<nav class="rail" aria-label="Main">
	<a class="brand" href="/"><img src="/icons/favicon.svg" alt="" />Cache</a>
	{#each NAV as item (item.id)}
		<a class="rail__link" class:is-active={active === item.id} href={item.href}><Icon name={item.icon} size={20} /> {item.label}</a>
	{/each}
	<button type="button" class="bh-btn bh-btn--primary rail__add" onclick={() => entry.add()}><Icon name="plus" size={20} /> Add transaction</button>
	<div class="rail__foot small muted">{session.me?.name || session.me?.email}</div>
</nav>
