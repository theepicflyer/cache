import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configFromEnv, devUser, envSchema } from "warren/server";
import { createCache } from "../src/app.js";
import * as ledger from "../src/ledger.js";
import type { Kind, Type } from "../src/schema.js";

export function testCache(env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-test-"));
  const app = createCache({
    config: configFromEnv(
      envSchema.parse({
        DATA_DIR: path.join(dir, "data"),
        STATIC_DIR: path.join(dir, "static"),
        PUBLIC_URL: "http://localhost:8000",
        DEV_LOGIN: "true",
        SCHEDULER: "false",
        TIMEZONE: "Asia/Singapore",
        ...env,
      }),
    ),
  });
  const { db } = app;
  /** A category with a monthly amount (in dollars) from January 2026. */
  const category = (name: string, kind: Kind = "budget", amount = 0, extra: Partial<ledger.CategoryInput> = {}) =>
    ledger.createCategory(db, { name, kind, amount: amount * 100, from_month: "2026-01", ...extra }, "2026-01-01");
  /** A transaction; `amount` in dollars. */
  const spend = (cat: { id: number }, amount: number, date: string, extra: { month?: string; title?: string; type?: Type } = {}) =>
    ledger.addTransaction(db, null, { amount: Math.round(amount * 100), category_id: cat.id, date, title: "Spend", ...extra }, date);

  const json = { "content-type": "application/json", "x-warren": "1" };
  const as = async (name: string) => {
    const res = await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name }) });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const req = (method: string, url: string, body?: unknown) =>
      app.http.request(url, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      req,
      get: async (url: string) => (await req("GET", url)).json() as Promise<any>,
      send: async (method: string, url: string, body?: unknown) => {
        const res = await req(method, url, body ?? {});
        return { status: res.status, body: (await res.json()) as any };
      },
    };
  };
  return { app, db, category, spend, as, user: (name: string) => devUser(db, name) };
}
