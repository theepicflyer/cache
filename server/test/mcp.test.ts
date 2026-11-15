import net from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as ledger from "../src/ledger.js";
import { today } from "../src/months.js";
import { testCache } from "./helpers.js";

let cache: ReturnType<typeof testCache>;
let base: string;
const NOW = today("Asia/Singapore");
const MONTH = NOW.slice(0, 7);

beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
  cache = testCache({ PORT: String(port), HOST: "127.0.0.1", MCP_DEV_USER: "Alice" });
  base = `http://127.0.0.1:${port}`;
  await cache.app.start();
});
afterAll(() => cache.app.stop());

async function rpc(method: string, params: unknown) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") || text);
}
/** Call a tool: its data, or the error text when it refused. */
async function call(name: string, args: unknown = {}): Promise<any> {
  const out = await rpc("tools/call", { name, arguments: args });
  const text = out.result?.content?.[0]?.text ?? JSON.stringify(out.error);
  return out.result && !out.result.isError ? JSON.parse(text) : { error: text };
}

test("the nine tools are listed, with reads marked read-only", async () => {
  const tools = (await rpc("tools/list", {})).result.tools;
  expect(Object.fromEntries(tools.map((t: any) => [t.name, t.annotations.readOnlyHint]))).toEqual({
    add_transaction: false, delete_transaction: false, get_budget_analysis: true, get_ledger_info: true,
    get_month_summary: true, list_categories: true, list_recurring: true, list_transactions: true, update_transaction: false,
  });
  const info = await call("get_ledger_info");
  expect(info).toMatchObject({ currency: "$", today: NOW, current_month: MONTH, can_write: true, signed_in_as: { name: "Alice" } });
});

test("log, find, change and delete a transaction, seeing where its category stands", async () => {
  const food = cache.category("Food", "budget", 300, { from_month: MONTH });
  const travel = cache.category("Travel", "fund", 200, { from_month: MONTH, opening_balance: 10000, target: 360000 });
  const pay = cache.category("Salary", "income");
  cache.category("Old", "budget", 0, { archived: true });

  const cats = await call("list_categories");
  expect(cats.categories).toEqual([
    { id: food.id, name: "Food", kind: "budget", archived: false, monthly_amount: "300.00" },
    { id: travel.id, name: "Travel", kind: "fund", archived: false, monthly_amount: "200.00", balance: "300.00", target: "3600.00" },
    { id: pay.id, name: "Salary", kind: "income", archived: false, monthly_amount: null },
  ]);
  expect((await call("list_categories", { include_archived: true })).categories).toHaveLength(4);

  const added = await call("add_transaction", { amount: 12.5, title: "Weekly groceries", category_id: food.id });
  expect(added.transaction).toMatchObject({ date: NOW, month: MONTH, type: "expense", amount: "12.50", category: { name: "Food", kind: "budget" }, created_by: { name: "Alice" } });
  expect(added.category_month).toEqual({ category_id: food.id, name: "Food", kind: "budget", month: MONTH, budget: "300.00", spent: "12.50", left: "287.50", over: false });
  // the type follows the category when left out
  const salary = await call("add_transaction", { amount: "4000", title: "Pay", category_id: pay.id });
  expect([salary.transaction.type, salary.category_month.received]).toEqual(["income", "4000.00"]);
  const flights = await call("add_transaction", { amount: "450.00", title: "Flights", category_id: travel.id, note: " return " });
  expect(flights.category_month).toMatchObject({ topup: "200.00", spent: "450.00", balance: "-150.00" });
  expect(flights.transaction.note).toBe("return");

  for (const [args, reason] of [
    [{ amount: "12.505", title: "x", category_id: food.id }, "at most 2 decimal places"],
    [{ amount: "$5", title: "x", category_id: food.id }, "plain positive number"],
    [{ amount: 0, title: "x", category_id: food.id }, "more than 0"],
    [{ amount: 5, title: " ", category_id: food.id }, "title must not be empty"],
    [{ amount: 5, title: "x", category_id: 9999 }, "no category with id 9999"],
    [{ amount: 5, title: "x", category_id: pay.id, type: "expense" }, "Salary is for income"],
    [{ amount: 5, title: "x", category_id: food.id, date: "5 May" }, "date must be a date like 2026-05-20"],
    [{ amount: 5, title: "x", category_id: food.id, month: "May" }, "month must be a month like 2026-05"],
    [{ amount: 5, title: "x", category_id: food.id, type: "refund" }, 'type must be one of "expense", "income"'],
  ] as const) {
    expect((await call("add_transaction", args)).error).toContain(reason);
  }

  const id = added.transaction.id;
  const found = await call("list_transactions", { search: "GROCER" });
  expect([found.total, found.total_expenses, found.total_income, found.has_more, found.transactions[0].id]).toEqual([1, "12.50", "0.00", false, id]);
  const page = await call("list_transactions", { month: MONTH, limit: 2 });
  expect([page.total, page.transactions.length, page.has_more, page.total_expenses, page.total_income]).toEqual([3, 2, true, "462.50", "4000.00"]);
  expect((await call("list_transactions", { date_from: "2030-01-02", date_to: "2030-01-01" })).error).toContain("date_from is after date_to");

  // changing the date moves the month with it, unless the month was set apart
  const moved = await call("update_transaction", { id, date: "2026-01-15", amount: "20" });
  expect([moved.changed, moved.transaction.month, moved.transaction.amount]).toEqual([["amount", "date"], "2026-01", "20.00"]);
  const apart = await call("update_transaction", { id, month: "2025-12" });
  expect((await call("update_transaction", { id, date: "2026-01-20" })).transaction.month).toBe("2025-12");
  expect(apart.category_month.month).toBe("2025-12");
  expect((await call("update_transaction", { id })).error).toContain("Nothing to change");
  expect((await call("update_transaction", { id, category_id: pay.id })).error).toContain("Salary is for income");
  expect((await call("update_transaction", { id: 9999, title: "x" })).error).toContain("no transaction with id 9999");

  const gone = await call("delete_transaction", { id });
  expect([gone.deleted.id, gone.category_month.spent]).toEqual([id, "0.00"]);
  expect(() => ledger.getTransaction(cache.db, id)).toThrow();
});

