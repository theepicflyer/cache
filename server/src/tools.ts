/**
 * Cache's tools for MCP clients (Claude on claude.ai): read the household ledger and log expenses
 * and income. They sit on the same services as the app, so agents see the same numbers.
 *
 * The ledger is shared, so there is no per-person filtering: anyone who can sign in can read and
 * write all of it, here as in the app. Mistakes in the input come back as an error the model can
 * act on. Amounts go out as strings with two decimals, in dollars. The read tools first create any
 * recurring entries that have fallen due, as the app's pages do; they are still marked read-only.
 */
import { and, count, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";
import { type Db, defineTool, DomainError, type Tool, type User } from "warren/server";
import { z } from "zod";
import * as ledger from "./ledger.js";
import { parseCents, plain } from "./money.js";
import { monthOf, requireDay, requireMonth, today as todayIn } from "./months.js";
import { type Category, recurring, transactions, type Transaction, type Type, TYPES } from "./schema.js";
import * as services from "./services.js";

export const INSTRUCTIONS =
  "Cache is a household money ledger, shared by everyone in the household. Each " +
  "transaction is an expense or income, always with a positive amount in dollars " +
  "($), and sits in one category. Budget categories have a monthly budget; fund " +
  "categories are sinking funds topped up on the 1st of each month and drawn down " +
  "by what is spent from them; income categories hold money coming in, such as " +
  "salary. Income in a budget or fund category is money back: a refund, or money " +
  "put into a fund. A transaction has a date (when it happened) and a month it " +
  "counts toward (normally the date's month). Call get_ledger_info first for " +
  "today's date and these conventions; look up category ids with list_categories " +
  "before add_transaction.";

const MAX_LIMIT = 500;
const MAX_ANALYSIS_MONTHS = 36;

// --- parsing --------------------------------------------------------------------------------------

function parseAmount(value: unknown): number {
  const cents = typeof value === "string" || typeof value === "number" ? parseCents(typeof value === "string" ? value.trim() : value) : null;
  if (cents === null || (typeof value === "string" && /[,$\s]/.test(value.trim()))) {
    if (typeof value === "number" && value <= 0) {
      throw new DomainError('amount must be more than 0. Amounts are always positive: for money back or income, pass the positive amount with type "income".');
    }
    throw new DomainError(`amount must be a plain positive number with at most 2 decimal places, like 12.50; got ${JSON.stringify(value)}.`);
  }
  if (cents <= 0) {
    throw new DomainError('amount must be more than 0. Amounts are always positive: for money back or income, pass the positive amount with type "income".');
  }
  return cents;
}

function parseType(value: string): Type {
  const text = value.trim().toLowerCase();
  if ((TYPES as readonly string[]).includes(text)) return text as Type;
  throw new DomainError(`type must be one of "expense", "income"; got ${JSON.stringify(value)}.`);
}

function cleanTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new DomainError("title must not be empty.");
  if (title.length > 200) throw new DomainError("title must be at most 200 characters; put the rest in note.");
  return title;
}

function findCategory(db: Db, id: number, forEntry = false): Category {
  let category: Category;
  try {
    category = ledger.getCategory(db, id);
  } catch {
    throw new DomainError(`There is no category with id ${id}. Call list_categories for the ids.`);
  }
  if (forEntry && category.archived) {
    throw new DomainError(
      `Category ${JSON.stringify(category.name)} (id ${category.id}) is archived and takes no new transactions. Pick an active category from list_categories.`,
    );
  }
  return category;
}

/** An income category takes only income (as in the app's entry form). */
function checkTypeFits(category: Category, type: Type): void {
  if (category.kind === "income" && type === "expense") {
    throw new DomainError(`${category.name} is for income. Pick another category, or use type "income" to record money received.`);
  }
}

function findTransaction(db: Db, id: number): Transaction {
  try {
    return ledger.getTransaction(db, id);
  } catch {
    throw new DomainError(`There is no transaction with id ${id}. Use list_transactions to find it.`);
  }
}

// --- output ---------------------------------------------------------------------------------------

const person = (user: User | undefined | null) => (user ? { email: user.email, name: user.name } : null);
const target = (category: Category) => (category.target === null ? null : plain(category.target));

