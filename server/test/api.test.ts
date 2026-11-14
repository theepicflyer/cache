import { expect, test } from "vitest";
import * as ledger from "../src/ledger.js";
import { money, parseCents, plain, signedMoney } from "../src/money.js";
import { today } from "../src/months.js";
import { seedLedger } from "../src/seed.js";
import { testCache } from "./helpers.js";

test("money parses what people type and prints one way", () => {
  expect(["12.50", "12,50", "$ 1 250", "7", 12.5, "0.5"].map(parseCents)).toEqual([1250, 1250, 125000, 700, 1250, 50]);
  expect(["", "abc", "-5", "1.234", "1e3", null].map(parseCents)).toEqual([null, null, null, null, null, null]);
  expect([money(123450), money(-500), money(0), plain(-1205), signedMoney(500, "expense"), signedMoney(500, "income")]).toEqual([
    "$1,234.50", "−$5.00", "$0.00", "-12.05", "−$5.00", "+$5.00",
  ]);
});

test("the API needs a signed-in person", async () => {
  const { app } = testCache();
  for (const url of ["/api/home", "/api/history", "/api/trends", "/api/categories", "/api/recurring", "/api/entry"]) {
    expect([url, (await app.http.request(url)).status]).toEqual([url, 401]);
  }
});

test("adding, editing and deleting through the entry flow's endpoints", async () => {
  const cache = testCache();
  const food = cache.category("Food", "budget", 300);
  const pay = cache.category("Salary", "income");
  const alice = await cache.as("Alice");

  const entry = await alice.get("/api/entry");
  expect(entry.cats.map((c: any) => [c.name, c.kind])).toEqual([["Food", "budget"], ["Salary", "income"]]);
  expect(entry.today).toBe(today("Asia/Singapore"));

  const added = await alice.send("POST", "/api/transactions", { amount: "12,50", title: " Laksa ", category: food.id, date: "2026-03-05" });
  expect(added.status).toBe(200);
  expect(added.body).toMatchObject({ ok: true, toast: "Laksa added: −$12.50", spend: { title: "Laksa", amount: 1250, month: "2026-03", type: "expense", counts_elsewhere: false } });
  expect(added.body.undo).toBe(added.body.spend.id);
  expect(added.body.spend.category).toMatchObject({ name: "Food", display_icon: "bowl-food" });

  // no title: the category's name; another month; income in a budget is money back
  const back = await alice.send("POST", "/api/transactions", { type: "income", amount: "5", category: food.id, date: "2026-04-02", month: "2026-03" });
  expect(back.body).toMatchObject({ toast: "Food added: +$5.00", spend: { title: "Food", month: "2026-03", counts_elsewhere: true } });

  const id = added.body.spend.id;
  const edited = await alice.send("PATCH", `/api/transactions/${id}`, { amount: "20", title: "Laksa", category: food.id, note: "with egg" });
  expect(edited.body).toMatchObject({ toast: "Laksa updated: −$20.00", undo: null, spend: { amount: 2000, date: "2026-03-05", note: "with egg" } });
  expect((await alice.get(`/api/transactions/${id}`)).amount).toBe(2000);

  for (const [body, errors] of [
    [{ amount: "0", category: food.id }, { amount: "Enter an amount above zero." }],
    [{ amount: "abc", category: food.id }, { amount: "Enter an amount above zero." }],
    [{ amount: "5" }, { category: "Pick a category." }],
    [{ amount: "5", category: pay.id }, { category: "Salary is for income. Pick another category." }],
    [{ amount: "5", category: 9999 }, { category: "Pick a category." }],
  ] as const) {
    const res = await alice.send("POST", "/api/transactions", body);
    expect([res.status, res.body]).toEqual([400, { ok: false, errors }]);
  }

  const gone = await alice.send("DELETE", `/api/transactions/${id}`);
  expect(gone.body).toMatchObject({ ok: true, toast: "Laksa deleted" });
  expect((await alice.req("GET", `/api/transactions/${id}`)).status).toBe(404);

  // who entered it is recorded; the ledger itself is shared
  expect(ledger.getTransaction(cache.db, back.body.spend.id).created_by).toBe(cache.user("Alice").id);
  const bob = await cache.as("Bob");
  expect((await bob.get("/api/history")).count).toBe(1);
});