test("month summary, analysis and recurring rules", async () => {
  const summary = await call("get_month_summary");
  expect(summary).toMatchObject({
    month: MONTH, is_current_month: true,
    budget_totals: { budget: "300.00", spent: "0.00", left: "300.00", over: false, percent_used: 0, ahead_of_pace: false },
    fund_spent_total: "450.00",
    flow: { income: "4000.00", out: "450.00", net: "3550.00" },
  });
  expect(summary.days_left).toBeGreaterThanOrEqual(0);
  const past = await call("get_month_summary", { month: "2026-01" });
  expect([past.is_current_month, "days_left" in past, "ahead_of_pace" in past.budget_totals]).toEqual([false, false, false]);

  const a = await call("get_budget_analysis", { months: 3 });
  expect(a.current_month).toBe(MONTH);
  expect(a.categories[0]).toMatchObject({ name: "Food", budget_now: "300.00", months_counted: 0, consistently_over: false });
  expect(a.funds[0]).toMatchObject({ name: "Travel", topup_now: "200.00", balance_at_end: "-150.00", target: "3600.00" });
  expect(a.flows.by_month.at(-1)).toMatchObject({ income: "4000.00", out: "450.00", partial: true });
  expect((await call("get_budget_analysis", { months: 40 })).error).toContain("between 1 and 36");

  const food = (await call("list_categories")).categories[0];
  ledger.createRecurring(cache.db, null, { title: "Transit bill", amount: 9640, category_id: food.id, start_date: NOW, month_offset: -1 });
  const rules = (await call("list_recurring")).recurring;
  expect(rules).toHaveLength(1);
  // reading the list created today's entry, as opening the app would
  expect(rules[0]).toMatchObject({ title: "Transit bill", amount: "96.40", frequency: "Monthly", counts_toward: "previous month", last_created: NOW, paused: false });
  expect(rules[0].next_date > NOW).toBe(true);
  expect((await call("list_transactions", { search: "transit" })).transactions[0]).toMatchObject({ recurring_id: rules[0].id, created_by: null });
});
