<script lang="ts">
	import { goto } from '$app/navigation';
	import { get, post } from 'warren/web';
	import world from '#lib/burrow/scenes/world.html?raw';
	import { session, toasts } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	let config = $state<{ oidc: boolean; dev: boolean } | null>(null);
	let name = $state('');
	let busy = $state(false);

	onMount(async () => {
		config = await get<{ oidc: boolean; dev: boolean }>('/api/auth/config');
	});

	/** Development only: sign in as anyone by name. */
	async function devLogin(who: string) {
		if (!who.trim()) return;
		busy = true;
		try {
			await post('/api/auth/dev-login', { name: who.trim() });
			await session.load(true);
			await goto('/');
		} catch (err) {
			toasts.error(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Sign in · Cache</title></svelte:head>

<main class="login">
	<div class="login__card">
		<div class="login__world">{@html world}</div>
		<div class="bh-card stack">
			<h1 class="page-title" style="text-align:center">Cache</h1>
			{#if config?.oidc}
				<a class="bh-btn bh-btn--primary bh-btn--block wn-press" href="/auth/login" data-sveltekit-reload>Sign in with Pocket ID</a>
			{/if}
			{#if config?.dev}
				<form
					class="form-grid"
					onsubmit={(e) => {
						e.preventDefault();
						devLogin(name);
					}}
				>
					<div class="field">
						<label for="dev-name">Development sign-in</label>
						<input class="input" id="dev-name" bind:value={name} placeholder="Any name, e.g. Alice" autocomplete="off" />
					</div>
					<button class="bh-btn bh-btn--secondary bh-btn--block wn-press" disabled={busy || !name.trim()}>Sign in as {name.trim() || '...'}</button>
				</form>
			{/if}
			{#if config && !config.oidc && !config.dev}
				<p class="form-error">No sign-in method is configured on the server.</p>
			{/if}
		</div>
	</div>
</main>
