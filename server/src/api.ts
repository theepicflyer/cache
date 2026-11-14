/**
 * JSON API for the web app, under /api, for signed-in people. Amounts go out as whole cents and
 * come in as what the person typed ("12.50"), parsed here.
 */
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Hono } from "hono";
import { type AppContext, type AppEnv, type Db, DomainError, schema as warren } from "warren/server";
import { z } from "zod";
import * as ledger from "./ledger.js";
import { parseCents, signedMoney } from "./money.js";
import { addDays, addMonths, monthName, monthOf, parseMonth, today as todayIn } from "./months.js";
import {
  type Category,
  KINDS,
  monthly_amounts,
  recurring,
  type Recurring,
  transactions,
  type Transaction,
  TYPES,
  UNITS,
} from "./schema.js";
import * as services from "./services.js";

// --- serializers ----------------------------------------------------------------------------------

export function categoryOut(category: Category) {
  const { created_at: _c, updated_at: _u, ...rest } = category;
  return { ...rest, display_icon: ledger.displayIcon(category) };
}

/** A transaction as rows show it and as the entry flow opens it. */
function transactionsOut(db: Db, rows: Transaction[]) {
  const byId = new Map(ledger.allCategories(db).map((c) => [c.id, categoryOut(c)]));
  const ruleIds = [...new Set(rows.flatMap((t) => (t.recurring_id === null ? [] : [t.recurring_id])))];
  const rules = new Map(
    ruleIds.length
      ? db.select({ id: recurring.id, title: recurring.title }).from(recurring).where(inArray(recurring.id, ruleIds)).all().map((r) => [r.id, r.title])
      : [],
  );
  return rows.map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    title: t.title,
    category_id: t.category_id,
    category: byId.get(t.category_id)!,
    date: t.date,
    month: t.month,
    counts_elsewhere: t.month !== monthOf(t.date),
    note: t.note,
    recurring_id: t.recurring_id,
    recurring_title: t.recurring_id === null ? "" : (rules.get(t.recurring_id) ?? ""),
  }));
}

function ruleOut(db: Db, rule: Recurring) {
  const { created_at: _c, updated_at: _u, created_by: _b, ...rest } = rule;
  return {
    ...rest,
    category: categoryOut(ledger.getCategory(db, rule.category_id)),
    frequency: services.frequencyLabel(rule),
    next: rule.paused ? null : services.nextDate(rule),
  };
}

const withCategory = <T extends { category: Category }>(line: T) => ({ ...line, category: categoryOut(line.category) });

// --- request shapes -------------------------------------------------------------------------------

const amountText = z.union([z.string(), z.number()]);
const optionalText = z.string().nullish();
const TransactionIn = z.object({
  type: z.enum(TYPES).nullish(),
  amount: amountText,
  title: optionalText,
  category: z.number().int().nullish(),
  date: optionalText,
  month: optionalText,
  note: optionalText,
  repeat: z.enum(UNITS).nullish().or(z.literal("")),
});
const CategoryIn = z.object({
  name: z.string().optional(),
  kind: z.enum(KINDS).optional(),
  icon: z.string().optional(),
  opening_balance: amountText.nullish(),
  target: amountText.nullish(),
  archived: z.boolean().optional(),
  amount: amountText.nullish(),
  from_month: optionalText,
});
const RecurringIn = z.object({
  type: z.enum(TYPES).nullish(),
  title: z.string(),
  amount: amountText,
  category: z.number().int().nullish(),
  note: optionalText,
  every: z.number().int().optional(),
  unit: z.enum(UNITS).optional(),
  start_date: z.string(),
  end_date: optionalText,
  month_offset: z.number().int().optional(),
});
const BudgetsIn = z.object({ from_month: optionalText, amounts: z.record(z.string(), z.string()) });

class NotFound extends Error {}
class Invalid extends Error {}

/** Field errors for a form: `{errors: {field: message}}` with a 400. */
class FieldErrors extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("invalid");
  }
}

const PAGE_SIZE = 60;