function transactionOut(db: Db, tx: Transaction, people: Map<number, User>) {
  const category = ledger.getCategory(db, tx.category_id);
  return {
    id: tx.id,
    date: tx.date,
    month: tx.month,
    title: tx.title,
    type: tx.type,
    amount: plain(tx.amount),
    category: { id: category.id, name: category.name, kind: category.kind },
    note: tx.note,
    recurring_id: tx.recurring_id,
    created_by: tx.created_by === null ? null : person(people.get(tx.created_by)),
  };
}

/**
 * Where a category stands for a month: a budget's budget/spent/left, a fund's top-up/spent/
 * month-end balance, or what an income category received.
 */
function categoryMonth(db: Db, category: Category, month: string) {
  const book = new services.Book(db);
  const spent = book.spent(category.id, month);
  const base = { category_id: category.id, name: category.name, kind: category.kind, month };
  if (category.kind === "income") return { ...base, received: plain(book.received(category.id, month)) };
  if (category.kind === "fund") {
    return { ...base, topup: plain(book.amount(category.id, month)), spent: plain(spent), balance: plain(book.fundBalance(category, month)) };
  }
  const budget = book.amount(category.id, month);
  return { ...base, budget: plain(budget), spent: plain(spent), left: plain(budget - spent), over: spent > budget };
}

const cellOut = (c: services.Cell) => ({ month: c.month, budget: plain(c.budget), spent: plain(c.spent), over: c.over, partial: c.partial });
const flowOut = (income: number, out: number) => ({ income: plain(income), out: plain(out), net: plain(income - out) });

// --- tools ----------------------------------------------------------------------------------------

