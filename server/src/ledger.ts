/** Changing the ledger: transactions, categories and their monthly amounts, recurring rules. */
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { type Db, DomainError, type User } from "warren/server";
import icons from "./icons.json" with { type: "json" };
import { addDays, isDay, isMonth, monthOf } from "./months.js";
import {
  categories,
  type Category,
  type Kind,
  KINDS,
  monthly_amounts,
  recurring,
  type Recurring,
  transactions,
  type Transaction,
  type Type,
  TYPES,
  type Unit,
  UNITS,
} from "./schema.js";

// --- icons ----------------------------------------------------------------------------------------

/** Stored in a category's icon to show its first letter instead of a guessed icon. */
export const LETTER = "letter";
const GENERIC = "dots-three";
const ICON_NAMES = new Set(icons.groups.flatMap((g) => g.icons.map((i) => i.n)));
const MATCH = icons.match as Record<string, string>;

/** An icon for a category called `name`, from the words in it; "" if none fits. */
export function guessIcon(name: string): string {
  const found: string[] = [];
  for (const word of name.toLowerCase().match(/[a-z]+/g) ?? []) {
    const hit = MATCH[word] ?? (word.endsWith("s") ? MATCH[word.slice(0, -1)] : undefined);
    if (hit) found.push(hit);
  }
  // "Other income" should get the income icon, not the catch-all one.
  return found.find((i) => i !== GENERIC) ?? found[0] ?? "";
}

/** The icon to draw: the one picked, else one that fits the name. "" means the first letter (or, for a fund, the acorn). */
export function displayIcon(category: Pick<Category, "icon" | "name">): string {
  if (category.icon === LETTER) return "";
  return ICON_NAMES.has(category.icon) ? category.icon : guessIcon(category.name);
}

// --- categories -----------------------------------------------------------------------------------

export function getCategory(db: Db, id: number): Category {
  const found = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!found) throw new DomainError(`There is no category with id ${id}.`);
  return found;
}

export function amountFor(db: Db, categoryId: number, month: string): number {
  const row = db
    .select({ amount: monthly_amounts.amount })
    .from(monthly_amounts)
    .where(and(eq(monthly_amounts.category_id, categoryId), sql`${monthly_amounts.start_month} <= ${month}`))
    .orderBy(sql`${monthly_amounts.start_month} desc`)
    .get();
  return row?.amount ?? 0;
}

/**
 * Set the monthly amount from `fromMonth` on. Earlier months keep theirs; later rows that already
 * exist are left alone (they were set on purpose).
 */
export function setAmount(db: Db, categoryId: number, amount: number, fromMonth: string): void {
  if (!Number.isInteger(amount) || amount < 0) throw new DomainError("Enter an amount like 250.");
  db.insert(monthly_amounts)
    .values({ category_id: categoryId, start_month: monthOf(fromMonth), amount })
    .onConflictDoUpdate({ target: [monthly_amounts.category_id, monthly_amounts.start_month], set: { amount } })
    .run();
}

export interface CategoryInput {
  name?: string;
  kind?: Kind;
  icon?: string;
  opening_balance?: number;
  target?: number | null;
  archived?: boolean;
  /** The monthly budget or top-up, applied from `from_month` on. */
  amount?: number | null;
  from_month?: string | null;
}

function categoryValues(db: Db, input: CategoryInput, selfId: number | null) {
  const values: Partial<typeof categories.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new DomainError("Give the category a name.");
    if (name.length > 80) throw new DomainError("Keep the name under 80 characters.");
    const clash = db
      .select({ id: categories.id })
      .from(categories)
      .where(and(sql`lower(${categories.name}) = ${name.toLowerCase()}`, selfId === null ? undefined : ne(categories.id, selfId)))
      .get();
    if (clash) throw new DomainError(`There is already a category called ${name}.`);
    values.name = name;
  }
  if (input.kind !== undefined) {
    if (!KINDS.includes(input.kind)) throw new DomainError("Pick budget, fund or income.");
    values.kind = input.kind;
  }
  if (input.icon !== undefined) {
    if (input.icon && input.icon !== LETTER && !ICON_NAMES.has(input.icon)) throw new DomainError("Pick an icon from the list.");
    values.icon = input.icon;
  }
  if (input.opening_balance !== undefined) values.opening_balance = input.opening_balance;
  if (input.target !== undefined) {
    if (input.target !== null && input.target < 0) throw new DomainError("A target can't be negative.");
    values.target = input.target;
  }
  if (input.archived !== undefined) values.archived = input.archived;
  return values;
}

