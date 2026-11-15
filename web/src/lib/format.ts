/** How Cache shows money and dates. Amounts are whole cents; days are YYYY-MM-DD; months are YYYY-MM. */
import type { TxnType } from './types.ts';

const MINUS = '−';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `$1,234.50` without a sign. */
function plain(cents: number): string {
	const abs = Math.abs(Math.round(cents));
	const whole = Math.floor(abs / 100).toLocaleString('en-US');
	return `$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** `$1,234.50`, `−$5.00` when negative. */
export function money(cents: number | null | undefined): string {
	if (cents === null || cents === undefined) return '';
	return cents < 0 ? MINUS + plain(cents) : plain(cents);
}

/** A transaction's amount: `−$5.00` for an expense, `+$5.00` for income. */
export function signedMoney(cents: number, type: TxnType): string {
	return (type === 'income' ? '+' : MINUS) + plain(cents);
}

/** Cents as the text of an amount input: `12.50`, or `12` when whole. */
export function amountText(cents: number | null | undefined): string {
	if (cents === null || cents === undefined) return '';
	const abs = Math.abs(cents);
	const text = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
	return cents < 0 ? `-${text}` : text;
}

function parts(day: string): { y: number; m: number; d: number } {
	const [y, m, d] = day.split('-').map(Number);
	return { y: y!, m: m!, d: d ?? 1 };
}

/** `Mon 9 Nov`, with the year when it isn't this year. */
export function day(value: string | null | undefined): string {
	if (!value) return '';
	const { y, m, d } = parts(value);
	const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	const text = `${weekday} ${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
	return y === new Date().getFullYear() ? text : `${text} ${y}`;
}

/** A month (or a day in it) as `November 2026` (long), `Nov 2026` (short), `November` (name) or `Nov` (abbr). */
export function month(value: string, style: 'long' | 'short' | 'name' | 'abbr' = 'long'): string {
	const { y, m } = parts(value);
	const name = MONTHS[m - 1]!;
	if (style === 'name') return name;
	if (style === 'abbr') return name.slice(0, 3);
	return `${style === 'short' ? name.slice(0, 3) : name} ${y}`;
}

/** The YYYY-MM of a day. */
export const monthOf = (value: string) => value.slice(0, 7);

/** A month moved by `n` months. */
export function addMonths(value: string, n: number): string {
	const { y, m } = parts(value);
	const index = y * 12 + (m - 1) + n;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** A day moved by `n` days. */
export function addDays(value: string, n: number): string {
	const { y, m, d } = parts(value);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "1 day", "3 days". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