export function cacheTools(timezone: string, users: (db: Db) => Map<number, User>): Tool[] {
  /** Create any recurring entries that have fallen due; return today. */
  const start = (db: Db, now: Date): string => {
    const today = todayIn(timezone, now);
    services.generateDue(db, today);
    return today;
  };

  return [
    defineTool({
      name: "get_ledger_info",
      description:
        "Start here. Returns the currency symbol ($), today's date and the current month (in the household's " +
        "timezone), who you are signed in as, whether this connection may change the ledger (can_write), and how " +
        "the ledger's fields work. Call it before the other tools.",
      input: z.strictObject({}),
      writes: false,
      expose: ["mcp"],
      run(ctx) {
        const today = todayIn(timezone, ctx.now);
        return {
          currency: "$",
          today,
          current_month: monthOf(today),
          signed_in_as: person(ctx.user),
          can_write: true,
          conventions: {
            shared: "One ledger shared by the whole household; everyone sees and edits everything.",
            amount: "Strings with 2 decimal places, in dollars ($). Always positive; a transaction's type says which way the money went.",
            type: {
              expense: "Money spent.",
              income:
                "Money received. In an income category it is income (salary and the like); in a budget or fund category it is money back: a refund, or money put into a fund.",
            },
            spent: "A budget's or fund's spent is net: its expenses minus its money back, so it can be negative.",
            flow: "Money in and out of the household: income is what the income categories received; out is what budgets and funds spent, net of money back; net is income minus out.",
            date: "YYYY-MM-DD: the day the transaction happened or was billed.",
            month:
              "YYYY-MM: the month a transaction counts toward. It is the date's month unless set otherwise (May's bill paid on 10 June can count toward May). Budgets and summaries use this month, not the date.",
            category_kinds: {
              budget: "Everyday spending with a monthly budget; spending is compared to it.",
              fund: "A sinking fund: topped up by a monthly amount on the 1st, lowered by what is spent from it. Its balance carries over from month to month.",
              income: "Money coming in, such as salary. Takes income only; no budget, just what it received each month.",
            },
            monthly_amount:
              "A budget category's budget (or a fund's top-up) for a month. Changes apply from a given month on; earlier months keep the amount they had. Income categories have none.",
            recurring: "Recurring rules create their transaction on each scheduled date once it arrives; nothing is created ahead of time.",
          },
        };
      },
    }),

    defineTool({
      name: "list_categories",
      description:
        "List the categories. Every transaction belongs to exactly one category, so use this to find the " +
        'category_id for add_transaction.\n\nEach category has kind "budget" (everyday spending with a monthly ' +
        'budget), "fund" (a sinking fund, topped up by a fixed amount on the 1st of each month; spending from it ' +
        'lowers its balance) or "income" (money coming in, such as salary). monthly_amount is this month\'s ' +
        "budget, or this month's top-up for a fund; it is null for an income category. Funds also return balance " +
        "(the balance at the end of the current month: this month's top-up is in, and everything spent from it so " +
        "far is out, net of money put in) and target (what it is saving up to, or null).",
      input: z.strictObject({
        include_archived: z.boolean().default(false).describe("Also return archived categories, which no longer take new transactions."),
      }),
      writes: false,
      expose: ["mcp"],
      run(ctx, args) {
        const current = monthOf(start(ctx.db, ctx.now));
        const book = new services.Book(ctx.db);
        return {
          month: current,
          categories: book.categories
            .filter((c) => args.include_archived || !c.archived)
            .map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
              archived: c.archived,
              monthly_amount: c.kind === "income" ? null : plain(book.amount(c.id, current)),
              ...(c.kind === "fund" ? { balance: plain(book.fundBalance(c, current)), target: target(c) } : {}),
            })),
        };
      },
    }),

    defineTool({
      name: "list_transactions",
      description:
        "Search and list transactions, newest date first. Filters combine; leave them all out to list everything.\n\n" +
        "Returns total (how many transactions match), total_expenses and total_income (the sums of every matching " +
        "expense and income, not just this page; for a budget or fund category, net spending is total_expenses " +
        "minus total_income), has_more, and the page of transactions. Each has id, date (when it happened), month " +
        '(the month it counts toward), title, type ("expense" or "income"; income in a budget or fund category is ' +
        "money back), amount (always positive), category, note, recurring_id (the recurring rule that created it, " +
        "or null) and created_by.",
      input: z.strictObject({
        month: z.string().optional().describe('"YYYY-MM"; only transactions that count toward this month. Use this (not dates) to see what a month\'s budgets were spent on.'),
        date_from: z.string().optional().describe('"YYYY-MM-DD"; only transactions dated on or after this day.'),
        date_to: z.string().optional().describe('"YYYY-MM-DD"; only transactions dated on or before this day.'),
        category_id: z.number().int().optional().describe("Only this category (ids from list_categories)."),
        type: z.string().optional().describe('"expense" or "income"; only transactions of this type.'),
        search: z.string().optional().describe("Case-insensitive text to find in the title or note."),
        limit: z.number().int().default(100).describe("Page size, default 100, at most 500."),
        offset: z.number().int().default(0).describe("How many matching transactions to skip, for paging."),
      }),
      writes: false,
      expose: ["mcp"],
      run(ctx, args) {
        const { db } = ctx;
        start(db, ctx.now);
        const where: (SQL | undefined)[] = [];
        if (args.type !== undefined) where.push(eq(transactions.type, parseType(args.type)));
        if (args.month) where.push(eq(transactions.month, requireMonth(args.month)));
        const from = args.date_from ? requireDay(args.date_from, "date_from") : null;
        const to = args.date_to ? requireDay(args.date_to, "date_to") : null;
        if (from && to && from > to) throw new DomainError("date_from is after date_to.");
        if (from) where.push(gte(transactions.date, from));
        if (to) where.push(lte(transactions.date, to));
        if (args.category_id !== undefined) where.push(eq(transactions.category_id, findCategory(db, args.category_id).id));
        if (args.search?.trim()) {
          const pattern = `%${args.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
          where.push(or(sql`${transactions.title} like ${pattern} escape '\\'`, sql`${transactions.note} like ${pattern} escape '\\'`));
        }
        if (args.offset < 0) throw new DomainError("offset must be 0 or more.");
        const limit = Math.max(1, Math.min(args.limit, MAX_LIMIT));
        const filter = and(...where);
        const total = db.select({ n: count() }).from(transactions).where(filter).get()!.n;
        const people = users(db);
        const page = db
          .select()
          .from(transactions)
          .where(filter)
          .orderBy(desc(transactions.date), desc(transactions.created_at), desc(transactions.id))
          .limit(limit)
          .offset(args.offset)
          .all()
          .map((tx) => transactionOut(db, tx, people));
        const sums = new Map(
          db.select({ type: transactions.type, total: sql<number>`sum(${transactions.amount})` }).from(transactions).where(filter).groupBy(transactions.type).all().map((r) => [r.type, r.total]),
        );
        return {
          total,
          total_expenses: plain(sums.get("expense") ?? 0),
          total_income: plain(sums.get("income") ?? 0),
          limit,
          offset: args.offset,
          has_more: args.offset + page.length < total,
          transactions: page,
        };
      },
    }),

    defineTool({
      name: "get_month_summary",
      description:
        "How the household is doing against its budgets in one month, and what came in and went out.\n\n" +
        "Returns budgets: for each budget category, budget, spent (net of money back), left (budget minus spent; " +
        "negative when over), over and percent_used; budget_totals across all budget categories; funds: for each " +
        "fund, topup (this month's top-up), spent (spent from it this month, net of money put in) and balance (its " +
        "balance at the end of the month); incomes: for each income category, received; and flow: income (received " +
        "by all income categories), out (spent from budgets and funds, net of money back) and net (income minus " +
        "out). Everything counts by the month a transaction counts toward, not its date. Fund spending is not part " +
        "of budget_totals. Archived categories only appear when they have transactions that month. For the current " +
        "month it also returns days_left, elapsed (share of the month gone, 0-1) and, in budget_totals, " +
        "ahead_of_pace (a larger share of the total budget is spent than the share of the month that has passed).",
      input: z.strictObject({ month: z.string().optional().describe('"YYYY-MM"; defaults to the current month.') }),
      writes: false,
      expose: ["mcp"],
      run(ctx, args) {
        const today = start(ctx.db, ctx.now);
        const month = args.month ? requireMonth(args.month) : monthOf(today);
        const status = services.monthStatus(ctx.db, month, today);
        const current = status.days_left !== null;
        return {
          month,
          is_current_month: month === monthOf(today),
          budgets: status.budgets.map((line) => ({
            category_id: line.category.id,
            name: line.category.name,
            budget: plain(line.budget),
            spent: plain(line.spent),
            left: plain(line.left),
            over: line.over,
            percent_used: line.percent,
          })),
          budget_totals: {
            budget: plain(status.total_budget),
            spent: plain(status.total_spent),
            left: plain(status.left),
            over: status.over,
            percent_used: status.percent,
            ...(current ? { ahead_of_pace: status.ahead_of_pace } : {}),
          },
          funds: status.funds.map((line) => ({
            category_id: line.category.id,
            name: line.category.name,
            topup: plain(line.topup),
            spent: plain(line.spent),
            balance: plain(line.balance),
            target: target(line.category),
          })),
          fund_spent_total: plain(status.fund_spent),
          incomes: status.incomes.map((line) => ({ category_id: line.category.id, name: line.category.name, received: plain(line.received) })),
          flow: flowOut(status.income, status.out),
          ...(current ? { days_left: status.days_left, elapsed: Math.round(status.elapsed! * 100) / 100 } : {}),
        };
      },
    }),

    defineTool({
      name: "get_budget_analysis",
      description:
        "Spending against budget over several months, to spot budget categories that keep running over and funds " +
        "that are draining, and money in and out per month.\n\nMonths that are still running (the current month, " +
        "and any later one) are marked partial: true and left out of every count and average below.\n\nReturns " +
        "months (the window); categories: for each budget category its per-month budget/spent/over, then over the " +
        "complete months months_over, months_counted, avg_spent, avg_budget, avg_percent, total_over and " +
        "consistently_over (over budget in at least half of the complete months, and at least twice), sorted " +
        "most-over first; totals: the same per month summed over all budget categories, with months_over, " +
        "avg_spent and avg_budget; funds: each fund's month-end balance per month, topup_now, avg_spent (average " +
        "monthly spending over the complete months) and draining (spending more on average than the top-up puts " +
        "in); flagged: the consistently-over categories; and flows: per month income (received by income " +
        "categories), out (spent from budgets and funds, net of money back), net (income minus out) and partial, " +
        "with avg_income, avg_out and avg_net over the complete months that had any (months_counted). Spent is " +
        "always net of money back. Income categories are only in flows.",
      input: z.strictObject({
        end_month: z.string().optional().describe('"YYYY-MM", the last month of the window; defaults to the current month.'),
        months: z.number().int().default(12).describe("How many months the window covers, ending at end_month (1-36, default 12)."),
      }),
      writes: false,
      expose: ["mcp"],
      run(ctx, args) {
        const today = start(ctx.db, ctx.now);
        const end = args.end_month ? requireMonth(args.end_month, "end_month") : monthOf(today);
        if (args.months < 1 || args.months > MAX_ANALYSIS_MONTHS) throw new DomainError(`months must be between 1 and ${MAX_ANALYSIS_MONTHS}.`);
        const a = services.analysis(ctx.db, end, args.months, today);
        return {
          months: a.months,
          current_month: a.current,
          categories: a.categories.map((t) => ({
            category_id: t.category.id,
            name: t.category.name,
            budget_now: plain(t.budget_now),
            months_over: t.months_over,
            months_counted: t.months_counted,
            avg_spent: plain(t.avg_spent),
            avg_budget: plain(t.avg_budget),
            avg_percent: t.avg_percent,
            total_over: plain(t.total_over),
            consistently_over: t.consistently_over,
            by_month: t.cells.map(cellOut),
          })),
          totals: { months_over: a.months_over, avg_spent: plain(a.avg_spent), avg_budget: plain(a.avg_budget), by_month: a.totals.map(cellOut) },
          funds: a.funds.map((f) => ({
            category_id: f.category.id,
            name: f.category.name,
            topup_now: plain(f.topup_now),
            avg_spent: plain(f.avg_spent),
            draining: f.draining,
            balance_at_end: plain(f.balance_now),
            target: target(f.category),
            balances: f.balances.map((b) => ({ month: b.month, balance: plain(b.balance) })),
          })),
          flagged: a.flagged.map((t) => ({ category_id: t.category.id, name: t.category.name })),
          flows: {
            months_counted: a.flows_counted,
            avg_income: plain(a.avg_income),
            avg_out: plain(a.avg_out),
            avg_net: plain(a.avg_net),
            by_month: a.flows.map((f) => ({ month: f.month, ...flowOut(f.income, f.out), partial: f.partial })),
          },
        };
      },
    }),

    defineTool({
      name: "list_recurring",
      description:
        "List the recurring rules (subscriptions, bills, allowances, salary). A rule creates its transaction on " +
        "each date of its schedule once that date arrives; nothing is created ahead of time.\n\nEach rule has its " +
        'title, type ("expense" or "income", as in add_transaction), amount, category and note; its schedule ' +
        "(every N week/month/year from start_date, until end_date if set); next_date (when it will create its " +
        'next transaction; null once the schedule has ended); counts_toward ("same month", or "previous month" ' +
        "for a bill that arrives after the month it belongs to) with next_counts_toward (the month next_date's " +
        "entry will count toward); and paused (a paused rule creates nothing until it is resumed in the app). " +
        "Rules cannot be edited through these tools.",
      input: z.strictObject({}),
      writes: false,
      expose: ["mcp"],
      run(ctx) {
        start(ctx.db, ctx.now);
        return {
          recurring: ctx.db.select().from(recurring).orderBy(recurring.title).all().map((rule) => {
            const next = services.nextDate(rule);
            const category = ledger.getCategory(ctx.db, rule.category_id);
            return {
              id: rule.id,
              title: rule.title,
              type: rule.type,
              amount: plain(rule.amount),
              category: { id: category.id, name: category.name, kind: category.kind },
              note: rule.note,
              every: rule.every,
              unit: rule.unit,
              frequency: services.frequencyLabel(rule),
              start_date: rule.start_date,
              end_date: rule.end_date,
              next_date: next,
              next_counts_toward: next ? services.monthFor(rule, next) : null,
              counts_toward: rule.month_offset === -1 ? "previous month" : "same month",
              month_offset: rule.month_offset,
              paused: rule.paused,
              last_created: rule.last_generated,
            };
          }),
        };
      },
    }),

    defineTool({
      name: "add_transaction",
      description:
        "Log an expense or income in the ledger.\n\nReturns the new transaction, and category_month: where its " +
        "category stands for that month afterwards (budget, spent and left for a budget category; top-up, spent " +
        "and balance for a fund; received for an income category). Spent is net of money back.",
      input: z.strictObject({
        amount: z.union([z.number(), z.string()]).describe('How much, in dollars; always more than 0. A plain number with at most 2 decimal places, e.g. 12.5 or "12.50"; no currency symbol, sign or thousands separators.'),
        title: z.string().describe('A short description, e.g. "Weekly groceries".'),
        category_id: z.number().int().describe("The category's id from list_categories. Archived categories take no new transactions."),
        type: z.string().optional().describe('"expense" (money spent) or "income" (money received). Leave it out to follow the category: "income" for an income category (salary and the like), "expense" otherwise. An income category takes no expenses. Pass "income" in a budget or fund category for money back: a refund, or money put into a fund.'),
        date: z.string().optional().describe('"YYYY-MM-DD", when it happened; defaults to today.'),
        month: z.string().optional().describe('"YYYY-MM", the month it counts toward; defaults to the date\'s month. Only set it when the transaction belongs to another month, e.g. May\'s bill paid on 10 June.'),
        note: z.string().default("").describe("An optional longer note."),
      }),
      writes: true,
      expose: ["mcp"],
      run(ctx, args) {
        const { db } = ctx;
        const today = start(db, ctx.now);
        const amount = parseAmount(args.amount);
        const title = cleanTitle(args.title);
        const category = findCategory(db, args.category_id, true);
        const type = args.type !== undefined ? parseType(args.type) : category.kind === "income" ? "income" : "expense";
        checkTypeFits(category, type);
        const date = args.date ? requireDay(args.date) : today;
        const month = args.month ? requireMonth(args.month) : monthOf(date);
        const tx = ledger.addTransaction(db, ctx.user, { type, amount, title, category_id: category.id, date, month, note: args.note }, today);
        return { transaction: transactionOut(db, tx, users(db)), category_month: categoryMonth(db, category, tx.month) };
      },
    }),

    defineTool({
      name: "update_transaction",
      description:
        "Change an existing transaction. Only the fields you pass change; leave the others out.\n\nIf you change " +
        "date without month, month follows the new date, unless the transaction counted toward a different month " +
        "than its date; then that month is kept. type stays as it is unless you pass it, and a change that would " +
        "leave an expense in an income category is refused. Returns the updated transaction, the fields that " +
        "changed, and category_month for its (new) category and month.",
      input: z.strictObject({
        id: z.number().int().describe("The transaction's id (from list_transactions)."),
        amount: z.union([z.number(), z.string()]).optional().describe("As in add_transaction."),
        title: z.string().optional(),
        category_id: z.number().int().optional(),
        type: z.string().optional(),
        date: z.string().optional(),
        month: z.string().optional(),
        note: z.string().optional().describe('The new note; pass "" to clear it.'),
      }),
      writes: true,
      expose: ["mcp"],
      run(ctx, args) {
        const { db } = ctx;
        start(db, ctx.now);
        const tx = findTransaction(db, args.id);
        const next = { type: tx.type, amount: tx.amount, title: tx.title, category_id: tx.category_id, date: tx.date, month: tx.month, note: tx.note };
        const changed: string[] = [];
        if (args.amount !== undefined) {
          next.amount = parseAmount(args.amount);
          changed.push("amount");
        }
        if (args.title !== undefined) {
          next.title = cleanTitle(args.title);
          changed.push("title");
        }
        if (args.category_id !== undefined && args.category_id !== tx.category_id) {
          next.category_id = findCategory(db, args.category_id, true).id;
          changed.push("category");
        }
        if (args.type !== undefined) {
          next.type = parseType(args.type);
          changed.push("type");
        }
        if (args.date !== undefined) {
          const date = requireDay(args.date);
          if (args.month === undefined && tx.month === monthOf(tx.date)) next.month = monthOf(date);
          next.date = date;
          changed.push("date");
        }
        if (args.month !== undefined) {
          next.month = requireMonth(args.month);
          changed.push("month");
        }
        if (args.note !== undefined) {
          next.note = args.note.trim();
          changed.push("note");
        }
        if (!changed.length) {
          throw new DomainError("Nothing to change: pass at least one of amount, title, category_id, type, date, month, note.");
        }
        const category = findCategory(db, next.category_id);
        if (changed.includes("type") || changed.includes("category")) checkTypeFits(category, next.type);
        const updated = ledger.updateTransaction(db, tx.id, next);
        return { transaction: transactionOut(db, updated, users(db)), changed, category_month: categoryMonth(db, category, updated.month) };
      },
    }),

    defineTool({
      name: "delete_transaction",
      description:
        "Delete a transaction permanently. If a recurring rule created it, the rule does not create it again.\n\n" +
        "Returns the deleted transaction and category_month: where its category stands for that month afterwards.",
      input: z.strictObject({ id: z.number().int().describe("The transaction's id (from list_transactions).") }),
      writes: true,
      expose: ["mcp"],
      run(ctx, args) {
        const { db } = ctx;
        start(db, ctx.now);
        const tx = findTransaction(db, args.id);
        const deleted = transactionOut(db, tx, users(db));
        ledger.deleteTransaction(db, tx.id);
        return { deleted, category_month: categoryMonth(db, ledger.getCategory(db, tx.category_id), tx.month) };
      },
    }),
  ];
}
