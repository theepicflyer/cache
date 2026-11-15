<script lang="ts">
	/**
	 * The add/edit transaction flow, one page at a time so nothing hides behind the phone keyboard:
	 * amount (own numpad, no keyboard) → title (keyboard; Return or a suggestion moves on) →
	 * category (a tap moves on) → review (date, month, repeat and note are optional and set in place;
	 * the calendar, other months and the note open their own page; one tap saves).
	 * Editing opens straight on the review page.
	 */
	import { goto, pushState } from '$app/navigation';
	import { ApiError, del, get, patch, post } from '#lib/api.ts';
	import { calendarDays, daysAgo, localToday, shortDate, weekday } from '#lib/entry/dates.ts';
	import { addDays, addMonths, month as monthText, monthOf, signedMoney } from '#lib/format.ts';
	import { entry, ledger, toasts } from '#lib/state.svelte.ts';
	import type { Category, EntryData, Saved, Txn, TxnType, Unit } from '#lib/types.ts';
	import { flushSync, onMount, tick, untrack } from 'svelte';
	import CategoryIcon from './CategoryIcon.svelte';
	import CategoryTile from './CategoryTile.svelte';
	import Icon from './Icon.svelte';

	type Page = 'amount' | 'title' | 'category' | 'review' | 'date' | 'month' | 'note';
	const MAIN: Page[] = ['amount', 'title', 'category', 'review'];
	const KIND_LABELS = { budget: 'Budget', fund: 'Sinking fund', income: 'Income' } as const;

	interface Draft {
		id: number | null;
		type: TxnType;
		int: string;
		dec: string;
		hasDec: boolean;
		title: string;
		category: number | null;
		date: string;
		month: string;
		/** The month was picked by hand, so it no longer follows the date. */
		monthPicked: boolean;
		/** The date was set by hand, so the server's today doesn't replace it. */
		datePicked: boolean;
		note: string;
		repeat: '' | Unit;
		recurring: number | null;
		recurringTitle: string;
	}

	function draft(txn: Txn | null, today: string): Draft {
		const cents = txn ? txn.amount : 0;
		const dec = String(cents % 100).padStart(2, '0');
		const hasDec = !!txn && dec !== '00';
		return {
			id: txn?.id ?? null,
			type: txn?.type ?? 'expense',
			int: txn ? String(Math.floor(cents / 100)) : '',
			dec: hasDec ? dec.replace(/0+$/, '') : '',
			hasDec,
			title: txn?.title ?? '',
			category: txn?.category_id ?? null,
			date: txn?.date ?? today,
			month: txn?.month ?? monthOf(today),
			monthPicked: txn ? txn.month !== monthOf(txn.date) : false,
			datePicked: !!txn,
			note: txn?.note ?? '',
			repeat: '',
			recurring: txn?.recurring_id ?? null,
			recurringTitle: txn?.recurring_title ?? ''
		};
	}

	let data = $state<EntryData | null>(null);
	const today = $derived(data?.today ?? localToday());
	const cats = $derived(new Map((data?.cats ?? []).map((c) => [c.id, c])));

	let shown = $state(false);
	let s = $state<Draft>(draft(null, localToday()));
	let page = $state<Page>('amount');
	let trail = $state<Page[]>([]); // pages to go back through
	let calView = $state('');
	let noteDraft = $state('');
	let error = $state('');
	let busy = $state(false);
	let kb = $state(false);
	let vvh = $state<string | undefined>();
	let vvt = $state<string | undefined>();
	let pushed = false;
	let popping = false;

	let panel: HTMLElement | undefined = $state();
	let titleInput: HTMLInputElement | undefined = $state();
	let noteInput: HTMLTextAreaElement | undefined = $state();
	const pageEls: Partial<Record<Page, HTMLElement>> = {};

	// ---------- amount (own numpad, so no keyboard here)
	const amountCents = $derived(Number(s.int || '0') * 100 + Number((s.dec || '').padEnd(2, '0')));
	const amountDisplay = $derived.by(() => {
		const int = Number(s.int || '0').toLocaleString('en-US');
		return s.hasDec ? `${int}.${s.dec}` : int;
	});
	const amountPayload = $derived(`${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, '0')}`);

	function key(k: string) {
		if (k === 'back') {
			if (s.dec) s.dec = s.dec.slice(0, -1);
			else if (s.hasDec) s.hasDec = false;
			else s.int = s.int.slice(0, -1);
		} else if (k === '.') {
			s.hasDec = true;
		} else if (s.hasDec) {
			if (s.dec.length < 2) s.dec += k;
		} else if (s.int.length < 9) {
			s.int = s.int === '0' ? k : s.int + k;
		}
		try {
			navigator.vibrate?.(5);
		} catch {
			/* unsupported */
		}
	}

	function setType(type: TxnType) {
		s.type = type;
		// Expenses never go to an income category.
		if (s.category && type === 'expense' && cats.get(s.category)?.kind === 'income') s.category = null;
	}
	const income = $derived(s.type === 'income');

	// ---------- title and its suggestions
	const wants = (m: EntryData['titles'][number]) => (m.y || 'expense') === s.type && cats.has(m.c);
	const suggestions = $derived.by(() => {
		const titles = data?.titles ?? [];
		const q = s.title.trim().toLowerCase();
		const out: EntryData['titles'] = [];
		for (const m of titles) {
			if (!wants(m)) continue;
			if (!q || m.t.toLowerCase().startsWith(q)) out.push(m);
			if (out.length >= 8) break;
		}
		if (q && out.length < 8) {
			for (const m of titles) {
				const t = m.t.toLowerCase();
				if (wants(m) && !t.startsWith(q) && t.includes(q)) out.push(m);
				if (out.length >= 8) break;
			}
		}
		return out;
	});

	function suggest(m: EntryData['titles'][number]) {
		s.title = m.t;
		s.category = m.c;
		after('review');
	}
	function titleDone() {
		s.title = s.title.trim();
		// An exact match to a past title brings its category along.
		const exact = data?.titles.find((m) => m.t.toLowerCase() === s.title.toLowerCase() && wants(m));
		if (exact && !s.category) s.category = exact.c;
		after(s.category ? 'review' : 'category');
	}

	// ---------- category: income first (then the budgets and funds it can be money back to)
	const incomeCats = $derived((data?.cats ?? []).filter((c) => c.kind === 'income'));
	const otherCats = $derived((data?.cats ?? []).filter((c) => c.kind !== 'income'));
	function pickCategory(c: Category) {
		s.category = c.id;
		setTimeout(() => after('review'), 140);
	}

	// ---------- review and its detail pages
	const cat = $derived(s.category ? cats.get(s.category) : undefined);
	const ago = $derived(daysAgo(s.date, today));
	const otherDate = $derived(ago < 0 || ago > 2);
	const dayAgo = (n: number) => addDays(today, -n);
	// Long name this year, "Sep 2025" otherwise, so it fits a third of the row.
	const monthLabel = (m: string) => (m.slice(0, 4) === today.slice(0, 4) ? monthText(m, 'name') : monthText(m, 'short'));
	// The month before the date's (a late bill) and the date's own, oldest on the left like the date row.
	const nearMonths = $derived([addMonths(monthOf(s.date), -1), monthOf(s.date)]);
	const otherMonth = $derived(!nearMonths.includes(s.month));
	const kindLine = $derived(cat ? (cat.kind !== 'income' && income ? `${KIND_LABELS[cat.kind]} · money back` : KIND_LABELS[cat.kind]) : '');

	function pickDate(d: string) {
		s.date = d;
		s.datePicked = true;
		if (!s.monthPicked) s.month = monthOf(d);
		if (page !== 'review') go('review', { back: true });
	}
	function pickMonth(m: string, back: boolean) {
		s.month = m;
		s.monthPicked = m !== monthOf(s.date);
		if (back) go('review', { back: true });
	}
	const monthChoices = $derived([-3, -2, -1, 0, 1, 2].map((n) => ({ value: addMonths(monthOf(s.date), n), own: n === 0 })));

	// ---------- summary chips (what's been entered so far; tap to change)
	const chips = $derived.by(() => {
		if (page === 'review' || !MAIN.includes(page)) return [];
		const out: [Page, string][] = [];
		if (page !== 'amount' && amountCents > 0) out.push(['amount', signedMoney(amountCents, s.type)]);
		if (page !== 'amount' && page !== 'title' && s.title) out.push(['title', s.title]);
		return out;
	});
	const dotIndex = $derived(MAIN.indexOf(MAIN.includes(page) ? page : 'review'));

	// ---------- navigation
	/** Renders `name` now, so focus lands inside the tap that got here and the phone raises its keyboard. */
	function show(name: Page) {
		if (page === 'title') s.title = s.title.trim();
		page = name;
		error = '';
		if (name === 'date') calView = monthOf(s.date);
		if (name === 'note') noteDraft = s.note;
		flushSync();
		const el = pageEls[name];
		if (el) {
			el.classList.remove('is-in');
			void el.offsetWidth;
			el.classList.add('is-in');
		}
		if (name === 'title') titleInput?.focus({ preventScroll: true });
		else if (name === 'note') noteInput?.focus({ preventScroll: true });
		else if (document.activeElement === titleInput || document.activeElement === noteInput) panel?.focus({ preventScroll: true });
	}
	function go(name: Page, { back = false } = {}) {
		if (name === page) return;
		if (back) {
			// Returning from a detail page: drop it from the trail.
			const at = trail.lastIndexOf(name);
			if (at >= 0) trail = trail.slice(0, at);
		} else {
			trail.push(page);
		}
		show(name);
	}
	// Finishing a page reached from the review goes back to the review; otherwise on to `next`.
	function after(next: Page) {
		if (trail.includes('review')) go('review', { back: true });
		else go(next);
	}
	function back() {
		const prev = trail.pop();
		if (prev) show(prev);
		else close();
	}
	function amountNext() {
		if (amountCents > 0) after(s.title && s.category ? 'review' : 'title');
	}

	// Keyboard on desktop: type the amount, Enter moves on, Escape closes.
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}
		if (page !== 'amount' || e.metaKey || e.ctrlKey || e.altKey) return;
		if (/^[0-9]$/.test(e.key) || e.key === '.' || e.key === ',') {
			e.preventDefault();
			key(e.key === ',' ? '.' : e.key);
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			key('back');
		} else if (e.key === 'Enter') {
			e.preventDefault();
			amountNext();
		}
	}

	// Keep the panel inside the part of the screen the keyboard leaves free.
	function fit() {
		const vv = window.visualViewport;
		if (!vv || !shown) return;
		vvh = `${vv.height}px`;
		vvt = `${vv.offsetTop}px`;
		kb = window.innerHeight - vv.height > 120;
	}

	// ---------- open / close
	function start(txn: Txn | null) {
		s = draft(txn, today);
		if (!txn && entry.category) s.category = entry.category;
		trail = [];
		page = 'amount';
		error = '';
		busy = false;
		shown = true;
		document.documentElement.classList.add('entry-open');
		fit();
		// Back (the phone's, or the browser's) closes the flow rather than leaving the page.
		if (!pushed) {
			pushState('', { entry: true });
			pushed = true;
		}
		show(txn ? 'review' : 'amount');
		panel?.focus({ preventScroll: true });
		get<EntryData>('/api/entry')
			.then((result) => {
				data = result;
				if (!s.datePicked) {
					s.date = result.today;
					if (!s.monthPicked) s.month = monthOf(result.today);
				}
			})
			.catch((err) => {
				if (err?.status !== 401) toasts.error(err);
			});
	}
	function finish() {
		if (panel?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
		shown = false;
		document.documentElement.classList.remove('entry-open');
		if (pushed && !popping) history.back();
		pushed = false;
		popping = false;
	}
	function close() {
		entry.close();
	}
	/** Leaves the flow for another page: the page takes the place of the history entry the flow added. */
	function leave(e: MouseEvent, href: string) {
		e.preventDefault();
		const replace = pushed;
		pushed = false;
		entry.close();
		goto(href, { replaceState: replace });
	}

	$effect(() => {
		const open = entry.open;
		const txn = entry.editing;
		untrack(() => {
			// flushSync can't run inside an effect, so the flow starts just after it.
			if (open && !shown) tick().then(() => entry.open && !shown && start(txn));
			else if (!open && shown) finish();
		});
	});

	onMount(() => {
		const vv = window.visualViewport;
		vv?.addEventListener('resize', fit);
		vv?.addEventListener('scroll', fit);
		const onpop = () => {
			if (!shown) return;
			popping = true;
			pushed = false;
			entry.close();
		};
		window.addEventListener('popstate', onpop);
		return () => {
			vv?.removeEventListener('resize', fit);
			vv?.removeEventListener('scroll', fit);
			window.removeEventListener('popstate', onpop);
			document.documentElement.classList.remove('entry-open');
		};
	});

	// ---------- save / delete / undo
	async function save() {
		if (busy) return;
		if (!s.category) {
			go('category');
			return;
		}
		busy = true;
		const body = { type: s.type, amount: amountPayload, title: s.title, category: s.category, date: s.date, month: s.month, note: s.note, repeat: s.id ? '' : s.repeat };
		try {
			const res = s.id ? await patch<Saved>(`/api/transactions/${s.id}`, body) : await post<Saved>('/api/transactions', body);
			close();
			ledger.changed();
			const id = res.undo;
			toasts.show(res.toast, { action: id ? { label: 'Undo', run: () => undo(id) } : null });
		} catch (err) {
			error = err instanceof ApiError ? Object.values(err.errors).join(' ') || "Couldn't save." : "Couldn't save. Check your connection and try again.";
		} finally {
			busy = false;
		}
	}
	async function undo(id: number) {
		try {
			const res = await del<Saved>(`/api/transactions/${id}`);
			ledger.changed();
			toasts.show(res.toast, { mood: 'happy' });
		} catch {
			toasts.show("Couldn't undo. Delete it from History instead.", { who: 'kayu', mood: 'worried' });
		}
	}
	async function remove() {
		if (!s.id || busy) return;
		busy = true;
		try {
			const res = await del<Saved>(`/api/transactions/${s.id}`);
			close();
			ledger.changed();
			const d = res.spend;
			toasts.show(res.toast, {
				mood: 'happy',
				action: d
					? {
							label: 'Undo',
							run: async () => {
								try {
									const amount = `${Math.floor(d.amount / 100)}.${String(d.amount % 100).padStart(2, '0')}`;
									await post<Saved>('/api/transactions', { type: d.type, amount, title: d.title, category: d.category_id, date: d.date, month: d.month, note: d.note, repeat: '' });
									ledger.changed();
								} catch (err) {
									toasts.error(err);
								}
							}
						}
					: null
			});
		} catch {
			error = "Couldn't delete. Check your connection and try again.";
		} finally {
			busy = false;
		}
	}
</script>

{#snippet seg(on: boolean, onclick: () => void, label: string)}
	<button type="button" class="entry__seg-opt" class:is-on={on} role="radio" aria-checked={on} {onclick}>{label}</button>
{/snippet}

<div class="entry" id="entry" class:is-income={income} class:is-kb={kb} hidden={!shown} style:--vvh={vvh} style:--vvt={vvt} {onkeydown} role="presentation">
	<div class="entry__scrim" onclick={close} role="presentation"></div>
	<div class="entry__panel" role="dialog" aria-modal="true" aria-labelledby="entry-q" tabindex="-1" bind:this={panel}>
		<header class="entry__head">
			<button type="button" class="entry__icon" aria-label="Back" style:visibility={trail.length ? 'visible' : 'hidden'} onclick={back}><Icon name="chevron-left" size={22} /></button>
			<div class="entry__dots" aria-hidden="true" hidden={!!s.id}>
				{#each MAIN as _, j (j)}<span class={j < dotIndex ? 'is-done' : j === dotIndex ? 'is-on' : ''}></span>{/each}
			</div>
			<button type="button" class="entry__icon" aria-label="Close" onclick={close}><Icon name="x" size={22} /></button>
		</header>
		<div class="entry__summary" hidden={!chips.length}>
			{#each chips as [p, text] (p)}<button type="button" class="bh-chip" onclick={() => go(p)}>{text}</button>{/each}
		</div>

		<!-- 1. Amount -->
		<div class="entry__page" hidden={page !== 'amount'} bind:this={pageEls.amount}>
			<div class="entry__types" role="radiogroup" aria-label="Type">
				<button type="button" class="entry__type" class:is-on={!income} role="radio" aria-checked={!income} onclick={() => setType('expense')}>Expense</button>
				<button type="button" class="entry__type" class:is-on={income} role="radio" aria-checked={income} onclick={() => setType('income')}>Income</button>
			</div>
			<p class="entry__q" id="entry-q">How much?</p>
			<div class="entry__amount num" class:is-empty={amountCents === 0} aria-live="polite"><span class="entry__cur">$</span><span>{amountDisplay}</span></div>
			<div class="entry__numpad">
				{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as k (k)}
					<button type="button" class="entry__key" onclick={() => key(k)}>{k}</button>
				{/each}
				<button type="button" class="entry__key entry__key--flat" aria-label="Delete digit" onclick={() => key('back')}>⌫</button>
			</div>
			<div class="entry__bar"><button type="button" class="bh-btn bh-btn--primary bh-btn--block" disabled={amountCents <= 0} onclick={amountNext}>Next</button></div>
		</div>

		<!-- 2. Title -->
		<div class="entry__page" hidden={page !== 'title'} bind:this={pageEls.title}>
			<p class="entry__q">{income ? 'Where is it from?' : 'What was it?'}</p>
			<div class="entry__titlebox">
				<input
					class="entry__title"
					maxlength="200"
					autocomplete="off"
					autocapitalize="sentences"
					enterkeyhint="next"
					placeholder={income ? 'e.g. Salary' : 'e.g. Chicken rice'}
					aria-label="Title"
					bind:value={s.title}
					bind:this={titleInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							titleDone();
						}
					}}
				/>
				<button type="button" class="bh-btn bh-btn--primary bh-btn--sm" onclick={titleDone}>Next</button>
			</div>
			<p class="entry__hint" hidden={!suggestions.length}>Pick one you used before to skip the category.</p>
			<ul class="entry__suggest" role="listbox" aria-label="Past titles">
				{#each suggestions as m (m.t + m.c)}
					{@const c = cats.get(m.c)}
					<li>
						<!-- pointerdown keeps the keyboard from bouncing before the page changes -->
						<button type="button" onpointerdown={(e) => e.preventDefault()} onclick={() => suggest(m)}>
							<span>{m.t}</span>
							<span class="entry__suggest-cat">{#if c?.display_icon}<CategoryIcon name={c.display_icon} size={18} />{/if}{c?.name ?? ''}</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>

		<!-- 3. Category -->
		<div class="entry__page" hidden={page !== 'category'} bind:this={pageEls.category}>
			<p class="entry__q">{income ? 'Which category?' : 'What for?'}</p>
			<div class="entry__scroll">
				<div class="entry__cats">
					{#if data && !data.cats.length}
						<p class="small muted">No categories yet. <a href="/categories/new" onclick={(e) => leave(e, '/categories/new')}>Add a category</a> first.</p>
					{/if}
					{#snippet catButton(c: Category)}
						<button type="button" class="entry__cat" class:is-on={c.id === s.category} onclick={() => pickCategory(c)}>
							<CategoryTile category={c} />
							<span class="entry__cat-name">{c.name}</span>
						</button>
					{/snippet}
					{#if income}
						{#each incomeCats as c (c.id)}{@render catButton(c)}{/each}
						{#if incomeCats.length}<p class="entry__label">Money back to</p>{/if}
					{/if}
					{#each otherCats as c (c.id)}{@render catButton(c)}{/each}
				</div>
			</div>
		</div>

		<!-- 4. Review: everything optional is on the page, one tap to change -->
		<div class="entry__page" hidden={page !== 'review'} bind:this={pageEls.review}>
			<div class="entry__scroll">
				<div class="entry__hero">
					<button type="button" class="entry__hero-amount num" class:in-text={income} onclick={() => go('amount')}>{signedMoney(amountCents, s.type)}</button>
					<button type="button" class="entry__hero-title" class:muted={!s.title} onclick={() => go('title')}>{s.title || cat?.name || 'Add a title'}</button>
					<button type="button" class="entry__hero-cat" class:is-missing={!cat} onclick={() => go('category')}>
						{#if cat}<span class="entry__hero-tile"><CategoryTile category={cat} /></span>{/if}
						<span class="grow"><span class="entry__hero-cat-name">{cat ? cat.name : 'Pick a category'}</span><span class="entry__hero-cat-kind">{kindLine}</span></span>
						<span class="entry__hero-change">Change</span>
					</button>
				</div>

				<div class="entry__field">
					<p class="entry__label"><Icon name="calendar" size={18} /> Date</p>
					<!-- Older on the left, today on the right; "Other" shows any other picked date. -->
					<div class="entry__seg" role="radiogroup" aria-label="Date">
						<button type="button" class="entry__seg-opt" class:is-on={otherDate} role="radio" aria-checked={otherDate} onclick={() => go('date')}>
							{#if otherDate}{shortDate(s.date, today)}{:else}<Icon name="calendar" size={16} /><span>Other</span>{/if}
						</button>
						{@render seg(ago === 2, () => pickDate(dayAgo(2)), weekday(dayAgo(2), 'short'))}
						{@render seg(ago === 1, () => pickDate(dayAgo(1)), 'Yesterday')}
						{@render seg(ago === 0, () => pickDate(dayAgo(0)), 'Today')}
					</div>
				</div>

				<div class="entry__field">
					<p class="entry__label"><Icon name="chart" size={18} /> Counts toward</p>
					<div class="entry__seg entry__seg--3" role="radiogroup" aria-label="Counts toward">
						{@render seg(otherMonth, () => go('month'), otherMonth ? monthLabel(s.month) : 'Other')}
						{#each nearMonths as m (m)}{@render seg(m === s.month, () => pickMonth(m, false), monthLabel(m))}{/each}
					</div>
				</div>

				{#if !s.id}
					<div class="entry__field">
						<p class="entry__label"><Icon name="repeat" size={18} /> Repeat</p>
						<div class="entry__seg" role="radiogroup" aria-label="Repeat">
							{#each [['', 'Never'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']] as const as [value, label] (value)}
								{@render seg(s.repeat === value, () => (s.repeat = value), label)}
							{/each}
						</div>
					</div>
				{/if}

				<div class="entry__field">
					<p class="entry__label"><Icon name="note" size={18} /> Note</p>
					<button type="button" class="entry__notebox" class:is-set={!!s.note.trim()} onclick={() => go('note')}>{s.note.trim() || 'Add a note'}</button>
				</div>

				{#if s.recurring}
					<p class="note">
						Added by the recurring <a href="/recurring/{s.recurring}" onclick={(e) => leave(e, `/recurring/${s.recurring}`)}>{s.recurringTitle || 'entry'}</a>. Changes here only affect this entry; edit the recurring one to
						change those still to come.
					</p>
				{/if}
				<p class="form-error" role="alert">{error}</p>
			</div>
			<div class="entry__bar entry__bar--review">
				{#if s.id}
					<button type="button" class="bh-btn bh-btn--ghost bh-btn--danger" onclick={remove}><Icon name="trash" size={20} /> Delete</button>
				{/if}
				<button type="button" class="bh-btn bh-btn--primary grow" disabled={busy} onclick={save}>{s.id ? 'Save changes' : `Add ${income ? 'income' : 'expense'}`}</button>
			</div>
		</div>

		<!-- Review details, one page each -->
		<div class="entry__page" hidden={page !== 'date'} bind:this={pageEls.date}>
			<p class="entry__q">When?</p>
			<div class="entry__scroll">
				<div class="entry__shortcuts">
					<button type="button" class="bh-chip" onclick={() => pickDate(dayAgo(2))}>{weekday(dayAgo(2), 'long')}</button>
					<button type="button" class="bh-chip" onclick={() => pickDate(dayAgo(1))}>Yesterday</button>
					<button type="button" class="bh-chip" onclick={() => pickDate(dayAgo(0))}>Today</button>
				</div>
				{#if calView}
					<div class="entry__cal">
						<div class="entry__cal-head">
							<button type="button" class="entry__icon" aria-label="Previous month" onclick={() => (calView = addMonths(calView, -1))}><Icon name="chevron-left" size={20} /></button>
							<span>{monthText(calView)}</span>
							<button type="button" class="entry__icon" aria-label="Next month" onclick={() => (calView = addMonths(calView, 1))}><Icon name="chevron-right" size={20} /></button>
						</div>
						<div class="entry__cal-grid">
							{#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as d, i (i)}<span class="entry__cal-dow">{d}</span>{/each}
							{#each calendarDays(calView) as d (d)}
								<button type="button" class="entry__day" class:is-out={monthOf(d) !== calView} class:is-on={d === s.date} class:is-today={d === today} onclick={() => pickDate(d)}>{Number(d.slice(8))}</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
		<div class="entry__page" hidden={page !== 'month'} bind:this={pageEls.month}>
			<p class="entry__q">Which month does it count toward?</p>
			<p class="entry__hint">For a bill that arrives after the month it's for.</p>
			<div class="entry__scroll">
				<div class="entry__months">
					{#each monthChoices as m (m.value)}
						<button type="button" class="entry__choice" class:is-on={m.value === s.month} onclick={() => pickMonth(m.value, true)}>
							{monthText(m.value)}{#if m.own}<span class="entry__choice-sub">Month of the date</span>{/if}
						</button>
					{/each}
				</div>
			</div>
		</div>
		<div class="entry__page" hidden={page !== 'note'} bind:this={pageEls.note}>
			<p class="entry__q">Note</p>
			<!-- A draft, so the back arrow discards the edit. -->
			<textarea class="textarea entry__note" rows="3" placeholder="Anything to remember about it" aria-label="Note" bind:value={noteDraft} bind:this={noteInput}></textarea>
			<div class="entry__bar entry__bar--inline">
				<button
					type="button"
					class="bh-btn bh-btn--primary bh-btn--block"
					onclick={() => {
						s.note = noteDraft;
						go('review', { back: true });
					}}>Done</button
				>
			</div>
		</div>
	</div>
</div>
