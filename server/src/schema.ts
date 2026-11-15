/**
 * Cache's household ledger. One shared ledger: every signed-in person sees and edits everything,
 * so nothing here has an owner (`created_by` only records who entered a transaction).
 *
 * Money is whole cents. A day is "YYYY-MM-DD" and a month is "YYYY-MM", both text, so they sort
 * and compare as strings. Property names are the column names, so a row is also its API shape.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { schema as warren } from "warren/server";

export const KINDS = ["budget", "fund", "income"] as const;
export type Kind = (typeof KINDS)[number];
export const TYPES = ["expense", "income"] as const;
export type Type = (typeof TYPES)[number];
export const UNITS = ["week", "month", "year"] as const;
export type Unit = (typeof UNITS)[number];

const now = sql`(unixepoch('subsec') * 1000)`;
const created_at = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);
const updated_at = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now)
    .$onUpdate(() => new Date());

/**
 * A budget (planned monthly spending), a fund (a sinking fund topped up on the 1st and drawn down
 * by what is spent from it) or income (pay and the like; no monthly amount, takes income only).
 */
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    kind: text("kind").$type<Kind>().notNull().default("budget"),
    /** "" picks an icon from the name, "letter" shows the first letter, else a name from the icon library. */
    icon: text("icon").notNull().default(""),
    position: integer("position").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    /** Funds only: the balance before the first top-up. */
    opening_balance: integer("opening_balance").notNull().default(0),
    /** Funds only: what the fund is saving up to. */
    target: integer("target"),
    created_at: created_at(),
    updated_at: updated_at(),
  },
  (t) => [uniqueIndex("categories_name").on(sql`lower(${t.name})`)],
);

/**
 * The category's monthly budget (or fund top-up) from `start_month` until the next row. The amount
 * for month M is the latest row starting on or before M, 0 before the first. A change adds a row,
 * so past months keep the amount they had and past trends never move. Never rewrite old rows.
 */
export const monthly_amounts = sqliteTable(
  "monthly_amounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    category_id: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    start_month: text("start_month").notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [
    uniqueIndex("monthly_amounts_category_month").on(t.category_id, t.start_month),
    check("monthly_amounts_not_negative", sql`${t.amount} >= 0`),
  ],
);

/**
 * A schedule that creates transactions as they fall due: every `every` units from `start_date`.
 * Nothing is created ahead of time, so editing a rule changes every entry still to come and
 * nothing already made. `last_generated` belongs to `generateDue`; nothing else writes it except
 * resuming a paused rule.
 */
export const recurring = sqliteTable("recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").$type<Type>().notNull().default("expense"),
  title: text("title").notNull(),
  amount: integer("amount").notNull(),
  category_id: integer("category_id")
    .notNull()
    .references(() => categories.id),
  note: text("note").notNull().default(""),
  every: integer("every").notNull().default(1),
  unit: text("unit").$type<Unit>().notNull().default("month"),
  start_date: text("start_date").notNull(),
  end_date: text("end_date"),
  /** 0: counts toward the month of its date. -1: the month before (a bill that arrives late). */
  month_offset: integer("month_offset").notNull().default(0),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  last_generated: text("last_generated"),
  created_by: integer("created_by").references(() => warren.users.id, { onDelete: "set null" }),
  created_at: created_at(),
  updated_at: updated_at(),
});

/**
 * An expense or income. The amount is always positive; `type` gives the direction. Income in a
 * budget or fund category is money back (a refund, or money put into a fund). `date` is when it
 * happened or was billed; `month` is the month it counts toward, which all budget and fund maths
 * use. May's transport bill paid on 10 June has date 2026-06-10 and month 2026-05.
 */
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").$type<Type>().notNull().default("expense"),
    amount: integer("amount").notNull(),
    title: text("title").notNull(),
    category_id: integer("category_id")
      .notNull()
      .references(() => categories.id),
    date: text("date").notNull(),
    month: text("month").notNull(),
    note: text("note").notNull().default(""),
    recurring_id: integer("recurring_id").references(() => recurring.id, { onDelete: "set null" }),
    created_by: integer("created_by").references(() => warren.users.id, { onDelete: "set null" }),
    created_at: created_at(),
    updated_at: updated_at(),
  },
  (t) => [
    index("transactions_month_category").on(t.month, t.category_id),
    index("transactions_date").on(t.date, t.created_at),
    check("transactions_positive", sql`${t.amount} > 0`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type MonthlyAmount = typeof monthly_amounts.$inferSelect;
export type Recurring = typeof recurring.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
