<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, changes, post } from 'warren/web';
	import CategoryForm, { type CategoryValues } from '#lib/components/CategoryForm.svelte';
	import Habitat from '#lib/components/Habitat.svelte';
	import { toasts } from '#lib/state.svelte.ts';
	import type { Kind } from '#lib/types.ts';

	const asked = page.url.searchParams.get('kind');
	const now = new Date();
	let values = $state<CategoryValues>({
		name: '',
		kind: asked === 'fund' || asked === 'income' ? (asked as Kind) : 'budget',
		icon: '',
		amount: '',
		from_month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
		opening_balance: '0',
		target: '',
		archived: false
	});
	let errors = $state<Record<string, string>>({});
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		try {
			const res = await post<{ toast: string }>('/api/categories', values);
			toasts.show(res.toast);
			changes.changed();
			await goto('/settings');
		} catch (err) {
			if (err instanceof ApiError && Object.keys(err.errors).length) errors = err.errors;
			else toasts.error(err);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>New category · Cache</title></svelte:head>

<Habitat kind="river" mood="busy">
	<span class="bh-habitat__eyebrow"><a href="/settings" style="color:inherit">Settings</a></span>
	<h1 class="page-title">New category</h1>
</Habitat>
<form class="bh-card form-grid" onsubmit={submit}>
	<CategoryForm bind:values {errors} />
	<div class="actions actions--end">
		<a class="bh-btn bh-btn--ghost wn-press" href="/settings">Cancel</a>
		<button class="bh-btn bh-btn--primary wn-press" type="submit" disabled={saving}>Add category</button>
	</div>
</form>
