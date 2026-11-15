<script lang="ts">
	import './layout.css';
	import { goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import Entry from '#lib/components/Entry.svelte';
	import Loading from '#lib/components/Loading.svelte';
	import Rail from '#lib/components/Rail.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { session } from '#lib/state.svelte.ts';
	import { followDevice } from '#lib/theme.ts';
	import { onMount } from 'svelte';

	let { children } = $props();
	let ready = $state(false);
	const isLogin = $derived(page.url.pathname.startsWith('/login'));
	/** Home and Trends lay out in columns and take the wide page. */
	const wide = $derived(page.url.pathname === '/' || page.url.pathname.startsWith('/trends') || /^\/categories\/\d+$/.test(page.url.pathname));

	// Screens cross over with a view transition; the same screen with another address (a month, a filter) doesn't.
	onNavigate((navigation) => {
		if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		if (navigation.from?.route.id === navigation.to?.route.id) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
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

<Toasts />

{#if isLogin}
	{@render children()}
{:else if ready && session.me}
	<div class="shell">
		<Rail />
		<main class="page" class:page--wide={wide} id="main">
			{@render children()}
		</main>
	</div>
	<BottomNav />
	<Entry />
{:else}
	<main class="login"><Loading /></main>
{/if}
