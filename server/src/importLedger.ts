/**
 * One-off: bring the ledger from the Django version of Cache (Postgres) into this one.
 *
 * 1. Export it from the old database as one JSON document (the query is `EXPORT_SQL` below, also in
 *    MIGRATIONS.md):
 *      psql -U wygiwyh -d wygiwyh -At -f export.sql > ledger.json
 * 2. With the app stopped, into an empty DATA_DIR:
 *      node dist/importLedger.js ledger.json
 *
 * Ids are kept. People keep their Pocket ID identity when they signed in to the old app with it
 * (the allauth uid is the OIDC `sub`), so their first sign-in finds them; anyone else is stored as
 * `legacy:<email>` and gets a new person on first sign-in, their old entries keeping the old name.
 * Only the ledger comes over: the WYGIWYH tables under /legacy/ were imported into it already.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { type Db, DB_FILE, loadConfig, openDatabase, runMigrations, schema as warren } from "warren/server";
import { MIGRATIONS } from "./app.js";
import { categories, monthly_amounts, recurring, transactions } from "./schema.js";

export const EXPORT_SQL = `SELECT json_build_object(
  'users', (SELECT coalesce(json_agg(json_build_object(
      'id', u.id, 'email', u.email, 'first_name', u.first_name, 'last_name', u.last_name,
      'date_joined', u.date_joined,
      'sub', (SELECT s.uid FROM socialaccount_socialaccount s WHERE s.user_id = u.id ORDER BY s.id LIMIT 1)
    ) ORDER BY u.id), '[]') FROM users_user u),
  'categories', (SELECT coalesce(json_agg(c ORDER BY c.id), '[]') FROM ledger_category c),
  'monthly_amounts', (SELECT coalesce(json_agg(m ORDER BY m.id), '[]') FROM ledger_monthlyamount m),
  'recurring', (SELECT coalesce(json_agg(r ORDER BY r.id), '[]') FROM ledger_recurring r),
  'transactions', (SELECT coalesce(json_agg(t ORDER BY t.id), '[]') FROM ledger_transaction t)
);`;

type Row = Record<string, any>;
export interface LedgerExport {
  users: Row[];
  categories: Row[];
  monthly_amounts: Row[];
  recurring: Row[];
  transactions: Row[];
}

/** Postgres numerics arrive as JSON numbers or strings with at most two decimals. */
const cents = (v: number | string | null): number | null => (v == null ? null : Math.round(Number(v) * 100));
/** A date column ("2026-05-01") as a month ("2026-05"). */
const month = (v: string) => v.slice(0, 7);
const day = (v: string | null) => (v == null ? null : v.slice(0, 10));
const time = (v: string | null) => (v == null ? undefined : new Date(v));

export function importLedger(db: Db, data: LedgerExport): Record<string, number> {
  const counts: Record<string, number> = {};
  /** Insert in chunks; SQLite caps the number of bound values in one statement. */
  const insert = (name: string, table: any, rows: Row[]) => {
    counts[name] = rows.length;
    if (!rows.length) return;
    const chunk = Math.max(1, Math.floor(900 / Object.keys(rows[0]!).length));
    for (let i = 0; i < rows.length; i += chunk) db.insert(table).values(rows.slice(i, i + chunk)).run();
  };

  db.transaction((tx) => {
    const n = (table: any) => tx.select({ n: sql<number>`count(*)` }).from(table).get()!.n;
    if (n(warren.users) || n(categories) || n(transactions)) {
      throw new Error("this database already has people or a ledger in it; import into an empty one");
    }
    insert("people", warren.users, data.users.map((u) => ({
      id: u.id,
      oidcSub: u.sub || `legacy:${u.email}`,
      email: u.email || null,
      name: [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || String(u.email || "user").split("@")[0],
      createdAt: time(u.date_joined),
    })));
    insert("categories", categories, data.categories.map((c) => ({
      id: c.id, name: c.name, kind: c.kind, icon: c.icon ?? "", position: c.position, archived: Boolean(c.archived),
      opening_balance: cents(c.opening_balance) ?? 0, target: cents(c.target),
      created_at: time(c.created_at), updated_at: time(c.updated_at),
    })));
    insert("monthly amounts", monthly_amounts, data.monthly_amounts.map((m) => ({
      id: m.id, category_id: m.category_id, start_month: month(m.start_month), amount: cents(m.amount)!,
    })));
    insert("recurring", recurring, data.recurring.map((r) => ({
      id: r.id, type: r.type, title: r.title, amount: cents(r.amount)!, category_id: r.category_id, note: r.note ?? "",
      every: r.every, unit: r.unit, start_date: day(r.start_date)!, end_date: day(r.end_date),
      month_offset: r.month_offset, paused: Boolean(r.paused), last_generated: day(r.last_generated),
      created_by: r.created_by_id, created_at: time(r.created_at), updated_at: time(r.updated_at),
    })));
    insert("transactions", transactions, data.transactions.map((t) => ({
      id: t.id, type: t.type, amount: cents(t.amount)!, title: t.title, category_id: t.category_id,
      date: day(t.date)!, month: month(t.month), note: t.note ?? "", recurring_id: t.recurring_id,
      created_by: t.created_by_id, created_at: time(t.created_at), updated_at: time(t.updated_at),
    })));
  });
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node dist/importLedger.js <ledger.json>   (stop the app first)");
    console.error("export it from the old database with:\n");
    console.error(EXPORT_SQL);
    process.exit(2);
  }
  const { dataDir } = loadConfig();
  const database = openDatabase(path.join(dataDir, DB_FILE));
  runMigrations(database, [{ folder: MIGRATIONS, table: "cache_migrations" }]);
  const counts = importLedger(database.db, JSON.parse(fs.readFileSync(file, "utf8")));
  database.sqlite.close();
  for (const [name, n] of Object.entries(counts)) console.log(`${String(n).padStart(7)} ${name}`);
  console.log(`imported ${file} into ${dataDir}`);
}
