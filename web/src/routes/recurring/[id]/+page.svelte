<script lang="ts">
	import { page } from '$app/state';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import RecurringForm from '#lib/components/RecurringForm.svelte';
	import { loaded } from 'warren/web';
	import type { Rule } from '#lib/types.ts';

	const rule = loaded<Rule>(() => `/api/recurring/${page.params.id}`);
</script>

<svelte:head><title>{rule.data?.title ?? 'Recurring'} · Cache</title></svelte:head>

{#if !rule.data}
	<Skeleton cards={[480]} />
{:else}
	<!-- Keyed on the id so moving to another rule starts a fresh form. -->
	{#key rule.data.id}<RecurringForm rule={rule.data} />{/key}
{/if}