test("home, history and trends on a seeded ledger", async () => {
  const cache = testCache();
  const now = today("Asia/Singapore");
  const total = seedLedger(cache.db, now);
  expect(total).toBeGreaterThan(300);
  expect(() => seedLedger(cache.db, now)).toThrow("already has data");
  const alice = await cache.as("Alice");

  const home = await alice.get("/api/home");
  expect(home).toMatchObject({ month: now.slice(0, 7), is_current: true });
  expect(home.status.budgets.map((b: any) => b.category.name)).toEqual(["Groceries", "Eating out", "Transport", "Household", "Fun"]);
  expect(home.status.funds.map((f: any) => f.category.name)).toEqual(["Travel", "Car", "Gifts"]);
  expect(home.status.budgets[0]).toMatchObject({ budget: 70000, category: { display_icon: "shopping-cart" } });
  expect(home.status.total_budget).toBe(70000 + 35000 + 26000 + 15000 + 20000);
  expect(home.recent.length).toBeLessThanOrEqual(6);
  expect(home.status.days_left).toBeGreaterThanOrEqual(0);
  const earlier = await alice.get(`/api/home?month=${home.prev_month}`);
  expect([earlier.is_current, earlier.upcoming, earlier.status.days_left]).toEqual([false, [], null]);

  const history = await alice.get("/api/history");
  expect(history.count).toBe(total);
  expect(history.pages).toBe(Math.ceil(total / 60));
  expect(history.days.flatMap((d: any) => d.rows)).toHaveLength(60);
  expect(history.days[0].date >= history.days[1].date).toBe(true);
  expect(history.months).toHaveLength(25);
  const last = await alice.get(`/api/history?page=${history.pages}`);
  expect(last.days.flatMap((d: any) => d.rows)).toHaveLength(total - 60 * (history.pages - 1));

  const laksa = await alice.get("/api/history?q=laksa&type=expense");
  expect(laksa.filtered).toBe(true);
  expect(laksa.days.flatMap((d: any) => d.rows).every((r: any) => r.title === "Laksa")).toBe(true);
  expect(laksa.spent).toBeGreaterThan(0);
  expect(laksa.received).toBe(0);
  const salary = history.categories.find((c: any) => c.name === "Salary");
  const pay = await alice.get(`/api/history?category=${salary.id}&month=${home.prev_month}`);
  expect([pay.count, pay.spent, pay.received]).toEqual([2, 0, 785000]);
  expect((await alice.get("/api/history?q=100%25")).count).toBe(0); // % is text, not a wildcard

  const trends = await alice.get("/api/trends");
  expect(trends.months).toHaveLength(8);
  expect(trends.current).toBe(now.slice(0, 7));
  expect(trends.categories.map((t: any) => t.category.name).sort()).toEqual(["Eating out", "Fun", "Groceries", "Household", "Transport"]);
  expect(trends.funds).toHaveLength(3);
  expect(trends.flows.at(-1).partial).toBe(true);
  expect(trends.next_end).toBeNull();
  expect((await alice.get("/api/trends?months=99")).span).toBe(24);
});

test("settings: categories, the all-amounts editor, and amount changes", async () => {
  const cache = testCache();
  const alice = await cache.as("Alice");
  const made = await alice.send("POST", "/api/categories", { name: "Groceries", kind: "budget", amount: "600", from_month: "2026-01" });
  expect(made.body).toMatchObject({ ok: true, toast: "Groceries added", category: { display_icon: "shopping-cart" } });
  const fund = await alice.send("POST", "/api/categories", { name: "Travel", kind: "fund", amount: "300", from_month: "2026-01", opening_balance: "200", target: "3600" });
  const income = await alice.send("POST", "/api/categories", { name: "Salary", kind: "income" });
  expect((await alice.send("POST", "/api/categories", { name: "groceries" })).body).toEqual({ ok: false, errors: { name: "There is already a category called groceries." } });
  expect((await alice.send("POST", "/api/categories", { name: "X", amount: "lots" })).body.errors).toEqual({ amount: "Enter an amount like 250." });
  expect((await alice.send("POST", "/api/categories", { name: "X", icon: "nope" })).body.errors).toEqual({ icon: "Pick an icon from the list." });

  const id = made.body.category.id;
  const saved = await alice.send("PATCH", `/api/categories/${id}`, { name: "Food", icon: "letter", amount: "700", from_month: "2026-06" });
  expect(saved.body).toMatchObject({ toast: "Food saved", category: { name: "Food", display_icon: "" } });

  const detail = await alice.get(`/api/categories/${id}`);
  expect(detail.amounts.map((a: any) => [a.start_month, a.amount])).toEqual([["2026-06", 70000], ["2026-01", 60000]]);
  expect(detail.history.kind).toBe("budget");
  expect(detail.history.months).toHaveLength(12);
  expect((await alice.get(`/api/categories/${fund.body.category.id}`)).history).toMatchObject({ kind: "fund" });
  expect((await alice.get(`/api/categories/${income.body.category.id}`)).history).toMatchObject({ kind: "income" });

  const budgets = await alice.get("/api/budgets?from_month=2026-07");
  expect(budgets.rows.map((r: any) => [r.category.name, r.amount])).toEqual([["Food", 70000], ["Travel", 30000]]);
  expect(budgets.month_choices).toHaveLength(16);
  const bad = await alice.send("PUT", "/api/budgets", { from_month: "2026-07", amounts: { [id]: "abc", [fund.body.category.id]: "350" } });
  expect([bad.status, bad.body.errors]).toEqual([400, { [id]: "Enter an amount like 250." }]);
  const ok = await alice.send("PUT", "/api/budgets", { from_month: "2026-07", amounts: { [id]: "700", [fund.body.category.id]: "1,350", 999: "" } });
  expect(ok.body).toMatchObject({ changed: 1, toast: "1 amounts updated from July 2026" });
  expect(ledger.amountFor(cache.db, fund.body.category.id, "2026-07")).toBe(135000);
  expect(ledger.amountFor(cache.db, fund.body.category.id, "2026-06")).toBe(30000);

  // removing a change brings back the amount before it; the last row stays
  const rows = (await alice.get(`/api/categories/${id}`)).amounts;
  expect((await alice.send("DELETE", `/api/amounts/${rows[0].id}`)).body.toast).toBe("Change removed");
  await alice.send("DELETE", `/api/amounts/${rows[1].id}`);
  expect((await alice.get(`/api/categories/${id}`)).amounts).toHaveLength(1);

  const settings = await alice.get("/api/categories");
  expect(settings.categories.map((c: any) => [c.name, c.kind, c.balance === null])).toEqual([["Food", "budget", true], ["Travel", "fund", false], ["Salary", "income", true]]);
  expect(settings.mcp_url).toBe("http://localhost:8000/mcp");

  cache.spend({ id }, 5, "2026-03-01");
  expect((await alice.send("DELETE", `/api/categories/${id}`)).body).toMatchObject({ result: "archived", toast: "Food has transactions, so it was archived instead." });
  expect((await alice.send("DELETE", `/api/categories/${income.body.category.id}`)).body).toMatchObject({ result: "deleted", toast: "Salary deleted" });
  expect((await alice.req("GET", "/api/categories/99999")).status).toBe(404);
});

