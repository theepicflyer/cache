/** Cache, assembled: the household ledger on Warren. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AppOptions, type Config, createApp, type Db, loadConfig, schema as warren, type User, type WarrenApp } from "warren/server";
import { routes } from "./api.js";
import { today } from "./months.js";
import { generateDue } from "./services.js";
import { cacheTools, INSTRUCTIONS } from "./tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS = path.resolve(here, "../migrations");

export interface CacheOptions {
  config?: Config;
}

const people = (db: Db) => new Map<number, User>(db.select().from(warren.users).all().map((u) => [u.id, u]));

export function createCache(options: CacheOptions = {}): WarrenApp {
  const config = options.config ?? loadConfig();
  const tz = config.timezone;
  const appOptions: AppOptions = {
    name: "cache",
    config,
    migrations: MIGRATIONS,
    tools: cacheTools(tz, people),
    mcpInstructions: INSTRUCTIONS,
    me: () => ({ today: today(tz), timezone: tz }),
    routes,
    // Pages also catch up when they load; this keeps the ledger current when nobody is looking.
    jobs: ({ db }) => [{ name: "recurring", run: (now) => void generateDue(db, today(tz, now)) }],
  };
  return createApp(appOptions);
}
