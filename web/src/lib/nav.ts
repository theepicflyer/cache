import type { IconName } from './icons.ts';

/** The four destinations, in order. */
export const NAV = [
	{ id: 'home', href: '/', label: 'Home', icon: 'home' },
	{ id: 'history', href: '/history', label: 'History', icon: 'list' },
	{ id: 'trends', href: '/trends', label: 'Trends', icon: 'chart' },
	{ id: 'settings', href: '/settings', label: 'Settings', icon: 'gear' }
] as const satisfies readonly { id: string; href: string; label: string; icon: IconName }[];

/** Which destination a page belongs to. Categories, budgets and recurring are reached from Settings. */
export function activeNav(pathname: string): (typeof NAV)[number]['id'] {
	if (pathname.startsWith('/history')) return 'history';
	if (pathname.startsWith('/trends')) return 'trends';
	if (/^\/(settings|categories|recurring)/.test(pathname)) return 'settings';
	return 'home';
}