test("recurring rules: create, list with monthly totals, pause, delete", async () => {
  const cache = testCache();
  const bills = cache.category("Bills");
  const pay = cache.category("Salary", "income");
  const alice = await cache.as("Alice");
  const start = today("Asia/Singapore");
  const rent = await alice.send("POST", "/api/recurring", { title: "Rent", amount: "1500", category: bills.id, start_date: start });
  expect(rent.body).toMatchObject({ ok: true, created: 1, toast: "Rent saved", rule: { frequency: "Monthly", last_generated: start } });
  await alice.send("POST", "/api/recurring", { type: "income", title: "Pay", amount: "4000", category: pay.id, start_date: start, every: 2, unit: "week" });
  await alice.send("POST", "/api/recurring", { title: "Insurance", amount: "1200", category: bills.id, start_date: start, unit: "year" });
  for (const [body, errors] of [
    [{ title: "", amount: "5", category: bills.id, start_date: start }, { title: "Give it a title." }],
    [{ title: "x", amount: "0", category: bills.id, start_date: start }, { amount: "Enter an amount above zero." }],
    [{ title: "x", amount: "5", category: pay.id, start_date: start }, { category: "Salary is for income. Pick another category." }],
    [{ title: "x", amount: "5", category: bills.id, start_date: start, end_date: "2020-01-01" }, { end_date: "The last date can't be before the first." }],
  ] as const) {
    expect((await alice.send("POST", "/api/recurring", body)).body).toEqual({ ok: false, errors });
  }

  const list = await alice.get("/api/recurring");
  expect(list.rules.map((r: any) => r.title).sort()).toEqual(["Insurance", "Pay", "Rent"]);
  expect([list.monthly_out, list.monthly_in]).toEqual([150000 + 10000, Math.round((400000 * (52 / 12)) / 2)]);

  const id = rent.body.rule.id;
  const edited = await alice.send("PATCH", `/api/recurring/${id}`, { title: "Rent", amount: "1600", category: bills.id, start_date: start });
  expect(edited.body).toMatchObject({ created: 0, rule: { amount: 160000, last_generated: start } });
  expect((await alice.send("POST", `/api/recurring/${id}/toggle`)).body).toMatchObject({ toast: "Rent paused", rule: { paused: true, next: null } });
  expect((await alice.send("POST", `/api/recurring/${id}/toggle`)).body.toast).toBe("Rent resumed");
  expect((await alice.send("DELETE", `/api/recurring/${id}`)).body.toast).toBe("Rent deleted. Past entries were kept.");
  const kept = (await alice.get("/api/history?q=Rent")).days[0].rows[0];
  expect([kept.title, kept.recurring_id, kept.recurring_title]).toEqual(["Rent", null, ""]);
  expect((await alice.get("/api/home")).upcoming.map((u: any) => u.rule.title)).toEqual(["Pay"]);
});
