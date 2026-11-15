<script lang="ts">
	/** A Burrow trace (acorn, leaf, footprint, twig...). Decorative. */
	let { name = 'acorn', size = 24, class: klass = '' }: { name?: string; size?: number; class?: string } = $props();
</script>

<img class="bh-trace {klass}" src="/img/burrow/traces/{name}.svg" width={size} height={size} alt="" aria-hidden="true" />