export function createCategory(db: Db, input: CategoryInput, today: string): Category {
  return db.transaction((tx) => {
    if (input.name === undefined) throw new DomainError("Give the category a name.");
    const values = categoryValues(tx, input, null);
    const category = tx.insert(categories).values({ ...values, name: values.name! }).returning().get();
    // Income has no monthly budget.
    if (category.kind !== "income") setAmount(tx, category.id, input.amount ?? 0, input.from_month ?? today);
    return category;
  });
}

export function updateCategory(db: Db, id: number, input: CategoryInput, today: string): Category {
  return db.transaction((tx) => {
    getCategory(tx, id);
    const values = categoryValues(tx, input, id);
    if (Object.keys(values).length) tx.update(categories).set(values).where(eq(categories.id, id)).run();
    const category = getCategory(tx, id);
    const from = monthOf(input.from_month ?? today);
    if (category.kind !== "income" && input.amount != null && input.amount !== amountFor(tx, id, from)) {
      setAmount(tx, id, input.amount, from);
    }
    return category;
  });
}

/** Delete a category, or archive it when it has transactions or recurring rules. Says which happened. */
export function deleteCategory(db: Db, id: number): "deleted" | "archived" {
  return db.transaction((tx) => {
    getCategory(tx, id);
    const used =
      tx.select({ n: count() }).from(transactions).where(eq(transactions.category_id, id)).get()!.n +
      tx.select({ n: count() }).from(recurring).where(eq(recurring.category_id, id)).get()!.n;
    if (used) {
      tx.update(categories).set({ archived: true }).where(eq(categories.id, id)).run();
      return "archived";
    }
    tx.delete(categories).where(eq(categories.id, id)).run();
    return "deleted";
  });
}

/** Remove one change to a category's monthly amount. The last remaining row stays. */
export function deleteAmount(db: Db, id: number): number {
  return db.transaction((tx) => {
    const row = tx.select().from(monthly_amounts).where(eq(monthly_amounts.id, id)).get();
    if (!row) throw new DomainError("That change is already gone.");
    const rows = tx.select({ n: count() }).from(monthly_amounts).where(eq(monthly_amounts.category_id, row.category_id)).get()!.n;
    if (rows > 1) tx.delete(monthly_amounts).where(eq(monthly_amounts.id, id)).run();
    return row.category_id;
  });
}

/** Apply many monthly amounts from one month on. Returns how many changed. */
export function setAmounts(db: Db, amounts: Record<number, number>, fromMonth: string): number {
  return db.transaction((tx) => {
    let changed = 0;
    for (const [id, amount] of Object.entries(amounts)) {
      const category = getCategory(tx, Number(id));
      if (category.kind === "income" || amount === amountFor(tx, category.id, fromMonth)) continue;
      setAmount(tx, category.id, amount, fromMonth);
      changed += 1;
    }
    return changed;
  });
}

// --- transactions ---------------------------------------------------------------------------------

export function getTransaction(db: Db, id: number): Transaction {
  const found = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!found) throw new DomainError(`There is no transaction with id ${id}.`);
  return found;
}

/** An income category takes only income. */
export function checkTypeFits(category: Category, type: Type): void {
  if (category.kind === "income" && type === "expense") {
    throw new DomainError(`${category.name} is for income. Pick another category.`);
  }
}

export interface TransactionInput {
  type?: Type | null;
  amount: number;
  title?: string | null;
  category_id: number;
  date?: string | null;
  month?: string | null;
  note?: string | null;
}

function transactionValues(db: Db, input: TransactionInput, fallbackDate: string) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("Enter an amount above zero.");
  const category = db.select().from(categories).where(eq(categories.id, input.category_id)).get();
  if (!category) throw new DomainError("Pick a category.");
  const type = input.type ?? "expense";
  if (!TYPES.includes(type)) throw new DomainError("Pick expense or income.");
  checkTypeFits(category, type);
  if (input.date != null && !isDay(input.date)) throw new DomainError("Pick a date.");
  if (input.month != null && !isMonth(input.month)) throw new DomainError("Pick a month.");
  const title = (input.title ?? "").trim() || category.name;
  if (title.length > 200) throw new DomainError("Keep the title under 200 characters; put the rest in the note.");
  const date = input.date ?? fallbackDate;
  return { type, amount: input.amount, title, category_id: category.id, date, month: monthOf(input.month ?? date), note: (input.note ?? "").trim() };
}

/**
 * Add a transaction. With `repeat`, also start a recurring rule from it: the rule's first entry is
 * this one, so it creates the next on the next date of its schedule.
 */
