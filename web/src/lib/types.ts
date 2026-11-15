/** The API's shapes (server/src/api.ts). Amounts are whole cents. */
export type Kind = 'budget' | 'fund' | 'income';
export type TxnType = 'expense' | 'income';
export type Unit = 'week' | 'month' | 'year';

export interface Me {
	id: number;
	name: string;
	email: string;
}

export interface Category {
	id: number;
	name: string;
	kind: Kind;
	/** "" (automatic), "letter", or an icon's name. */
	icon: string;
	/** The icon to draw, or "" for none. */
	display_icon: string;
	position: number;
	archived: boolean;
	opening_balance: number;
	target: number | null;
}

export interface Txn {
	id: number;
	type: TxnType;
	amount: number;
	title: string;
	category_id: number;
	category: Category;
	date: string;
	month: string;
	counts_elsewhere: boolean;
	note: string;
	recurring_id: number | null;
	recurring_title: string;
}

export interface Rule {
	id: number;
	type: TxnType;
	title: string;
	amount: number;
	category_id: number;
	category: Category;
	note: string;
	every: number;
	unit: Unit;
	start_date: string;
	end_date: string | null;
	month_offset: number;
	paused: boolean;
	last_generated: string | null;
	/** "Monthly", "Every 2 weeks". */
	frequency: string;
	next: string | null;
}

export interface BudgetLine {
	category: Category;
	budget: number;
	spent: number;
	left: number;
	over: boolean;
	percent: number;
}
export interface FundLine {
	category: Category;
	topup: number;
	spent: number;
	balance: number;
	acorns: number;
}
export interface IncomeLine {
	category: Category;
	received: number;
}
export interface MonthStatus {
	month: string;
	budgets: BudgetLine[];
	funds: FundLine[];
	incomes: IncomeLine[];
	total_budget: number;
	total_spent: number;
	left: number;
	over: boolean;
	percent: number;
	fund_spent: number;
	income: number;
	out: number;
	net: number;
	leaves: number;
	days_left: number | null;
	elapsed: number | null;
	ahead_of_pace: boolean;
}
export interface Home {
	month: string;
	month_name: string;
	prev_month: string;
	next_month: string;
	is_current: boolean;
	status: MonthStatus;
	recent: Txn[];
	upcoming: { date: string; rule: Rule }[];
}

export interface History {
	days: { date: string; rows: Txn[] }[];
	page: number;
	pages: number;
	count: number;
	spent: number;
	received: number;
	filters: { q: string; month: string; category: string; type: '' | TxnType };
	filtered: boolean;
	categories: Category[];
	months: string[];
	today: string;
}

export type Tone = 'none' | 'over' | 'near' | 'under';
export interface Cell {
	month: string;
	budget: number;
	spent: number;
	partial: boolean;
	over: boolean;
	percent: number | null;
	tone: Tone;
}
export interface CategoryTrend {
	category: Category;
	cells: Cell[];
	budget_now: number;
	months_over: number;
	months_counted: number;
	avg_spent: number;
	avg_budget: number;
	total_over: number;
	avg_percent: number | null;
	avg_over: boolean;
	consistently_over: boolean;
}
export interface FundTrend {
	category: Category;
	balances: { month: string; balance: number }[];
	topup_now: number;
	avg_spent: number;
	balance_now: number;
	draining: boolean;
}
export interface Flow {
	month: string;
	income: number;
	out: number;
	net: number;
	partial: boolean;
}
export interface Trends {
	months: string[];
	current: string | null;
	categories: CategoryTrend[];
	totals: Cell[];
	funds: FundTrend[];
	flagged: CategoryTrend[];
	flows: Flow[];
	months_over: number;
	avg_spent: number;
	avg_budget: number;
	flows_counted: number;
	avg_income: number;
	avg_out: number;
	avg_net: number;
	span: number;
	end: string;
	prev_end: string;
	next_end: string | null;
}

export type CategoryHistory =
	| { kind: 'income'; months: string[]; received: number[] }
	| { kind: 'fund'; months: string[]; balances: number[]; topups: number[]; spent: number[] }
	| { kind: 'budget'; months: string[]; trend: CategoryTrend };

export interface MonthlyAmount {
	id: number;
	category_id: number;
	start_month: string;
	amount: number;
}
export interface CategoryDetail {
	category: Category;
	history: CategoryHistory;
	recent: Txn[];
	balance: number | null;
	received_now: number | null;
	amount_now: number;
	amounts: MonthlyAmount[];
	this_month: string;
}

export interface CategoryList {
	month: string;
	categories: (Category & { amount: number; balance: number | null })[];
	recurring_count: number;
	mcp_url: string;
}
export interface Budgets {
	from_month: string;
	rows: { category: Category; amount: number }[];
	month_choices: string[];
}
export interface RecurringList {
	rules: Rule[];
	monthly_out: number;
	monthly_in: number;
}
export interface EntryData {
	cats: Category[];
	/** Past titles: text, category id, type. */
	titles: { t: string; c: number; y: TxnType }[];
	today: string;
}
/** What a write returns. */
export interface Saved {
	ok: true;
	toast: string;
	spend?: Txn;
	undo?: number | null;
}
