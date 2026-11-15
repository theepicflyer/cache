<script lang="ts">
	import type { Snippet } from 'svelte';
	import burrow from '#lib/burrow/scenes/habitat_burrow.html?raw';
	import meadow from '#lib/burrow/scenes/habitat_meadow.html?raw';
	import oak from '#lib/burrow/scenes/habitat_oak.html?raw';
	import river from '#lib/burrow/scenes/habitat_river.html?raw';
	import type { Mood, Who } from '#lib/state.svelte.ts';
	import Mascot from './Mascot.svelte';

	/**
	 * Burrow Habitat: the page header band showing an animal at home. oak is Kacang's (home, budgets,
	 * trends), burrow is Gali's (history, search), river is Kayu's (settings, editing). The children are
	 * the page title and controls; keep them short, the scenery takes the right-hand side.
	 */
	type Kind = 'oak' | 'burrow' | 'river' | 'meadow';
	let { kind = 'oak', who, mood = 'happy', class: klass = '', children }: { kind?: Kind; who?: Who; mood?: Mood; class?: string; children: Snippet } = $props();

	const scenes: Record<Kind, { art: string; resident: Who }> = {
		oak: { art: oak, resident: 'kacang' },
		burrow: { art: burrow, resident: 'gali' },
		river: { art: river, resident: 'kayu' },
		meadow: { art: meadow, resident: 'bao' }
	};
</script>

<div class="bh-habitat bh-habitat--{kind} bh-habitat--page {klass}">
	{@html scenes[kind].art}
	<!-- keyed, so the resident hops when its mood changes -->
	<span class="bh-habitat__resident">{#key mood}<Mascot who={who ?? scenes[kind].resident} {mood} size={96} bounce />{/key}</span>
	<div class="bh-habitat__content">{@render children()}</div>
</div>