export function addTransaction(db: Db, user: User | null, input: TransactionInput & { repeat?: Unit | null }, today: string): Transaction {
  return db.transaction((tx) => {
    const values = transactionValues(tx, input, today);
    let recurring_id: number | null = null;
    if (input.repeat) {
      if (!UNITS.includes(input.repeat)) throw new DomainError("Pick weekly, monthly or yearly.");
      recurring_id = tx
        .insert(recurring)
        .values({
          type: values.type,
          title: values.title,
          amount: values.amount,
          category_id: values.category_id,
          note: values.note,
          unit: input.repeat,
          start_date: values.date,
          month_offset: values.month < monthOf(values.date) ? -1 : 0,
          last_generated: values.date,
          created_by: user?.id ?? null,
        })
        .returning({ id: recurring.id })
        .get().id;
    }
    return tx.insert(transactions).values({ ...values, recurring_id, created_by: user?.id ?? null }).returning().get();
  });
}

export function updateTransaction(db: Db, id: number, input: TransactionInput): Transaction {
  return db.transaction((tx) => {
    const current = getTransaction(tx, id);
    tx.update(transactions).set(transactionValues(tx, input, current.date)).where(eq(transactions.id, id)).run();
    return getTransaction(tx, id);
  });
}

/** Delete a transaction. If a recurring rule made it, the rule doesn't make it again. */
export function deleteTransaction(db: Db, id: number): Transaction {
  const gone = getTransaction(db, id);
  db.delete(transactions).where(eq(transactions.id, id)).run();
  return gone;
}

// --- recurring rules ------------------------------------------------------------------------------

export function getRecurring(db: Db, id: number): Recurring {
  const found = db.select().from(recurring).where(eq(recurring.id, id)).get();
  if (!found) throw new DomainError("That recurring transaction is gone.");
  return found;
}

export interface RecurringInput {
  type?: Type | null;
  title: string;
  amount: number;
  category_id: number;
  note?: string | null;
  every?: number;
  unit?: Unit;
  start_date: string;
  end_date?: string | null;
  month_offset?: number;
}

function recurringValues(db: Db, input: RecurringInput, selfCategory: number | null) {
  const title = input.title.trim();
  if (!title) throw new DomainError("Give it a title.");
  if (title.length > 200) throw new DomainError("Keep the title under 200 characters.");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("Enter an amount above zero.");
  const category = db.select().from(categories).where(eq(categories.id, input.category_id)).get();
  // An archived category takes no new rules, but a rule already in one may stay there.
  if (!category || (category.archived && category.id !== selfCategory)) throw new DomainError("Pick a category.");
  const type = input.type ?? "expense";
  if (!TYPES.includes(type)) throw new DomainError("Pick expense or income.");
  checkTypeFits(category, type);
  const every = input.every ?? 1;
  if (!Number.isInteger(every) || every < 1 || every > 999) throw new DomainError("Repeat every 1 or more.");
  const unit = input.unit ?? "month";
  if (!UNITS.includes(unit)) throw new DomainError("Pick weeks, months or years.");
  if (!isDay(input.start_date)) throw new DomainError("Pick the first date.");
  const end_date = input.end_date || null;
  if (end_date !== null && !isDay(end_date)) throw new DomainError("Pick the last date, or leave it empty.");
  if (end_date !== null && end_date < input.start_date) throw new DomainError("The last date can't be before the first.");
  const month_offset = input.month_offset ?? 0;
  if (month_offset !== 0 && month_offset !== -1) throw new DomainError("Pick same month or previous month.");
  return { type, title, amount: input.amount, category_id: category.id, note: (input.note ?? "").trim(), every, unit, start_date: input.start_date, end_date, month_offset };
}

export function createRecurring(db: Db, user: User | null, input: RecurringInput): Recurring {
  return db.insert(recurring).values({ ...recurringValues(db, input, null), created_by: user?.id ?? null }).returning().get();
}

/** Edit a rule. Entries it already made stay as they are; `last_generated` is not touched. */
export function updateRecurring(db: Db, id: number, input: RecurringInput): Recurring {
  const current = getRecurring(db, id);
  db.update(recurring).set(recurringValues(db, input, current.category_id)).where(eq(recurring.id, id)).run();
  return getRecurring(db, id);
}

/** Pause or resume. Resuming skips what fell due while paused; today's entry (if any) is still made. */
export function toggleRecurring(db: Db, id: number, today: string): Recurring {
  const rule = getRecurring(db, id);
  const paused = !rule.paused;
  const yesterday = addDays(today, -1);
  const last_generated = !paused && (!rule.last_generated || rule.last_generated < yesterday) ? yesterday : rule.last_generated;
  db.update(recurring).set({ paused, last_generated }).where(eq(recurring.id, id)).run();
  return getRecurring(db, id);
}

/** Delete a rule. Past entries stay; they just lose the link. */
export function deleteRecurring(db: Db, id: number): Recurring {
  const rule = getRecurring(db, id);
  db.delete(recurring).where(eq(recurring.id, id)).run();
  return rule;
}

export function allCategories(db: Db): Category[] {
  return db.select().from(categories).orderBy(asc(categories.kind), asc(categories.position), asc(categories.name)).all();
}