export function routes(api: Hono<AppEnv>, ctx: AppContext): void {
  const { db, config } = ctx;
  const today = () => todayIn(config.timezone);

  api.onError((err, c) => {
    if (err instanceof FieldErrors) return c.json({ ok: false, errors: err.errors }, 400);
    if (err instanceof Invalid) return c.json({ detail: "Invalid request" }, 422);
    if (err instanceof NotFound) return c.json({ detail: "Not found" }, 404);
    if (err instanceof DomainError) return c.json({ detail: err.message }, 400);
    console.error(`cache: ${c.req.method} ${c.req.path} failed`, err);
    return c.json({ detail: "Something went wrong" }, 500);
  });

  async function body<S extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, schema: S): Promise<z.infer<S>> {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new Invalid();
    return parsed.data;
  }
  const id = (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new NotFound();
    return n;
  };
  /** Run a lookup; a missing row is a 404 rather than a 400. */
  const found = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DomainError) throw new NotFound();
      throw err;
    }
  };
  /** Run a write for a form; a DomainError becomes an error on `field`. */
  const forField = <T>(field: string, fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DomainError) throw new FieldErrors({ [field]: err.message });
      throw err;
    }
  };
  /** Cents from a typed amount, or a field error. Empty means "not given". */
  const cents = (value: unknown, field: string, message: string): number | null => {
    if (value == null || value === "") return null;
    const parsed = parseCents(value);
    if (parsed === null) throw new FieldErrors({ [field]: message });
    return parsed;
  };

  // --- pages -------------------------------------------------------------------------------------

  api.get("/home", (c) => {
    const now = today();
    services.generateDue(db, now);
    const month = parseMonth(c.req.query("month"), now);
    const current = month === monthOf(now);
    const status = services.monthStatus(db, month, now);
    const recent = db.select().from(transactions).where(eq(transactions.month, month)).orderBy(desc(transactions.date), desc(transactions.created_at), desc(transactions.id)).limit(6).all();
    const upcoming = current ? services.upcoming(db, addDays(now, 14), now).slice(0, 5) : [];
    return c.json({
      month,
      month_name: monthName(month),
      prev_month: addMonths(month, -1),
      next_month: addMonths(month, 1),
      is_current: current,
      status: {
        ...status,
        budgets: status.budgets.map(withCategory),
        funds: status.funds.map(withCategory),
        incomes: status.incomes.map(withCategory),
      },
      recent: transactionsOut(db, recent),
      upcoming: upcoming.map(({ date, rule }) => ({ date, rule: ruleOut(db, rule) })),
    });
  });

  api.get("/history", (c) => {
    const now = today();
    services.generateDue(db, now);
    const q = (c.req.query("q") ?? "").trim();
    const month = c.req.query("month") ?? "";
    const category = c.req.query("category") ?? "";
    const type = (TYPES as readonly string[]).includes(c.req.query("type") ?? "") ? (c.req.query("type") as (typeof TYPES)[number]) : "";
    const where: (SQL | undefined)[] = [];
    if (type) where.push(eq(transactions.type, type));
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push(or(sql`${transactions.title} like ${pattern} escape '\\'`, sql`${transactions.note} like ${pattern} escape '\\'`));
    }
    if (month) where.push(eq(transactions.month, parseMonth(month, now)));
    if (/^\d+$/.test(category)) where.push(eq(transactions.category_id, Number(category)));
    const filter = and(...where);

    const total = db.select({ n: count() }).from(transactions).where(filter).get()!.n;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Number(c.req.query("page")) || 1));
    const rows = db
      .select()
      .from(transactions)
      .where(filter)
      .orderBy(desc(transactions.date), desc(transactions.created_at), desc(transactions.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .all();
    const sums = new Map(
      db.select({ type: transactions.type, total: sql<number>`sum(${transactions.amount})` }).from(transactions).where(filter).groupBy(transactions.type).all().map((r) => [r.type, r.total]),
    );
    const days: { date: string; rows: ReturnType<typeof transactionsOut> }[] = [];
    for (const row of transactionsOut(db, rows)) {
      if (days.at(-1)?.date !== row.date) days.push({ date: row.date, rows: [] });
      days.at(-1)!.rows.push(row);
    }
    return c.json({
      days,
      page,
      pages,
      count: total,
      spent: sums.get("expense") ?? 0,
      received: sums.get("income") ?? 0,
      filters: { q, month, category, type },
      filtered: Boolean(q || month || category || type),
      categories: ledger.allCategories(db).map(categoryOut),
      months: Array.from({ length: 25 }, (_, i) => addMonths(monthOf(now), 1 - i)),
      today: now,
    });
  });

  api.get("/trends", (c) => {
    const now = today();
    const end = parseMonth(c.req.query("end"), now);
    const span = Math.max(3, Math.min(24, Number(c.req.query("months")) || 12));
    const a = services.analysis(db, end, span, now);
    const trend = (t: services.CategoryTrend) => withCategory(t);
    const next = addMonths(end, span);
    return c.json({
      ...a,
      categories: a.categories.map(trend),
      flagged: a.flagged.map(trend),
      funds: a.funds.map(withCategory),
      span,
      end,
      prev_end: addMonths(end, -span),
      next_end: next <= monthOf(now) ? next : null,
    });
  });

  // --- transactions (the entry flow) ------------------------------------------------------------

  api.get("/entry", (c) => {
    const now = today();
    return c.json({
      cats: services.categoriesForEntry(db, now).map(categoryOut),
      titles: services.titleSuggestions(db),
      today: now,
    });
  });

  const transactionInput = (input: z.infer<typeof TransactionIn>) => {
    const amount = cents(input.amount, "amount", "Enter an amount above zero.");
    if (amount === null || amount <= 0) throw new FieldErrors({ amount: "Enter an amount above zero." });
    if (input.category == null) throw new FieldErrors({ category: "Pick a category." });
    return { type: input.type, amount, title: input.title, category_id: input.category, date: input.date || null, month: input.month || null, note: input.note };
  };

  api.post("/transactions", async (c) => {
    const input = await body(c, TransactionIn);
    const txn = forField("category", () => ledger.addTransaction(db, c.var.user, { ...transactionInput(input), repeat: input.repeat || null }, today()));
    return c.json({ ok: true, spend: transactionsOut(db, [txn])[0], toast: `${txn.title} added: ${signedMoney(txn.amount, txn.type)}`, undo: txn.id });
  });

  api.get("/transactions/:id", (c) => c.json(transactionsOut(db, [found(() => ledger.getTransaction(db, id(c.req.param("id"))))])[0]));

  api.patch("/transactions/:id", async (c) => {
    const input = await body(c, TransactionIn);
    const txnId = id(c.req.param("id"));
    found(() => ledger.getTransaction(db, txnId));
    const txn = forField("category", () => ledger.updateTransaction(db, txnId, transactionInput(input)));
    return c.json({ ok: true, spend: transactionsOut(db, [txn])[0], toast: `${txn.title} updated: ${signedMoney(txn.amount, txn.type)}`, undo: null });
  });

  api.delete("/transactions/:id", (c) => {
    const txnId = id(c.req.param("id"));
    const [spend] = transactionsOut(db, [found(() => ledger.getTransaction(db, txnId))]);
    ledger.deleteTransaction(db, txnId);
    return c.json({ ok: true, spend, toast: `${spend!.title} deleted` });
  });

  // --- categories and budgets -------------------------------------------------------------------

  /** Every category with where it stands this month, for Settings. */
  api.get("/categories", (c) => {
    const month = monthOf(today());
    const book = new services.Book(db);
    return c.json({
      month,
      categories: book.categories.map((category) => ({
        ...categoryOut(category),
        amount: book.amount(category.id, month),
        balance: category.kind === "fund" ? book.fundBalance(category, month) : null,
      })),
      recurring_count: db.select({ n: count() }).from(recurring).where(eq(recurring.paused, false)).get()!.n,
      mcp_url: `${config.publicUrl}/mcp`,
    });
  });

  api.get("/categories/:id", (c) => {
    const category = found(() => ledger.getCategory(db, id(c.req.param("id"))));
    const now = today();
    const month = monthOf(now);
    const book = new services.Book(db);
    const history = services.categoryHistory(db, category, month, 12, now);
    const recent = db
      .select()
      .from(transactions)
      .where(eq(transactions.category_id, category.id))
      .orderBy(desc(transactions.date), desc(transactions.created_at), desc(transactions.id))
      .limit(30)
      .all();
    return c.json({
      category: categoryOut(category),
      history: history.kind === "budget" ? { ...history, trend: withCategory(history.trend) } : history,
      recent: transactionsOut(db, recent),
      balance: category.kind === "fund" ? book.fundBalance(category, month) : null,
      received_now: category.kind === "income" ? book.received(category.id, month) : null,
      amount_now: book.amount(category.id, month),
      amounts: db.select().from(monthly_amounts).where(eq(monthly_amounts.category_id, category.id)).orderBy(desc(monthly_amounts.start_month)).all(),
      this_month: month,
    });
  });

  const categoryInput = (input: z.infer<typeof CategoryIn>): ledger.CategoryInput => {
    const amount = cents(input.amount, "amount", "Enter an amount like 250.");
    const opening = cents(input.opening_balance, "opening_balance", "Enter an amount like 250.");
    const out: ledger.CategoryInput = { name: input.name, kind: input.kind, icon: input.icon, archived: input.archived, amount, from_month: input.from_month || null };
    if (input.opening_balance !== undefined) out.opening_balance = opening ?? 0;
    if (input.target !== undefined) out.target = cents(input.target, "target", "Enter an amount like 250.");
    return out;
  };
  /** Which form field a category problem belongs to. */
  const categoryField = (err: DomainError) => (/icon/i.test(err.message) ? "icon" : /amount|target/i.test(err.message) ? "amount" : "name");
  const saveCategory = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DomainError) throw new FieldErrors({ [categoryField(err)]: err.message });
      throw err;
    }
  };

  api.post("/categories", async (c) => {
    const input = categoryInput(await body(c, CategoryIn));
    const category = saveCategory(() => ledger.createCategory(db, input, today()));
    return c.json({ ok: true, category: categoryOut(category), toast: `${category.name} added` });
  });

  api.patch("/categories/:id", async (c) => {
    const categoryId = id(c.req.param("id"));
    found(() => ledger.getCategory(db, categoryId));
    const input = categoryInput(await body(c, CategoryIn));
    const category = saveCategory(() => ledger.updateCategory(db, categoryId, input, today()));
    return c.json({ ok: true, category: categoryOut(category), toast: `${category.name} saved` });
  });

  api.delete("/categories/:id", (c) => {
    const categoryId = id(c.req.param("id"));
    const category = found(() => ledger.getCategory(db, categoryId));
    const result = ledger.deleteCategory(db, categoryId);
    return c.json({
      ok: true,
      result,
      toast: result === "archived" ? `${category.name} has transactions, so it was archived instead.` : `${category.name} deleted`,
    });
  });

  api.delete("/amounts/:id", (c) => {
    const categoryId = found(() => ledger.deleteAmount(db, id(c.req.param("id"))));
    return c.json({ ok: true, category_id: categoryId, toast: "Change removed" });
  });

  /** All monthly amounts on one screen, applied from a chosen month on. */
  api.get("/budgets", (c) => {
    const now = today();
    const fromMonth = parseMonth(c.req.query("from_month"), now);
    const book = new services.Book(db);
    return c.json({
      from_month: fromMonth,
      rows: book.categories
        .filter((category) => !category.archived && category.kind !== "income")
        .map((category) => ({ category: categoryOut(category), amount: book.amount(category.id, fromMonth) })),
      month_choices: Array.from({ length: 16 }, (_, i) => addMonths(monthOf(now), i - 12)),
    });
  });

  api.put("/budgets", async (c) => {
    const input = await body(c, BudgetsIn);
    const fromMonth = parseMonth(input.from_month, today());
    const amounts: Record<number, number> = {};
    const errors: Record<string, string> = {};
    for (const [key, raw] of Object.entries(input.amounts)) {
      const text = raw.trim().replaceAll(",", "");
      if (text === "") continue;
      const value = parseCents(text);
      if (value === null) errors[key] = "Enter an amount like 250.";
      else amounts[Number(key)] = value;
    }
    if (Object.keys(errors).length) throw new FieldErrors(errors);
    const changed = ledger.setAmounts(db, amounts, fromMonth);
    return c.json({ ok: true, changed, toast: `${changed} amounts updated from ${monthName(fromMonth)}` });
  });

  // --- recurring ---------------------------------------------------------------------------------

  api.get("/recurring", (c) => {
    const now = today();
    services.generateDue(db, now);
    const rules = db.select().from(recurring).all().map((rule) => ruleOut(db, rule));
    rules.sort(
      (a, b) =>
        Number(a.paused) - Number(b.paused) ||
        Number(a.next === null) - Number(b.next === null) ||
        (a.next ?? now).localeCompare(b.next ?? now) ||
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    );
    const perMonth = { week: 52 / 12, month: 1, year: 1 / 12 };
    const monthly = (type: string) =>
      Math.round(rules.filter((r) => !r.paused && r.next && r.type === type).reduce((s, r) => s + (r.amount * perMonth[r.unit]) / r.every, 0));
    return c.json({ rules, monthly_out: monthly("expense"), monthly_in: monthly("income") });
  });

  api.get("/recurring/:id", (c) => c.json(ruleOut(db, found(() => ledger.getRecurring(db, id(c.req.param("id")))))));

  const recurringInput = (input: z.infer<typeof RecurringIn>): ledger.RecurringInput => {
    const amount = cents(input.amount, "amount", "Enter an amount above zero.");
    if (amount === null) throw new FieldErrors({ amount: "Enter an amount above zero." });
    if (input.category == null) throw new FieldErrors({ category: "Pick a category." });
    return { ...input, amount, category_id: input.category };
  };
  /** Which form field a recurring-rule problem belongs to. */
  const ruleField = (err: DomainError) => {
    const m = err.message;
    if (/title/i.test(m)) return "title";
    if (/amount/i.test(m)) return "amount";
    if (/last date/i.test(m)) return "end_date";
    if (/first date/i.test(m)) return "start_date";
    if (/every|weeks/i.test(m)) return "every";
    return "category";
  };
  const saveRule = (fn: () => Recurring) => {
    let rule: Recurring;
    try {
      rule = fn();
    } catch (err) {
      if (err instanceof DomainError) throw new FieldErrors({ [ruleField(err)]: err.message });
      throw err;
    }
    const created = services.generateDue(db, today());
    return { ok: true, rule: ruleOut(db, ledger.getRecurring(db, rule.id)), created, toast: `${rule.title} saved` };
  };

  api.post("/recurring", async (c) => {
    const input = recurringInput(await body(c, RecurringIn));
    return c.json(saveRule(() => ledger.createRecurring(db, c.var.user, input)));
  });

  api.patch("/recurring/:id", async (c) => {
    const ruleId = id(c.req.param("id"));
    found(() => ledger.getRecurring(db, ruleId));
    const input = recurringInput(await body(c, RecurringIn));
    return c.json(saveRule(() => ledger.updateRecurring(db, ruleId, input)));
  });

  api.post("/recurring/:id/toggle", (c) => {
    const now = today();
    const rule = found(() => ledger.toggleRecurring(db, id(c.req.param("id")), now));
    services.generateDue(db, now);
    return c.json({ ok: true, rule: ruleOut(db, ledger.getRecurring(db, rule.id)), toast: `${rule.title} ${rule.paused ? "paused" : "resumed"}` });
  });

  api.delete("/recurring/:id", (c) => {
    const rule = found(() => ledger.deleteRecurring(db, id(c.req.param("id"))));
    return c.json({ ok: true, toast: `${rule.title} deleted. Past entries were kept.` });
  });

  /** Who entered things, for display. */
  api.get("/people", (c) => c.json({ people: db.select({ id: warren.users.id, name: warren.users.name }).from(warren.users).orderBy(asc(warren.users.name)).all() }));
}
