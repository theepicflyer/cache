import { defineConfig } from "drizzle-kit";

// Cache's tables only; Warren's (warren_*) have their own migrations.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
  tablesFilter: ["!warren_*"],
});
