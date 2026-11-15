/**
 * The charts, drawn with Chart.js, which loads only when a chart is on screen. Every amount passed
 * in is whole cents; labels are what the x axis shows (short month names).
 */
import type { Chart as ChartJs, ChartConfiguration } from 'chart.js';

export type ChartData =
	/** Bars: spent (tomato when over, faded while the month is running). Dashed line: budget. */
	| { kind: 'budget'; labels: string[]; budget: number[]; spent: number[]; partial?: boolean[] }
	/** One line per fund: its balance. */
	| { kind: 'funds'; labels: string[]; funds: { name: string; values: number[] }[] }
	/** One fund: balance as an area, spending as bars. */
	| { kind: 'fund'; labels: string[]; balance: number[]; spent: number[] }
	/** Income against everything spent, faded while the month is running. */
	| { kind: 'inout'; labels: string[]; income: number[]; out: number[]; partial?: boolean[] }
	/** Money received in an income category. */
	| { kind: 'income'; labels: string[]; received: number[] };

type Colors = Record<'mint' | 'sky' | 'sunny' | 'tomato' | 'bark' | 'ink' | 'muted' | 'line' | 'paper', string>;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colors = (): Colors => ({
	mint: cssVar('--mint'),
	sky: cssVar('--sky'),
	sunny: cssVar('--sunny'),
	tomato: cssVar('--tomato'),
	bark: cssVar('--bark'),
	ink: cssVar('--ink'),
	muted: cssVar('--ink-muted'),
	line: cssVar('--line'),
	paper: cssVar('--paper')
});
const alpha = (hex: string, a: number) => {
	const h = hex.replace('#', '');
	const n = parseInt(h.length === 3 ? [...h].map((x) => x + x).join('') : h, 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
const dollars = (cents: number[]) => cents.map((c) => c / 100);
const money = (v: unknown) => `${Number(v) < 0 ? '−' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const xAxis = { grid: { display: false } };
const yAxis = (beginAtZero = true) => ({ beginAtZero, ticks: { callback: money } });
const labelled = { callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}` } };
const byIndex = { mode: 'index', intersect: false } as const;

function build(data: ChartData, c: Colors): ChartConfiguration {
	switch (data.kind) {
		case 'budget': {
			const partial = data.partial ?? [];
			return {
				type: 'bar',
				data: {
					labels: data.labels,
					datasets: [
						{ type: 'line', label: 'Budget', data: dollars(data.budget), borderColor: c.ink, backgroundColor: c.ink, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, stepped: 'middle', order: 0 },
						{
							label: 'Spent',
							data: dollars(data.spent),
							order: 1,
							backgroundColor: data.spent.map((s, i) => alpha(s > data.budget[i]! ? c.tomato : c.mint, partial[i] ? 0.45 : 1)),
							borderWidth: 0
						}
					]
				},
				// the card's header carries a legend that explains the colours
				options: { interaction: byIndex, scales: { y: yAxis(), x: xAxis }, plugins: { legend: { display: false }, tooltip: labelled } }
			} as ChartConfiguration;
		}
		case 'funds': {
			const series = [c.mint, c.sky, c.sunny, c.tomato, c.bark, c.muted];
			return {
				type: 'line',
				data: {
					labels: data.labels,
					datasets: data.funds.map((f, i) => ({ label: f.name, data: dollars(f.values), borderColor: series[i % series.length], backgroundColor: series[i % series.length], pointRadius: 0, tension: 0.25 }))
				},
				options: { interaction: byIndex, scales: { y: yAxis(false), x: xAxis }, plugins: { tooltip: labelled } }
			} as ChartConfiguration;
		}
		case 'fund':
			return {
				type: 'bar',
				data: {
					labels: data.labels,
					datasets: [
						{ type: 'line', label: 'Balance', data: dollars(data.balance), borderColor: c.mint, backgroundColor: alpha(c.mint, 0.15), fill: true, pointRadius: 0, tension: 0.25, order: 0 },
						{ label: 'Spent', data: dollars(data.spent), backgroundColor: alpha(c.bark, 0.8), order: 1 }
					]
				},
				options: { interaction: byIndex, scales: { y: yAxis(), x: xAxis }, plugins: { tooltip: labelled } }
			} as ChartConfiguration;
		case 'inout': {
			const partial = data.partial ?? [];
			return {
				type: 'bar',
				data: {
					labels: data.labels,
					datasets: [
						{ label: 'Income', data: dollars(data.income), backgroundColor: data.income.map((_, i) => alpha(c.mint, partial[i] ? 0.45 : 1)) },
						{ label: 'Spent', data: dollars(data.out), backgroundColor: data.out.map((_, i) => alpha(c.bark, partial[i] ? 0.45 : 1)) }
					]
				},
				options: { interaction: byIndex, scales: { y: yAxis(), x: xAxis }, plugins: { legend: { display: false }, tooltip: labelled } }
			} as ChartConfiguration;
		}
		case 'income':
			return {
				type: 'bar',
				data: { labels: data.labels, datasets: [{ label: 'Received', data: dollars(data.received), backgroundColor: c.mint }] },
				options: { scales: { y: yAxis(), x: xAxis }, plugins: { legend: { display: false }, tooltip: labelled } }
			} as ChartConfiguration;
	}
}

/**
 * Draw `data` on a canvas. Colours are read from the theme at draw time, so draw again when the theme
 * changes. `animate` grows the bars and draws the lines in, left to right; only a chart's first
 * drawing does, so a redraw for a new theme or new data appears at once.
 */
export async function draw(canvas: HTMLCanvasElement, data: ChartData, animate = false): Promise<ChartJs> {
	const { default: Chart } = await import('chart.js/auto');
	const c = colors();
	const d = Chart.defaults;
	d.font.family = '"Figtree Variable", system-ui, sans-serif';
	d.color = c.muted;
	d.scale.grid.color = c.line;
	(d.scale as unknown as { border: { color: string } }).border.color = c.line;
	d.elements.line.borderWidth = 3;
	d.elements.bar.borderRadius = 6;
	d.maintainAspectRatio = false;
	d.plugins.legend.labels.usePointStyle = true;
	d.plugins.tooltip.backgroundColor = c.ink;
	d.plugins.tooltip.titleColor = c.paper;
	d.plugins.tooltip.bodyColor = c.paper;
	d.plugins.tooltip.cornerRadius = 10;
	d.plugins.tooltip.padding = 10;
	Chart.getChart(canvas)?.destroy();
	const config = build(data, c);
	const still = !animate || matchMedia('(prefers-reduced-motion: reduce)').matches;
	config.options = {
		...config.options,
		animation: still
			? false
			: {
					duration: 700,
					easing: 'easeOutQuart',
					// one month after another; each bar or point starts a little after the one to its left
					delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 35 : 0)
				}
	};
	return new Chart(canvas, config);
}
