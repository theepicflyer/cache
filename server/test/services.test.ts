import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import * as ledger from "../src/ledger.js";
import { recurring, transactions } from "../src/schema.js";
import * as services from "../src/services.js";
import { testCache } from "./helpers.js";

const $ = (dollars: number) => Math.round(dollars * 100);

test("changing the monthly amount keeps earlier months", () => {
  const { db, category } = testCache();
  const cat = category("Groceries", "budget", 500);
  ledger.setAmount(db, cat.id, $(650), "2026-06-15");
  const amounts = ["2025-12", "2026-01", "2026-05", "2026-06", "2027-03"].map((m) => ledger.amountFor(db, cat.id, m));
  expect(amounts).toEqual([0, $(500), $(500), $(650), $(650)]);
  const book = new services.Book(db);
  expect([book.amount(cat.id, "2026-05"), book.amount(cat.id, "2026-07")]).toEqual([$(500), $(650)]);
  // setting it again for the same month replaces that row rather than adding another
  ledger.setAmount(db, cat.id, $(700), "2026-06");
  expect(ledger.amountFor(db, cat.id, "2026-06")).toBe($(700));
});

test("a transaction counts toward its date's month unless told otherwise", () => {
  const { category, spend } = testCache();
  const cat = category("Transport");
  expect(spend(cat, 5, "2026-06-10").month).toBe("2026-06");
  expect(spend(cat, 88, "2026-06-10", { month: "2026-05-20" }).month).toBe("2026-05");
});

