/**
 * Budget and fund maths, analysis, and recurring generation.
 *
 * `Book` loads every monthly amount and every (category, month) total once, so pages that look
 * across many months and categories cost three queries.
 *
 * Budgets and funds answer different questions (did spending stay under budget; what is saved),
 * so they are kept apart everywhere: Home's ring and "left" are budgets only.
 */
import { and, asc, count, desc, eq, gte, inArray, lte, max, sql } from "drizzle-orm";
import type { Db } from "warren/server";
import { roundHalfEven } from "./money.js";
import { addDays, addMonths, addMonthsToDay, daysInMonth, monthOf, monthRange } from "./months.js";
import { categories, type Category, monthly_amounts, recurring, type Recurring, transactions, type Type } from "./schema.js";

/** Net spend of a transaction row: the amount for an expense, minus it for income. */
const net = sql<number>`sum(case when ${transactions.type} = 'income' then -${transactions.amount} else ${transactions.amount} end)`;

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
const average = (values: number[]) => (values.length ? roundHalfEven(sum(values) / values.length) : 0);
const percentOf = (spent: number, budget: number) => roundHalfEven((spent / budget) * 100);

export class Book {
  readonly categories: Category[];
  private starts = new Map<number, string[]>();
  private amounts = new Map<number, number[]>();
  private spentAt = new Map<string, number>();
  private spentByCategory = new Map<number, [string, number][]>();

  constructor(db: Db) {
    this.categories = db.select().from(categories).orderBy(asc(categories.kind), asc(categories.position), asc(categories.name)).all();
    for (const row of db.select().from(monthly_amounts).orderBy(asc(monthly_amounts.category_id), asc(monthly_amounts.start_month)).all()) {
      this.starts.set(row.category_id, [...(this.starts.get(row.category_id) ?? []), row.start_month]);
      this.amounts.set(row.category_id, [...(this.amounts.get(row.category_id) ?? []), row.amount]);
    }
    // Net spend per (category, month). For an income category it is negative: `received` flips the sign.
    const rows = db
      .select({ category_id: transactions.category_id, month: transactions.month, total: net })
      .from(transactions)
      .groupBy(transactions.category_id, transactions.month)
      .orderBy(asc(transactions.month))
      .all();
    for (const row of rows) {
      this.spentAt.set(`${row.category_id}:${row.month}`, row.total);
      this.spentByCategory.set(row.category_id, [...(this.spentByCategory.get(row.category_id) ?? []), [row.month, row.total]]);
    }
  }

  /** The budget (or fund top-up) for a month: the latest amount starting on or before it, 0 before the first. */
  amount(categoryId: number, month: string): number {
    const starts = this.starts.get(categoryId);
    if (!starts) return 0;
    let i = -1;
    while (i + 1 < starts.length && starts[i + 1]! <= month) i += 1;
    return i >= 0 ? this.amounts.get(categoryId)![i]! : 0;
  }

  spent(categoryId: number, month: string): number {
    return this.spentAt.get(`${categoryId}:${month}`) ?? 0;
  }

  received(categoryId: number, month: string): number {
    return -this.spent(categoryId, month) || 0;
  }

  firstMonth(categoryId: number): string | null {
    return this.starts.get(categoryId)?.[0] ?? null;
  }

  /** Earliest month with any amount or transaction, or null for an empty ledger. */
  firstData(): string | null {
    const months = [...[...this.starts.values()].map((s) => s[0]!), ...[...this.spentAt.keys()].map((k) => k.slice(k.indexOf(":") + 1))];
    return months.length ? months.reduce((a, b) => (a < b ? a : b)) : null;
  }

  topupsThrough(categoryId: number, month: string): number {
    const first = this.firstMonth(categoryId);
    if (first === null || first > month) return 0;
    return sum(monthRange(first, month).map((m) => this.amount(categoryId, m)));
  }

  spentThrough(categoryId: number, month: string): number {
    return sum((this.spentByCategory.get(categoryId) ?? []).filter(([m]) => m <= month).map(([, t]) => t));
  }

  /** A fund's balance at the end of `month` (top-ups land on the 1st). Computed, never stored. */
  fundBalance(category: Category, month: string): number {
    return category.opening_balance + this.topupsThrough(category.id, month) - this.spentThrough(category.id, month);
  }

  hasActivity(categoryId: number, months: string[]): boolean {
    return months.some((m) => this.spentAt.has(`${categoryId}:${m}`));
  }
}

