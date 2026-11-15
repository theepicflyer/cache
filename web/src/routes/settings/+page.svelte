<script lang="ts">
	import { goto } from '$app/navigation';
	import { forgetData, loaded, post } from 'warren/web';
	import CategoryTile from '#lib/components/CategoryTile.svelte';
	import Habitat from '#lib/components/Habitat.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { money } from '#lib/format.ts';
	import { smoothDetails } from '#lib/motion.svelte.ts';
	import { session, toasts } from '#lib/state.svelte.ts';
	import { setTheme, themeChoice, type ThemeChoice } from '#lib/theme.ts';
	import type { CategoryList, Kind } from '#lib/types.ts';

	const list = loaded<CategoryList>(() => '/api/categories');
	const cats = $derived(list.data?.categories ?? []);
	const live = $derived(cats.filter((c) => !c.archived));
	const budgets = $derived(live.filter((c) => c.kind === 'budget'));
	const funds = $derived(live.filter((c) => c.kind === 'fund'));
	const incomes = $derived(live.filter((c) => c.kind === 'income'));
	const archived = $derived(cats.filter((c) => c.archived));

	const KIND_NAMES: Record<Kind, string> = { budget: 'Budget', fund: 'Sinking fund', income: 'Income' };

	let theme = $state<ThemeChoice>(themeChoice());
	function pickTheme(choice: ThemeChoice) {
		theme = choice;
		setTheme(choice);
	}

	async function copyMcp(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			toasts.show('Address copied', { who: 'kayu', mood: 'happy' });
		} catch {
			// Clipboard access can be refused (insecure origin, permissions); the address stays selectable.
			toasts.show("Couldn't copy. Select the address and copy it instead.", { who: 'kayu', mood: 'worried' });
		}
	}

	let signingOut = $state(false);
	async function signOut() {
		signingOut = true;
		try {
			await post('/api/auth/logout');
			// the next person to sign in on this device never sees this one's screens
			forgetData();
			await session.load(true);
			await goto('/login');
		} catch (err) {
			toasts.error(err);
			signingOut = false;
		}
	}
</script>

<svelte:head><title>Settings · Cache</title></svelte:head>

<Habitat kind="river" mood="happy">
	<span class="bh-habitat__eyebrow">Household</span>
	<h1 class="page-title">Settings</h1>
	<p class="bh-habitat__sub">Categories, budgets, funds and recurring</p>
</Habitat>

