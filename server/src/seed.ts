/**
 * Fill an empty ledger with fictional data, for local work and screenshots.
 *
 *   npm run seed            (uses DATA_DIR; refuses if the ledger has data)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { count, eq } from "drizzle-orm";
import { type Db, DB_FILE, loadConfig, openDatabase, runMigrations } from "warren/server";
import { MIGRATIONS } from "./app.js";
import * as ledger from "./ledger.js";
import { addDays, addMonths, monthOf, today as todayIn } from "./months.js";
import { categories, transactions } from "./schema.js";
import { generateDue } from "./services.js";

// name, monthly budget, titles, amount range, chance of a spend on any day
const BUDGETS: [string, number, string[], [number, number], number][] = [
  ["Groceries", 600, ["Supermarket", "Wet market", "Bakery", "Fruit stall"], [8, 90], 0.42],
  ["Eating out", 350, ["Chicken rice", "Laksa", "Coffee", "Dinner out", "Brunch"], [4, 60], 0.4],
  ["Transport", 260, ["Bus top-up", "Taxi", "Train"], [2, 30], 0.3],
  ["Household", 150, ["Cleaning supplies", "Hardware store", "Plants"], [5, 60], 0.12],
  ["Fun", 200, ["Cinema", "Books", "Concert", "Board game"], [10, 80], 0.12],
];
const FUNDS: [string, number, number | null, string[]][] = [
  ["Travel", 300, 3600, ["Flights", "Hotel", "Rail pass"]],
  ["Car", 150, null, ["Servicing", "Tyres", "Insurance"]],
  ["Gifts", 80, null, ["Birthday gift", "Wedding gift"]],
];

/** A small seeded generator, so the same seed gives the same ledger. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedLedger(db: Db, today: string, months = 8, seed = 7): number {
  return db.transaction((tx) => {
    const has = (table: typeof categories | typeof transactions) => tx.select({ n: count() }).from(table).get()!.n > 0;
    if (has(categories) || has(transactions)) throw new Error("The ledger already has data.");
    const rnd = random(seed);
    const pick = <T>(items: T[]) => items[Math.floor(rnd() * items.length)]!;
    const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const first = `${addMonths(monthOf(today), -(months - 1))}-01`;
    const days: string[] = [];
    for (let d = first; d <= today; d = addDays(d, 1)) days.push(d);
    const spend = (category_id: number, amount: number, title: string, date: string, type: "expense" | "income" = "expense") =>
      ledger.addTransaction(tx, null, { type, amount, title, category_id, date }, today);
    const ids: Record<string, number> = {};

    BUDGETS.forEach(([name, budget, titles, [lo, hi], chance], position) => {
      const cat = ledger.createCategory(tx, { name, kind: "budget", amount: budget * 100, from_month: first }, today);
      tx.update(categories).set({ position }).where(eq(categories.id, cat.id)).run();
      ids[name] = cat.id;
      for (const day of days) if (rnd() < chance) spend(cat.id, between(lo * 100, hi * 100), pick(titles), day);
    });
    // Eating out overspends most months; groceries got a bigger budget three months ago.
    ledger.setAmount(tx, ids.Groceries!, 70000, addMonths(monthOf(today), -2));

    FUNDS.forEach(([name, topup, target, titles], position) => {
      const cat = ledger.createCategory(
        tx,
        { name, kind: "fund", target: target === null ? null : target * 100, opening_balance: 20000, amount: topup * 100, from_month: first },
        today,
      );
      tx.update(categories).set({ position }).where(eq(categories.id, cat.id)).run();
      for (let i = between(1, 3); i > 0; i--) spend(cat.id, between(80, 600) * 100, pick(titles), pick(days));
    });

    const salary = ledger.createCategory(tx, { name: "Salary", kind: "income" }, today);
    const interest = ledger.createCategory(tx, { name: "Interest", kind: "income" }, today);
    tx.update(categories).set({ position: 1 }).where(eq(categories.id, interest.id)).run();
    for (const [title, amount] of [["Pay (Alex)", 420000], ["Pay (Sam)", 365000]] as const) {
      ledger.createRecurring(tx, null, { type: "income", title, amount, category_id: salary.id, unit: "month", start_date: addDays(first, 24) });
    }
    for (let m = monthOf(first); m <= monthOf(today); m = addMonths(m, 1)) {
      spend(interest.id, between(8, 30) * 100, "Savings interest", `${m}-01`, "income");
    }
    spend(ids.Fun!, 2490, "Returned shoes", addDays(today, -3), "income");

    ledger.createRecurring(tx, null, {
      title: "Transit card bill", amount: 9640, category_id: ids.Transport!, unit: "month",
      start_date: addDays(`${addMonths(monthOf(first), 1)}-01`, 9), month_offset: -1,
    });
    ledger.createRecurring(tx, null, {
      title: "Music subscription", amount: 1198, category_id: ids.Fun!, unit: "month", start_date: addDays(first, between(0, 27)),
    });
    generateDue(tx, today);
    return tx.select({ n: count() }).from(transactions).get()!.n;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const config = loadConfig();
  const database = openDatabase(path.join(config.dataDir, DB_FILE));
  runMigrations(database, [{ folder: MIGRATIONS, table: "cache_migrations" }]);
  console.log(`Seeded ${seedLedger(database.db, todayIn(config.timezone))} transactions.`);
  database.sqlite.close();
}