// --- one month ------------------------------------------------------------------------------------

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
  /** 0-15 acorns for the Stash art: share of the target, or of a year of top-ups. */
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
  /** Everything spent: budgets and funds, net of money back. */
  out: number;
  net: number;
  /** 0-26 leaves for the wreath. */
  leaves: number;
  /** Current month only. */
  days_left: number | null;
  /** Share of the month gone, current month only. */
  elapsed: number | null;
  /** Spent more than the share of the month gone by (current month only). */
  ahead_of_pace: boolean;
}

function budgetPercent(budget: number, spent: number): number {
  if (budget <= 0) return spent > 0 ? 100 : 0;
  return percentOf(spent, budget);
}

function acorns(category: Category, topup: number, balance: number): number {
  const cap = category.target || topup * 12;
  if (cap <= 0 || balance <= 0) return 0;
  return Math.max(1, Math.min(15, roundHalfEven((balance / cap) * 15)));
}

export function monthStatus(db: Db, month: string, today: string, book = new Book(db)): MonthStatus {
  const budgets: BudgetLine[] = [];
  const funds: FundLine[] = [];
  const incomes: IncomeLine[] = [];
  for (const category of book.categories) {
    const spent = book.spent(category.id, month);
    if (category.archived && !spent) continue;
    if (category.kind === "income") {
      incomes.push({ category, received: -spent || 0 });
    } else if (category.kind === "fund") {
      const topup = book.amount(category.id, month);
      const balance = book.fundBalance(category, month);
      funds.push({ category, topup, spent, balance, acorns: acorns(category, topup, balance) });
    } else {
      const budget = book.amount(category.id, month);
      budgets.push({ category, budget, spent, left: budget - spent, over: spent > budget, percent: budgetPercent(budget, spent) });
    }
  }
  const total_budget = sum(budgets.map((b) => b.budget));
  const total_spent = sum(budgets.map((b) => b.spent));
  const fund_spent = sum(funds.map((f) => f.spent));
  const income = sum(incomes.map((i) => i.received));
  const current = month === monthOf(today);
  const days = daysInMonth(month);
  const dayOfMonth = Number(today.slice(8, 10));
  const elapsed = current ? dayOfMonth / days : null;
  return {
    month,
    budgets,
    funds,
    incomes,
    total_budget,
    total_spent,
    left: total_budget - total_spent,
    over: total_spent > total_budget,
    percent: budgetPercent(total_budget, total_spent),
    fund_spent,
    income,
    out: total_spent + fund_spent,
    net: income - (total_spent + fund_spent),
    leaves: total_budget <= 0 ? 0 : Math.min(26, roundHalfEven((total_spent / total_budget) * 26)),
    days_left: current ? days - dayOfMonth : null,
    elapsed,
    ahead_of_pace: elapsed !== null && total_budget > 0 && total_spent > total_budget * elapsed,
  };
}

// --- analysis -------------------------------------------------------------------------------------

export type Tone = "none" | "over" | "near" | "under";

export interface Cell {
  month: string;
  budget: number;
  spent: number;
  /** The month is still running; left out of every count and average. */
  partial: boolean;
  over: boolean;
  percent: number | null;
  tone: Tone;
}

function cell(month: string, budget: number, spent: number, partial: boolean): Cell {
  const over = spent > budget;
  let tone: Tone = "under";
  if (spent <= 0 && budget <= 0) tone = "none";
  else if (over) tone = "over";
  else if (budget > 0 && spent >= budget * 0.9) tone = "near";
  return { month, budget, spent, partial, over, percent: budget <= 0 ? null : percentOf(spent, budget), tone };
}

/** Finished months in which there was a budget or spending. */
const complete = (cells: Cell[]) => cells.filter((c) => !c.partial && (c.budget > 0 || c.spent !== 0));

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
  /** Over in at least half of the complete months (and at least twice). */
  consistently_over: boolean;
}

function categoryTrend(category: Category, cells: Cell[], budget_now: number): CategoryTrend {
  const done = complete(cells);
  const months_over = done.filter((c) => c.over).length;
  const avg_spent = average(done.map((c) => c.spent));
  const avg_budget = average(done.map((c) => c.budget));
  return {
    category,
    cells,
    budget_now,
    months_over,
    months_counted: done.length,
    avg_spent,
    avg_budget,
    total_over: sum(done.filter((c) => c.over).map((c) => c.spent - c.budget)),
    avg_percent: avg_budget <= 0 ? null : percentOf(avg_spent, avg_budget),
    avg_over: avg_spent > avg_budget,
    consistently_over: done.length > 0 && months_over >= Math.max(2, Math.floor((done.length + 1) / 2)),
  };
}

export interface FundTrend {
  category: Category;
  balances: { month: string; balance: number }[];
  topup_now: number;
  avg_spent: number;
  balance_now: number;
  /** Spending more on average than the top-up puts in. */
  draining: boolean;
}

