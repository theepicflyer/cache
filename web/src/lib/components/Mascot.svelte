<script lang="ts">
	import type { Mood, Who } from '#lib/state.svelte.ts';

	/** One of the Burrow cast in a mood. Decorative. */
	let { who = 'kacang', mood = 'happy', size = 96, bounce = false, class: klass = '' }: { who?: Who; mood?: Mood; size?: number; bounce?: boolean; class?: string } = $props();
</script>

<img class="bh-mascot {klass}" class:bh-mascot--bounce={bounce} src="/img/burrow/characters/{who}-{mood}.svg" width={size} height={size} alt="" aria-hidden="true" />
