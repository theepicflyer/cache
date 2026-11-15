<script lang="ts">
	import { draw, type ChartData } from '#lib/charts.ts';

	/**
	 * A chart in a `chart-box`. It redraws when its data changes and when the theme does, because
	 * colours are read from the theme at draw time. `label` says what it shows, for screen readers.
	 */
	let { data, label, small = false }: { data: ChartData; label: string; small?: boolean } = $props();
	let canvas: HTMLCanvasElement;
	let theme = $state(document.documentElement.dataset.theme);

	$effect(() => {
		const observer = new MutationObserver(() => (theme = document.documentElement.dataset.theme));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	});

	$effect(() => {
		void theme;
		let stale = false;
		let chart: { destroy(): void } | undefined;
		draw(canvas, data).then((drawn) => {
			if (stale) drawn.destroy();
			else chart = drawn;
		});
		return () => {
			stale = true;
			chart?.destroy();
		};
	});
</script>

<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
<div class="chart-box" class:chart-box--sm={small}><canvas bind:this={canvas} role="img" aria-label={label}></canvas></div>