{#if !list.data}
	<Skeleton habitat={false} />
{:else}
	{@const data = list.data}
	<div class="stack">
		<section class="bh-card" aria-labelledby="budgets-title">
			<div class="bh-card__head">
				<h2 class="bh-card__title section-title" id="budgets-title">Budgets</h2>
				<a class="card-link" href="/settings/budgets">Edit amounts</a>
			</div>
			{#each budgets as c (c.id)}
				<a class="setting wn-press" href="/categories/{c.id}">
					<CategoryTile category={c} />
					<span class="grow setting__title">{c.name}</span>
					<span class="bh-row__end"><span class="setting__value">{money(c.amount)}</span><span class="bh-row__detail">a month</span></span>
				</a>
			{:else}
				<p class="small muted">No budget categories yet.</p>
			{/each}
			<div class="actions" style="margin-top:12px"><a class="bh-btn bh-btn--secondary bh-btn--sm wn-press" href="/categories/new?kind=budget"><Icon name="plus" size={18} /> Add a category</a></div>
		</section>

		<section class="bh-card" aria-labelledby="funds-title">
			<div class="bh-card__head"><h2 class="bh-card__title section-title" id="funds-title">Sinking funds</h2></div>
			{#each funds as c (c.id)}
				<a class="setting wn-press" href="/categories/{c.id}">
					<CategoryTile category={c} />
					<span class="setting__text"><span class="setting__title">{c.name}</span><span class="bh-tags"><span class="bh-tag bh-tag--in">+{money(c.amount)} a month</span></span></span>
					<span class="bh-row__end"><span class="setting__value" class:over-text={(c.balance ?? 0) < 0}>{money(c.balance)}</span><span class="bh-row__detail">saved</span></span>
				</a>
			{:else}
				<p class="small muted">No funds yet. A fund grows by a set amount each month, for costs that come in lumps: car servicing, gifts, travel.</p>
			{/each}
			<div class="actions" style="margin-top:12px"><a class="bh-btn bh-btn--secondary bh-btn--sm wn-press" href="/categories/new?kind=fund"><Icon name="plus" size={18} /> Add a fund</a></div>
		</section>

		<section class="bh-card" aria-labelledby="income-title">
			<div class="bh-card__head"><h2 class="bh-card__title section-title" id="income-title">Income</h2></div>
			{#each incomes as c (c.id)}
				<a class="setting wn-press" href="/categories/{c.id}">
					<CategoryTile category={c} />
					<span class="grow setting__title">{c.name}</span>
					<Icon name="chevron-right" size={20} />
				</a>
			{:else}
				<p class="small muted">No income categories yet. Add one for pay, interest or anything else coming in.</p>
			{/each}
			<div class="actions" style="margin-top:12px"><a class="bh-btn bh-btn--secondary bh-btn--sm wn-press" href="/categories/new?kind=income"><Icon name="plus" size={18} /> Add income category</a></div>
		</section>

		<section class="bh-card" aria-labelledby="rec-title">
			<a class="setting wn-press" href="/recurring">
				<span class="tile" aria-hidden="true"><Icon name="repeat" size={22} /></span>
				<span class="setting__text"><span class="setting__title" id="rec-title">Recurring</span><span class="setting__sub">{data.recurring_count} active</span></span>
				<Icon name="chevron-right" size={20} />
			</a>
			{#if archived.length}
				<details class="disclosure disclosure--ruled" {@attach smoothDetails}>
					<summary>Archived categories ({archived.length}) <Icon name="chevron-down" size={20} /></summary>
					{#each archived as c (c.id)}
						<a class="setting wn-press" href="/categories/{c.id}"><CategoryTile category={c} class="tile--off" /><span class="grow setting__title">{c.name}</span><span class="bh-tag">{KIND_NAMES[c.kind]}</span></a>
					{/each}
				</details>
			{/if}
		</section>

		<section class="bh-card" aria-labelledby="app-title">
			<div class="bh-card__head"><h2 class="bh-card__title section-title" id="app-title">App</h2></div>
			<div class="form-grid">
				<div class="field">
					<span class="field__label">Theme</span>
					<div class="bh-seg" role="radiogroup" aria-label="Theme">
						<label><input type="radio" name="theme" value="system" checked={theme === 'system'} onchange={() => pickTheme('system')} /><span class="bh-seg__opt">Match device</span></label>
						<label><input type="radio" name="theme" value="light" checked={theme === 'light'} onchange={() => pickTheme('light')} /><span class="bh-seg__opt"><Icon name="sun" size={16} /> Light</span></label>
						<label><input type="radio" name="theme" value="dark" checked={theme === 'dark'} onchange={() => pickTheme('dark')} /><span class="bh-seg__opt"><Icon name="moon" size={16} /> Dark</span></label>
					</div>
				</div>
			</div>
		</section>

		<section class="bh-card" id="agents" aria-labelledby="agents-title">
			<div class="bh-card__head">
				<div class="bh-card__heading">
					<h2 class="bh-card__title section-title" id="agents-title">Connect Claude</h2>
					<p class="bh-card__sub">Add this address to Claude as a custom connector; Claude signs in the same way you do.</p>
				</div>
			</div>
			<div class="row" style="align-items:stretch">
				<code class="code grow" style="min-width:0">{data.mcp_url}</code>
				<button class="bh-btn bh-btn--secondary bh-btn--sm wn-press" type="button" onclick={() => copyMcp(data.mcp_url)}>Copy</button>
			</div>
		</section>

		<section class="bh-card" aria-labelledby="acct-title">
			<div class="bh-card__head">
				<div class="bh-card__heading">
					<h2 class="bh-card__title section-title" id="acct-title">Account</h2>
					<p class="bh-card__sub">Signed in as {session.me?.email || session.me?.name}. Everyone who signs in shares one household ledger.</p>
				</div>
			</div>
			<div class="actions">
				<button class="bh-btn bh-btn--secondary wn-press" type="button" disabled={signingOut} onclick={signOut}><Icon name="logout" size={18} /> Sign out</button>
			</div>
		</section>
	</div>
{/if}
