/** Day arithmetic for the entry flow. Days are YYYY-MM-DD and months YYYY-MM, as everywhere else. */
import { addDays, monthOf } from '#lib/format.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utc(value: string): number {
	const [y, m, d] = value.split('-').map(Number);
	return Date.UTC(y!, m! - 1, d ?? 1);
}

/** The device's own today, until the server's arrives. */
export function localToday(): string {
	const now = new Date();
	return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

/** Whole days from `day` to `today`: 0 today, 1 yesterday, negative in the future. */
export const daysAgo = (day: string, today: string) => Math.round((utc(today) - utc(day)) / 86400000);

export function weekday(day: string, style: 'long' | 'short'): string {
	const name = WEEKDAYS[new Date(utc(day)).getUTCDay()]!;
	return style === 'long' ? name : name.slice(0, 3);
}

/** `20 Oct`, or `20 Oct 25` outside today's year: short enough for a quarter of the date row. */
export function shortDate(day: string, today: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const text = `${d} ${MONTHS[m! - 1]}`;
	return day.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${String(y).slice(2)}`;
}

/** The days a month's calendar shows, Sunday first: whole weeks, five or six of them. */
export function calendarDays(month: string): string[] {
	const first = `${month}-01`;
	const start = addDays(first, -new Date(utc(first)).getUTCDay());
	const days: string[] = [];
	for (let i = 0; i < 42; i++) {
		const d = addDays(start, i);
		if (i >= 35 && monthOf(d) !== month) break;
		days.push(d);
	}
	return days;
}
