<script lang="ts">
	import { NAV, activeNav } from '#lib/nav.ts';
	import { page } from '$app/state';
	import { entry, session } from '#lib/state.svelte.ts';
	import { slidingPill } from 'warren/web';
	import Icon from './Icon.svelte';

	/** The side rail, from 1024px. It holds still while screens change, and its highlight slides. */
	const active = $derived(activeNav(page.url.pathname));
</script>

<nav class="rail" aria-label="Main" data-wn-keep="rail">
	<a class="brand" href="/"><img src="/icons/favicon.svg" alt="" />Cache</a>
	<div class="rail__links" {@attach slidingPill('.rail__hl')}>
		{#each NAV as item (item.id)}
			<a class="rail__link wn-press" class:is-active={active === item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}
				><span class="rail__hl" aria-hidden="true"></span><Icon name={item.icon} size={20} /> {item.label}</a
			>
		{/each}
	</div>
	<button type="button" class="bh-btn bh-btn--primary rail__add wn-press" onclick={() => entry.add()}><Icon name="plus" size={20} /> Add transaction</button>
	<div class="rail__foot small muted">{session.me?.name || session.me?.email}</div>
</nav>
