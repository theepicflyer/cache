<script lang="ts">
	import { page } from '$app/state';
	import Loading from '#lib/components/Loading.svelte';
	import RecurringForm from '#lib/components/RecurringForm.svelte';
	import { loaded } from '#lib/load.svelte.ts';
	import type { Rule } from '#lib/types.ts';

	const rule = loaded<Rule>(() => `/api/recurring/${page.params.id}`);
</script>

<svelte:head><title>{rule.data?.title ?? 'Recurring'} · Cache</title></svelte:head>

{#if !rule.data}
	<Loading />
{:else}
	<!-- Keyed on the id so moving to another rule starts a fresh form. -->
	{#key rule.data.id}<RecurringForm rule={rule.data} />{/key}
{/if}
