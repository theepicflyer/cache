<script lang="ts">
	import 'warren/web/motion.css';
	import './layout.css';
	import { afterNavigate, goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { arrivedBy, configureApi, configureData, forgetData, pageTransition, swipeBack } from 'warren/web';
	import { Toast } from 'warren/burrow';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import Entry from '#lib/components/Entry.svelte';
	import Loading from '#lib/components/Loading.svelte';
	import Rail from '#lib/components/Rail.svelte';
	import { arrival } from '#lib/motion.svelte.ts';
	import { NAV, activeNav } from '#lib/nav.ts';
	import { session, toasts } from '#lib/state.svelte.ts';
	import { followDevice } from '#lib/theme.ts';
	import { onMount } from 'svelte';

	let { children } = $props();
	let ready = $state(false);
	const isLogin = $derived(page.url.pathname.startsWith('/login'));
	/** Home and Trends lay out in columns and take the wide page. */
	const wide = $derived(page.url.pathname === '/' || page.url.pathname.startsWith('/trends') || /^\/categories\/\d+$/.test(page.url.pathname));

	configureApi({
		onUnauthorized: () => {
			forgetData();
			return goto('/login');
		}
	});
	configureData({ onError: (err) => toasts.error(err) });

	/** The nav's own screens: switching between them cross-fades; anything else slides in over them and back out. */
	const TABS = NAV.map((item) => item.href);
	const isTab = (path: string) => (TABS as readonly string[]).includes(path.replace(/\/+$/, '') || '/');

	/**
	 * A screen gone back to doesn't play its entrances again. How it was reached is Warren's
	 * `arrivedBy()` (html[data-wn-arrived], set by pageTransition as the navigation starts); Cache
	 * applies it to `main.is-back` only as the new screen mounts, and leaves it alone for the same
	 * screen with other data (a month, a filter). Keyed straight on the attribute, the old screen would
	 * start its entrances in the moment the transition snapshots it, and a screen gone back to would
	 * replay them on its first month change.
	 */
	let signIn = false;
	$effect.pre(() => {
		void page.url;
		const by = arrivedBy();
		if (signIn || !by) arrival.back = false;
		else if (by !== 'same') arrival.back = by === 'back';
	});

	onNavigate((navigation) => {
		// Signing in or out swaps the whole app at once, and the screen after it is new.
		signIn = !!(navigation.from?.url.pathname.startsWith('/login') || navigation.to?.url.pathname.startsWith('/login'));
		if (signIn) return;
		return pageTransition(navigation, { tabs: TABS });
	});

	/** In-app screens behind this one, so the edge swipe never leaves the app. */
	let behind = 0;
	afterNavigate((navigation) => {
		if (navigation.type === 'enter') behind = 0;
		else if (navigation.type === 'popstate') behind = Math.max(0, behind + (navigation.delta ?? -1));
		else if (navigation.from && navigation.from.url.href !== navigation.to?.url.href) behind++;
	});
	/** Swipe in from the left edge to go back, on any screen below the nav's own. */
	const swipe = swipeBack({
		canGoBack: () => !isTab(page.url.pathname),
		back: () => (behind > 0 ? history.back() : goto(NAV.find((item) => item.id === activeNav(page.url.pathname))!.href, { replaceState: true }))
	});

	onMount(() => {
		const stop = followDevice();
		if (isLogin) {
			ready = true;
		} else {
			session.load().then(async (me) => {
				if (!me) await goto('/login', { replace: true });
				ready = true;
			});
		}
		return stop;
	});
</script>

<Toast {toasts} look={(t) => ({ character: t.who, mood: t.mood })} class="toasts {isLogin ? '' : 'toasts--app'}" />

{#if isLogin}
	{@render children()}
{:else if ready && session.me}
	<div class="shell">
		<Rail />
		<main class="page" class:page--wide={wide} class:is-back={arrival.back} id="main" {@attach swipe}>
			{@render children()}
		</main>
	</div>
	<BottomNav />
	<Entry />
{:else}
	<main class="login"><Loading /></main>
{/if}