/** Money in and out in one month. `out` is budgets and funds, net of money back. */
export interface Flow {
  month: string;
  income: number;
  out: number;
  net: number;
  partial: boolean;
}

export interface Analysis {
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
}

export function analysis(db: Db, endMonth: string, months: number, today: string): Analysis {
  const book = new Book(db);
  const current = monthOf(today);
  let span = monthRange(addMonths(endMonth, -(months - 1)), endMonth);
  // Don't open the range on months from before the ledger has anything in them.
  const firstData = book.firstData();
  if (firstData && firstData > span[0]!) {
    const kept = span.filter((m) => m >= firstData);
    span = kept.length ? kept : span.slice(-1);
  }

  const trends: CategoryTrend[] = [];
  for (const category of book.categories) {
    if (category.kind !== "budget") continue;
    if (category.archived && !book.hasActivity(category.id, span)) continue;
    const cells = span.map((m) => cell(m, book.amount(category.id, m), book.spent(category.id, m), m >= current));
    if (!cells.some((c) => c.budget || c.spent)) continue;
    trends.push(categoryTrend(category, cells, book.amount(category.id, current)));
  }
  const totals = span.map((m, i) =>
    cell(m, sum(trends.map((t) => t.cells[i]!.budget)), sum(trends.map((t) => t.cells[i]!.spent)), m >= current),
  );

  const finished = span.filter((m) => m < current);
  const funds: FundTrend[] = [];
  for (const category of book.categories) {
    if (category.kind !== "fund" || (category.archived && !book.hasActivity(category.id, span))) continue;
    const balances = span.map((month) => ({ month, balance: book.fundBalance(category, month) }));
    const topup_now = book.amount(category.id, current);
    const avg_spent = average(finished.map((m) => book.spent(category.id, m)));
    funds.push({
      category,
      balances,
      topup_now,
      avg_spent,
      balance_now: balances.at(-1)?.balance ?? category.opening_balance,
      draining: avg_spent > topup_now,
    });
  }

  trends.sort(
    (a, b) => b.months_over - a.months_over || (b.avg_percent ?? 0) - (a.avg_percent ?? 0) || a.category.name.localeCompare(b.category.name),
  );
  const flows = span.map((month) => {
    const income = sum(book.categories.filter((c) => c.kind === "income").map((c) => book.received(c.id, month)));
    const out = sum(book.categories.filter((c) => c.kind !== "income").map((c) => book.spent(c.id, month)));
    return { month, income, out, net: income - out, partial: month >= current };
  });
  const doneTotals = complete(totals);
  const doneFlows = flows.filter((f) => !f.partial && (f.income || f.out));
  return {
    months: span,
    current: span.includes(current) ? current : null,
    categories: trends,
    totals,
    funds,
    flagged: trends.filter((t) => t.consistently_over),
    flows,
    months_over: doneTotals.filter((c) => c.over).length,
    avg_spent: average(doneTotals.map((c) => c.spent)),
    avg_budget: average(doneTotals.map((c) => c.budget)),
    flows_counted: doneFlows.length,
    avg_income: average(doneFlows.map((f) => f.income)),
    avg_out: average(doneFlows.map((f) => f.out)),
    avg_net: average(doneFlows.map((f) => f.net)),
  };
}

export type CategoryHistory =
  | { kind: "income"; months: string[]; received: number[] }
  | { kind: "fund"; months: string[]; balances: number[]; topups: number[]; spent: number[] }
  | { kind: "budget"; months: string[]; trend: CategoryTrend };

/** Per-month budget and spending (budgets), balance (funds) or money received (income) for one category. */
export function categoryHistory(db: Db, category: Category, endMonth: string, months: number, today: string): CategoryHistory {
  const book = new Book(db);
  const current = monthOf(today);
  const span = monthRange(addMonths(endMonth, -(months - 1)), endMonth);
  if (category.kind === "income") {
    return { kind: "income", months: span, received: span.map((m) => book.received(category.id, m)) };
  }
  if (category.kind === "fund") {
    return {
      kind: "fund",
      months: span,
      balances: span.map((m) => book.fundBalance(category, m)),
      topups: span.map((m) => book.amount(category.id, m)),
      spent: span.map((m) => book.spent(category.id, m)),
    };
  }
  const cells = span.map((m) => cell(m, book.amount(category.id, m), book.spent(category.id, m), m >= current));
  return { kind: "budget", months: span, trend: categoryTrend(category, cells, book.amount(category.id, current)) };
}

// --- entry helpers --------------------------------------------------------------------------------

