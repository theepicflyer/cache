import { expect, test } from "vitest";
import { schema as warren, upsertUser } from "warren/server";
import { importLedger, type LedgerExport } from "../src/importLedger.js";
import * as services from "../src/services.js";
import { testCache } from "./helpers.js";

/** What the export query gives for a small, made-up ledger (Postgres numerics as JSON numbers). */
const exported = (): LedgerExport => ({
  users: [
    { id: 1, email: "alex@example.com", first_name: "Alex", last_name: "", date_joined: "2025-01-02T03:04:05+00:00", sub: "pocket-sub-1" },
    { id: 2, email: "sam@example.com", first_name: "", last_name: "", date_joined: "2025-01-02T03:04:05+00:00", sub: null },
  ],
  categories: [
    { id: 3, name: "Groceries", kind: "budget", icon: "", position: 0, archived: false, opening_balance: 0, target: null, created_at: "2025-01-02T03:04:05+00:00", updated_at: "2025-01-02T03:04:05+00:00" },
    { id: 4, name: "Travel", kind: "fund", icon: "airplane", position: 1, archived: false, opening_balance: 120.5, target: 2000, created_at: "2025-01-02T03:04:05+00:00", updated_at: "2025-01-02T03:04:05+00:00" },
    { id: 5, name: "Salary", kind: "income", icon: "letter", position: 2, archived: false, opening_balance: 0, target: null, created_at: "2025-01-02T03:04:05+00:00", updated_at: "2025-01-02T03:04:05+00:00" },
  ],
  monthly_amounts: [
    { id: 1, category_id: 3, start_month: "2026-01-01", amount: 500 },
    { id: 2, category_id: 3, start_month: "2026-04-01", amount: 650.1 },
    { id: 3, category_id: 4, start_month: "2026-01-01", amount: 100 },
  ],
  recurring: [
    { id: 7, type: "expense", title: "Phone bill", amount: 30.05, category_id: 3, note: "", every: 1, unit: "month", start_date: "2026-01-15", end_date: null, month_offset: -1, paused: false, last_generated: "2026-04-15", created_by_id: 1, created_at: "2026-01-02T03:04:05+00:00", updated_at: "2026-01-02T03:04:05+00:00" },
  ],
  transactions: [
    { id: 10, type: "expense", amount: 80.4, title: "Market", category_id: 3, date: "2026-04-03", month: "2026-04-01", note: "", recurring_id: null, created_by_id: 1, created_at: "2026-04-03T10:00:00.123+00:00", updated_at: "2026-04-03T10:00:00.123+00:00" },
    { id: 11, type: "expense", amount: 30.05, title: "Phone bill", category_id: 3, date: "2026-04-15", month: "2026-03-01", note: "", recurring_id: 7, created_by_id: 1, created_at: "2026-04-15T10:00:00+00:00", updated_at: "2026-04-15T10:00:00+00:00" },
    { id: 12, type: "expense", amount: 250, title: "Flights", category_id: 4, date: "2026-04-20", month: "2026-04-01", note: "Holiday", recurring_id: null, created_by_id: 2, created_at: "2026-04-20T10:00:00+00:00", updated_at: "2026-04-20T10:00:00+00:00" },
    { id: 13, type: "income", amount: 4000, title: "Pay", category_id: 5, date: "2026-04-25", month: "2026-04-01", note: "", recurring_id: null, created_by_id: null, created_at: "2026-04-25T10:00:00+00:00", updated_at: "2026-04-25T10:00:00+00:00" },
  ],
});

test("the old ledger comes over in cents and months, with the same totals", () => {
  const { db } = testCache();
  const counts = importLedger(db, exported());
  expect(counts).toEqual({ people: 2, categories: 3, "monthly amounts": 3, recurring: 1, transactions: 4 });

  const april = services.monthStatus(db, "2026-04", "2026-04-30");
  const groceries = april.budgets.find((b) => b.category.name === "Groceries")!;
  expect([groceries.budget, groceries.spent]).toEqual([65010, 8040]);
  const travel = april.funds[0]!;
  // opening 120.50 + four top-ups of 100 - 250 spent
  expect([travel.category.target, travel.balance]).toEqual([200000, 12050 + 40000 - 25000]);
  expect(april.incomes[0]!.received).toBe(400000);
  // the late phone bill still counts toward March
  expect(services.monthStatus(db, "2026-03", "2026-04-30").budgets[0]!.spent).toBe(3005);
  // nothing is regenerated: the rule had already made April's
  expect(services.generateDue(db, "2026-04-30")).toBe(0);
});

test("people who signed in with Pocket ID are found again; the rest get a placeholder", () => {
  const { db } = testCache();
  importLedger(db, exported());
  const people = db.select().from(warren.users).all();
  expect(people.map((p) => [p.id, p.oidcSub, p.name])).toEqual([
    [1, "pocket-sub-1", "Alex"],
    [2, "legacy:sam@example.com", "sam"],
  ]);
  expect(upsertUser(db, { sub: "pocket-sub-1", email: "alex@example.com", name: "Alex" }).id).toBe(1);
});

test("it refuses a database that already has a ledger", () => {
  const { db, category } = testCache();
  category("Groceries");
  expect(() => importLedger(db, exported())).toThrow(/empty/);
});
