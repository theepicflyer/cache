<script lang="ts">
	import { NAV, activeNav } from '#lib/nav.ts';
	import { page } from '$app/state';
	import { entry, toasts } from '#lib/state.svelte.ts';
	import { slidingPill } from 'warren/web';
	import { Mascot } from 'warren/burrow';
	import Icon from './Icon.svelte';

	/** Burrow BottomNav on phones: four destinations and the add button, Kacang peeking over the top. It holds still while screens change, its highlight slides, and it slides away while a toast has its place. */
	const active = $derived(activeNav(page.url.pathname));
</script>

{#snippet link(item: (typeof NAV)[number])}
	<a class="bh-nav__item wn-press" class:is-active={active === item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}>
		<span class="bh-nav__pill"><Icon name={item.icon} size={22} /></span><span class="bh-nav__label">{item.label}</span>
	</a>
{/snippet}

<div class="bh-bottomnav" class:is-away={toasts.current} data-wn-keep="dock">
	<Mascot character="kacang" mood="happy" size={56} class="bh-bottomnav__peek" />
	<nav class="bh-nav" aria-label="Main" {@attach slidingPill()}>
		{@render link(NAV[0])}
		{@render link(NAV[1])}
		<button type="button" class="bh-nav__fab wn-press" onclick={() => entry.add()} aria-label="Add transaction"><Icon name="plus" size={26} /></button>
		{@render link(NAV[2])}
		{@render link(NAV[3])}
	</nav>
</div>