test("a fund grows on the first and shrinks by what is spent, by month not date", () => {
  const { db, category, spend } = testCache();
  const fund = category("Travel", "fund", 200, { opening_balance: $(100) });
  ledger.setAmount(db, fund.id, $(300), "2026-04");
  spend(fund, 450, "2026-02-14", { title: "Flights" });
  spend(fund, 50, "2026-03-02", { title: "Refund", type: "income" });
  let book = new services.Book(db);
  const balance = (m: string) => book.fundBalance(fund, m) / 100;
  expect(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"].map(balance)).toEqual([100, 300, 50, 300, 600]);
  spend(fund, 250, "2026-05-03", { month: "2026-04" });
  book = new services.Book(db);
  expect(balance("2026-04")).toBe(350);
});

test("budgets and funds are kept apart in a month's status", () => {
  const { db, category, spend } = testCache();
  const food = category("Food", "budget", 300);
  const fun = category("Fun", "budget", 100);
  const car = category("Car", "fund", 150);
  category("Old", "budget", 50, { archived: true });
  spend(food, 120, "2026-03-05");
  spend(fun, 130, "2026-03-06");
  spend(car, 400, "2026-03-07");
  const status = services.monthStatus(db, "2026-03", "2026-03-15");
  expect([status.total_budget, status.total_spent, status.left, status.over]).toEqual([$(400), $(250), $(150), false]);
  const lines = Object.fromEntries(status.budgets.map((b) => [b.category.name, b]));
  expect(Object.keys(lines)).toEqual(["Food", "Fun"]); // the archived category without spends is hidden
  expect([lines.Fun!.over, lines.Fun!.percent]).toEqual([true, 130]);
  expect([status.funds[0]!.balance, status.fund_spent]).toEqual([$(50), $(400)]);
  expect([status.days_left, status.ahead_of_pace]).toEqual([16, true]); // 62% spent, 48% of the month gone
  const past = services.monthStatus(db, "2026-02", "2026-03-15");
  expect([past.days_left, past.elapsed, past.ahead_of_pace]).toEqual([null, null, false]);
});

test("income is counted apart from budgets, and money back lowers what was spent", () => {
  const { db, category, spend } = testCache();
  const pay = category("Salary", "income");
  const food = category("Food", "budget", 300);
  const car = category("Car", "fund", 100);
  spend(pay, 4000, "2026-03-25", { type: "income" });
  spend(food, 250, "2026-03-05");
  spend(food, 30, "2026-03-09", { title: "Refund", type: "income" });
  spend(car, 120, "2026-03-12");
  const status = services.monthStatus(db, "2026-03", "2026-04-02");
  expect(status.budgets.map((b) => b.category.name)).toEqual(["Food"]);
  expect([status.total_spent, status.income, status.out, status.net]).toEqual([$(220), $(4000), $(340), $(3660)]);
  const a = services.analysis(db, "2026-03", 3, "2026-04-02");
  expect(a.categories.map((t) => t.category.name)).toEqual(["Food"]);
  expect(a.flows.at(-1)).toMatchObject({ income: $(4000), out: $(340), net: $(3660) });
  expect(a.avg_income).toBe($(4000));
  expect(() => spend(pay, 5, "2026-03-01")).toThrow("Salary is for income");
});

test("analysis counts complete months over budget", () => {
  const { db, category, spend } = testCache();
  const eat = category("Eating out", "budget", 100);
  const rent = category("Rent", "budget", 1000);
  [120, 90, 150, 130, 500].forEach((amount, i) => {
    spend(eat, amount, `2026-0${i + 1}-10`);
    spend(rent, 1000, `2026-0${i + 1}-01`);
  });
  const a = services.analysis(db, "2026-05", 6, "2026-05-20");
  // Leading December (no data) is trimmed; May is still running.
  expect([a.months[0], a.current]).toEqual(["2026-01", "2026-05"]);
  const trend = Object.fromEntries(a.categories.map((t) => [t.category.name, t]));
  expect(trend["Eating out"]).toMatchObject({ months_over: 3, months_counted: 4, consistently_over: true, avg_spent: $(122.5) });
  expect(trend.Rent!.consistently_over).toBe(false);
  expect(a.flagged.map((t) => t.category.name)).toEqual(["Eating out"]);
  expect([a.months_over, a.avg_budget]).toEqual([3, $(1100)]);
  expect(trend["Eating out"]!.cells.map((c) => c.tone)).toEqual(["over", "near", "over", "over", "over"]);
});

test("months before a category existed do not count", () => {
  const { db, category, spend } = testCache();
  const pet = category("Pet", "budget", 80, { from_month: "2026-03" });
  spend(pet, 90, "2026-03-04");
  spend(category("Food", "budget", 100), 50, "2026-01-04");
  const a = services.analysis(db, "2026-03", 3, "2026-04-02");
  expect(a.categories.find((t) => t.category.name === "Pet")).toMatchObject({ months_counted: 1, avg_budget: $(80) });
});

test("recurring: month-end dates do not drift; weekly and yearly schedules", () => {
  const rule = { every: 1, unit: "month" as const, start_date: "2026-01-31", end_date: null, last_generated: null, month_offset: 0 };
  expect(services.datesBetween(rule, null, "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  expect(services.datesBetween({ ...rule, unit: "week", every: 2, start_date: "2026-01-01" }, null, "2026-01-31")).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
  expect(services.datesBetween({ ...rule, unit: "year", start_date: "2025-03-01" }, null, "2026-12-31")).toEqual(["2025-03-01", "2026-03-01"]);
  expect(services.datesBetween({ ...rule, unit: "year", start_date: "2024-02-29" }, null, "2026-03-01")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  expect(services.frequencyLabel({ every: 1, unit: "month" })).toBe("Monthly");
  expect(services.frequencyLabel({ every: 2, unit: "week" })).toBe("Every 2 weeks");
});

test("recurring: creates only what is due, only once, and edits change what is still to come", () => {
  const { db, category } = testCache();
  const bills = category("Bills");
  const rule = ledger.createRecurring(db, null, { title: "Rent", amount: $(1500), category_id: bills.id, start_date: "2026-01-05" });
  expect(services.generateDue(db, "2026-03-04")).toBe(2);
  expect(services.generateDue(db, "2026-03-04")).toBe(0);
  ledger.updateRecurring(db, rule.id, { title: "Rent (new lease)", amount: $(1600), category_id: bills.id, start_date: "2026-01-05" });
  expect(services.generateDue(db, "2026-03-05")).toBe(1);
  const made = db.select().from(transactions).where(eq(transactions.recurring_id, rule.id)).orderBy(transactions.date).all();
  expect(made.map((t) => [t.title, t.amount])).toEqual([["Rent", $(1500)], ["Rent", $(1500)], ["Rent (new lease)", $(1600)]]);
  expect(services.nextDate(ledger.getRecurring(db, rule.id))).toBe("2026-04-05");
  expect(services.upcoming(db, "2026-05-30", "2026-03-05").map((u) => u.date)).toEqual(["2026-04-05", "2026-05-05"]);

  // a deleted entry is not made again
  for (const t of made) ledger.deleteTransaction(db, t.id);
  expect(services.generateDue(db, "2026-03-20")).toBe(0);
});

test("recurring: previous-month bills, paused and ended rules, recurring income", () => {
  const { db, category } = testCache();
  const bills = category("Bills");
  const pay = category("Salary", "income");
  ledger.createRecurring(db, null, { title: "Transit bill", amount: $(96.4), category_id: bills.id, start_date: "2026-06-10", month_offset: -1 });
  const paused = ledger.createRecurring(db, null, { title: "Paused", amount: 100, category_id: bills.id, start_date: "2026-01-05" });
  ledger.toggleRecurring(db, paused.id, "2026-01-01");
  ledger.createRecurring(db, null, { title: "Gym", amount: 100, category_id: bills.id, start_date: "2026-01-05", end_date: "2026-02-01" });
  ledger.createRecurring(db, null, { type: "income", title: "Pay", amount: $(3000), category_id: pay.id, start_date: "2026-05-25" });
  services.generateDue(db, "2026-06-25");
  const rows = db.select().from(transactions).orderBy(transactions.date, transactions.title).all();
  expect(rows.map((t) => [t.title, t.date, t.month, t.type])).toEqual([
    ["Gym", "2026-01-05", "2026-01", "expense"],
    ["Pay", "2026-05-25", "2026-05", "income"],
    ["Transit bill", "2026-06-10", "2026-05", "expense"],
    ["Pay", "2026-06-25", "2026-06", "income"],
  ]);
  expect(new services.Book(db).received(pay.id, "2026-06")).toBe($(3000));

  // resuming skips what fell due while paused; today's entry is still made
  ledger.toggleRecurring(db, paused.id, "2026-07-05");
  expect(services.generateDue(db, "2026-07-05")).toBe(1);
  expect(db.select().from(recurring).where(eq(recurring.id, paused.id)).get()!.last_generated).toBe("2026-07-05");
  expect(() => ledger.createRecurring(db, null, { title: "x", amount: 1, category_id: pay.id, start_date: "2026-01-01" })).toThrow("for income");
  expect(() => ledger.createRecurring(db, null, { title: "x", amount: 1, category_id: bills.id, start_date: "2026-02-01", end_date: "2026-01-01" })).toThrow("can't be before");
});

test("adding a transaction with repeat starts a rule that picks up from the next date", () => {
  const { db, category } = testCache();
  const fun = category("Fun");
  const first = ledger.addTransaction(db, null, { amount: 1198, title: "Music", category_id: fun.id, date: "2026-03-10", month: "2026-02", repeat: "month" }, "2026-03-10");
  const rule = ledger.getRecurring(db, first.recurring_id!);
  expect(rule).toMatchObject({ title: "Music", unit: "month", start_date: "2026-03-10", last_generated: "2026-03-10", month_offset: -1 });
  expect(services.generateDue(db, "2026-04-10")).toBe(1);
  expect(db.select().from(transactions).all().map((t) => [t.date, t.month])).toEqual([["2026-03-10", "2026-02"], ["2026-04-10", "2026-03"]]);
});

test("categories: unique names, guessed icons, archive instead of delete when used", () => {
  const { db, category, spend } = testCache();
  const food = category("Groceries");
  expect(() => category("groceries")).toThrow("already a category called groceries");
  expect(ledger.displayIcon(food)).toBe("shopping-cart");
  expect(ledger.displayIcon({ icon: "letter", name: "Groceries" })).toBe("");
  expect(ledger.displayIcon({ icon: "airplane", name: "Groceries" })).toBe("airplane");
  expect(ledger.displayIcon({ icon: "", name: "Zzz" })).toBe("");
  expect(() => ledger.updateCategory(db, food.id, { icon: "nope" }, "2026-01-01")).toThrow("Pick an icon");
  spend(food, 5, "2026-01-02");
  expect(ledger.deleteCategory(db, food.id)).toBe("archived");
  expect(ledger.deleteCategory(db, category("Empty").id)).toBe("deleted");
  // an income category never gets a monthly amount
  const pay = category("Salary", "income", 500);
  expect(ledger.amountFor(db, pay.id, "2026-06")).toBe(0);
});

test("entry helpers: categories by recent use, titles with their last category", () => {
  const { db, category, spend } = testCache();
  const a = category("Alpha");
  const b = category("Beta");
  const fund = category("Car", "fund");
  category("Gone", "budget", 0, { archived: true });
  spend(b, 1, "2026-03-01", { title: "Coffee" });
  spend(b, 1, "2026-03-02", { title: "Coffee" });
  spend(a, 1, "2026-03-03", { title: "Coffee" });
  spend(fund, 1, "2026-01-01", { title: "Tyres" });
  expect(services.categoriesForEntry(db, "2026-03-10", 30).map((c) => c.name)).toEqual(["Beta", "Alpha", "Car"]);
  // newest entry first, each title once, with the category it was last used with
  expect(services.titleSuggestions(db)).toEqual([
    { t: "Tyres", c: fund.id, y: "expense" },
    { t: "Coffee", c: a.id, y: "expense" },
  ]);
});