/** Active categories, most used in the last `days` first, then budgets before the rest, then by name. */
export function categoriesForEntry(db: Db, today: string, days = 90): Category[] {
  const counts = new Map(
    db
      .select({ id: transactions.category_id, n: count() })
      .from(transactions)
      .where(gte(transactions.date, addDays(today, -days)))
      .groupBy(transactions.category_id)
      .all()
      .map((r) => [r.id, r.n]),
  );
  const rank = (c: Category) => [-(counts.get(c.id) ?? 0), c.kind === "budget" ? 0 : 1] as const;
  return db
    .select()
    .from(categories)
    .where(eq(categories.archived, false))
    .all()
    .sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1] || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Recent distinct titles with the category and type last used for each, newest first. */
export function titleSuggestions(db: Db, limit = 300): { t: string; c: number; y: Type }[] {
  const latest = db
    .select({ id: max(transactions.id) })
    .from(transactions)
    .groupBy(transactions.title)
    .orderBy(desc(max(transactions.id)))
    .limit(limit)
    .all()
    .map((r) => r.id!);
  if (!latest.length) return [];
  const rows = db
    .select({ id: transactions.id, t: transactions.title, c: transactions.category_id, y: transactions.type })
    .from(transactions)
    .where(inArray(transactions.id, latest))
    .orderBy(desc(transactions.id))
    .all();
  return rows.map(({ t, c, y }) => ({ t, c, y }));
}

// --- recurring ------------------------------------------------------------------------------------

type Schedule = Pick<Recurring, "every" | "unit" | "start_date" | "end_date" | "last_generated" | "month_offset">;

/**
 * The n-th date of the schedule (0 = start). Computed from the start each time, so the 31st stays
 * the 31st (or the month's last day) and never drifts.
 */
export function occurrence(rule: Schedule, n: number): string {
  const k = n * rule.every;
  if (rule.unit === "week") return addDays(rule.start_date, 7 * k);
  return addMonthsToDay(rule.start_date, rule.unit === "year" ? 12 * k : k);
}

/** Schedule dates in (after, until], bounded by the rule's end date. */
export function datesBetween(rule: Schedule, after: string | null, until: string): string[] {
  const last = rule.end_date && rule.end_date < until ? rule.end_date : until;
  const out: string[] = [];
  for (let n = 0; ; n++) {
    const d = occurrence(rule, n);
    if (d > last) return out;
    if (after === null || d > after) out.push(d);
  }
}

/** The next date the rule will create an entry on, or null if it has ended. */
export function nextDate(rule: Schedule): string | null {
  const after = rule.last_generated ?? addDays(rule.start_date, -1);
  for (let n = 0; ; n++) {
    const d = occurrence(rule, n);
    if (rule.end_date && d > rule.end_date) return null;
    if (d > after) return d;
  }
}

export function monthFor(rule: Schedule, day: string): string {
  return addMonths(monthOf(day), rule.month_offset);
}

export function frequencyLabel(rule: Pick<Recurring, "every" | "unit">): string {
  if (rule.every === 1) return { week: "Weekly", month: "Monthly", year: "Yearly" }[rule.unit];
  return `Every ${rule.every} ${rule.unit}s`;
}

/** Create every recurring entry that has fallen due. Safe to call often: each date is made once. */
export function generateDue(db: Db, today: string): number {
  return db.transaction((tx) => {
    let created = 0;
    const rules = tx.select().from(recurring).where(and(eq(recurring.paused, false), lte(recurring.start_date, today))).all();
    for (const rule of rules) {
      const dates = datesBetween(rule, rule.last_generated ?? addDays(rule.start_date, -1), today);
      if (!dates.length) continue;
      tx.insert(transactions)
        .values(
          dates.map((date) => ({
            type: rule.type,
            amount: rule.amount,
            title: rule.title,
            category_id: rule.category_id,
            date,
            month: monthFor(rule, date),
            note: rule.note,
            recurring_id: rule.id,
            created_by: rule.created_by,
          })),
        )
        .run();
      tx.update(recurring).set({ last_generated: dates.at(-1)! }).where(eq(recurring.id, rule.id)).run();
      created += dates.length;
    }
    return created;
  });
}

/** Recurring entries due after today up to `until`, soonest first. */
export function upcoming(db: Db, until: string, today: string): { date: string; rule: Recurring }[] {
  const out: { date: string; rule: Recurring }[] = [];
  for (const rule of db.select().from(recurring).where(eq(recurring.paused, false)).all()) {
    const before = addDays(rule.start_date, -1);
    const floor = rule.last_generated ?? before;
    const after = today > floor ? today : floor;
    for (const date of datesBetween(rule, after, until)) out.push({ date, rule });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.rule.title.localeCompare(b.rule.title));
}
